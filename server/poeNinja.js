import { MARKET_CATEGORIES } from '../src/data/marketCategories.js'

const API_BASE = 'https://poe.ninja/poe1/api/economy'
const LEAGUES_URL = `${API_BASE}/leagues`
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 128
const cache = new Map()

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
]

const ITEM_GROUPS = [
  { label: 'Unique Items', endpoint: 'item', type: 'UniqueWeapon' },
  { label: 'Unique Items', endpoint: 'item', type: 'UniqueArmour' },
  { label: 'Unique Items', endpoint: 'item', type: 'UniqueAccessory' },
  { label: 'Unique Items', endpoint: 'item', type: 'UniqueFlask' },
  { label: 'Unique Items', endpoint: 'item', type: 'UniqueJewel' },
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

function normalizeExchange(line, itemById, primary, divineToChaos, category) {
  const item = itemById.get(line.id)
  if (!item || !Number.isFinite(line.primaryValue)) return null

  const priceChaos = primary === 'divine'
    ? line.primaryValue * divineToChaos
    : line.primaryValue
  const icon = poeNinjaImage(item.image || item.icon)
    || (category === 'Divination Cards' ? divinationCardImage(item.detailsId || item.id || line.id) : null)
  return toItem(item.name, category, priceChaos, line.sparkline?.totalChange, line.id, {
    icon,
    variant: typeof item.variant === 'string' ? item.variant : '',
    links: Number.isFinite(item.links) ? item.links : 0,
    baseType: typeof item.baseType === 'string' ? item.baseType : '',
    sparkline: Array.isArray(line.sparkline?.data) ? line.sparkline.data : [],
    volumePerHour: Number.isFinite(line.volumePrimaryValue) ? line.volumePrimaryValue : null,
    maxVolumeCurrency: typeof line.maxVolumeCurrency === 'string' ? line.maxVolumeCurrency : null,
    maxVolumeRate: Number.isFinite(line.maxVolumeRate) ? line.maxVolumeRate : null,
  })
}

function getDivineToChaos(data) {
  const itemByName = new Map((data.items || []).map((item) => [item.name, item]))
  const lineById = new Map(data.lines.map((line) => [line.id, line]))
  const divine = itemByName.get('Divine Orb')
  const chaos = itemByName.get('Chaos Orb')
  const divineValue = divine && lineById.get(divine.id)?.primaryValue
  const chaosValue = chaos && lineById.get(chaos.id)?.primaryValue

  if (!Number.isFinite(divineValue) || !Number.isFinite(chaosValue) || chaosValue <= 0) {
    return null
  }

  return divineValue / chaosValue
}

function normalizeItem(line, category) {
  if (!line.name || !Number.isFinite(line.chaosValue)) return null
  return toItem(
    line.name,
    category,
    line.chaosValue,
    line.sparkLine?.totalChange,
    line.id ?? line.detailsId ?? line.name,
    {
      icon: poeNinjaImage(line.icon || line.image),
      variant: typeof line.variant === 'string' ? line.variant : '',
      links: Number.isFinite(line.links) ? line.links : 0,
      baseType: typeof line.baseType === 'string' ? line.baseType : '',
      sparkline: Array.isArray(line.sparkLine?.data)
        ? line.sparkLine.data
        : Array.isArray(line.sparkline?.data)
          ? line.sparkline.data
          : [],
      volumePerHour: Number.isFinite(line.volumePrimaryValue) ? line.volumePrimaryValue : null,
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

export async function getMarketCategory(league, categoryId, { refresh = false } = {}) {
  const category = MARKET_CATEGORIES.find((entry) => entry.id === categoryId)
  if (!category) return null
  if (refresh) clearLeagueCache(league)

  const [rate, data] = await Promise.all([
    getMarketRate(league),
    category.id === 'currency'
      ? getCachedJson(endpointUrl('exchange', league, 'Currency'))
      : getCachedJson(endpointUrl(category.endpoint, league, category.type)),
  ])
  const itemById = new Map((data.items || []).map((item) => [item.id, item]))
  const items = category.endpoint === 'exchange'
    ? data.lines.map((line) => normalizeExchange(
      line,
      itemById,
      data.core?.primary,
      rate.divineToChaos,
      category.label,
    ))
    : data.lines.map((line) => normalizeItem(line, category.label))

  return {
    ...rate,
    categoryId: category.id,
    category: category.label,
    items: sortByPrice(items, rate.divineToChaos),
  }
}

function clearLeagueCache(league) {
  for (const key of cache.keys()) {
    if (new URL(key).searchParams.get('league') === league) cache.delete(key)
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
        const itemById = new Map((data.items || []).map((item) => [item.id, item]))
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
        items: data.lines.map((line) => normalizeItem(line, group.label)),
      }
    }),
  )

  const groupedItems = new Map()
  const currencyItems = currencyData.lines.map((line) => normalizeExchange(
    line,
    new Map((currencyData.items || []).map((item) => [item.id, item])),
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
