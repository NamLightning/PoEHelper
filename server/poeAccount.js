import { randomUUID } from 'node:crypto'
import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configuredSessionId, poeHeaders, logPoeForbidden, poeFetch } from './poeRequest.js'
import { createCharacterCache, characterCacheKey } from './poeCharacterCache.js'

const characterCache = createCharacterCache()

const CONFIG_PATH = process.env.POESTASH_CONFIG_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../config.local.json')
const CHARACTERS_URL = 'https://www.pathofexile.com/character-window/get-characters'
const CHARACTER_ITEMS_URL = 'https://www.pathofexile.com/character-window/get-items'

export class AccountApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'AccountApiError'
    this.status = status
    this.code = code
  }
}

async function readLocalConfig() {
  try {
    const contents = await readFile(CONFIG_PATH, 'utf8')
    const config = JSON.parse(contents)
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('config.local.json must contain a JSON object.')
    }
    return config
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

async function readAccountCredentials() {
  const localConfig = await readLocalConfig()
  const accountName = process.env.POE_ACCOUNT_NAME || localConfig.POE_ACCOUNT_NAME || localConfig.accountName || ''
  const sessionId = configuredSessionId(localConfig, process.env)

  return {
    accountName: typeof accountName === 'string' ? accountName.trim() : '',
    sessionId: typeof sessionId === 'string' ? sessionId.trim() : '',
    source: process.env.POE_ACCOUNT_NAME || (!Object.hasOwn(localConfig, 'POESESSID') && process.env.POESESSID) ? 'environment' : 'local',
  }
}

function isValidAccountName(accountName) {
  return /^[^#\s\u0000-\u001f\u007f]{1,64}#[^#\s\u0000-\u001f\u007f]{1,32}$/.test(accountName)
}

function isValidSessionId(sessionId) {
  return sessionId.length >= 8
    && sessionId.length <= 1024
    && !/[\u0000-\u0020\u007f;]/.test(sessionId)
}

async function requireAccountCredentials({ requireSession = false } = {}) {
  const credentials = await readAccountCredentials()
  if (!isValidAccountName(credentials.accountName) || (credentials.sessionId && !isValidSessionId(credentials.sessionId))) {
    throw new AccountApiError(
      400,
      'ACCOUNT_NOT_CONFIGURED',
      'Configure a valid Account Name#Tag and an optional valid POESESSID first.',
    )
  }
  if (requireSession && !credentials.sessionId) throw new AccountApiError(400, 'STASH_SESSION_REQUIRED', 'Stash sync requires POESESSID. Public mode supports character profiles.')
  return credentials
}

export async function getStashCredentials() {
  const credentials = await requireAccountCredentials({ requireSession: true })
  return {
    accountName: credentials.accountName.split('#')[0].trim(),
    rawAccountName: credentials.accountName,
    sessionId: credentials.sessionId,
  }
}

export async function getAccountConfigStatus() {
  const { accountName, sessionId, source } = await readAccountCredentials()
  const accountNameConfigured = isValidAccountName(accountName)
  const cookieConfigured = isValidSessionId(sessionId)

  return {
    configured: accountNameConfigured && (!sessionId || cookieConfigured),
    mode: cookieConfigured ? 'authenticated' : 'public',
    accountName: accountName || '',
    accountNameConfigured,
    cookieConfigured,
    source,
  }
}

export async function saveAccountConfig({ accountName, poeSessId }) {
  if (typeof accountName !== 'string' || !isValidAccountName(accountName.trim())) {
    throw new AccountApiError(
      400,
      'INVALID_ACCOUNT_NAME',
      'Enter the account name in Name#Tag format.',
    )
  }
  if (poeSessId !== undefined && typeof poeSessId !== 'string') {
    throw new AccountApiError(400, 'INVALID_SESSION_ID', 'POESESSID must be a string.')
  }

  const current = await readAccountCredentials()
  const sessionId = typeof poeSessId === 'string' ? poeSessId.trim().replace(/^POESESSID=/i, '').trim() : current.sessionId
  if (sessionId && !isValidSessionId(sessionId)) {
    throw new AccountApiError(400, 'INVALID_SESSION_ID', 'Enter a valid POESESSID.')
  }

  const config = {
    ...await readLocalConfig(),
    POE_ACCOUNT_NAME: accountName.trim(),
    POESESSID: sessionId,
  }
  delete config.poesessid
  delete config.poeSessId
  const temporaryPath = `${CONFIG_PATH}.${randomUUID()}.tmp`

  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, CONFIG_PATH)
  } catch (error) {
    try {
      await unlink(temporaryPath)
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw cleanupError
    }
    throw error
  }

  characterCache.clear()
  return getAccountConfigStatus()
}

function getCredentialsError(error) {
  if (error instanceof AccountApiError) return error
  return new AccountApiError(
    500,
    'ACCOUNT_CONFIG_ERROR',
    error instanceof Error ? error.message : 'Could not read local account configuration.',
  )
}

function fetchPoeJson(url, sessionId, options) {
  return characterCache.get(characterCacheKey(url, sessionId), () => requestPoeJson(url, sessionId, options), options)
}

async function requestPoeJson(url, sessionId, { notFoundCode, notFoundMessage }) {
  let response
  try {
    response = await poeFetch(url, {
      headers: poeHeaders(sessionId),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    if (error?.status === 429) throw error
    throw new AccountApiError(
      502,
      'POE_UNAVAILABLE',
      error instanceof Error ? error.message : 'Could not reach pathofexile.com.',
    )
  }

  let data, validJson = true
  try { data = await response.json() } catch { validJson = false }
  logPoeForbidden(url, response.status, data)
  if (response.status === 401 || response.status === 403 || Number(data?.error?.code) === 6) {
    throw new AccountApiError(
      response.status === 401 ? 401 : 403,
      sessionId ? 'SESSION_INVALID' : 'PROFILE_FORBIDDEN',
      sessionId ? 'POESESSID is expired or invalid. Update the cookie and try again.' : 'GGG refused the public profile. Check that the profile is public or provide POESESSID.',
    )
  }
  if (response.status === 404) {
    throw new AccountApiError(404, notFoundCode, notFoundMessage)
  }
  if (!response.ok) {
    throw new AccountApiError(
      502,
      'POE_UPSTREAM_ERROR',
      `pathofexile.com returned HTTP ${response.status}.`,
    )
  }

  if (!validJson) {
    throw new AccountApiError(
      502,
      'POE_INVALID_RESPONSE',
      'pathofexile.com did not return valid JSON. Check the cookie and try again.',
    )
  }
  const endpoint = new URL(url).pathname
  const valid = endpoint.endsWith('/get-characters') ? Array.isArray(data)
    : endpoint.endsWith('/get-items') ? Array.isArray(data?.items) : Array.isArray(data?.hashes)
  if (!valid) throw new AccountApiError(502, 'POE_INVALID_RESPONSE', 'GGG returned invalid character data.')
  return data
}

function encodeAccountName(accountName) {
  return encodeURIComponent(accountName)
}

export async function getAccountCharacters(options = {}) {
  let credentials
  try {
    credentials = await requireAccountCredentials()
  } catch (error) {
    throw getCredentialsError(error)
  }

  const data = await fetchPoeJson(
    `${CHARACTERS_URL}?accountName=${encodeAccountName(credentials.accountName)}&realm=pc`,
    credentials.sessionId,
    {
      notFoundCode: 'ACCOUNT_NOT_FOUND',
      notFoundMessage: 'Account not found. Check the account name and tag.',
      force: options.force === true,
    },
  )
  if (!Array.isArray(data)) {
    throw new AccountApiError(
      502,
      'POE_INVALID_RESPONSE',
      'pathofexile.com returned an unexpected character list.',
    )
  }

  return data
    .filter((character) => typeof character?.name === 'string')
    .map((character) => ({
      name: character.name,
      class: typeof character.class === 'string' ? character.class : '',
      level: Number.isFinite(character.level) ? character.level : null,
      league: typeof character.league === 'string' ? character.league : '',
    }))
}

export async function getAccountCharacterItems(characterName, options = {}) {
  let credentials
  try {
    credentials = await requireAccountCredentials()
  } catch (error) {
    throw getCredentialsError(error)
  }

  if (typeof characterName !== 'string'
    || !characterName.trim()
    || characterName.length > 64
    || /[\u0000-\u001f\u007f/?#]/.test(characterName)) {
    throw new AccountApiError(400, 'INVALID_CHARACTER_NAME', 'Provide a valid character name.')
  }

  const characters = await getAccountCharacters()
  const character = characters.find((entry) => entry.name === characterName)
  if (!character) {
    throw new AccountApiError(404, 'CHARACTER_NOT_FOUND', 'Character was not found on this account.')
  }

  const url = `${CHARACTER_ITEMS_URL}?accountName=${encodeAccountName(credentials.accountName)}&character=${encodeURIComponent(characterName)}`
  const data = await fetchPoeJson(url, credentials.sessionId, {
    force: options.force === true,
    notFoundCode: 'CHARACTER_NOT_FOUND',
    notFoundMessage: 'Character was not found on this account.',
  })
  if (!data || !Array.isArray(data.items)) {
    throw new AccountApiError(
      502,
      'POE_INVALID_RESPONSE',
      'pathofexile.com returned character data without an item list.',
    )
  }

  return data
}

export async function getAccountCharacterBuild(characterName, options = {}) {
  // The items request validates both the character name and account ownership.
  const items = await getAccountCharacterItems(characterName, options)
  const credentials = await requireAccountCredentials()
  const url = `https://www.pathofexile.com/character-window/get-passive-skills?accountName=${encodeAccountName(credentials.accountName)}&character=${encodeURIComponent(characterName)}`
  const passives = await fetchPoeJson(url, credentials.sessionId, {
    force: options.force === true,
    notFoundCode: 'CHARACTER_NOT_FOUND',
    notFoundMessage: 'Character was not found on this account.',
  })
  if (!Array.isArray(passives?.hashes)) {
    throw new AccountApiError(502, 'POE_INVALID_RESPONSE', 'GGG returned an invalid passive tree.')
  }
  return { ...items, passives }
}
