const API_URL = 'https://www.poewiki.net/w/api.php'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 512
const cache = new Map()
const USER_AGENT = 'PoEHelper/0.1.0 (local item tooltip)'
const VARIANT_PREFIXES = [
  'Uber Blighted',
  'Foulborn',
  'Foil',
  'Relic',
  'Replica',
  'Synthesised',
  'Blighted',
]
const FIELDS = [
  'name',
  'base_item',
  'rarity',
  'frame_type',
  'class',
  'implicit_stat_text',
  'explicit_stat_text',
  'enchantment_stat_text',
  'flavour_text',
  'help_text',
  'inventory_icon',
  'required_level',
  'required_strength',
  'required_dexterity',
  'required_intelligence',
  'stat_text',
  'html',
].join(',')

const HTML_ENTITIES = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

export class WikiRequestError extends Error {
  constructor(message, status = 502, code = 'WIKI_REQUEST_FAILED') {
    super(message)
    this.name = 'WikiRequestError'
    this.status = status
    this.code = code
  }
}

function decodeEntities(value) {
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] !== '#') return HTML_ENTITIES[code.toLowerCase()] ?? entity
    const hex = code[1]?.toLowerCase() === 'x'
    const number = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10)
    if (!Number.isFinite(number) || number < 0 || number > 0x10ffff) return entity
    try {
      return String.fromCodePoint(number)
    } catch {
      return entity
    }
  })
}

function plainTextLines(value) {
  let text = decodeEntities(value)
  for (let pass = 0; pass < 2; pass += 1) {
    text = decodeEntities(text)
  }
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|li|div)>/gi, '\n')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/'''?([^']+?)'''?/g, '$1')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function cleanBasicStats(html) {
  const decoded = decodeEntities(decodeEntities(html))
  const firstGroup = decoded.match(/<span\b[^>]*class=["'][^"']*\bgroup\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)
  if (!firstGroup) return []
  return plainTextLines(firstGroup[1]).filter((line) => !/^Requires\b/i.test(line))
}

function toNumber(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizedRarity(frameType, rarity, baseItem) {
  const categories = {
    currency: 'Currency',
    divicard: 'Divination Card',
    gem: 'Gem',
    magic: 'Magic',
    normal: baseItem ? 'Base Item' : 'Normal',
    rare: 'Rare',
    unique: 'Unique',
  }
  return categories[String(frameType || '').toLowerCase()] || rarity || 'Unknown'
}

function buildRequirements(row, frameType) {
  if (['currency', 'divicard'].includes(String(frameType || '').toLowerCase())) return []
  const requirements = []
  const level = toNumber(row['required level'])
  const strength = toNumber(row['required strength'])
  const dexterity = toNumber(row['required dexterity'])
  const intelligence = toNumber(row['required intelligence'])

  if (level != null && level > 0) requirements.push(`Requires Level ${level}`)
  if (strength != null && strength > 0) requirements.push(`${strength} Strength`)
  if (dexterity != null && dexterity > 0) requirements.push(`${dexterity} Dexterity`)
  if (intelligence != null && intelligence > 0) requirements.push(`${intelligence} Intelligence`)
  return requirements
}

async function fetchWikiJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) {
    throw new WikiRequestError(`PoE Wiki returned HTTP ${response.status}.`)
  }

  const data = await response.json()
  if (data.error) {
    throw new WikiRequestError(data.error.info || 'PoE Wiki returned an API error.')
  }
  return data
}

async function getIconUrl(inventoryIcon) {
  const filename = typeof inventoryIcon === 'string'
    ? inventoryIcon.replace(/^File:/i, '').trim()
    : ''
  if (!filename) return null

  const url = new URL(API_URL)
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    iiprop: 'url',
    iiurlwidth: '128',
    prop: 'imageinfo',
    titles: `File:${filename}`,
  }).toString()
  const result = await fetchWikiJson(url)
  const page = Object.values(result.query?.pages || {})[0]
  const image = page?.imageinfo?.[0]
  const iconUrl = image?.thumburl || image?.url
  if (typeof iconUrl !== 'string') return null

  try {
    const parsed = new URL(iconUrl)
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function stripVariantPrefix(name) {
  for (const prefix of VARIANT_PREFIXES) {
    const expression = new RegExp(`^${prefix}\\s+`, 'i')
    if (expression.test(name)) return name.replace(expression, '').trim()
  }
  return name
}

function stripDisplaySuffix(name, suffix) {
  if (!suffix) return name
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const expression = new RegExp(`\\s*,\\s*${escapedSuffix}\\s*$`, 'i')
  return name.replace(expression, '').trim()
}

function getNameCandidates(name, baseType, variant) {
  let cleanedName = stripDisplaySuffix(name, baseType)
  cleanedName = stripDisplaySuffix(cleanedName, variant)

  const candidates = [
    name,
    cleanedName,
    stripVariantPrefix(cleanedName),
    stripVariantPrefix(name),
  ]
  return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))]
}

async function fetchCargoRow(name) {
  const url = new URL(API_URL)
  const whereName = name.replaceAll("'", "''")
  url.search = new URLSearchParams({
    action: 'cargoquery',
    fields: FIELDS,
    format: 'json',
    limit: '1',
    tables: 'items',
    where: `name='${whereName}'`,
  }).toString()
  const result = await fetchWikiJson(url)
  return (result.cargoquery || [])
    .map((entry) => entry.title)
    .find((entry) => decodeEntities(entry?.name).toLocaleLowerCase() === name.toLocaleLowerCase())
    || null
}

async function searchWikiTitles(term) {
  const url = new URL(API_URL)
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    list: 'search',
    srnamespace: '0',
    srsearch: term,
    srlimit: '5',
  }).toString()
  const result = await fetchWikiJson(url)
  return (result.query?.search || [])
    .map((entry) => entry.title)
    .filter((title) => typeof title === 'string' && title.trim())
}

async function fetchWikiText(title) {
  const url = new URL(API_URL)
  url.search = new URLSearchParams({
    action: 'parse',
    format: 'json',
    page: title,
    prop: 'wikitext',
  }).toString()
  const result = await fetchWikiJson(url)
  return result.parse?.wikitext?.['*'] || ''
}

function cleanWikiMarkup(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '; ')
    .replace(/\{\{c\|[^|{}]+\|([\s\S]*?)\}\}/gi, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/'''?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractFoulbornModifiers(wikitext, title) {
  const lines = String(wikitext || '').split(/\r?\n/)
  const headerIndex = lines.findIndex((line) => /Foulborn modifier/i.test(line))
  if (headerIndex < 0) return []

  const modifiers = []
  for (const line of lines.slice(headerIndex + 1)) {
    if (/^\s*\|\}/.test(line)) break
    if (!/^\s*\|/.test(line) || /^\s*\|[-+]/.test(line)) continue
    const cells = line.replace(/^\s*\|/, '').split(/\s*\|\|\s*/)
    if (cells.length < 3 || cleanWikiMarkup(cells[0]).toLocaleLowerCase() !== title.toLocaleLowerCase()) continue
    const modifier = cleanWikiMarkup(cells[cells.length - 1])
    if (modifier) modifiers.push(modifier)
  }
  return [...new Set(modifiers)]
}

async function getRowForCandidates(candidates) {
  for (const candidate of candidates) {
    const row = await fetchCargoRow(candidate)
    if (row) return { row, candidate }
  }
  return null
}

async function findItemRow(name, baseType, variant) {
  const candidates = getNameCandidates(name, baseType, variant)
  const directMatch = await getRowForCandidates(candidates)
  if (directMatch) {
    return {
      ...directMatch,
      fallback: directMatch.candidate.toLocaleLowerCase() !== name.toLocaleLowerCase(),
    }
  }

  for (const term of candidates.slice(1)) {
    const titles = await searchWikiTitles(term)
    const match = await getRowForCandidates(titles)
    if (match) return { ...match, fallback: true }
  }

  if (baseType && !candidates.some((candidate) => candidate.toLocaleLowerCase() === baseType.toLocaleLowerCase())) {
    const baseMatch = await fetchCargoRow(baseType)
    if (baseMatch) return { row: baseMatch, candidate: baseType, fallback: true }
  }
  if (baseType) {
    const titles = await searchWikiTitles(baseType)
    const match = await getRowForCandidates(titles)
    if (match) return { ...match, fallback: true }
  }
  return null
}

async function fetchItemDetails(name, baseType, variant) {
  const match = await findItemRow(name, baseType, variant)
  if (!match) return null
  const { row } = match

  const frameType = row['frame type'] || ''
  const baseItem = row['base item'] || ''
  const explicitStats = plainTextLines(row['explicit stat text'])
  const implicitStats = plainTextLines(row['implicit stat text'])
  const enchantmentStats = plainTextLines(row['enchantment stat text'])
  const statLines = plainTextLines(row['stat text'])
  const fallbackStats = explicitStats.length || implicitStats.length
    ? []
    : statLines
  let iconUrl = null
  if (String(frameType).toLowerCase() !== 'divicard') {
    try {
      iconUrl = await getIconUrl(row['inventory icon'])
    } catch (error) {
      console.warn(`PoE Wiki image lookup failed for "${name}":`, error)
    }
  }

  let variantInfo = []
  if (/^Foulborn\b/i.test(name) || /\bFoulborn\b/i.test(variant)) {
    try {
      variantInfo = extractFoulbornModifiers(await fetchWikiText(row.name), row.name)
    } catch (error) {
      console.warn(`PoE Wiki variant lookup failed for "${row.name}":`, error)
    }
  }

  const matchedWikiTitle = decodeEntities(row.name)
  return {
    name: matchedWikiTitle,
    matchedWikiTitle,
    isFallbackMatch: match.fallback || matchedWikiTitle.toLocaleLowerCase() !== name.toLocaleLowerCase(),
    baseItem,
    rarity: normalizedRarity(frameType, row.rarity, baseItem),
    wikiRarity: row.rarity || '',
    itemClass: row.class || '',
    basicStats: cleanBasicStats(row.html),
    requirements: buildRequirements(row, frameType),
    implicitStats,
    explicitStats: explicitStats.length ? explicitStats : fallbackStats,
    enchantmentStats,
    flavourText: plainTextLines(row['flavour text']),
    helpText: plainTextLines(row['help text']),
    variantInfo,
    iconUrl,
  }
}

function readCache(key) {
  const entry = cache.get(key)
  if (!entry) return undefined

  if (entry.promise || entry.expiresAt > Date.now()) {
    cache.delete(key)
    cache.set(key, entry)
    return entry
  }

  cache.delete(key)
  return undefined
}

function writeCache(key, entry) {
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value)
  }
}

export async function getWikiItemDetails(name, { baseType = '', variant = '' } = {}) {
  const key = [
    name.trim().toLocaleLowerCase(),
    baseType.trim().toLocaleLowerCase(),
    variant.trim().toLocaleLowerCase(),
  ].join('\u0000')
  const cached = readCache(key)
  if (cached?.data !== undefined) return cached.data
  if (cached?.promise) return cached.promise

  const promise = fetchItemDetails(name.trim(), baseType.trim(), variant.trim())
    .then((data) => {
      writeCache(key, {
        data,
        expiresAt: Date.now() + (data ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
      })
      return data
    })
    .catch((error) => {
      cache.delete(key)
      throw error
    })

  writeCache(key, { promise, expiresAt: 0 })
  return promise
}
