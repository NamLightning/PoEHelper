import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getMarketSummary } from './poeNinja.js'
import { getStashCredentials } from './poeAccount.js'

const STASH_URL = 'https://www.pathofexile.com/character-window/get-stash-items'
const CHARACTERS_URL = 'https://www.pathofexile.com/character-window/get-characters'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
const STASH_CACHE_FILE = path.join(DATA_DIR, 'stash-cache.json')

const emptyStashCache = () => ({ items: [], tabs: [], lastSyncedAt: null })

export async function readStashFileCache() {
  try {
    const contents = await fs.readFile(STASH_CACHE_FILE, 'utf8')
    const cache = JSON.parse(contents)
    return {
      ...emptyStashCache(),
      ...cache,
      items: Array.isArray(cache?.items) ? cache.items : [],
      tabs: Array.isArray(cache?.tabs) ? cache.tabs : [],
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyStashCache()
    throw error
  }
}

export async function writeStashFileCache(cache) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(STASH_CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
}

function clean(value) {
  return String(value ?? '').trim()
}

function poeHeaders(poesessid) {
  return {
    Cookie: `POESESSID=${clean(poesessid)}`,
    'User-Agent': USER_AGENT,
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9',
    Origin: 'https://www.pathofexile.com',
    Referer: 'https://www.pathofexile.com/my-account',
    'X-Requested-With': 'XMLHttpRequest',
  }
}

async function fetchStashTab(accountName, sessionId, league, tabIndex) {
  const query = new URLSearchParams({
    accountName,
    realm: 'pc',
    league,
    tabs: '1',
    tabIndex: String(tabIndex),
  })
  const response = await fetch(`${STASH_URL}?${query}`, {
    headers: poeHeaders(sessionId),
  })
  const raw = await response.text()
  console.log('[poe-stash] get-stash-items URL:', `${STASH_URL}?${query}`)
  let payload
  try { payload = JSON.parse(raw) } catch {
    const error = new Error(`GGG stash API returned invalid JSON (HTTP ${response.status}): ${raw.slice(0, 300)}`)
    error.status = response.status
    throw error
  }
  if (!response.ok || payload?.error) {
    const detail = payload?.error?.message || payload?.error || raw.slice(0, 300)
    const error = new Error(`GGG get-stash-items failed (HTTP ${response.status}, code ${payload?.error?.code ?? 'unknown'}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    error.status = response.status >= 400
      ? response.status
      : payload?.error?.code === 6 ? 403 : payload?.error?.code === 1 ? 404 : 502
    error.code = payload?.error?.code
    throw error
  }
  return payload
}

async function fetchStashTabWithAccountFallback(rawAccountName, cleanAccountName, sessionId, league, tabIndex) {
  const candidates = [...new Set([clean(rawAccountName), clean(cleanAccountName)])].filter(Boolean)
  let lastError

  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const payload = await fetchStashTab(candidate, sessionId, league, tabIndex)
        console.log('[poe-stash] get-stash-items succeeded for accountName:', candidate, 'tabIndex:', tabIndex)
        return payload
      } catch (error) {
        lastError = error
        const retryable = error?.status === 429 || error?.status === 403 || error?.code === 6
        console.warn('[poe-stash] get-stash-items failed for accountName:', candidate, 'tabIndex:', tabIndex, error.message)
        if (!retryable) throw error
        if (attempt === 0) await wait(1500)
      }
    }
  }

  throw lastError || new Error('GGG get-stash-items failed for all account name candidates.')
}

async function verifySession(rawAccountName, sessionId) {
  const query = new URLSearchParams({ accountName: rawAccountName })
  const url = `${CHARACTERS_URL}?${query}`
  const response = await fetch(url, {
    headers: poeHeaders(sessionId),
  })
  const raw = await response.text()
  let payload
  try { payload = JSON.parse(raw) } catch { payload = null }
  if (response.status === 401 || response.status === 403 || !Array.isArray(payload) || payload.length === 0) {
    const error = new Error('POESESSID đã hết hạn, vui lòng copy lại cookie mới từ pathofexile.com')
    error.status = response.status === 401 || response.status === 403 ? response.status : 403
    error.code = 'SESSION_INVALID'
    console.error('[poe-stash] get-characters failed:', response.status, raw.slice(0, 300))
    throw error
  }
  const characters = payload.filter((character) => typeof character?.league === 'string' && character.league.trim())
  if (!characters.length) {
    const error = new Error('POESESSID đã hết hạn, vui lòng copy lại cookie mới từ pathofexile.com')
    error.status = 403
    error.code = 'SESSION_INVALID'
    throw error
  }
  return characters
}

function tabName(tab, index) {
  return clean(tab?.n || tab?.name || tab?.label || `Tab ${index + 1}`) || `Tab ${index + 1}`
}

function normalizeRawItems(payload, tab, index) {
  return (Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.stash) ? payload.stash : []).map((item) => ({
    ...item,
    name: clean(item.name || item.baseType || 'Unknown item'),
    tab: tabName(tab, index),
    tabIndex: index,
    tabType: tab?.type || 'NormalStash',
    tabColour: tab?.colour ?? null,
    quantity: Number(item.stackSize ?? item.quantity ?? 1) || 1,
  }))
}

function normalized(value) {
  return clean(value).toLowerCase()
}

function propertyNumber(item, propertyName, fallback = 0) {
  const property = (item.properties || []).find((entry) => normalized(entry?.name) === normalized(propertyName))
  const value = property?.values?.[0]?.[0]
  const number = Number(String(value ?? '').match(/-?\d+(?:\.\d+)?/)?.[0])
  return Number.isFinite(number) ? number : fallback
}

function mapTierFromItem(item) {
  const propertyTier = propertyNumber(item, 'Map Tier', 0)
  if (propertyTier > 0) return propertyTier
  const mapName = clean(item?.baseType || item?.typeLine || item?.name)
  return Number(mapName.match(/Map\s*\(Tier\s*(\d+)\)/i)?.[1]) || 0
}

function itemLinkCount(item) {
  const groups = new Map()
  for (const socket of item.sockets || []) {
    if (socket?.group == null) continue
    groups.set(socket.group, (groups.get(socket.group) || 0) + 1)
  }
  return Math.max(0, ...groups.values())
}

function priceForMarketItem(item) {
  return Number(item?.priceChaos ?? item?.chaosValue ?? item?.price ?? 0) || 0
}

function categoryItems(summary, labels) {
  const wanted = new Set(labels)
  return (summary.categories || [])
    .filter((category) => wanted.has(category.label))
    .flatMap((category) => category.items || [])
}

function setPrice(map, key, item) {
  const normalizedKey = normalized(key)
  if (normalizedKey) map.set(normalizedKey, item)
}

function buildPriceTables(summary) {
  const currencyPrices = new Map()
  const divCardPrices = new Map()
  const uniquePrices = new Map()
  const gemPrices = new Map()
  const mapPrices = new Map()
  const tierMedianPrices = new Map()

  for (const item of categoryItems(summary, ['Currency', 'Fragments', 'Scarabs', 'Essences', 'Catalysts', 'Oils', 'Delirium Orbs'])) {
    setPrice(currencyPrices, item.name, item)
  }
  for (const item of categoryItems(summary, ['Divination Cards'])) {
    setPrice(divCardPrices, item.name, item)
  }
  for (const item of categoryItems(summary, ['Unique Items', 'Unique Maps'])) {
    const links = Number(item.links ?? item.minLinks ?? 0) || 0
    setPrice(uniquePrices, `${item.name}|${links}`, item)
  }
  for (const item of categoryItems(summary, ['Skill Gems'])) {
    setPrice(gemPrices, `${item.name}|${Number(item.gemLevel ?? 1)}|${Number(item.gemQuality ?? 0)}|${Boolean(item.corrupted)}`, item)
  }
  for (const item of categoryItems(summary, ['Maps'])) {
    setPrice(mapPrices, `${item.baseType || item.name}|${mapTierFromItem(item)}`, item)
  }

  const tierPrices = new Map()
  for (const item of categoryItems(summary, ['Maps'])) {
    const tier = mapTierFromItem(item)
    const price = priceForMarketItem(item)
    if (tier > 0 && Number.isFinite(price) && price >= 0) {
      const prices = tierPrices.get(tier) || []
      prices.push(price)
      tierPrices.set(tier, prices)
    }
  }
  for (const [tier, prices] of tierPrices) {
    prices.sort((left, right) => left - right)
    const middle = Math.floor(prices.length / 2)
    const median = prices.length % 2 === 1
      ? prices[middle]
      : (prices[middle - 1] + prices[middle]) / 2
    tierMedianPrices.set(tier, median)
  }

  return { currencyPrices, divCardPrices, uniquePrices, gemPrices, mapPrices, tierMedianPrices }
}

export function priceItem(item, priceTables) {
  const frameType = Number.isInteger(Number(item?.frameType)) ? Number(item.frameType) : 0
  const baseType = clean(item?.baseType)
  const isMap = Boolean(item?.mapTier)
    || (item?.properties || []).some((property) => normalized(property?.name) === 'map tier')
    || /Map\s*\(Tier\s*\d+\)/i.test(baseType || clean(item?.typeLine))

  if (![3, 4, 5, 6, 8, 9].includes(frameType) && !isMap) return 0
  if ([0, 1, 2].includes(frameType) && !isMap) return 0

  const typeLine = clean(item?.typeLine)
  const mapTier = mapTierFromItem(item)
  let match = null

  if (isMap && frameType !== 3) {
    match = priceTables.mapPrices.get(normalized(`${baseType}|${mapTier}`))
    if (!match && /^Map\s*\(Tier\s*\d+\)$/i.test(baseType)) {
      return priceTables.tierMedianPrices.get(mapTier) || 0
    }
  } else if (frameType === 3) {
    const links = itemLinkCount(item)
    match = priceTables.uniquePrices.get(normalized(`${clean(item?.name)}|${links}`))
  } else if (frameType === 4) {
    const level = propertyNumber(item, 'Level', 1)
    const quality = propertyNumber(item, 'Quality', 0)
    const corrupted = Boolean(item?.corrupted)
    match = priceTables.gemPrices.get(normalized(`${typeLine}|${level}|${quality}|${corrupted}`))
  } else if (frameType === 5) {
    match = priceTables.currencyPrices.get(normalized(typeLine))
  } else if (frameType === 6) {
    match = priceTables.divCardPrices.get(normalized(typeLine))
  }

  return priceForMarketItem(match)
}

export function priceStashItem(item, summary) {
  return priceItem(item, buildPriceTables(summary))
}

function compactStashItem(item, index, priceChaos, divineRate) {
  const quantity = Number(item.quantity) || 1
  const frameType = Number.isInteger(Number(item.frameType)) ? Number(item.frameType) : 0
  return {
    id: `${item.tab}__${item.name}__${index}`,
    name: clean(item.name || item.baseType || 'Unknown item'),
    typeLine: clean(item.typeLine),
    baseType: clean(item.baseType),
    tab: item.tab,
    tabIndex: Number(item.tabIndex) || 0,
    tabType: item.tabType || 'NormalStash',
    tabColour: item.tabColour ?? null,
    tabLocations: Array.isArray(item.tabLocations) ? item.tabLocations : undefined,
    quantity,
    priceChaos,
    totalChaos: Math.round(quantity * priceChaos * 100) / 100,
    totalDivine: divineRate > 0 ? Math.round((quantity * priceChaos / divineRate) * 10000) / 10000 : 0,
    icon: item.icon || item.iconUrl || '',
    frameType,
    links: item.links ?? itemLinkCount(item),
    gemLevel: frameType === 4 ? propertyNumber(item, 'Level', 1) : 0,
    gemQuality: frameType === 4 ? propertyNumber(item, 'Quality', 0) : 0,
    corrupted: Boolean(item.corrupted),
    mapTier: mapTierFromItem(item),
  }
}

export function aggregateStashItems(items, divineRate) {
  const grouped = new Map()
  for (const item of items) {
    const displayName = clean(item.name)
    const groupKey = displayName
    const quantity = Number(item.quantity || item.stackSize) || 1
    const tabNumber = Number.isFinite(Number(item.tabIndex)) ? Number(item.tabIndex) + 1 : 0
    const tabLocation = {
      tabNumber,
      tabName: clean(item.tab || 'Unknown'),
      tabType: item.tabType || 'NormalStash',
      tabColour: item.tabColour ?? null,
      quantity,
    }
    const existing = grouped.get(groupKey)
    if (!existing) {
      grouped.set(groupKey, {
        ...item,
        quantity,
        tabLocations: [tabLocation],
        totalChaos: Math.round(quantity * (Number(item.priceChaos) || 0) * 100) / 100,
        totalDivine: divineRate > 0
          ? Math.round((quantity * (Number(item.priceChaos) || 0) / divineRate) * 10000) / 10000
          : 0,
      })
      continue
    }
    if (existing.frameType === 3 && Number(item.frameType) !== 3 && item.icon) {
      existing.icon = item.icon
    }
    existing.quantity += quantity
    const existingLocation = existing.tabLocations.find((location) => location.tabNumber === tabNumber)
    if (existingLocation) {
      existingLocation.quantity += quantity
    } else {
      existing.tabLocations.push(tabLocation)
    }
    existing.totalChaos = Math.round(existing.quantity * existing.priceChaos * 100) / 100
    existing.totalDivine = divineRate > 0
      ? Math.round((existing.totalChaos / divineRate) * 10000) / 10000
      : 0
  }
  return Array.from(grouped.values())
}

export async function syncPoeStash(league) {
  const { accountName, rawAccountName, sessionId } = await getStashCredentials()
  const characters = await verifySession(rawAccountName, sessionId)
  const availableLeagues = new Set(
    characters.map((character) => clean(character.league)).filter(Boolean),
  )
  const requestedLeague = clean(league)
  const normalizedLeague = availableLeagues.has(requestedLeague)
    ? requestedLeague
    : clean(characters[0]?.league) || 'Standard'
  if (requestedLeague && requestedLeague !== normalizedLeague) {
    console.warn('[poe-stash] Requested league was not found on the account; using character league:', normalizedLeague)
  }
  console.log('[poe-stash] verified account:', accountName, 'league:', normalizedLeague)

  const firstPayload = await fetchStashTabWithAccountFallback(rawAccountName, accountName, sessionId, normalizedLeague, 0)
  const sourceTabs = Array.isArray(firstPayload.tabs) ? firstPayload.tabs : []
  console.log('[poe-stash] GGG data.tabs:', sourceTabs.map((tab) => ({ index: tab?.i, name: tab?.n, type: tab?.type, colour: tab?.colour })))
  const tabCount = Math.min(5, Math.max(1, sourceTabs.length || 5))
  const rawItems = normalizeRawItems(firstPayload, sourceTabs[0], 0)

  for (let tabIndex = 1; tabIndex < tabCount; tabIndex += 1) {
    await wait(400)
    const payload = await fetchStashTabWithAccountFallback(rawAccountName, accountName, sessionId, normalizedLeague, tabIndex)
    rawItems.push(...normalizeRawItems(payload, sourceTabs[tabIndex], tabIndex))
  }

  const market = await getMarketSummary(normalizedLeague)
  const priceTables = buildPriceTables(market)
  const items = rawItems.map((item, index) => {
    const priceChaos = priceItem(item, priceTables)
    return compactStashItem(item, index, priceChaos, market.divineToChaos)
  })
  const aggregatedItems = aggregateStashItems(items, market.divineToChaos)
  console.log('[poe-stash] top 5 priced items:', [...aggregatedItems]
    .sort((left, right) => right.priceChaos - left.priceChaos)
    .slice(0, 5)
    .map((item) => ({
      name: item.name,
      typeLine: item.typeLine,
      frameType: item.frameType,
      priceChaos: item.priceChaos,
    })))
  const tabs = sourceTabs.slice(0, tabCount).map((tab, index) => ({
    id: String(tab?.i ?? index),
    index: tab?.i ?? index,
    label: tabName(tab, index),
    name: clean(tab?.n || tabName(tab, index)),
    type: tab?.type || 'NormalStash',
    colour: tab?.colour ?? null,
    kind: tab?.type || 'NormalStash',
    color: tab?.colour ?? null,
  }))

  const lastSyncedAt = new Date().toISOString()
  try {
    await writeStashFileCache({
      league: normalizedLeague,
      lastSyncedAt,
      tabs,
      items: aggregatedItems,
    })
  } catch (error) {
    console.error('[poe-stash] Could not persist stash cache file:', error)
  }

  return {
    items: aggregatedItems,
    tabs: tabs.length ? tabs : [...new Set(aggregatedItems.map((item) => item.tab))].map((name, index) => ({ id: name, index, label: name, name, type: 'NormalStash', colour: null, kind: 'NormalStash', color: null })),
    divineRate: market.divineToChaos,
    league: normalizedLeague,
    source: 'ggg-and-poe.ninja',
    lastSyncedAt,
  }
}
