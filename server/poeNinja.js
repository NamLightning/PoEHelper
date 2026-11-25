import { MARKET_CATEGORIES } from '../src/data/marketCategories.js'
import { getPoETradeMinLinks } from '../src/lib/poeTrade.js'
import { normalizeSkillGem } from '../src/lib/poeNinjaGem.js'

const API_BASE = 'https://poe.ninja/poe1/api/economy'
const LEAGUES_URL = `${API_BASE}/leagues`
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 128
const CATEGORY_CACHE_TTL_MS = 5 * 60 * 1000
const STATIC_ITEM_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const REPOE_ITEMS_URL = 'https://raw.githubusercontent.com/brather1ng/RePoE/master/RePoE/data/base_items.min.json'
const MAX_CATEGORY_CACHE_ENTRIES = 64
const cache = new Map()
const categoryResponseCache = new Map()
const categoryResponseInFlight = new Map()
let staticItemDetailsCache = null
let staticItemDetailsExpiresAt = 0
let staticItemDetailsRequest = null

const DIVINATION_CARD_ART_FILENAMES = {
  'alone-in-the-darkness': 'AloneintheDarkness',
  'arrogance-of-the-vaal': 'ArroganceoftheVaal',
  'assassins-favour': 'AssassinsFavor',
  'atziris-arsenal': 'AtzirisArmory',
  'boon-of-justice': 'BoonofJustice',
  'boon-of-the-first-ones': 'BoonoftheFirstOnes',
  'brothers-gift': 'BrotherGift',
  'council-of-cats': 'CounciloOfCats',
  'darker-half': 'TheDarkerHalf',
  'demigods-wager': 'DemigodsWagergives',
  'destined-to-crumble': 'DestinedtoCrumble',
  'from-bone-to-ashes': 'FromBonesToAshes',
  'light-and-truth': 'LigthAndTruth',
  'mawr-blaidd': 'RussiaDivinationCard',
  'prometheus-armoury': 'PrometheusArmory',
  'rebirth': 'BirthOfTheThree',
  'reflection-of-the-heart': 'TheReflectionOfTheHeart',
  'shard-of-fate': 'ShardofFate',
  'squandered-prosperity': 'BaronCat',
  'struck-by-lightning': 'StruckbyLightning',
  'the-aspirant': 'Dream',
  'the-garish-power': 'GarishPower',
  'the-lord-of-celebration': 'TheLordofCelebration',
  'the-price-of-protection': 'ThePriceofProtection',
  'the-progeny-of-lunaris': 'TheProgenyofLunaris',
  'the-rite-of-elements': 'TheRiteofElements',
  'the-standoff': 'TheStandOff',
  'the-tumbleweed': 'TheTumbleWeed',
}

const EXCHANGE_GROUPS = [
  { label: 'Currency', endpoint: 'exchange', type: 'Currency' },
  { label: 'Fragments', endpoint: 'exchange', type: 'Fragment' },
  { label: 'Divination Cards', endpoint: 'exchange', type: 'DivinationCard' },
  { label: 'Scarabs', endpoint: 'exchange', type: 'Scarab' },
  { label: 'Essences', endpoint: 'exchange', type: 'Essence' },
  { label: 'Catalysts', endpoint: 'exchange', type: 'Catalyst' },
  { label: 'Oils', endpoint: 'exchange', type: 'Oil' },
  { label: 'Delirium Orbs', endpoint: 'exchange', type: 'DeliriumOrb' },
]

const ITEM_GROUPS = [
  { label: 'Unique Items', endpoint: 'item', type: 'UniqueWeapon' },
  { label: 'Unique Items', endpoint: 'item', type: 'UniqueArmour' },
  { label: 'Unique Items', endpoint: 'item', type: 'UniqueAccessory' },
  { label: 'Unique Items', endpoint: 'item', type: 'UniqueFlask' },
  { label: 'Unique Items', endpoint: 'item', type: 'UniqueJewel' },
  { label: 'Unique Maps', endpoint: 'item', type: 'UniqueMap' },
  { label: 'Maps', endpoint: 'item', type: 'Map' },
  { label: 'Base Types', endpoint: 'item', type: 'BaseType' },
  { label: 'Skill Gems', endpoint: 'item', type: 'SkillGem' },
]

function cacheGet(key) {
  const entry = cache.get(key)
  if (!entry) return undefined

  if (entry.expiresAt > Date.now() || entry.promise) {
    cache.delete(key)
    cache.set(key, entry)
    return entry
  }

  cache.delete(key)
  return undefined
}

function cacheSet(key, entry) {
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value)
  }
}

function getCachedCategoryResponse(key) {
  const entry = categoryResponseCache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    categoryResponseCache.delete(key)
    return undefined
  }
  categoryResponseCache.delete(key)
  categoryResponseCache.set(key, entry)
  return entry.data
}

function cacheCategoryResponse(key, data) {
  categoryResponseCache.delete(key)
  categoryResponseCache.set(key, {
    data,
    expiresAt: Date.now() + CATEGORY_CACHE_TTL_MS,
  })
  while (categoryResponseCache.size > MAX_CATEGORY_CACHE_ENTRIES) {
    categoryResponseCache.delete(categoryResponseCache.keys().next().value)
  }
}

async function fetchJson(url, validate) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'PoeStash local market proxy/0.1.0' },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) {
    throw new Error(`poe.ninja returned HTTP ${response.status} for ${new URL(url).pathname}`)
  }

  const data = await response.json()
  if (!validate(data)) {
    throw new Error(`poe.ninja returned an invalid response for ${new URL(url).pathname}`)
  }
  return data
}

function getCachedJson(url, validate = (data) => Array.isArray(data?.lines)) {
  const cached = cacheGet(url)
  if (cached?.data) return Promise.resolve(cached.data)
  if (cached?.promise) return cached.promise

  const promise = fetchJson(url, validate)
    .then((data) => {
      cacheSet(url, { data, expiresAt: Date.now() + CACHE_TTL_MS })
      return data
    })
    .catch((error) => {
      cache.delete(url)
      throw error
    })

  cacheSet(url, { promise, expiresAt: 0 })
  return promise
}

function endpointUrl(endpoint, league, type) {
  const path = endpoint === 'currency'
    ? 'stash/current/currency/overview'
    : endpoint === 'exchange'
      ? 'exchange/current/overview'
      : 'stash/current/item/overview'
  const url = new URL(`${API_BASE}/${path}`)
  url.searchParams.set('league', league)
  url.searchParams.set('type', type)
  return url.toString()
}

async function getCategoryData(category, league) {
  const alternateEndpoints = category.endpoint === 'item'
    ? ['exchange', 'currency']
    : ['item', 'currency']
  const leagues = league === 'Standard' ? ['Standard'] : [league, 'Standard']
  const candidates = [
    { league, endpoint: category.endpoint },
    ...leagues.slice(1).map((sourceLeague) => ({ league: sourceLeague, endpoint: category.endpoint })),
    ...leagues.flatMap((sourceLeague) => alternateEndpoints.map((endpoint) => ({
      league: sourceLeague,
      endpoint,
    }))),
  ]
  let emptyResult
  let lastError

  for (const candidate of candidates) {
    try {
      const data = await getCachedJson(
        endpointUrl(candidate.endpoint, candidate.league, category.type),
      )
      if (Array.isArray(data.lines) && data.lines.length > 0) {
        return { ...candidate, data, triedLeagues: leagues }
      }
      emptyResult ||= { ...candidate, data, triedLeagues: leagues }
    } catch (error) {
      if (!/returned HTTP 404\b/.test(error.message)) {
        lastError = error
      }
    }
  }

  if (lastError && !emptyResult) throw lastError
  return emptyResult || {
    league,
    endpoint: category.endpoint,
    data: { lines: [], items: [] },
    triedLeagues: leagues,
  }
}

function poeNinjaImage(path) {
  if (typeof path !== 'string' || !path) return null
  try {
    const base = path.startsWith('/gen/image/')
      ? 'https://web.poecdn.com'
      : 'https://poe.ninja'
    const url = new URL(path, base)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function divinationCardImage(detailsId) {
  if (typeof detailsId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(detailsId)) {
    return null
  }
  const filename = DIVINATION_CARD_ART_FILENAMES[detailsId]
    || detailsId.replace(/(^|-)([a-z0-9])/gi, (_, separator, character) => character.toUpperCase())
  return `https://web.poecdn.com/image/divination-card/${filename}.png`
}

function toItem(name, category, priceChaos, change, identity = name, details = {}) {
  return {
    id: `${category}-${identity}`,
    name,
    category,
    priceChaos,
    change: Number.isFinite(change) ? change : null,
    ...details,
  }
}

function normalizeModifiers(modifiers) {
  if (!Array.isArray(modifiers)) return []
  return modifiers
    .map((modifier) => {
      if (typeof modifier === 'string') return modifier
      if (typeof modifier?.text !== 'string' || !modifier.text.trim()) return null
      return {
        ...modifier,
        text: modifier.text,
      }
    })
    .filter(Boolean)
}

function normalizeDetailLines(value) {
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (!Array.isArray(value)) return []
  return value
    .map((line) => {
      if (typeof line === 'string') return line
      if (line && typeof line === 'object') return { ...line }
      return null
    })
    .filter(Boolean)
}

function getDetailFields(source) {
  const fields = {}
  for (const key of [
    'properties',
    'requirements',
    'secDescrText',
    'descrText',
    'description',
    'details',
    'flavourText',
  ]) {
    if (typeof source?.[key] === 'string' || Array.isArray(source?.[key])) {
      fields[key] = normalizeDetailLines(source[key])
    }
  }
  return fields
}

function getScalarDetailFields(source) {
  const fields = {}
  for (const key of [
    'levelRequired',
    'requiredLevel',
    'requiredStrength',
    'requiredDexterity',
    'requiredIntelligence',
    'stackSize',
    'mapTier',
    'gemLevel',
    'gemQuality',
    'quality',
    'energyShield',
    'armour',
    'evasion',
    'ward',
    'movementSpeed',
    'physicalDamage',
    'attacksPerSecond',
    'criticalStrikeChance',
  ]) {
    if (source?.[key] != null) fields[key] = source[key]
  }
  return fields
}

function getStaticItemName(entry) {
  return typeof entry?.name === 'string'
    ? entry.name.trim().toLowerCase()
    : ''
}

function toStaticItemDetailsMap(payload) {
  const entries = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? Object.values(payload)
      : []
  const details = new Map()
  for (const entry of entries) {
    const name = getStaticItemName(entry)
    if (name) details.set(name, entry)
  }
  return details
}

async function getStaticItemDetails() {
  if (staticItemDetailsCache && staticItemDetailsExpiresAt > Date.now()) return staticItemDetailsCache
  if (staticItemDetailsRequest) return staticItemDetailsRequest

  staticItemDetailsRequest = fetch(REPOE_ITEMS_URL, {
    headers: { 'User-Agent': 'PoEStash local market proxy/0.1.0' },
    signal: AbortSignal.timeout(10_000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`RePoE returned HTTP ${response.status}.`)
      return toStaticItemDetailsMap(await response.json())
    })
    .catch(() => new Map())
    .then((details) => {
      staticItemDetailsCache = details
      staticItemDetailsExpiresAt = Date.now() + STATIC_ITEM_CACHE_TTL_MS
      return details
    })
    .finally(() => {
      staticItemDetailsRequest = null
    })

  return staticItemDetailsRequest
}

function mergeStaticItemDetails(item, staticDetails) {
  const staticItem = staticDetails.get(getStaticItemName(item))
  if (!staticItem) return item
  const merged = { ...item }
  for (const key of ['properties', 'requirements', 'descrText', 'description']) {
    if ((!Array.isArray(merged[key]) || merged[key].length === 0) && Array.isArray(staticItem[key])) {
      merged[key] = staticItem[key]
    }
  }
  if ((!Array.isArray(merged.explicitModifiers) || merged.explicitModifiers.length === 0)
    && Array.isArray(staticItem.explicitModifiers || staticItem.explicitMods)) {
    merged.explicitModifiers = staticItem.explicitModifiers || staticItem.explicitMods
  }
  if ((!Array.isArray(merged.implicitModifiers) || merged.implicitModifiers.length === 0)
    && Array.isArray(staticItem.implicitModifiers || staticItem.implicitMods)) {
    merged.implicitModifiers = staticItem.implicitModifiers || staticItem.implicitMods
  }
  return merged
}

function normalizeTradeInfo(tradeInfo) {
  if (!Array.isArray(tradeInfo)) return []
  return tradeInfo
    .map((entry) => entry?.mod)
    .filter((mod) => typeof mod === 'string')
    .map((mod) => ({ mod }))
}

function normalizeForbiddenMetadata(line) {
  const metadata = line?.metadata && typeof line.metadata === 'object' ? line.metadata : {}
  return {
    ...(Object.keys(metadata).length ? { metadata } : {}),
    ...(typeof metadata.baseClass === 'string' ? { baseClass: metadata.baseClass } : {}),
    ...(typeof metadata.ascendancy === 'string' ? { ascendancy: metadata.ascendancy } : {}),
    ...(typeof metadata.passiveName === 'string' ? { passiveName: metadata.passiveName } : {}),
  }
}

function normalizeVariantTags(variant) {
  if (Array.isArray(variant)) return variant.filter((tag) => typeof tag === 'string' && tag.trim())
  return typeof variant === 'string'
    ? variant.split(',').map((tag) => tag.trim()).filter(Boolean)
    : []
}

function normalizeCurrencyUnit(value) {
  if (typeof value !== 'string') return null
  const unit = value.toLowerCase()
  if (unit.includes('divine')) return 'divine'
  if (unit.includes('chaos')) return 'chaos'
  return null
}

function normalizeExchange(line, itemById, primary, divineToChaos, category) {
  const item = itemById.get(line.id)
  if (!item || !Number.isFinite(line.primaryValue)) return null

  const priceChaos = primary === 'divine'
    ? line.primaryValue * divineToChaos
    : line.primaryValue
  const icon = poeNinjaImage(item.image || item.icon)
    || (category === 'Divination Cards' ? divinationCardImage(item.detailsId || item.id || line.id) : null)
  const minLinks = getPoETradeMinLinks({
    name: item.name,
    links: item.links,
    sockets: item.sockets,
  })
  return toItem(item.name, category, priceChaos, line.sparkline?.totalChange, line.id, {
    ...getDetailFields(item),
    ...getDetailFields(line),
    ...getScalarDetailFields(item),
    ...getScalarDetailFields(line),
    icon,
    tradeId: typeof item.id === 'string' ? item.id : '',
    variant: typeof item.variant === 'string' ? item.variant : '',
    variantTags: normalizeVariantTags(item.variant),
    explicitModifiers: normalizeModifiers(item.explicitModifiers),
    implicitModifiers: normalizeModifiers(item.implicitModifiers),
    mutatedModifiers: normalizeModifiers(item.mutatedModifiers),
    tradeInfo: normalizeTradeInfo(item.tradeInfo),
    links: minLinks ?? 0,
    minLinks,
    ...(item.sockets !== undefined ? { sockets: item.sockets } : {}),
    baseType: typeof item.baseType === 'string' ? item.baseType : '',
    ...normalizeForbiddenMetadata(item),
    sparkline: Array.isArray(line.sparkline?.data) ? line.sparkline.data : [],
    volumePerHour: Number.isFinite(line.volumePrimaryValue) ? line.volumePrimaryValue : null,
    volumeCurrency: normalizeCurrencyUnit(primary)
      || normalizeCurrencyUnit(line.volumeCurrency)
      || normalizeCurrencyUnit(line.maxVolumeCurrency)
      || 'chaos',
    maxVolumeCurrency: typeof line.maxVolumeCurrency === 'string' ? line.maxVolumeCurrency : null,
    maxVolumeRate: Number.isFinite(line.maxVolumeRate) ? line.maxVolumeRate : null,
  })
}

function getDivineToChaos(data) {
  const itemByName = new Map((data.items || []).map((item) => [item.name, item]))
  const lineById = new Map(data.lines.map((line) => [line.id, line]))
  const divine = itemByName.get('Divine Orb')
  const chaos = itemByName.get('Chaos Orb')
  const divineLine = divine && lineById.get(divine.id)
  const chaosLine = chaos && lineById.get(chaos.id)
  const chaosEquivalent = Number(divineLine?.chaosEquivalent)
  if (Number.isFinite(chaosEquivalent) && chaosEquivalent > 0) return chaosEquivalent
  const divineValue = divineLine?.primaryValue
  const chaosValue = chaosLine?.primaryValue

  if (!Number.isFinite(divineValue) || !Number.isFinite(chaosValue) || chaosValue <= 0) {
    return null
  }

  return divineValue / chaosValue
}

function normalizeItem(line, category, primary) {
  if (!line.name || !Number.isFinite(line.chaosValue)) return null
  const gemDetails = category === 'Skill Gems' ? normalizeSkillGem(line) : null
  const minLinks = getPoETradeMinLinks({
    name: line.name,
    links: line.links,
    sockets: line.sockets,
  })
  return toItem(
    line.name,
    category,
    line.chaosValue,
    line.sparkLine?.totalChange,
    line.id ?? line.detailsId ?? line.name,
    {
      ...getDetailFields(line),
      ...getScalarDetailFields(line),
      icon: poeNinjaImage(line.icon || line.image),
      detailsId: typeof line.detailsId === 'string' ? line.detailsId : '',
      variant: typeof line.variant === 'string' ? line.variant : '',
      variantTags: normalizeVariantTags(line.variantTags ?? line.variant),
      explicitModifiers: normalizeModifiers(line.explicitModifiers),
      implicitModifiers: normalizeModifiers(line.implicitModifiers),
      mutatedModifiers: normalizeModifiers(line.mutatedModifiers),
      tradeInfo: normalizeTradeInfo(line.tradeInfo),
      links: minLinks ?? 0,
      minLinks,
      ...(line.sockets !== undefined ? { sockets: line.sockets } : {}),
      baseType: typeof line.baseType === 'string' ? line.baseType : '',
      ...normalizeForbiddenMetadata(line),
      ...(gemDetails || {}),
      levelRequired: Number.isFinite(line.levelRequired)
        ? line.levelRequired
        : Number.isFinite(line.itemLevel)
          ? line.itemLevel
          : Number.isFinite(line.level)
            ? line.level
            : null,
      sparkline: Array.isArray(line.sparkLine?.data)
        ? line.sparkLine.data
        : Array.isArray(line.sparkline?.data)
          ? line.sparkline.data
          : [],
      volumePerHour: Number.isFinite(line.volumePrimaryValue) ? line.volumePrimaryValue : null,
      volumeCurrency: normalizeCurrencyUnit(line.volumeCurrency)
        || normalizeCurrencyUnit(line.maxVolumeCurrency)
        || normalizeCurrencyUnit(primary)
        || 'chaos',
      maxVolumeCurrency: typeof line.maxVolumeCurrency === 'string' ? line.maxVolumeCurrency : null,
      maxVolumeRate: Number.isFinite(line.maxVolumeRate) ? line.maxVolumeRate : null,
    },
  )
}

function sortByPrice(items, divineToChaos) {
  return items
    .filter((item) => item && Number.isFinite(item.priceChaos) && item.priceChaos >= 0)
    .sort((left, right) => right.priceChaos - left.priceChaos)
    .map((item) => ({
      ...item,
      priceDivine: Math.round((item.priceChaos / divineToChaos) * 10000) / 10000,
    }))
}

export async function getPoeOneLeagues() {
  const entries = await getCachedJson(LEAGUES_URL, Array.isArray)
  const leagues = entries
    .filter((entry) => typeof entry?.id === 'string' && typeof entry?.name === 'string')
    .map(({ id, name }) => ({ id, name }))
  const defaultLeague = leagues[0]

  if (!defaultLeague) {
    throw new Error('poe.ninja did not provide an active PoE 1 challenge league.')
  }

  return { leagues, defaultLeague: defaultLeague.id }
}

export async function getMarketRate(league) {
  const currencyData = await getCachedJson(endpointUrl('exchange', league, 'Currency'))
  const divineToChaos = getDivineToChaos(currencyData)
  if (!Number.isFinite(divineToChaos) || divineToChaos <= 0) {
    throw new Error(`poe.ninja did not provide a Divine Orb rate for league "${league}"`)
  }

  return {
    league,
    source: 'poe.ninja',
    cacheTtlSeconds: CACHE_TTL_MS / 1000,
    divineToChaos,
    currencyIcons: {
      chaos: {
        name: 'Chaos Orb',
        icon: poeNinjaImage((currencyData.items || []).find((item) => item.name === 'Chaos Orb')?.image),
      },
      divine: {
        name: 'Divine Orb',
        icon: poeNinjaImage((currencyData.items || []).find((item) => item.name === 'Divine Orb')?.image),
      },
    },
    fetchedAt: new Date().toISOString(),
  }
}

async function fetchMarketCategory(league, category) {
  const [rate, source] = await Promise.all([
    getMarketRate(league),
    getCategoryData(category, league),
  ])
  const { data, endpoint, league: dataLeague } = source
  const sourceRate = dataLeague === league ? rate : await getMarketRate(dataLeague)
  const staticDetails = endpoint === 'exchange' && ['Currency', 'Fragments'].includes(category.label)
    ? await getStaticItemDetails()
    : new Map()
  const itemById = new Map((data.items || []).map((item) => [
    item.id,
    mergeStaticItemDetails(item, staticDetails),
  ]))
  const items = endpoint === 'exchange'
    ? data.lines.map((line) => normalizeExchange(
      line,
      itemById,
      data.core?.primary,
      sourceRate.divineToChaos,
      category.label,
    ))
    : data.lines.map((line) => normalizeItem(line, category.label, data.core?.primary))

  return {
    ...rate,
    categoryId: category.id,
    category: category.label,
    dataLeague,
    isFallbackData: dataLeague !== league,
    dataEndpoint: endpoint,
    fallbackTriedLeagues: source.triedLeagues,
    items: sortByPrice(items, rate.divineToChaos),
  }
}

export async function getMarketCategory(league, categoryId, { refresh = false } = {}) {
  const category = MARKET_CATEGORIES.find((entry) => entry.id === categoryId)
  if (!category) return null

  const key = JSON.stringify([league, categoryId])
  if (refresh) {
    const sourceLeagues = league === 'Standard' ? ['Standard'] : [league, 'Standard']
    const categoryKeys = sourceLeagues.map((sourceLeague) => JSON.stringify([sourceLeague, categoryId]))
    for (const categoryKey of categoryKeys) {
      categoryResponseCache.delete(categoryKey)
      categoryResponseInFlight.delete(categoryKey)
    }
    clearCategorySourceCache(league, category)
  }

  const cached = refresh ? undefined : getCachedCategoryResponse(key)
  if (cached) return cached
  const inFlight = categoryResponseInFlight.get(key)
  if (inFlight) return inFlight

  const request = fetchMarketCategory(league, category)
  categoryResponseInFlight.set(key, request)
  try {
    const result = await request
    if (categoryResponseInFlight.get(key) === request) {
      cacheCategoryResponse(key, result)
    }
    return result
  } finally {
    if (categoryResponseInFlight.get(key) === request) {
      categoryResponseInFlight.delete(key)
    }
  }
}

function clearLeagueCache(league) {
  for (const key of cache.keys()) {
    if (new URL(key).searchParams.get('league') === league) cache.delete(key)
  }
}

function clearCategorySourceCache(league, category) {
  const sourceLeagues = league === 'Standard' ? ['Standard'] : [league, 'Standard']
  const sourceEndpoints = category.endpoint === 'item'
    ? ['item', 'exchange', 'currency']
    : ['exchange', 'item', 'currency']

  for (const sourceLeague of sourceLeagues) {
    cache.delete(endpointUrl('exchange', sourceLeague, 'Currency'))
    for (const endpoint of sourceEndpoints) {
      cache.delete(endpointUrl(endpoint, sourceLeague, category.type))
    }
  }
}

export async function getMarketSummary(league, { refresh = false } = {}) {
  if (refresh) clearLeagueCache(league)

  const currencyData = await getCachedJson(endpointUrl('exchange', league, 'Currency'))
  const divineToChaos = getDivineToChaos(currencyData)
  if (!Number.isFinite(divineToChaos) || divineToChaos <= 0) {
    throw new Error(`poe.ninja did not provide a Divine Orb rate for league "${league}"`)
  }

  const groups = await Promise.all(
    [...EXCHANGE_GROUPS.filter((group) => group.type !== 'Currency'), ...ITEM_GROUPS].map(async (group) => {
      const data = await getCachedJson(endpointUrl(group.endpoint, league, group.type))
      if (group.endpoint === 'exchange') {
        const staticDetails = ['Currency', 'Fragments'].includes(group.label)
          ? await getStaticItemDetails()
          : new Map()
        const itemById = new Map((data.items || []).map((item) => [
          item.id,
          mergeStaticItemDetails(item, staticDetails),
        ]))
        return {
          label: group.label,
          items: data.lines.map((line) => normalizeExchange(
            line,
            itemById,
            data.core?.primary,
            divineToChaos,
            group.label,
          )),
        }
      }

      return {
        label: group.label,
        items: data.lines.map((line) => normalizeItem(line, group.label, data.core?.primary)),
      }
    }),
  )

  const groupedItems = new Map()
  const currencyStaticDetails = await getStaticItemDetails()
  const currencyItems = currencyData.lines.map((line) => normalizeExchange(
    line,
    new Map((currencyData.items || []).map((item) => [
      item.id,
      mergeStaticItemDetails(item, currencyStaticDetails),
    ])),
    currencyData.core?.primary,
    divineToChaos,
    'Currency',
  ))
  groupedItems.set('Currency', currencyItems)

  for (const result of groups) {
    const current = groupedItems.get(result.label) || []
    current.push(...result.items)
    groupedItems.set(result.label, current)
  }

  const categories = Array.from(groupedItems, ([label, items]) => ({
    label,
    items: sortByPrice(items, divineToChaos),
  }))

  const cards = categories.find((category) => category.label === 'Divination Cards')?.items || []
  const featured = [...cards]
    .sort((left, right) => (right.change ?? -Infinity) - (left.change ?? -Infinity))
    .slice(0, 5)

  return {
    league,
    source: 'poe.ninja',
    cacheTtlSeconds: CACHE_TTL_MS / 1000,
    divineToChaos,
    categories,
    featured,
    fetchedAt: new Date().toISOString(),
  }
}
