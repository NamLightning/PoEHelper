import { randomUUID } from 'node:crypto'
import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CONFIG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../config.local.json')
const CHARACTERS_URL = 'https://www.pathofexile.com/character-window/get-characters'
const CHARACTER_ITEMS_URL = 'https://www.pathofexile.com/character-window/get-items'
const USER_AGENT = 'PoEHelper/0.1.0 (local Path of Exile account integration)'

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
  const sessionId = process.env.POESESSID || localConfig.POESESSID || localConfig.poesessid || localConfig.poeSessId || ''

  return {
    accountName: typeof accountName === 'string' ? accountName.trim() : '',
    sessionId: typeof sessionId === 'string' ? sessionId.trim() : '',
    source: process.env.POE_ACCOUNT_NAME || process.env.POESESSID ? 'environment' : 'local',
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

async function requireAccountCredentials() {
  const credentials = await readAccountCredentials()
  if (!isValidAccountName(credentials.accountName) || !isValidSessionId(credentials.sessionId)) {
    throw new AccountApiError(
      400,
      'ACCOUNT_NOT_CONFIGURED',
      'Configure a valid POE_ACCOUNT_NAME and POESESSID first.',
    )
  }
  return credentials
}

export async function getStashCredentials() {
  const credentials = await requireAccountCredentials()
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
    configured: accountNameConfigured && cookieConfigured,
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
  const sessionId = typeof poeSessId === 'string' && poeSessId.trim()
    ? poeSessId.trim()
    : current.sessionId
  if (!isValidSessionId(sessionId)) {
    throw new AccountApiError(400, 'INVALID_SESSION_ID', 'Enter a valid POESESSID.')
  }

  const config = {
    POE_ACCOUNT_NAME: accountName.trim(),
    POESESSID: sessionId,
  }
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

async function fetchPoeJson(url, sessionId, { notFoundCode, notFoundMessage }) {
  let response
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Cookie: `POESESSID=${sessionId}`,
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw new AccountApiError(
      502,
      'POE_UNAVAILABLE',
      error instanceof Error ? error.message : 'Could not reach pathofexile.com.',
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new AccountApiError(
      response.status,
      'SESSION_INVALID',
      'POESESSID is expired or invalid. Update the cookie and try again.',
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

  try {
    return await response.json()
  } catch {
    throw new AccountApiError(
      502,
      'POE_INVALID_RESPONSE',
      'pathofexile.com did not return valid JSON. Check the cookie and try again.',
    )
  }
}

function encodeAccountName(accountName) {
  return encodeURIComponent(accountName)
}

export async function getAccountCharacters() {
  let credentials
  try {
    credentials = await requireAccountCredentials()
  } catch (error) {
    throw getCredentialsError(error)
  }

  const data = await fetchPoeJson(
    `${CHARACTERS_URL}?accountName=${encodeAccountName(credentials.accountName)}`,
    credentials.sessionId,
    {
      notFoundCode: 'ACCOUNT_NOT_FOUND',
      notFoundMessage: 'Account not found. Check the account name and tag.',
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

export async function getAccountCharacterItems(characterName) {
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
