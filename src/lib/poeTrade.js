import { MARKET_CATEGORIES } from '../data/marketCategories.js'

const VALID_STAT_ID_PATTERN = /^(?:explicit|implicit|enchant|pseudo|imbued)\.[a-z][a-z0-9_.-]*(?:\|[a-z0-9_.-]+)?$/i
const DEFAULT_TRADE_STATUS = 'securable'
const VALID_TRADE_STATUS_OPTIONS = new Set(['available', 'securable', 'onlineleague', 'online', 'any'])

const HTML_ENTITY_MAP = {
  '&amp;': '&',
  '&apos;': "'",
  '&gt;': '>',
  '&lt;': '<',
  '&quot;': '"',
  '&#039;': "'",
  '&#39;': "'",
  '&#x27;': "'",
  '&#x027;': "'",
}

function decodeItemName(value) {
  return value.replace(
    /&(?:amp|apos|gt|lt|quot);|&#(?:0*39|x0*27);/gi,
    (entity) => HTML_ENTITY_MAP[entity.toLowerCase()] ?? entity,
  )
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getTradeItemName(item) {
  const rawName = typeof item.name === 'string' ? decodeItemName(item.name).trim() : ''
  if (!rawName) return ''

  const baseType = typeof item.baseType === 'string'
    ? decodeItemName(item.baseType).trim()
    : ''
  const variant = typeof item.variant === 'string'
    ? decodeItemName(item.variant).trim()
    : ''
  const variantTags = Array.isArray(item.variantTags)
    ? item.variantTags
      .filter((tag) => typeof tag === 'string')
      .map((tag) => decodeItemName(tag).trim())
      .filter(Boolean)
    : variant.split(',').map((tag) => tag.trim()).filter(Boolean)
  const suffixes = [variant, ...variantTags, baseType].filter(Boolean)
  let name = rawName

  for (let index = 0; index < 3; index += 1) {
    const previousName = name
    for (const suffix of suffixes) {
      name = name.replace(new RegExp(`,\\s*${escapeRegExp(suffix)}\\s*$`, 'i'), '')
    }
    name = name.replace(/,\s*(?:\d+\s*L|Gem Level(?:\s*\d+)?)\s*$/i, '')
    if (name === previousName) break
  }
  return name.trim()
}

function cleanBaseTypeName(value) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\b(?:Shaper|Elder|Redeemer|Crusader|Hunter|Warlord)(?:\s*\/\s*(?:Shaper|Elder|Redeemer|Crusader|Hunter|Warlord))*\b/gi, '')
    .replace(/\b(?:Synthesised|Fractured)\b/gi, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s*,\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getBaseTypeLevel(item) {
  const rawLevel = item?.levelRequired ?? item?.itemLevel ?? item?.level
  if (typeof rawLevel === 'number' && Number.isFinite(rawLevel)) return rawLevel
  if (typeof rawLevel !== 'string') return null
  const match = rawLevel.trim().match(/^(\d+)\+?$/)
  if (!match) return null
  const level = Number(match[1])
  return Number.isFinite(level) ? { value: level, minimumOnly: rawLevel.trim().endsWith('+') } : null
}

function getBaseTypeInfluenceCount(item) {
  const values = [
    item?.displayInfluence,
    item?.variant,
    ...(Array.isArray(item?.variantTags) ? item.variantTags : []),
    item?.name,
  ].filter((value) => typeof value === 'string' && value.trim())
  if (values.some((value) => /^all$/i.test(value.trim()))) return 6
  const found = new Set()
  for (const value of values) {
    for (const match of value.matchAll(/\b(Shaper|Elder|Redeemer|Crusader|Hunter|Warlord)\b/gi)) {
      found.add(match[1].toLowerCase())
    }
  }
  return found.size
}

function buildBaseTypeStatFilters(item) {
  const countStatId = typeof item?.baseTypeInfluenceCountStatId === 'string'
    ? item.baseTypeInfluenceCountStatId
    : ''
  const influenceStatIds = Array.isArray(item?.baseTypeInfluenceStatIds)
    ? item.baseTypeInfluenceStatIds.filter((id) => typeof id === 'string')
    : []
  const filters = []
  if (countStatId && VALID_STAT_ID_PATTERN.test(countStatId)) {
    const influenceCount = getBaseTypeInfluenceCount(item)
    filters.push({
      id: countStatId,
      value: influenceCount ? { min: influenceCount, max: influenceCount } : { max: 0 },
    })
  }
  filters.push(...influenceStatIds
    .filter((id) => VALID_STAT_ID_PATTERN.test(id))
    .map((id) => ({ id })))
  return filters
}

function parseLinkCount(value, allowBareNumber = false) {
  if (Number.isFinite(value)) {
    return value > 0 ? Math.floor(value) : null
  }
  if (typeof value !== 'string') return null

  const match = value.match(/\b(\d+)\s*L\b/i)
    || (allowBareNumber ? value.match(/^\s*(\d+)\s*$/) : null)
  if (!match) return null
  const count = Number(match[1])
  return Number.isInteger(count) && count > 0 ? count : null
}

function getSocketGroupLinkCount(sockets) {
  if (typeof sockets === 'string') return parseLinkCount(sockets)
  if (!sockets || typeof sockets !== 'object') return null

  for (const value of [sockets.minLinks, sockets.links, sockets.linkCount]) {
    const count = parseLinkCount(value, true)
    if (count != null) return count
  }

  const groups = Array.isArray(sockets)
    ? [sockets]
    : [sockets.linkGroups, sockets.groups, sockets.sockets].filter(Array.isArray)
  let largestGroup = null
  const groupCounts = new Map()

  for (const group of groups.flatMap((entries) => entries)) {
    if (Array.isArray(group)) {
      if (group.length > 1) largestGroup = Math.max(largestGroup || 0, group.length)
      continue
    }

    if (!group || typeof group !== 'object') continue
    const explicit = parseLinkCount(group.minLinks ?? group.links ?? group.linkCount, true)
    if (explicit != null) {
      largestGroup = Math.max(largestGroup || 0, explicit)
      continue
    }

    const groupId = group.group ?? group.linkGroup ?? group.groupId
    if (groupId == null) continue
    const key = String(groupId)
    groupCounts.set(key, (groupCounts.get(key) || 0) + 1)
  }

  for (const count of groupCounts.values()) {
    if (count > 1) largestGroup = Math.max(largestGroup || 0, count)
  }

  return largestGroup
}

export function getPoETradeMinLinks(item) {
  const safeItem = item && typeof item === 'object' ? item : {}
  for (const value of [safeItem.minLinks, safeItem.links]) {
    const count = parseLinkCount(value, true)
    if (count != null) return count
  }

  const socketLinks = getSocketGroupLinkCount(safeItem.sockets)
  if (socketLinks != null) return socketLinks

  for (const value of [safeItem.displayName, safeItem.displayText, safeItem.name]) {
    const count = parseLinkCount(value)
    if (count != null) return count
  }
  return null
}

function isUniqueItem(item, category) {
  return category?.label?.toLowerCase().startsWith('unique')
    || ['ForbiddenJewel', 'ShrineBelt'].includes(category?.type)
    || /^(Uber Blighted|Foulborn|Foil|Relic|Replica|Synthesised|Blighted)\s+/i.test(item.name || '')
}

export function buildPoETradePayload(item, matchedStatIds = [], statusOption = DEFAULT_TRADE_STATUS) {
  const safeItem = item && typeof item === 'object' ? item : {}
  const tradeStatus = VALID_TRADE_STATUS_OPTIONS.has(statusOption) ? statusOption : 'securable'
  const itemName = getTradeItemName(safeItem)
  const itemCategory = typeof safeItem.category === 'string' ? safeItem.category : ''
  const category = MARKET_CATEGORIES.find(({ label }) => label === itemCategory)
  const minLinks = getPoETradeMinLinks(safeItem)

  if (
    category?.endpoint === 'exchange'
    && category.id !== 'divination-cards'
    && category.id !== 'currency'
  ) {
    const exchangeQuery = {
      exchange: {
        status: { option: tradeStatus },
        have: [],
        want: [safeItem.tradeId || itemName],
      },
    }
    return exchangeQuery
  }

  const statIds = [...new Set(
    (Array.isArray(matchedStatIds) ? matchedStatIds : [])
      .map((entry) => typeof entry === 'string' ? entry : entry?.matchedStatId)
      .filter((id) => typeof id === 'string' && VALID_STAT_ID_PATTERN.test(id)),
  )]
  const statFilters = [...new Map(
    (Array.isArray(matchedStatIds) ? matchedStatIds : [])
      .map((entry) => typeof entry === 'string' ? { id: entry } : entry)
      .filter((entry) => typeof entry?.matchedStatId === 'string' || typeof entry?.id === 'string')
      .map((entry) => {
        const id = entry.matchedStatId || entry.id
        return [id, {
          id,
          ...(entry.value ? { value: entry.value } : {}),
        }]
      }),
  ).values()]
  const query = {
    status: { option: tradeStatus },
  }
  const isImbuedGem = category?.id === 'imbued-gems'
  const isSkillGem = category?.id === 'skill-gems'
    || safeItem.gemLevel != null
    || safeItem.gemQuality != null
  if (isImbuedGem) {
    query.type = itemName
    if (statFilters.length) {
      query.stats = [{
        type: 'and',
        filters: statFilters.map((filter) => ({ ...filter, disabled: false })),
        disabled: false,
      }]
    }
    return { query, sort: { price: 'asc' } }
  }
  if (isSkillGem) {
    const miscFilters = {}
    const gemLevel = Number(safeItem.gemLevel)
    const gemQuality = Number(safeItem.gemQuality)
    if (Number.isFinite(gemLevel) && gemLevel > 0) {
      miscFilters.gem_level = { min: gemLevel, max: gemLevel }
    }
    if (Number.isFinite(gemQuality) && gemQuality > 0) {
      miscFilters.quality = { min: gemQuality, max: gemQuality }
    }
    if (typeof safeItem.corrupted === 'boolean') {
      miscFilters.corrupted = { option: safeItem.corrupted ? 'true' : 'false' }
    }
    query.type = itemName
    if (Object.keys(miscFilters).length) {
      query.filters = { misc_filters: { filters: miscFilters } }
    }
    return { query, sort: { price: 'asc' } }
  }
  if (category?.id === 'base-types') {
    const rawBaseType = typeof safeItem.baseType === 'string' ? safeItem.baseType : ''
    query.type = cleanBaseTypeName(rawBaseType) || cleanBaseTypeName(itemName)
    const baseTypeStatFilters = buildBaseTypeStatFilters(safeItem)
    if (baseTypeStatFilters.length) {
      query.stats = [{ type: 'and', filters: baseTypeStatFilters }]
    }
    query.filters = {
      type_filters: {
        filters: {
          rarity: { option: 'nonunique' },
        },
      },
    }
    const level = getBaseTypeLevel(safeItem)
    const levelValue = typeof level === 'number' ? { value: level, minimumOnly: false } : level
    if (levelValue) {
      query.filters.misc_filters = {
        filters: {
          ilvl: levelValue.minimumOnly
            ? { min: levelValue.value }
            : { min: levelValue.value, max: levelValue.value },
        },
      }
    }
    if (minLinks != null) {
      query.filters.socket_filters = {
        filters: {
          links: { min: minLinks },
        },
      }
    }
    return { query, sort: { price: 'asc' } }
  }
  if (statIds.length) {
    query.stats = [{
      type: 'and',
      filters: statIds.map((id) => ({ id })),
    }]
  }

  const forbiddenVariant = typeof safeItem.variant === 'string'
    ? safeItem.variant.trim().match(/^Forbidden\s+(?:Flame|Flesh)$/i)?.[0]
    : ''
  const isForbiddenJewel = category?.id === 'forbidden-jewels' && forbiddenVariant
  const isUnique = isUniqueItem({ ...safeItem, name: itemName }, category)
  const baseType = typeof safeItem.baseType === 'string'
    ? decodeItemName(safeItem.baseType).trim()
    : ''
  if (isForbiddenJewel) {
    query.name = forbiddenVariant
    if (baseType) query.type = baseType
  } else if (isUnique) {
    query.name = itemName.replace(/\bFoulborn\s+/gi, '').replace(/\s+/g, ' ').trim()
    if (baseType) query.type = baseType
  } else {
    query.type = itemName
  }

  if (minLinks != null) {
    query.filters = {
      socket_filters: {
        filters: {
          links: { min: minLinks },
        },
      },
    }
  }

  return { query, sort: { price: 'asc' } }
}

export function buildPoETradeUrl(item, league, matchedStatIds = [], statusOption = DEFAULT_TRADE_STATUS) {
  const safeItem = item && typeof item === 'object' ? item : {}
  const itemCategory = typeof safeItem.category === 'string' ? safeItem.category : ''
  const category = MARKET_CATEGORIES.find(({ label }) => label === itemCategory)
  const encodedLeague = encodeURIComponent(typeof league === 'string' ? league : '')
  const isExchange = category?.endpoint === 'exchange'
    && category.id !== 'divination-cards'
    && category.id !== 'currency'
  const path = isExchange ? 'exchange' : 'search'
  const payload = buildPoETradePayload(safeItem, matchedStatIds, statusOption)
  return `https://www.pathofexile.com/trade/${path}/${encodedLeague}?q=${encodeURIComponent(JSON.stringify(payload))}`
}
