import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  CircleDollarSign,
  ExternalLink,
  Gem,
  Layers3,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
} from 'lucide-react'
import { MARKET_CATEGORIES, MARKET_CATEGORY_GROUPS } from '../data/marketCategories'
import { MARKET_CATEGORY_ICONS } from '../data/marketCategoryIcons'
import { getBaseItemData } from '../data/baseItemsData'
import {
  FORBIDDEN_ASCENDANCY_BASE_CLASS,
  FORBIDDEN_BASE_CLASSES,
  FORBIDDEN_BASE_CLASS_ASCENDANCIES,
  normalizeForbiddenJewelsMetadata,
} from '../data/forbiddenJewels'
import { buildPoETradePayload, buildPoETradeUrl, getPoETradeMinLinks } from '../lib/poeTrade'
import { normalizeSkillGem } from '../lib/poeNinjaGem'
import { getBaseTypeStatMatches, getForbiddenJewelStatMatches, getImbuedStatMatches, getVariantStatMatches } from '../lib/poeTradeStats'
import { getImbuedStatMap } from '../data/imbuedStats.js'

const PAGE_SIZE = 30
const CATEGORY_CACHE_MS = 5 * 60 * 1000
const MAX_CATEGORY_CACHE_ENTRIES = 64
const CURRENCY_ICON_CACHE_KEY = 'poestash.currency-icons.v1'
const CURRENCY_ICON_API_URL = 'https://poe.ninja/api/data/currencyoverview?league=Standard&type=Currency'
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const CURRENCY_ICON_FALLBACKS = {
  chaos: { name: 'Chaos Orb' },
  divine: { name: 'Divine Orb' },
}
const VARIANT_PREFIX_PATTERN = /^(Uber Blighted|Foulborn|Foil|Relic|Replica|Synthesised|Blighted)\s+/i
const BASE_TYPE_INFLUENCE_PATTERN = /\b((?:Elder|Crusader|Shaper|Redeemer|Hunter|Warlord)(?:\s*\/\s*(?:Elder|Crusader|Shaper|Redeemer|Hunter|Warlord)){1,}|(?:Crusader|Shaper|Redeemer|Hunter|Warlord|Elder)|Synthesised|Fractured)\b/i
const INFLUENCE_ORDER = ['shaper', 'elder', 'redeemer', 'crusader', 'hunter', 'warlord', 'synthesised', 'fractured']
const COMPOSITE_NAME_CATEGORY_IDS = new Set([
  'maps',
  'blighted-maps',
  'blight-ravaged-maps',
  'valdo-maps',
  'temples',
  'scrying-orbs',
  'beasts',
])
const MAP_TIER_COLUMN_CATEGORY_IDS = new Set([
  'maps',
  'blighted-maps',
  'blight-ravaged-maps',
  'unique-maps',
])

let currencyIconMapPromise

function cacheCategoryResponse(cache, key, entry) {
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > MAX_CATEGORY_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value)
  }
}

function getVariantPrefix(name) {
  return name.match(VARIANT_PREFIX_PATTERN)?.[1] || ''
}

function getFallbackWikiTitle(name) {
  return name.replace(VARIANT_PREFIX_PATTERN, '').trim() || name
}

function getSearchDisplayName(name) {
  return name.replace(VARIANT_PREFIX_PATTERN, '').trim() || name
}

function getPrimaryCompositeName(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  return value.split(',')[0].trim()
}

function cleanDisplayName(value, item, category) {
  const rawParts = String(value || '').split(',').map((part) => part.trim()).filter(Boolean)
  if (!rawParts.length) return ''
  const itemName = String(item?.name || '').trim().toLowerCase()
  const baseType = String(item?.baseType || '').trim().toLowerCase()
  const categoryName = String(category || '').trim().toLowerCase()
  const seen = new Set()
  const subParts = rawParts.slice(1).filter((part) => {
    const normalized = part.toLowerCase()
    if (normalized === itemName || normalized === baseType || normalized === categoryName || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
  return subParts.length ? `${rawParts[0]}, ${subParts.join(', ')}` : rawParts[0]
}

function getNameSortKey(item, categoryId) {
  const hideCompositeName = COMPOSITE_NAME_CATEGORY_IDS.has(categoryId)
  const isSkillGemCategory = categoryId === 'skill-gems'
  const displayNameText = cleanDisplayName(
    item?.displayName || item?.name,
    item,
    item?.category,
  ) || String(item?.name || '')
  const displayNameParts = displayNameText.split(',').map((part) => part.trim()).filter(Boolean)
  const primaryName = displayNameParts.shift() || displayNameText
  const hasDistinctBaseType = typeof item?.baseType === 'string'
    && item.baseType.trim().toLowerCase() !== displayNameText.trim().toLowerCase()
  const subtitleCandidates = [
    ...displayNameParts,
    ...(!isSkillGemCategory && !hideCompositeName ? [item?.variant] : []),
    ...(!hideCompositeName && hasDistinctBaseType ? [item?.baseType] : []),
    ...(item?.links >= 5 ? [`${item.links}L`] : []),
  ]
  const seen = new Set()
  const subtitle = subtitleCandidates
    .map((part) => typeof part === 'string' ? part.trim() : '')
    .filter((part) => {
      const normalized = part.toLowerCase()
      const itemName = String(item?.name || '').trim().toLowerCase()
      const categoryName = String(item?.category || '').trim().toLowerCase()
      if (!normalized || normalized === itemName || normalized === categoryName || seen.has(normalized)) return false
      seen.add(normalized)
      return true
    })
  return [primaryName, ...subtitle].join(', ')
}

function extractMapTier(item) {
  const directTier = Number(item?.mapTier)
  if (Number.isInteger(directTier) && directTier > 0) return directTier

  for (const value of [item?.name, item?.variant, item?.baseType]) {
    if (typeof value !== 'string') continue
    const match = value.match(/\(\s*tier\s+(\d+)\s*\)/i) || value.match(/tier\s+(\d+)/i)
    if (match) return Number(match[1])
  }
  return null
}

function normalizeInfluenceLabel(value) {
  return value
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(.)/, (match) => match.toUpperCase())
}

function getInfluenceCombination(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  const parts = value.split('/').map((part) => part.trim().toLowerCase()).filter(Boolean)
  const uniqueParts = [...new Set(parts)]
  uniqueParts.sort((left, right) => {
    const leftIndex = INFLUENCE_ORDER.indexOf(left)
    const rightIndex = INFLUENCE_ORDER.indexOf(right)
    return (leftIndex < 0 ? INFLUENCE_ORDER.length : leftIndex)
      - (rightIndex < 0 ? INFLUENCE_ORDER.length : rightIndex)
      || left.localeCompare(right)
  })
  return uniqueParts.join('/')
}

function formatInfluenceCombination(value) {
  return getInfluenceCombination(value)
    .split('/')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('/')
}

function getBaseTypeDisplayMetadata(source) {
  const candidates = [source?.variant, source?.name, source?.displayName]
    .filter((value) => typeof value === 'string' && value.trim())
  let influence = ''
  for (const candidate of candidates) {
    const match = candidate.match(BASE_TYPE_INFLUENCE_PATTERN)
    if (match) {
      influence = normalizeInfluenceLabel(match[1])
      break
    }
  }
  if (!influence) return { displayName: '', displayInfluence: '' }
  const rawName = typeof source?.name === 'string' && source.name.trim()
    ? source.name.trim()
    : typeof source?.displayName === 'string' ? source.displayName.trim() : ''
  const displayName = rawName
    .replace(BASE_TYPE_INFLUENCE_PATTERN, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s*,\s*$/, '')
    .trim()
  return { displayName: displayName || rawName, displayInfluence: formatInfluenceCombination(influence) }
}

function wikiPageUrl(title) {
  return `https://www.poewiki.net/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`
}

function normalizeIconUrl(icon) {
  if (typeof icon !== 'string' || !icon.trim()) return null
  try {
    const url = new URL(icon, 'https://web.poecdn.com')
    if (url.hostname === 'poe.ninja' && url.pathname.startsWith('/gen/image/')) {
      url.hostname = 'web.poecdn.com'
    }
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function createIconMap(entries) {
  if (!Array.isArray(entries)) return {}
  const icons = Object.create(null)
  for (const entry of entries) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
    const icon = normalizeIconUrl(entry?.icon)
    if (name && icon) icons[name] = icon
  }
  return icons
}

function normalizeMarketItem(item, fallbackCategory = '', fallbackCategoryId = '') {
  const source = item && typeof item === 'object' ? item : {}
  const name = typeof source.name === 'string' && source.name.trim()
    ? source.name.trim()
    : 'Unknown item'
  const category = typeof source.category === 'string' ? source.category : fallbackCategory
  const isCompositeNameCategory = COMPOSITE_NAME_CATEGORY_IDS.has(fallbackCategoryId)
    || COMPOSITE_NAME_CATEGORY_IDS.has(fallbackCategory)
    || COMPOSITE_NAME_CATEGORY_IDS.has(category)
  const gemDetails = category === 'Skill Gems' || fallbackCategory === 'skill-gems'
    ? normalizeSkillGem(source)
    : null
  const priceChaos = Number.isFinite(source.priceChaos) ? source.priceChaos : 0
  const minLinks = getPoETradeMinLinks(source)
  const forbiddenMetadata = fallbackCategory === 'forbidden-jewels' || category === 'Forbidden Jewels'
    ? normalizeForbiddenJewelsMetadata(source)
    : {}
  const baseTypeMetadata = fallbackCategory === 'base-types' || category === 'Base Types'
    ? getBaseTypeDisplayMetadata(source)
    : {}
  return {
    ...source,
    id: typeof source.id === 'string' && source.id
      ? source.id
      : `${category}-${name}`,
    name,
    category,
    variant: typeof source.variant === 'string' ? source.variant : '',
    variantTags: Array.isArray(source.variantTags)
      ? source.variantTags.filter((tag) => typeof tag === 'string' && tag.trim())
      : typeof source.variant === 'string'
        ? source.variant.split(',').map((tag) => tag.trim()).filter(Boolean)
        : [],
    explicitModifiers: Array.isArray(source.explicitModifiers)
      ? source.explicitModifiers
        .map((modifier) => {
          if (typeof modifier === 'string') return modifier
          if (typeof modifier?.text !== 'string' || !modifier.text.trim()) return null
          return { ...modifier, text: modifier.text }
        })
        .filter(Boolean)
      : [],
    implicitModifiers: Array.isArray(source.implicitModifiers)
      ? source.implicitModifiers
        .map((modifier) => {
          if (typeof modifier === 'string') return modifier
          if (typeof modifier?.text !== 'string' || !modifier.text.trim()) return null
          return { ...modifier, text: modifier.text }
        })
        .filter(Boolean)
      : [],
    mutatedModifiers: Array.isArray(source.mutatedModifiers)
      ? source.mutatedModifiers
        .map((modifier) => {
          if (typeof modifier === 'string') return modifier
          if (typeof modifier?.text !== 'string' || !modifier.text.trim()) return null
          return { ...modifier, text: modifier.text }
        })
        .filter(Boolean)
      : [],
    tradeInfo: Array.isArray(source.tradeInfo)
      ? source.tradeInfo.filter((entry) => typeof entry?.mod === 'string')
      : [],
    baseType: typeof source.baseType === 'string' ? source.baseType : '',
    ...(Object.keys(forbiddenMetadata).length
      ? {
          displayBaseClass: forbiddenMetadata.baseClass,
          displayAscendancy: forbiddenMetadata.ascendancy,
          displayPassiveName: forbiddenMetadata.passiveName,
        }
      : {}),
    ...(Object.keys(baseTypeMetadata).length ? baseTypeMetadata : {}),
    displayName: cleanDisplayName(
      gemDetails?.displayName
        || baseTypeMetadata.displayName
        || (isCompositeNameCategory ? getPrimaryCompositeName(name) : null)
        || (typeof source.displayName === 'string' ? source.displayName : name),
      source,
      category,
    ) || name,
    gemLevel: gemDetails?.gemLevel ?? (Number.isFinite(source.gemLevel) ? source.gemLevel : null),
    tierValue: extractMapTier(source),
    gemQuality: gemDetails?.gemQuality ?? (Number.isFinite(source.gemQuality) ? source.gemQuality : null),
    corrupted: gemDetails?.corrupted ?? Boolean(source.corrupted),
    links: minLinks ?? 0,
    minLinks,
    levelRequired: Number.isFinite(source.levelRequired)
      ? source.levelRequired
      : Number.isFinite(source.itemLevel)
        ? source.itemLevel
        : Number.isFinite(source.level)
          ? source.level
          : null,
    tradeId: typeof source.tradeId === 'string' ? source.tradeId : '',
    icon: typeof source.icon === 'string' ? source.icon : '',
    priceChaos,
    priceDivine: Number.isFinite(source.priceDivine) ? source.priceDivine : 0,
    change: Number.isFinite(source.change) ? source.change : null,
    volumePerHour: Number.isFinite(source.volumePerHour) ? source.volumePerHour : null,
    volumeCurrency: typeof source.volumeCurrency === 'string' ? source.volumeCurrency : 'chaos',
    maxVolumeRate: Number.isFinite(source.maxVolumeRate) ? source.maxVolumeRate : null,
    sparkline: Array.isArray(source.sparkline) ? source.sparkline.filter(Number.isFinite) : [],
  }
}

function getMarketLevel(item, categoryId) {
  const value = categoryId === 'skill-gems' ? item?.gemLevel : item?.levelRequired
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return String(value)
  }
  if (typeof value === 'string') {
    const level = value.trim()
    if (/^\d+\+?$/.test(level)) return level
  }
  return ''
}

function normalizeMarketResponse(result, fallbackCategory) {
  return {
    ...(result && typeof result === 'object' ? result : {}),
    categoryId: typeof result?.categoryId === 'string' ? result.categoryId : fallbackCategory,
    items: Array.isArray(result?.items)
      ? result.items.map((item) => normalizeMarketItem(item, fallbackCategory, fallbackCategory))
      : [],
    currencyIcons: result?.currencyIcons && typeof result.currencyIcons === 'object'
      ? result.currencyIcons
      : {},
    divineToChaos: Number.isFinite(result?.divineToChaos) ? result.divineToChaos : 0,
  }
}

function normalizeTooltipModifier(value) {
  const text = typeof value === 'string'
    ? value
    : typeof value?.text === 'string'
      ? value.text
      : typeof value?.name === 'string' && value.value != null
        ? `${value.name}: ${value.value}`
        : ''
  return text
    .toLowerCase()
    .replace(/[−–—]/g, '-')
    .replace(/[^a-z0-9+%-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getTooltipLineText(value) {
  if (typeof value === 'string') return value
  if (typeof value?.text === 'string') return value.text
  if (typeof value?.name === 'string' && value.value != null) return `${value.name}: ${value.value}`
  return ''
}

function tooltipModifiersMatch(left, right) {
  const leftKey = normalizeTooltipModifier(left)
  const rightKey = normalizeTooltipModifier(right)
  return Boolean(leftKey && rightKey && (
    leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey)
  ))
}

function getPoeNinjaTooltipDetails(item) {
  const source = item && typeof item === 'object' ? item : {}
  const category = String(source.category || '').toLowerCase()
  const isEquipmentCategory = category === 'base types' || category.startsWith('unique')
  const base = isEquipmentCategory ? getBaseItemData(source.baseType) : null
  const stringList = (value) => typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.map((line) => {
      if (typeof line === 'string') return line
      if (typeof line?.text === 'string') return line.text
      if (typeof line?.name === 'string' && line.value != null) return `${line.name}: ${line.value}`
      if (typeof line?.name === 'string' && Array.isArray(line.values)) {
        return `${line.name}: ${line.values.map((value) => {
          if (typeof value === 'string') return value
          if (Array.isArray(value)) return value[0] || ''
          return value?.value || ''
        }).filter(Boolean).join(', ')}`
      }
      return ''
      }).filter(Boolean)
      : []
  const modifierList = (value) => Array.isArray(value)
    ? value.map((line) => typeof line === 'string' ? line : line?.text ? { ...line, text: line.text } : null).filter(Boolean)
    : []
  const directRequirements = stringList(source.requirements)
  const requirementFallback = []
  const baseRequirements = Array.isArray(base?.r) ? base.r : []
  const requiredLevel = Math.max(
    Number(source.levelRequired ?? source.requiredLevel ?? source.itemLevel ?? source.level) || 0,
    Number(baseRequirements[0]) || 0,
  )
  if (requiredLevel > 0) requirementFallback.push(`Requires Level ${requiredLevel}`)
  for (const [key, label] of [
    ['requiredStrength', 'Str'],
    ['requiredDexterity', 'Dex'],
    ['requiredIntelligence', 'Int'],
  ]) {
    const index = label === 'Str' ? 1 : label === 'Dex' ? 2 : 3
    const value = source[key] ?? baseRequirements[index]
    if (value != null && String(value).trim() && Number(value) > 0) requirementFallback.push(`${value} ${label}`)
  }
  const modifierText = [source.explicitModifiers, source.implicitModifiers]
    .flatMap((value) => Array.isArray(value) ? value.map(getTooltipLineText) : [])
    .join(' ')
  const noAttributeRequirements = /has no attribute requirements(?: or energy shield)?/i.test(modifierText)
  const fallbackRequirements = noAttributeRequirements
    ? requirementFallback.filter((line) => /^Requires Level/i.test(line))
    : requirementFallback
  const directProperties = stringList(source.basicStats?.length ? source.basicStats : source.properties)
  const propertyFallback = []
  for (const [key, label] of [
    ['stackSize', 'Stack Size'],
    ['mapTier', 'Map Tier'],
    ['gemLevel', 'Level'],
    ['gemQuality', 'Quality'],
    ['quality', 'Quality'],
    ['energyShield', 'Energy Shield'],
    ['armour', 'Armour'],
    ['evasion', 'Evasion'],
    ['ward', 'Ward'],
    ['movementSpeed', 'Movement Speed'],
    ['physicalDamage', 'Physical Damage'],
    ['attacksPerSecond', 'Attacks per Second'],
    ['criticalStrikeChance', 'Critical Strike Chance'],
  ]) {
    if (source[key] != null && String(source[key]).trim()) propertyFallback.push(`${label}: ${source[key]}`)
  }
  if (base?.p) {
    const basePropertyLabels = {
      ar: 'Armour', ev: 'Evasion', es: 'Energy Shield', ward: 'Ward',
      block: 'Chance to Block', ms: 'Movement Speed', crit: 'Critical Strike Chance',
      aps: 'Attacks per Second', range: 'Weapon Range', duration: 'Duration', charges: 'Charges',
    }
    for (const [key, label] of Object.entries(basePropertyLabels)) {
      if (base.p[key] == null || propertyFallback.some((line) => line.startsWith(`${label}:`))) continue
      const value = Array.isArray(base.p[key]) ? base.p[key].join('–') : base.p[key]
      propertyFallback.push(`${label}: ${value}${key === 'ms' ? '%' : ''}`)
    }
    if (Array.isArray(base.p.phys) && !propertyFallback.some((line) => line.startsWith('Physical Damage:'))) {
      propertyFallback.push(`Physical Damage: ${base.p.phys.join('–')}`)
    }
  }
  return {
    ...source,
    name: typeof source.name === 'string' ? source.name : '',
    baseItem: typeof source.baseItem === 'string' ? source.baseItem : source.baseType || '',
    itemClass: typeof source.itemClass === 'string' ? source.itemClass : source.category || '',
    rarity: typeof source.rarity === 'string' ? source.rarity : '',
    basicStats: directProperties.length ? directProperties : propertyFallback,
    requirements: directRequirements.length ? directRequirements : fallbackRequirements,
    secDescrText: stringList(source.secDescrText),
    implicitStats: modifierList(source.implicitModifiers),
    explicitStats: modifierList(source.explicitModifiers),
    enchantmentStats: modifierList(source.enchantmentModifiers || source.enchantmentStats),
    descrText: stringList(source.descrText || source.description),
    helpText: stringList(source.helpText),
    variantInfo: stringList(source.foulbornModifiers || source.mutatedModifiers),
    iconUrl: typeof source.iconUrl === 'string' ? source.iconUrl : source.icon || null,
  }
}

function getFoulbornTooltipDetails(details, item) {
  const isFoulborn = /^Foulborn\b/i.test(item?.name || '')
    || (Array.isArray(item?.foulbornModifiers) && item.foulbornModifiers.length > 0)
  if (!details || !isFoulborn) return details

  const variantInfo = Array.isArray(details.variantInfo) ? details.variantInfo : []
  const itemExplicitModifiers = [
    ...(Array.isArray(item?.explicitModifiers) ? item.explicitModifiers : []),
    ...(Array.isArray(item?.mutatedModifiers) ? item.mutatedModifiers : []),
  ]
  const explicitStats = Array.isArray(details.explicitStats) ? details.explicitStats : []
  const declaredFoulbornModifiers = [
    ...(Array.isArray(item?.foulbornModifiers) ? item.foulbornModifiers : []),
  ]
  const activeModifiers = variantInfo.filter((line) => itemExplicitModifiers.some((modifier) => (
    tooltipModifiersMatch(line, modifier)
  )))

  for (const line of declaredFoulbornModifiers) {
    if (!activeModifiers.some((active) => tooltipModifiersMatch(active, line))) {
      const matchingVariantLine = variantInfo.find((variantLine) => tooltipModifiersMatch(variantLine, line))
      activeModifiers.push(matchingVariantLine || line)
    }
  }

  if (!activeModifiers.length) {
    const variantText = [item.variant, ...(item.variantTags || []), item.name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    const variantPatterns = [
      { pattern: /gem\s*level|level\s*of\s*socketed/, match: /level\s+of\s+socketed/i },
      { pattern: /no\s*requirements|requirements?/, match: /attribute\s+requirements/i },
      { pattern: /block/, match: /block/i },
      { pattern: /chaos\s+damage/, match: /chaos\s+damage/i },
    ]
    const selectedPattern = variantPatterns.find(({ pattern }) => pattern.test(variantText))
    if (selectedPattern) {
      activeModifiers.push(...variantInfo.filter((line) => selectedPattern.match.test(line)))
    }
  }

  const selected = [...new Set(activeModifiers)]
  const selectedKeys = new Set(selected.map(normalizeTooltipModifier))
  const hasGemLevelReplacement = selected.some((line) => /level\s+of\s+socketed/i.test(line))
  const hasNoRequirementsReplacement = selected.some((line) => /attribute\s+requirements/i.test(line))
  const hasVariantExplicitData = itemExplicitModifiers.length > 0
  const currentVariantModifiers = itemExplicitModifiers
    .map(normalizeTooltipModifier)
    .filter((key) => key && ![...selectedKeys].some((selectedKey) => tooltipModifiersMatch(key, selectedKey)))
  const replacementIndexes = new Set()

  // poe.ninja normally supplies the exact explicit list for the selected variant.
  // If the tooltip fallback came from the base item (for example Wiki Cargo), keep
  // the current variant's non-Foulborn lines and remove one unmatched original
  // line for each active Foulborn replacement.
  if (hasVariantExplicitData && selected.length) {
    const unmatchedOriginalIndexes = explicitStats.reduce((indexes, line, index) => {
      const isActiveFoulborn = [...selectedKeys].some((key) => tooltipModifiersMatch(line, key))
      const belongsToCurrentVariant = currentVariantModifiers.some((key) => tooltipModifiersMatch(line, key))
      if (!isActiveFoulborn && !belongsToCurrentVariant) indexes.push(index)
      return indexes
    }, [])
    unmatchedOriginalIndexes.slice(0, selected.length).forEach((index) => replacementIndexes.add(index))
  }

  return {
    ...details,
    requirements: hasNoRequirementsReplacement ? [] : details.requirements,
    explicitStats: explicitStats.filter((line, index) => (
      ![...selectedKeys].some((key) => tooltipModifiersMatch(line, key))
      && !replacementIndexes.has(index)
      && !(hasGemLevelReplacement && /quality\s+of\s+socketed\s+support\s+gems/i.test(line))
    )),
    variantInfo: selected,
  }
}

function getCachedCurrencyIconMap() {
  try {
    const stored = localStorage.getItem(CURRENCY_ICON_CACHE_KEY)
    if (!stored) return null
    const icons = JSON.parse(stored)
    if (!icons || typeof icons !== 'object' || Array.isArray(icons)) return null
    const validIcons = Object.create(null)
    for (const [name, icon] of Object.entries(icons)) {
      const url = normalizeIconUrl(icon)
      if (name.trim() && url) validIcons[name] = url
    }
    return Object.keys(validIcons).length ? validIcons : null
  } catch {
    return null
  }
}

function cacheCurrencyIconMap(icons) {
  try {
    localStorage.setItem(CURRENCY_ICON_CACHE_KEY, JSON.stringify(icons))
  } catch {}
}

async function fetchCurrencyIconMap() {
  let sourceError
  try {
    const response = await fetch(CURRENCY_ICON_API_URL)
    if (!response.ok) throw new Error(`poe.ninja icon API returned HTTP ${response.status}.`)
    const data = await response.json()
    const icons = createIconMap(data.currencyDetails)
    if (Object.keys(icons).length === 0) {
      throw new Error('poe.ninja icon API did not return currencyDetails icons.')
    }
    cacheCurrencyIconMap(icons)
    return icons
  } catch (error) {
    sourceError = error
  }

  try {
    const response = await fetch('/api/market/category?league=Standard&category=currency')
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.details || data.error || `Market API returned HTTP ${response.status}.`)
    }
    const icons = createIconMap(data.items)
    if (Object.keys(icons).length === 0) {
      throw new Error('The market API did not return currency item icons.')
    }
    cacheCurrencyIconMap(icons)
    return icons
  } catch (fallbackError) {
    throw new Error(
      `Could not load poe.ninja currency icons. ${sourceError.message} ${fallbackError.message}`,
    )
  }
}

function getCurrencyIconMap() {
  if (!currencyIconMapPromise) {
    currencyIconMapPromise = Promise.resolve().then(() => {
      const cached = getCachedCurrencyIconMap()
      return cached || fetchCurrencyIconMap()
    })
  }
  return currencyIconMapPromise
}

function ItemIcon({ item, iconUrl, small = false }) {
  const [failed, setFailed] = useState(false)
  const size = small ? 'h-5 w-5' : 'h-9 w-9'
  const safeItem = item && typeof item === 'object' ? item : {}
  const icon = iconUrl || safeItem.icon

  useEffect(() => setFailed(false), [icon])

  if (typeof icon === 'string' && icon && !failed) {
    return (
      <img
        src={icon}
        alt=""
        loading="lazy"
        className={`${size} shrink-0 object-contain`}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <span className={`${size} grid shrink-0 place-items-center rounded-md bg-[#26343b] text-xs font-semibold text-[#9fb4ba]`}>
      {typeof safeItem.name === 'string' ? safeItem.name.slice(0, 1) || '?' : '?'}
    </span>
  )
}

function Sparkline({ values, change }) {
  const points = (Array.isArray(values) ? values : []).filter(Number.isFinite)
  if (points.length < 2) {
    return <span className="inline-block w-[72px] text-center text-xs text-[#667780]">—</span>
  }

  const low = Math.min(...points)
  const range = Math.max(...points) - low || 1
  const line = points.map((value, index) => {
    const x = (index / (points.length - 1)) * 72
    const y = 22 - ((value - low) / range) * 18
    return `${x},${y}`
  }).join(' ')
  const color = change < 0 ? '#e87952' : '#00c997'

  return (
    <svg viewBox="0 0 72 24" className="h-6 w-[72px] shrink-0" role="img" aria-label="Price trend">
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function CategoryIcon({ category }) {
  const [failedPrimary, setFailedPrimary] = useState(false)
  const [failedFallback, setFailedFallback] = useState(false)
  const fallbackImage = category.fallbackIcon || MARKET_CATEGORY_ICONS[category.id]
  const image = category.icon || fallbackImage
  const displayImage = failedPrimary
    ? (image !== fallbackImage && !failedFallback ? fallbackImage : null)
    : image

  useEffect(() => {
    setFailedPrimary(false)
    setFailedFallback(false)
  }, [image, fallbackImage])
  if (displayImage) {
    return (
      <img
        src={displayImage}
        alt=""
        loading="lazy"
        className="h-5 w-5 shrink-0 object-contain opacity-100"
        onError={() => {
          if (image !== fallbackImage && !failedPrimary) setFailedPrimary(true)
          else setFailedFallback(true)
        }}
      />
    )
  }

  const { label } = category
  const Icon = label.includes('Unique') || label.includes('Skill')
    ? Gem
    : label.includes('Card') || label.includes('Fragment') || label.includes('Scarab')
      ? Layers3
      : label.includes('Currency')
        ? CircleDollarSign
        : label.includes('Map')
          ? Shield
          : Sparkles
  return <Icon size={20} strokeWidth={1.7} className="opacity-100" />
}

function ValueCell({ item, display, divineToChaos, currencyIcons, className = '' }) {
  const safeItem = item
  const rate = Number.isFinite(divineToChaos) ? divineToChaos : 0
  const showDivine = display === 'Divine'
    || (display === 'Adaptive' && rate > 0 && safeItem.priceChaos >= rate)
  const value = showDivine ? safeItem.priceDivine : safeItem.priceChaos
  const unit = showDivine ? 'divine' : 'chaos'
  const icon = currencyIcons[unit] || CURRENCY_ICON_FALLBACKS[unit]

  return (
    <div className={`flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap ${className}`}>
      <span className="font-sans text-sm font-semibold tabular-nums text-white">
        {number.format(value)}
      </span>
      <ItemIcon item={icon} small />
    </div>
  )
}

function FilterSelect({ label, value, onChange, options, disabled = false, className = '' }) {
  return (
    <label className={`relative block min-w-0 flex-1 ${className}`}>
      <span className="pointer-events-none absolute left-3 top-1.5 z-10 text-[11px] font-normal text-[#8a9ba8]">{label}</span>
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="h-12 w-full appearance-none rounded-[2px] border border-white/[0.14] bg-[#1c2632]/90 px-3 pb-0 pt-4 text-sm font-medium text-[#f1f5f9] outline-none transition-colors focus:border-[#00b98d] disabled:opacity-50"
      >
        {options.map((option) => {
          const item = Array.isArray(option) ? { value: option[0], label: option[1] } : { value: option, label: option }
          return <option key={item.value} value={item.value}>{item.label}</option>
        })}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 mt-1 -translate-y-1/2 text-[#87939d]" />
    </label>
  )
}

function getTradeItem(item) {
  return {
    id: item.id,
    name: item.name,
    baseType: item.baseType,
    variant: item.variant,
    variantTags: item.variantTags,
    explicitModifiers: item.explicitModifiers,
    implicitModifiers: item.implicitModifiers,
    mutatedModifiers: item.mutatedModifiers,
    tradeInfo: item.tradeInfo,
    details: item.details,
    displayInfluence: item.displayInfluence,
    levelRequired: item.levelRequired,
    itemLevel: item.itemLevel,
    level: item.level,
    gemLevel: item.gemLevel,
    gemQuality: item.gemQuality,
    quality: item.gemQuality ?? item.quality,
    corrupted: item.corrupted,
    minLinks: item.minLinks,
    links: item.links,
    sockets: item.sockets,
    category: item.category,
    tradeId: item.tradeId,
    passiveName: item.displayPassiveName || item.passiveName,
    detailsId: item.detailsId,
  }
}

function hasTradeVariant(item) {
  return Boolean(
    item.variantTags?.length
    || (typeof item.variant === 'string' && item.variant.trim())
    || /^Foulborn\s+/i.test(item.name),
  )
}

async function getMatchedTradeStats(item, variantSiblings) {
  if (item.category === 'Forbidden Jewels') return getForbiddenJewelStatMatches(item)
  if (item.category === 'Base Types') return getBaseTypeStatMatches(item)
  if (item.category === 'Imbued Gems') return getImbuedStatMatches(item)
  if (!hasTradeVariant(item)) return []
  return getVariantStatMatches(item, variantSiblings)
}

function VolumeCell({ item, currencyIcons, className = '' }) {
  if (!Number.isFinite(item.volumePerHour)) {
    return <span className="text-right font-sans text-sm font-normal tabular-nums text-[#8a9ba8]">—</span>
  }
  const icon = currencyIcons[item.volumeCurrency] || CURRENCY_ICON_FALLBACKS[item.volumeCurrency]

  return (
    <div className={`flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap ${className}`}>
      <span className="font-sans text-sm font-normal tabular-nums text-white">
        {compact.format(item.volumePerHour)}
      </span>
      <ItemIcon item={icon} small />
    </div>
  )
}

function TradeCell({ item, league, variantSiblings, statusOption }) {
  const [tradeError, setTradeError] = useState('')
  const tradeItem = getTradeItem(item)
  const fallbackUrl = buildPoETradeUrl(tradeItem, league, [], statusOption)

  async function handleTradeClick(event) {
    if (!hasTradeVariant(tradeItem) && !['Base Types', 'Imbued Gems'].includes(tradeItem.category)) return

    const tradeWindow = window.open('about:blank', '_blank')
    if (!tradeWindow) {
      setTradeError('Pop-up blocked. The search opened without variant filters.')
      return
    }

    event.preventDefault()
    tradeWindow.opener = null
    setTradeError('')

    try {
      if (tradeItem.category === 'Imbued Gems') {
        await getImbuedStatMap(tradeItem)
      }
      const matches = await getMatchedTradeStats(tradeItem, variantSiblings)
      const resolvedTradeItem = tradeItem.category === 'Base Types'
        ? {
            ...tradeItem,
            baseTypeInfluenceCountStatId: matches.find((match) => match.role === 'influence-count')?.matchedStatId || '',
            baseTypeInfluenceStatIds: [...new Set(
              matches
                .filter((match) => match.role === 'influence')
                .map((match) => match.matchedStatId)
                .filter(Boolean),
            )],
          }
        : tradeItem
      const statIds = [...new Set(matches.map((match) => match.matchedStatId).filter(Boolean))]
      const statFilters = matches
        .filter((match) => match?.matchedStatId)
        .map((match) => ({ matchedStatId: match.matchedStatId, ...(match.value ? { value: match.value } : {}) }))
      if (!tradeWindow.closed) {
        const tradeStats = tradeItem.category === 'Imbued Gems' ? statFilters : statIds
        const tradeUrl = buildPoETradeUrl(resolvedTradeItem, league, tradeStats, statusOption)
        const tradePayload = buildPoETradePayload(resolvedTradeItem, tradeStats, statusOption)
        if (tradeItem.category === 'Imbued Gems') {
          console.log('[Imbued Trade Debug]', {
            itemName: tradeItem.name,
            variant: tradeItem.variant,
            matchedStatId: tradeStats[0]?.matchedStatId || tradeStats[0] || null,
            tradePayload,
          })
        }
        console.log('Trade URL:', tradeUrl, tradePayload)
        tradeWindow.location.replace(tradeUrl)
      }
    } catch (error) {
      console.error('Could not load PoE Trade variant stats:', error)
      setTradeError('Variant filters unavailable; opened search without them.')
      if (!tradeWindow.closed) tradeWindow.location.replace(fallbackUrl)
    }
  }

  return (
    <div className="flex items-center justify-center gap-2 whitespace-nowrap">
      <a
        href={fallbackUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleTradeClick}
        aria-label={`Trade ${item.name} on Path of Exile`}
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-teal-400/30 bg-teal-500/[0.14] px-3 text-xs font-medium text-[#5eead4] transition-colors hover:border-teal-300/50 hover:bg-teal-500/[0.24]"
      >
        Trade <span aria-hidden="true" className="text-[13px] leading-none">⇄</span>
      </a>
      {tradeError ? <span role="alert" className="max-w-40 text-[10px] text-amber-300">{tradeError}</span> : null}
    </div>
  )
}

function TooltipImage({ item, fallbackIcon }) {
  const [failedPrimary, setFailedPrimary] = useState(false)
  const [failedFallback, setFailedFallback] = useState(false)
  const primaryIcon = item.iconUrl || fallbackIcon
  const icon = failedPrimary ? (failedFallback ? null : fallbackIcon) : primaryIcon

  useEffect(() => {
    setFailedPrimary(false)
    setFailedFallback(false)
  }, [primaryIcon, fallbackIcon])

  return icon ? (
    <img
      src={icon}
      alt=""
      className="mx-auto mt-3 max-h-20 max-w-24 object-contain"
      onError={() => {
        if (!failedPrimary) setFailedPrimary(true)
        else setFailedFallback(true)
      }}
    />
  ) : (
    <span className="mx-auto mt-3 grid h-12 w-12 place-items-center rounded border border-white/10 bg-white/5 text-lg text-white/70">
      {item.name.slice(0, 1)}
    </span>
  )
}

function WikiItemTooltip(props) {
  if (!props?.item) return null
  return <WikiItemTooltipContent {...props} />
}

function WikiItemTooltipContent({ item, fallbackIcon, displayName = item?.name || '', showVariant = true, showBaseType = true }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const triggerRef = useRef(null)
  const wikiButtonRef = useRef(null)
  const panelRef = useRef(null)
  const closeTimerRef = useRef(null)
  const hasDistinctBaseType = typeof item?.baseType === 'string'
    && item.baseType.trim().toLowerCase() !== displayName.trim().toLowerCase()
  const displayNameText = cleanDisplayName(displayName, item, item?.category) || String(item?.name || '')
  const displayNameParts = displayNameText.split(',').map((part) => part.trim()).filter(Boolean)
  const displayNamePrimary = displayNameParts.shift() || displayNameText
  const subtitleCandidates = [
    ...displayNameParts,
    ...(showVariant ? [item?.variant] : []),
    ...(showBaseType && hasDistinctBaseType ? [item?.baseType] : []),
    ...(item?.links >= 5 ? [`${item.links}L`] : []),
  ]
  const subtitleSeen = new Set()
  const subtitle = subtitleCandidates
    .map((part) => typeof part === 'string' ? part.trim() : '')
    .filter((part) => {
      const normalized = part.toLowerCase()
      const itemName = String(item?.name || '').trim().toLowerCase()
      const categoryName = String(item?.category || '').trim().toLowerCase()
      if (!normalized || normalized === itemName || normalized === categoryName || subtitleSeen.has(normalized)) return false
      subtitleSeen.add(normalized)
      return true
    })
    .join(', ')
  const tooltipId = `market-item-tooltip-${String(item?.id || 'item').replace(/[^a-z0-9_-]/gi, '-')}`
  const inferredUnique = String(item?.category || '').toLowerCase().startsWith('unique')
  const variantPrefix = getVariantPrefix(item?.name || '')
  const variantLabels = String(item?.variant || '').split(',').map((label) => label.trim()).filter(Boolean)
  const details = useMemo(() => getPoeNinjaTooltipDetails(item), [item])
  const unique = (details.rarity || (inferredUnique ? 'Unique' : '')) === 'Unique'
  const tooltipDetails = getFoulbornTooltipDetails(details, item)
  const categoryText = String(item?.category || '').toLowerCase()
  const isCurrencyLike = /currency|fragment|scarab|oil|catalyst|essence|fossil|delirium orb|incubator|omen|tattoo|allflame|coffin|corpse/.test(categoryText)
  const isGemLike = /skill gem|imbued gem/.test(categoryText)
  const colors = unique
    ? {
      background: '#0C0B0A',
      border: '#AF6025',
      headerGradient: 'linear-gradient(180deg, #3d1e0d 0%, #1a0d06 100%)',
      title: '#AF6025',
      stats: '#C27A43',
      flavour: '#C27A43',
    }
    : isCurrencyLike
      ? {
        background: '#100e0a',
        border: '#8f7b55',
        headerGradient: 'linear-gradient(180deg, #382e1e 0%, #17130c 100%)',
        title: '#aa9e82',
        stats: '#8888FF',
        flavour: '#D0D0D0',
      }
      : isGemLike
        ? {
          background: '#071817',
          border: '#1ba29b',
          headerGradient: 'linear-gradient(180deg, #0d3331 0%, #061817 100%)',
          title: '#1ba29b',
          stats: '#8888FF',
          flavour: '#D0D0D0',
        }
        : {
      background: '#0E0E0E',
      border: '#6E6E6E',
      headerGradient: 'linear-gradient(180deg, #262b33 0%, #121519 100%)',
      title: '#E5E5E5',
      stats: '#8888FF',
      flavour: '#D0D0D0',
          }

  function updatePosition() {
    const wikiRect = wikiButtonRef.current?.getBoundingClientRect()
    const rect = wikiRect?.width
      ? wikiRect
      : triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const margin = 12
    const gap = 12
    const maxWidth = Math.max(0, Math.min(460, window.innerWidth - margin * 2))
    const rightSpace = window.innerWidth - rect.right - gap - margin
    const leftSpace = rect.left - gap - margin
    const placeRight = rightSpace >= maxWidth || rightSpace >= leftSpace
    const availableWidth = Math.max(0, placeRight ? rightSpace : leftSpace)
    const width = Math.min(maxWidth, availableWidth)
    const maxHeight = Math.max(0, window.innerHeight - margin * 2)
    const panelHeight = panelRef.current?.getBoundingClientRect().height
      || Math.min(460, maxHeight)
    const height = Math.min(panelHeight, maxHeight)
    const top = Math.max(margin, Math.min(rect.top, window.innerHeight - margin - height))
    const left = placeRight ? rect.right + gap : rect.left - gap - width
    setPosition({
      left: Math.max(margin, Math.min(left, window.innerWidth - margin - width)),
      top,
      width,
      maxWidth,
      maxHeight,
    })
  }

  function cancelClose() {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  function closeLater() {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120)
  }

  function loadDetails(show) {
    cancelClose()
    if (show) {
      updatePosition()
      setOpen(true)
    }
  }

  function showTooltip() {
    loadDetails(true)
  }

  useEffect(() => () => {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const reposition = () => updatePosition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (open) updatePosition()
  }, [open, details])

  function renderGroup(title, values, className) {
    const lines = Array.isArray(values) ? values : []
    if (!lines.length) return null
    return (
      <section className="border-t border-[#af6025]/50 px-4 py-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#7a8a99]">{title}</p>
        <div className={`space-y-1 text-center text-[13px] leading-relaxed ${className}`}>
          {lines.map((line, index) => <p key={`${title}-${index}`}>{getTooltipLineText(line)}</p>)}
        </div>
      </section>
    )
  }

  function renderRequirements(values) {
    const lines = Array.isArray(values) ? values : []
    if (!lines.length) return null
    const text = lines.join(', ')
      .replace(/\bStrength\b/gi, 'Str')
      .replace(/\bDexterity\b/gi, 'Dex')
      .replace(/\bIntelligence\b/gi, 'Int')
      .replace(/\s*,\s*/g, ', ')
    const parts = text.split(/(\d+(?:\.\d+)?)/g)
    return (
      <section className="border-t border-[#af6025]/50 px-4 py-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#7a8a99]">Requirements</p>
        <p className="text-center text-[13px] leading-relaxed text-[#7f7f7f]">
          {parts.map((part, index) => part.match(/^\d/) ? <span key={index} className="font-medium text-white">{part}</span> : part)}
        </p>
      </section>
    )
  }

  function renderItemProperties(values) {
    const lines = Array.isArray(values) ? values : []
    if (!lines.length) return null
    return (
      <section className="border-t border-[#af6025]/50 px-4 py-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#7a8a99]">Item Properties</p>
        <div className="space-y-1 text-center text-[13px] leading-relaxed">
          {lines.map((line, index) => {
            const separator = line.indexOf(':')
            if (separator < 0) return <p key={index} className="text-[#8888ff]">{line}</p>
            const label = line.slice(0, separator + 1)
            const value = line.slice(separator + 1).trim()
            const isVariable = /[()]/.test(value)
            return (
              <p key={index}>
                <span className="text-[#7f7f7f]">{label}</span>{' '}
                <span className={isVariable ? 'text-[#8888ff]' : 'font-medium text-white'}>{value}</span>
              </p>
            )
          })}
        </div>
      </section>
    )
  }

  function renderOptionalGemEffects(values) {
    const lines = Array.isArray(values) ? values : []
    if (!lines.length) return null
    return (
      <section className="border-t border-[#af6025]/50 px-4 py-2">
        <p className="mb-1 text-center text-[12px] font-medium text-white">Additional Effects From 1-20% Quality:</p>
        <div className="space-y-1 text-center text-[13px] leading-relaxed text-[#8888ff]">
          {lines.map((line, index) => <p key={`quality-effect-${index}`}>{getTooltipLineText(line)}</p>)}
        </div>
      </section>
    )
  }

  const panel = open && position ? createPortal(
    <div
      ref={panelRef}
      id={tooltipId}
      role="tooltip"
      onMouseEnter={cancelClose}
      onMouseLeave={closeLater}
      className="fixed z-[100] overflow-y-auto rounded border shadow-2xl"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxWidth: position.maxWidth,
        maxHeight: position.maxHeight,
        backgroundColor: colors.background,
        borderColor: colors.border,
        boxShadow: `0 14px 36px rgba(0,0,0,.7), 0 0 0 1px ${colors.border}22`,
      }}
    >
      <header
        className="border-b px-4 py-3 text-center"
        style={{ backgroundImage: colors.headerGradient, borderColor: `${colors.border}88` }}
      >
        <a
          href={wikiPageUrl(details?.matchedWikiTitle || getFallbackWikiTitle(item?.name || displayNameText))}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-semibold hover:underline"
          style={{ color: colors.title }}
        >
          {displayNamePrimary || displayNameText}
        </a>
        <p className="mt-1 text-sm font-medium text-[#af6025]">
          {[details?.rarity || (inferredUnique ? 'Unique' : item?.category), details?.baseItem || details?.itemClass]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {showVariant && (variantPrefix || variantLabels.length) ? (
          <div className="mt-2 flex flex-wrap justify-center gap-1">
            {variantPrefix ? (
              <span className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] text-white/80">
                {variantPrefix}
              </span>
            ) : null}
            {variantLabels.map((label) => (
              <span key={label} className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/70">
                {label}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      {details ? (
        <div className="divide-y divide-white/10 text-center">
          {renderRequirements(tooltipDetails?.requirements || [])}
          {tooltipDetails?.secDescrText?.length ? (
            <section className="border-t border-[#af6025]/50 px-4 py-2">
              <div className="space-y-1 text-center text-xs leading-relaxed text-[#1ba29b]">
                {tooltipDetails.secDescrText.map((line, index) => <p key={`secondary-description-${index}`}>{getTooltipLineText(line)}</p>)}
              </div>
            </section>
          ) : null}
          {renderItemProperties(tooltipDetails?.basicStats || [])}
          {renderGroup('Implicit modifiers', tooltipDetails?.implicitStats || [], 'text-[#8888ff]')}
          {renderGroup('Explicit modifiers', (tooltipDetails?.explicitStats || []).filter((line) => !line?.optional), 'text-[#8888ff]')}
          {renderOptionalGemEffects((tooltipDetails?.explicitStats || []).filter((line) => line?.optional))}
          {renderGroup('Enchantments', tooltipDetails?.enchantmentStats || [], 'text-[#8888ff]')}
          {renderGroup('Foulborn modifiers', tooltipDetails?.variantInfo || [], 'font-medium text-[#e879f9]')}
          {renderGroup('Use', tooltipDetails?.helpText || [], 'text-[#9E9E9E]')}
        </div>
      ) : (
        <div className="px-4 py-3 text-center text-[11px] leading-relaxed text-white/65">
          <p>{item?.category || 'Item'} · {number.format(item?.priceChaos || 0)} chaos</p>
        </div>
      )}
      <div className="border-t border-white/10 px-4 pb-3 text-center">
        {tooltipDetails?.descrText?.length ? (
          <div className="mb-3 border-t border-[#af6025]/50 pt-2 text-xs italic text-[#9ca3af]">
            {tooltipDetails.descrText.map((line, index) => <p key={`description-${index}`}>{line}</p>)}
          </div>
        ) : null}
        <TooltipImage item={details || item} fallbackIcon={fallbackIcon} />
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center">
        <a
          ref={triggerRef}
          href={wikiPageUrl(details?.matchedWikiTitle || getFallbackWikiTitle(item?.name || displayNameText))}
          target="_blank"
          rel="noreferrer"
          onMouseEnter={showTooltip}
          onMouseLeave={closeLater}
          onFocus={showTooltip}
          onBlur={closeLater}
          aria-describedby={open ? tooltipId : undefined}
          className="group min-w-0 flex-1 whitespace-normal break-normal leading-snug text-sm font-normal text-[#f1f5f9]"
        >
          <span className="font-normal text-white decoration-[#9cacb1]/60 underline-offset-2 group-hover:underline">
            {displayNamePrimary || displayNameText}
            {subtitle ? <span className="font-normal text-[#8a9ba8]">, {subtitle}</span> : null}
          </span>
        </a>
        <a
          href={wikiPageUrl(details?.matchedWikiTitle || getFallbackWikiTitle(item?.name || displayNameText))}
          target="_blank"
          rel="noreferrer"
          ref={wikiButtonRef}
          aria-label={`Open ${details?.matchedWikiTitle || item.name} wiki`}
          onMouseEnter={showTooltip}
          onMouseLeave={closeLater}
          onFocus={showTooltip}
          onBlur={closeLater}
          className="ml-3 hidden shrink-0 items-center gap-1 rounded border border-[#323c48] bg-[#222933] px-2 py-1 text-[11px] font-medium uppercase text-white hover:bg-[#2d3642] sm:inline-flex"
        >
          WIKI <ExternalLink size={9} />
        </a>
      </div>
      {panel}
    </>
  )
}

export default function MarketView({ query, selectedLeague, onLeagueChange, onNavigate, onClearQuery }) {
  const [leagues, setLeagues] = useState([])
  const [league, setLeague] = useState(selectedLeague || '')
  const [market, setMarket] = useState(null)
  const [selectedCategory, setSelectedCategory] = useState('currency')
  const [filterText, setFilterText] = useState('')
  const [levelFilter, setLevelFilter] = useState('All')
  const [baseClassFilter, setBaseClassFilter] = useState('All')
  const [ascendancyFilter, setAscendancyFilter] = useState('All')
  const [influenceFilter, setInfluenceFilter] = useState('All')
  const [tierFilter, setTierFilter] = useState('All')
  const [globalSearchText, setGlobalSearchText] = useState('')
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [globalSearchResults, setGlobalSearchResults] = useState([])
  const [valueDisplay, setValueDisplay] = useState('Adaptive')
  const [saleType, setSaleType] = useState('securable')
  const [sort, setSort] = useState({ key: 'priceChaos', direction: 'desc' })
  const [loading, setLoading] = useState(true)
  const [loadingLeagues, setLoadingLeagues] = useState(true)
  const [error, setError] = useState('')
  const [currencyIconMap, setCurrencyIconMap] = useState({})
  const [categoryIconMap, setCategoryIconMap] = useState({})
  const [currencyIconError, setCurrencyIconError] = useState('')
  const [refreshSequence, setRefreshSequence] = useState(0)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [openCategoryGroups, setOpenCategoryGroups] = useState(() => new Set([MARKET_CATEGORY_GROUPS[0]?.label]))
  const lastRefreshSequence = useRef(0)
  const categoryCache = useRef(new Map())
  const globalSearchIndexRef = useRef(new Map())
  const globalSearchPromiseRef = useRef(new Map())

  function toggleCategoryGroup(label) {
    setOpenCategoryGroups((current) => {
      const next = new Set(current)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  function openGroupForCategory(categoryId) {
    const group = MARKET_CATEGORY_GROUPS.find((entry) => entry.categories.some((item) => item.id === categoryId))
    if (!group) return
    setOpenCategoryGroups((current) => new Set(current).add(group.label))
  }

  useEffect(() => {
    setLevelFilter('All')
    setBaseClassFilter('All')
    setAscendancyFilter('All')
    setInfluenceFilter('All')
    setTierFilter('All')
  }, [league, selectedCategory])

  useEffect(() => {
    if (!globalSearchText.trim()) {
      setGlobalSearchResults([])
      setGlobalSearchOpen(false)
      return undefined
    }

    let active = true
    async function buildGlobalSearchIndex() {
      if (globalSearchIndexRef.current.has(league)) return globalSearchIndexRef.current.get(league)
      const inFlight = globalSearchPromiseRef.current.get(league)
      if (inFlight) return inFlight

      const request = (async () => {
        const index = []
        for (let start = 0; start < MARKET_CATEGORIES.length; start += 8) {
          const batch = MARKET_CATEGORIES.slice(start, start + 8)
          const responses = await Promise.all(batch.map(async (entry) => {
            try {
              const response = await fetch(`/api/market/category?league=${encodeURIComponent(league)}&category=${encodeURIComponent(entry.id)}`)
              const data = await response.json()
              if (!response.ok) return []
              const items = normalizeMarketResponse(data, entry.id).items
              return items.map((item) => ({ item, category: entry }))
            } catch {
              return []
            }
          }))
          index.push(...responses.flat())
        }
        globalSearchIndexRef.current.set(league, index)
        return index
      })()
      globalSearchPromiseRef.current.set(league, request)
      try {
        return await request
      } finally {
        if (globalSearchPromiseRef.current.get(league) === request) {
          globalSearchPromiseRef.current.delete(league)
        }
      }
    }

    const timeout = window.setTimeout(() => {
      buildGlobalSearchIndex()
        .then((index) => {
          if (!active || !index) return
          const needle = globalSearchText.trim().toLowerCase()
          const deduplicated = new Map()
          for (const entry of index) {
            const name = entry.item.name?.trim()
            if (!name) continue
            const displayName = getSearchDisplayName(name)
            if (!displayName.toLowerCase().includes(needle) && !name.toLowerCase().includes(needle)) continue
            const key = displayName.toLowerCase()
            if (!deduplicated.has(key)) deduplicated.set(key, { ...entry, displayName })
          }
          setGlobalSearchResults([...deduplicated.values()].slice(0, 30))
          setGlobalSearchOpen(true)
        })
        .catch(() => {
          if (active) setGlobalSearchResults([])
        })
    }, 180)

    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [globalSearchText, league])

  useEffect(() => {
    let active = true
    getCurrencyIconMap()
      .then((icons) => {
        if (active) setCurrencyIconMap(icons)
      })
      .catch((iconError) => {
        console.error('Could not load poe.ninja currency icons:', iconError)
        if (active) setCurrencyIconError(iconError.message || 'Currency icons are unavailable.')
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/market/leagues', { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.details || result.error || `Market API returned HTTP ${response.status}.`)
        }
        return result
      })
      .then((result) => {
        const availableLeagues = Array.isArray(result?.leagues) ? result.leagues : []
        setLeagues(availableLeagues)
        const initialLeague = selectedLeague || result?.defaultLeague || ''
        setLeague(initialLeague)
        onLeagueChange(initialLeague)
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message || 'Could not load PoE 1 leagues.')
          setLoading(false)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingLeagues(false)
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (selectedLeague && selectedLeague !== league) setLeague(selectedLeague)
  }, [selectedLeague])

  useEffect(() => {
    const category = MARKET_CATEGORIES.find((entry) => entry.id === selectedCategory) || MARKET_CATEGORIES[0]
    if (!league || !category) return undefined

    const controller = new AbortController()
    const refresh = refreshSequence !== lastRefreshSequence.current
    lastRefreshSequence.current = refreshSequence
    const cacheKey = `${league}:${category.id}`
    const cached = refresh ? null : categoryCache.current.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      categoryCache.current.delete(cacheKey)
      categoryCache.current.set(cacheKey, cached)
      setMarket(cached.data)
      const cachedIcon = cached.data.items[0]?.icon
      if (cachedIcon) {
        setCategoryIconMap((current) => ({ ...current, [category.id]: cachedIcon }))
      }
      setLoading(false)
      setError('')
      return () => controller.abort()
    }
    categoryCache.current.delete(cacheKey)

    setLoading(true)
    setError('')
    const refreshParam = refresh ? '&refresh=1' : ''

    fetch(`/api/market/category?league=${encodeURIComponent(league)}&category=${encodeURIComponent(category.id)}${refreshParam}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.details || result.error || `Market API returned HTTP ${response.status}.`)
        }
        return result
      })
      .then((result) => {
        if (controller.signal.aborted) return
        const normalizedResult = normalizeMarketResponse(result, category.id)
        cacheCategoryResponse(categoryCache.current, cacheKey, {
          data: normalizedResult,
          expiresAt: Date.now() + CATEGORY_CACHE_MS,
        })
        setMarket(normalizedResult)
        const categoryIcon = normalizedResult.items[0]?.icon
        if (categoryIcon) {
          setCategoryIconMap((current) => ({ ...current, [category.id]: categoryIcon }))
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted && requestError.name !== 'AbortError') {
          setMarket(null)
          setError(requestError.message || 'Could not load market data.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [league, refreshSequence, selectedCategory])

  const category = MARKET_CATEGORIES.find((entry) => entry.id === selectedCategory) || MARKET_CATEGORIES[0]
  const currencyIcons = market?.currencyIcons || {}
  const categoryItems = useMemo(() => {
    const sourceItems = market?.categoryId === category?.id
      && market?.league === league
      && Array.isArray(market.items)
      ? market.items
      : []
    return sourceItems.map((item) => normalizeMarketItem(item, category?.label, category?.id))
  }, [category, league, market])
  const variantSiblingsByName = useMemo(() => {
    const siblingsByName = new Map()
    for (const item of categoryItems) {
      const key = item.name.toLowerCase().replace(/^foulborn\s+/i, '')
      const siblings = siblingsByName.get(key) || []
      siblings.push(item)
      siblingsByName.set(key, siblings)
    }
    return siblingsByName
  }, [categoryItems])
  const isSkillGemCategory = category?.id === 'skill-gems'
  const isForbiddenJewelsCategory = category?.id === 'forbidden-jewels'
  const isBaseTypesCategory = category?.id === 'base-types'
  const hideCompositeName = COMPOSITE_NAME_CATEGORY_IDS.has(category?.id)
  const showInfluenceFilter = isBaseTypesCategory
  const showTierFilter = MAP_TIER_COLUMN_CATEGORY_IDS.has(category?.id)
  const showTierColumn = MAP_TIER_COLUMN_CATEGORY_IDS.has(category?.id)
  const showVolume = Boolean(category?.bulkExchange)
  const showLevel = Boolean(category?.showLevel) && !isForbiddenJewelsCategory
  const showAscendancy = isForbiddenJewelsCategory
  const showInfluence = isBaseTypesCategory
  const forbiddenBaseClassOptions = useMemo(() => {
    if (!showAscendancy) return []
    if (ascendancyFilter !== 'All') {
      return ['All', FORBIDDEN_ASCENDANCY_BASE_CLASS[ascendancyFilter]]
    }
    return ['All', ...FORBIDDEN_BASE_CLASSES]
  }, [ascendancyFilter, showAscendancy])
  const forbiddenAscendancyOptions = useMemo(() => {
    if (!showAscendancy) return []
    if (baseClassFilter !== 'All') {
      return ['All', ...(FORBIDDEN_BASE_CLASS_ASCENDANCIES[baseClassFilter] || [])]
    }
    return ['All', ...Object.keys(FORBIDDEN_ASCENDANCY_BASE_CLASS)]
  }, [baseClassFilter, showAscendancy])
  const influenceOptions = useMemo(() => {
    if (!showInfluenceFilter) return []
    const values = new Set(['All', 'None'])
    for (const item of categoryItems) {
      const influence = item.displayInfluence || ''
      if (!influence) continue
      values.add(formatInfluenceCombination(influence))
    }
    return ['All', 'None', ...[...values].filter((value) => value !== 'All' && value !== 'None').sort((left, right) => left.localeCompare(right))]
  }, [categoryItems, showInfluenceFilter])
  const tierOptions = useMemo(() => {
    if (!showTierFilter) return []
    const tiers = new Set()
    for (const item of categoryItems) {
      if (Number.isInteger(item.tierValue) && item.tierValue > 0) tiers.add(item.tierValue)
    }
    return [...tiers].sort((left, right) => right - left).map(String)
  }, [categoryItems, showTierFilter])
  useEffect(() => {
    if (!showAscendancy) return
    if (baseClassFilter !== 'All' && ascendancyFilter !== 'All'
      && !FORBIDDEN_BASE_CLASS_ASCENDANCIES[baseClassFilter]?.includes(ascendancyFilter)) {
      setAscendancyFilter('All')
    }
  }, [ascendancyFilter, baseClassFilter, showAscendancy])
  const levelOptions = useMemo(() => {
    if (!showLevel) return []
    const counts = new Map()
    for (const item of categoryItems) {
      const level = getMarketLevel(item, category?.id)
      if (level) counts.set(level, (counts.get(level) || 0) + 1)
    }
    return [...counts.entries()]
      .sort(([left], [right]) => {
        const leftNumber = Number(left.replace(/\+$/, ''))
        const rightNumber = Number(right.replace(/\+$/, ''))
        return leftNumber - rightNumber || Number(left.endsWith('+')) - Number(right.endsWith('+'))
      })
  }, [category?.id, categoryItems, showLevel])
  const rows = useMemo(() => {
    const needle = typeof filterText === 'string' ? filterText.trim().toLowerCase() : ''
    const filtered = categoryItems.filter((item) => {
      if (
        showLevel
        && levelFilter !== 'All'
        && getMarketLevel(item, category?.id) !== levelFilter
      ) {
        return false
      }
      if (showAscendancy && baseClassFilter !== 'All' && item.displayBaseClass !== baseClassFilter) return false
      if (showAscendancy && ascendancyFilter !== 'All' && item.displayAscendancy !== ascendancyFilter) return false
      if (showInfluenceFilter && influenceFilter !== 'All') {
        const itemCombination = getInfluenceCombination(item.displayInfluence)
        const selectedCombination = getInfluenceCombination(influenceFilter)
        if (influenceFilter === 'None' ? Boolean(itemCombination) : itemCombination !== selectedCombination) return false
      }
      if (showTierFilter && tierFilter !== 'All' && String(item.tierValue ?? '') !== tierFilter) return false
      if (!needle) return true
      const displayText = [
        item.displayName,
        ...(hideCompositeName ? [] : [item.name, item.variant]),
        item.links >= 5 ? `${item.links}L` : '',
        item.baseType,
      ].filter(Boolean).join(', ').toLowerCase()
      return displayText.includes(needle)
    })
    return [...filtered].sort((left, right) => {
      const direction = sort.direction === 'asc' ? 1 : -1
      if (sort.key === 'name') {
        const leftKey = getNameSortKey(left, category?.id)
        const rightKey = getNameSortKey(right, category?.id)
        return leftKey.localeCompare(rightKey, undefined, { numeric: true, sensitivity: 'base' }) * direction
      }
      const leftValue = left[sort.key]
      const rightValue = right[sort.key]
      if (sort.key === 'tierValue') {
        if (leftValue == null && rightValue == null) return 0
        if (leftValue == null) return 1
        if (rightValue == null) return -1
        return (leftValue - rightValue) * direction
      }
      if (typeof leftValue === 'string') return leftValue.localeCompare(rightValue || '') * direction
      return ((leftValue ?? -Infinity) - (rightValue ?? -Infinity)) * direction
    })
  }, [ascendancyFilter, baseClassFilter, category?.id, categoryItems, filterText, hideCompositeName, influenceFilter, levelFilter, showAscendancy, showInfluenceFilter, showLevel, showTierFilter, sort, tierFilter])
  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount])
  useEffect(() => {
    if (!showVolume && sort.key === 'volumePerHour') {
      setSort({ key: 'priceChaos', direction: 'desc' })
    }
    if (!showTierColumn && sort.key === 'tierValue') {
      setSort({ key: 'priceChaos', direction: 'desc' })
    }
  }, [showTierColumn, showVolume, sort.key])
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [ascendancyFilter, baseClassFilter, influenceFilter, league, selectedCategory, filterText, levelFilter, sort, refreshSequence, tierFilter])

  function sortBy(key) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }))
  }

  function refreshMarket() {
    categoryCache.current.clear()
    setRefreshSequence((value) => value + 1)
  }

  function resetCategoryView() {
    setFilterText('')
    setLevelFilter('All')
    setBaseClassFilter('All')
    setAscendancyFilter('All')
    setGlobalSearchText('')
    setGlobalSearchOpen(false)
    setGlobalSearchResults([])
    setSort({ key: 'priceChaos', direction: 'desc' })
    setVisibleCount(PAGE_SIZE)
    onClearQuery?.()
  }

  function goToMarketHome() {
    resetCategoryView()
    setSelectedCategory('currency')
  }

  const sortHeader = (label, key, align = 'right') => (
    <button
      type="button"
      onClick={() => sortBy(key)}
    className={`inline-flex w-full items-center gap-1 whitespace-nowrap text-[13.5px] font-semibold uppercase tracking-wide text-[#f1f5f9] hover:text-white ${
        sort.key === key ? 'border-b-2 border-[#10b981] pb-1 text-white' : 'pb-[3px]'
      } ${align === 'left' ? '' : 'px-0'} ${
        align === 'left' ? 'justify-start' : align === 'center' ? 'w-full justify-center' : 'w-full justify-end'
      }`}
    >
      {label}
      {sort.key === key ? <span className="text-[#00c997]">{sort.direction === 'asc' ? '↑' : '↓'}</span> : null}
    </button>
  )
  const columnClass = (key, className = '') => `${className} ${sort.key === key ? 'bg-teal-300/[0.10]' : ''}`
  const nameSortKey = 'name'

  return (
    <section className="-mt-2 rounded-xl border border-white/[0.14] bg-[#151e27]/90 text-[#dbe3e5] shadow-[0_20px_50px_rgba(0,0,0,0.65)] backdrop-blur-md">
      <div className="grid gap-2 border-b border-white/[0.12] bg-[#1e2936]/75 p-3 sm:grid-cols-[minmax(0,1fr)_250px]">
        <div className="relative">
          <label className="block">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#819198]" />
            <input
              value={globalSearchText}
              onChange={(event) => {
                setGlobalSearchText(event.target.value)
                setGlobalSearchOpen(Boolean(event.target.value.trim()))
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setGlobalSearchOpen(false)
                }
              }}
              placeholder="Search by item..."
              aria-label="Search all market items"
              autoComplete="off"
              className="h-11 w-full border border-white/[0.12] bg-[#1e2936]/75 pl-9 pr-10 text-sm text-[#e0e8ea] outline-none placeholder:text-[#77868d] focus:border-[#00b98d]"
            />
          </label>
          {globalSearchText ? (
            <button
              type="button"
              onClick={() => {
                setGlobalSearchText('')
                setGlobalSearchOpen(false)
                setGlobalSearchResults([])
              }}
              aria-label="Clear global item search"
              className="absolute right-3 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-xs text-[#9baab0] hover:bg-[#26353c] hover:text-white"
            >
              ×
            </button>
          ) : null}
          {globalSearchOpen && globalSearchText.trim() ? (
            <div className="absolute z-[70] mt-1 max-h-80 w-full overflow-y-auto border border-white/[0.12] bg-[#1e2936]/95 shadow-2xl backdrop-blur-lg">
              {globalSearchResults.length ? globalSearchResults.map(({ item, category: resultCategory, displayName }) => (
                <button
                  type="button"
                  key={`${resultCategory.id}-${item.name}-${item.id}`}
                  onClick={() => {
                    if (resultCategory.id !== selectedCategory) {
                      openGroupForCategory(resultCategory.id)
                      setSelectedCategory(resultCategory.id)
                    }
                    setFilterText(item.displayName || item.name || '')
                    setGlobalSearchText('')
                    setGlobalSearchOpen(false)
                    setVisibleCount(PAGE_SIZE)
                  }}
                  className="grid w-full grid-cols-[minmax(0,1fr)_150px] items-center gap-3 px-3 py-2 text-left hover:bg-[#26343b]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ItemIcon item={item} iconUrl={currencyIconMap[item.name]} small />
                    <span className="truncate text-sm text-[#dfe7e9]">{displayName || getSearchDisplayName(item.name)}</span>
                  </span>
                  <span className="truncate text-right text-xs text-[#78a9a0]">{resultCategory.label}</span>
                </button>
              )) : (
                <p className="px-3 py-3 text-xs text-[#839198]">Searching market items…</p>
              )}
            </div>
          ) : null}
        </div>
        <label className="relative block">
          <span className="absolute left-3 top-1.5 text-[10px] text-[#9ba8ad]">League</span>
          <select
            value={league}
            onChange={(event) => {
              setLeague(event.target.value)
              onLeagueChange(event.target.value)
            }}
            disabled={loadingLeagues || leagues.length === 0}
            className="h-12 w-full appearance-none rounded-[2px] border border-white/[0.14] bg-[#1c2632]/90 px-3 pb-0 pt-4 text-sm font-medium text-white outline-none focus:border-[#00b98d] disabled:opacity-50"
          >
            {league && !leagues.some((item) => item.id === league) ? (
              <option value={league}>{league}</option>
            ) : null}
            {leagues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#9ba8ad]" />
        </label>
      </div>

      <div className="grid min-h-[620px] items-start md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="shrink-0 border-b border-white/[0.10] bg-[#0b0f14]/95 md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:self-start md:overflow-y-auto md:border-b-0 md:border-r md:[scrollbar-color:#34434b_#0b0f14] md:[scrollbar-width:thin]">
          <nav aria-label="Economy categories" className="space-y-0.5 pb-3">
            {MARKET_CATEGORY_GROUPS.map((group) => (
              <div key={group.label}>
                <button
                  type="button"
                  onClick={() => toggleCategoryGroup(group.label)}
                  aria-expanded={openCategoryGroups.has(group.label)}
                  className="flex w-full items-center justify-between px-5 pb-2 pt-4 text-left text-xs font-bold uppercase tracking-wider text-[#cbd5e1] transition hover:text-white"
                >
                  {group.label}
                  <span aria-hidden="true" className="text-base leading-none text-[#cbd5e1]">{openCategoryGroups.has(group.label) ? '▾' : '▸'}</span>
                </button>
                {openCategoryGroups.has(group.label) ? <div className="space-y-0.5">
                  {group.categories.map((entry) => {
                    const active = entry.id === category?.id
                    const itemCount = market?.categoryId === entry.id ? market.items.length : null
                    const sidebarCategory = {
                      ...entry,
                      icon: categoryIconMap[entry.id],
                    }
                    return (
                      <button
                        type="button"
                        key={entry.id}
                        onClick={() => {
                          setSelectedCategory(entry.id)
                          setFilterText('')
                        }}
                        aria-current={active ? 'page' : undefined}
                        className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[15px] transition ${
                          active
                            ? 'bg-teal-500/[0.12] font-semibold text-[#2dd4bf]'
                            : 'font-medium text-[#e2e8f0] hover:bg-white/[0.05] hover:text-white'
                        }`}
                      >
                        <CategoryIcon category={sidebarCategory} />
                        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                        {itemCount != null ? <span className="text-xs text-[#718087]">{itemCount}</span> : null}
                      </button>
                    )
                  })}
                </div> : null}
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 font-sans">
          <div className="relative z-[75] flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.11] px-4 py-3">
            <div className="flex items-center gap-2 text-[13px] font-normal text-[#a8b8c8]">
              <button
                type="button"
                onClick={goToMarketHome}
                aria-label="Go to Market home and reset search"
                className="text-[#a8b8c8] transition hover:text-white hover:underline"
              >
                Market
              </button>
              <span className="text-[#5d6b72]">›</span>
              <button
                type="button"
                onClick={resetCategoryView}
                aria-label={`Reset search and filters for ${category?.label || 'Currency'}`}
                className="font-normal text-[#e2e8f0] underline decoration-transparent underline-offset-2 transition hover:text-white hover:decoration-current"
              >
                {category?.label || 'Currency'}
              </button>
            </div>
          </div>

          <div className="px-4 pb-1 pt-4">
            <div className="flex items-center justify-between gap-4">
              <h1 className="text-3xl font-bold tracking-tight text-white">{category?.label || 'Currency'}</h1>
              {market ? (
                <div className="flex shrink-0 items-center gap-2 text-sm font-semibold tabular-nums text-white" aria-label={`1 Divine equals ${number.format(market.divineToChaos)} Chaos`}>
                  <ItemIcon item={currencyIcons.divine || CURRENCY_ICON_FALLBACKS.divine} small />
                  <span>1</span>
                  <span className="text-[#718087]">=</span>
                  <ItemIcon item={currencyIcons.chaos || CURRENCY_ICON_FALLBACKS.chaos} small />
                  <span>{number.format(market.divineToChaos)}</span>
                </div>
              ) : null}
            </div>
            <div className="hidden">
              <p className="mt-1 text-sm text-[#89989e]">
                {market?.league || league || 'Loading league'} · {rows.length.toLocaleString('en-US')} items
                {market ? ` · 1 Divine = ${number.format(market.divineToChaos)} Chaos` : ''}
                {market?.isFallbackData ? ` · Reference prices from ${market.dataLeague}` : ''}
              </p>
            </div>
          </div>
              <div className="grid grid-cols-1 gap-2 border-b border-white/[0.12] bg-[#1e2936]/45 px-4 pb-4 pt-3 sm:grid-cols-[repeat(auto-fit,minmax(145px,1fr))]">
            <label className="relative flex h-12 min-w-0 flex-1 items-center">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#a8b8c8]" />
              <input
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
                placeholder="Filter items"
                className="h-12 w-full rounded-[2px] border border-white/[0.14] bg-[#1c2632]/90 pl-9 pr-8 text-sm font-medium text-white outline-none placeholder:text-[#aab3ba] focus:border-[#00b98d]"
              />
              {filterText ? (
                <button type="button" onClick={() => setFilterText('')} aria-label="Clear item filter" className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center text-xs text-[#9baab0] hover:text-white">×</button>
              ) : null}
            </label>
            {showAscendancy ? (
              <>
                <FilterSelect label="Base Class" value={baseClassFilter} onChange={(event) => {
                  const nextBaseClass = event.target.value
                  setBaseClassFilter(nextBaseClass)
                  if (nextBaseClass !== 'All' && ascendancyFilter !== 'All' && !FORBIDDEN_BASE_CLASS_ASCENDANCIES[nextBaseClass]?.includes(ascendancyFilter)) setAscendancyFilter('All')
                }} options={forbiddenBaseClassOptions} />
                <FilterSelect label="Ascendancy" value={ascendancyFilter} onChange={(event) => {
                  const nextAscendancy = event.target.value
                  setAscendancyFilter(nextAscendancy)
                  if (nextAscendancy !== 'All') setBaseClassFilter(FORBIDDEN_ASCENDANCY_BASE_CLASS[nextAscendancy] || 'All')
                }} options={forbiddenAscendancyOptions} />
              </>
            ) : null}
            {showTierFilter ? <FilterSelect label="Tier" value={tierFilter} onChange={(event) => setTierFilter(event.target.value)} options={['All', ...tierOptions]} /> : null}
            {showInfluenceFilter ? <FilterSelect label="Influence" value={influenceFilter} onChange={(event) => setInfluenceFilter(event.target.value)} options={influenceOptions} /> : null}
            {showLevel ? <FilterSelect label="Level" value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)} options={['All', ...levelOptions.map(([level, count]) => [level, `${level} [${count.toLocaleString('en-US')}]`])]} /> : null}
            <FilterSelect label="Value Display" value={valueDisplay} onChange={(event) => setValueDisplay(event.target.value)} options={['Adaptive', 'Chaos', 'Divine']} />
            <FilterSelect label="Sale Type" value={saleType} onChange={(event) => setSaleType(event.target.value)} options={[
              ['available', 'Instant Buyout and In Person'],
              ['securable', 'Instant Buyout'],
              ['onlineleague', 'In Person (Online in League)'],
              ['online', 'In Person (Online)'],
              ['any', 'Any'],
            ]} />
            <button type="button" onClick={refreshMarket} disabled={!league || loading || loadingLeagues} aria-label="Refresh market prices" title="Refresh prices" className="grid h-12 min-w-[48px] place-items-center rounded-[2px] border border-white/[0.14] bg-[#1c2632]/90 text-[#aebbc0] hover:border-[#00b98d] hover:text-white disabled:opacity-50">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="hidden">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[10px] text-[#92a0a5]">
                Filter by name
                <span className="relative mt-1 block">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#788890]" />
                  <input
                    value={filterText}
                    onChange={(event) => setFilterText(event.target.value)}
                    placeholder="Filter items"
                    className="h-8 w-48 border border-[#3b4951] bg-[#11191f] pl-8 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                  />
                  {filterText ? (
                    <button
                      type="button"
                      onClick={() => setFilterText('')}
                      aria-label="Clear item filter"
                      className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-xs text-[#9baab0] hover:bg-[#26353c] hover:text-white"
                    >
                      X
                    </button>
                  ) : null}
                </span>
              </label>
              {showAscendancy ? (
                <>
                  <label className="text-[10px] text-[#92a0a5]">
                    Base Class
                    <span className="relative mt-1 block">
                      <select
                        value={baseClassFilter}
                        onChange={(event) => {
                          const nextBaseClass = event.target.value
                          setBaseClassFilter(nextBaseClass)
                          if (nextBaseClass !== 'All'
                            && ascendancyFilter !== 'All'
                            && !FORBIDDEN_BASE_CLASS_ASCENDANCIES[nextBaseClass]?.includes(ascendancyFilter)) {
                            setAscendancyFilter('All')
                          }
                        }}
                        className="h-8 w-36 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                      >
                        {forbiddenBaseClassOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                      <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                    </span>
                  </label>
                  <label className="text-[10px] text-[#92a0a5]">
                    Ascendancy
                    <span className="relative mt-1 block">
                      <select
                        value={ascendancyFilter}
                        onChange={(event) => {
                          const nextAscendancy = event.target.value
                          setAscendancyFilter(nextAscendancy)
                          if (nextAscendancy !== 'All') {
                            setBaseClassFilter(FORBIDDEN_ASCENDANCY_BASE_CLASS[nextAscendancy] || 'All')
                          }
                        }}
                        className="h-8 w-36 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                      >
                        {forbiddenAscendancyOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                      <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                    </span>
                  </label>
                </>
              ) : null}
              {false && showLevel ? (
                <label className="hidden text-[10px] text-[#92a0a5]">
                  Level
                  <span className="relative mt-1 block">
                    <select
                      value={levelFilter}
                      onChange={(event) => setLevelFilter(event.target.value)}
                      className="h-8 w-36 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                    >
                      <option value="All">All</option>
                      {levelOptions.map(([level, count]) => (
                        <option key={level} value={level}>
                          {level} [{count.toLocaleString('en-US')}]
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                  </span>
                </label>
              ) : null}
              {/* legacy search placement removed; the toolbar starts with the search field above. */}
              <label className="text-[10px] text-[#92a0a5] hidden">
                Filter by name
                <span className="relative mt-1 block">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#788890]" />
                  <input
                    value={filterText}
                    onChange={(event) => setFilterText(event.target.value)}
                    placeholder="Filter items"
                    className="h-8 w-48 border border-[#3b4951] bg-[#11191f] pl-8 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                  />
                  {filterText ? (
                    <button
                      type="button"
                      onClick={() => setFilterText('')}
                      aria-label="Clear item filter"
                      className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-xs text-[#9baab0] hover:bg-[#26353c] hover:text-white"
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              </label>
              {false && showInfluenceFilter ? (
                <label className="text-[10px] text-[#92a0a5]">
                  Influence
                  <span className="relative mt-1 block">
                    <select
                      value={influenceFilter}
                      onChange={(event) => setInfluenceFilter(event.target.value)}
                      className="h-8 w-36 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                    >
                      {influenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                  </span>
                </label>
              ) : null}
              {false && showTierFilter ? (
                <label className="text-[10px] text-[#92a0a5]">
                  Tier
                  <span className="relative mt-1 block">
                    <select
                      value={tierFilter}
                      onChange={(event) => setTierFilter(event.target.value)}
                      className="h-8 w-36 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                    >
                      <option value="All">All</option>
                      {tierOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                  </span>
                </label>
              ) : null}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {false && showLevel ? (
                <label className="hidden text-[10px] text-[#92a0a5]">
                  Level
                  <span className="relative mt-1 block">
                    <select
                      value={levelFilter}
                      onChange={(event) => setLevelFilter(event.target.value)}
                      className="h-8 w-36 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                    >
                      <option value="All">All</option>
                      {levelOptions.map(([level, count]) => (
                        <option key={level} value={level}>
                          {level} [{count.toLocaleString('en-US')}]
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                  </span>
                </label>
              ) : null}
              {showTierFilter ? (
                <label className="text-[10px] text-[#92a0a5]">
                  Tier
                  <span className="relative mt-1 block">
                    <select
                      value={tierFilter}
                      onChange={(event) => setTierFilter(event.target.value)}
                      className="h-8 w-36 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                    >
                      <option value="All">All</option>
                      {tierOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                  </span>
                </label>
              ) : null}
              {showInfluenceFilter ? (
                <label className="text-[10px] text-[#92a0a5]">
                  Influence
                  <span className="relative mt-1 block">
                    <select
                      value={influenceFilter}
                      onChange={(event) => setInfluenceFilter(event.target.value)}
                      className="h-8 w-36 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                    >
                      {influenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                  </span>
                </label>
              ) : null}
              {showLevel ? (
                <label className="text-[10px] text-[#92a0a5]">
                  Level
                  <span className="relative mt-1 block">
                    <select
                      value={levelFilter}
                      onChange={(event) => setLevelFilter(event.target.value)}
                      className="h-8 w-36 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                    >
                      <option value="All">All</option>
                      {levelOptions.map(([level, count]) => (
                        <option key={level} value={level}>
                          {level} [{count.toLocaleString('en-US')}]
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                  </span>
                </label>
              ) : null}
              <label className="text-[10px] text-[#92a0a5]">
                Value display
                <span className="relative mt-1 block">
                  <select
                    value={valueDisplay}
                    onChange={(event) => setValueDisplay(event.target.value)}
                    className="h-8 w-36 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                  >
                    <option>Adaptive</option>
                    <option>Chaos</option>
                    <option>Divine</option>
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                </span>
              </label>
              {false && showTierFilter ? (
                <label className="hidden text-[10px] text-[#92a0a5]">
                  Tier
                  <span className="relative mt-1 block">
                    <select
                      value={tierFilter}
                      onChange={(event) => setTierFilter(event.target.value)}
                      className="h-8 w-36 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                    >
                      <option value="All">All</option>
                      {tierOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                  </span>
                </label>
              ) : null}
              {false && showInfluenceFilter ? (
                <label className="hidden text-[10px] text-[#92a0a5]">
                  Influence
                  <span className="relative mt-1 block">
                    <select
                      value={influenceFilter}
                      onChange={(event) => setInfluenceFilter(event.target.value)}
                      className="h-8 w-36 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                    >
                      {influenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                  </span>
                </label>
              ) : null}
              {false && showLevel ? (
                <label className="hidden text-[10px] text-[#92a0a5]">
                  Level
                  <span className="relative mt-1 block">
                    <select
                      value={levelFilter}
                      onChange={(event) => setLevelFilter(event.target.value)}
                      className="h-8 w-36 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                    >
                      <option value="All">All</option>
                      {levelOptions.map(([level, count]) => (
                        <option key={level} value={level}>
                          {level} [{count.toLocaleString('en-US')}]
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                  </span>
                </label>
              ) : null}
              <label className="text-[10px] text-[#92a0a5]">
                Sale Type
                <span className="relative mt-1 block">
                  <select
                    value={saleType}
                    onChange={(event) => setSaleType(event.target.value)}
                    className="h-8 w-44 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                  >
                    <option value="available">Instant Buyout and In Person</option>
                    <option value="securable">Instant Buyout</option>
                    <option value="onlineleague">In Person (Online in League)</option>
                    <option value="online">In Person (Online)</option>
                    <option value="any">Any</option>
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                </span>
              </label>
              <button
                type="button"
                onClick={refreshMarket}
                disabled={!league || loading || loadingLeagues}
                aria-label="Refresh market prices"
                title="Refresh prices"
                className="grid h-8 w-8 place-items-center border border-[#3b4951] bg-[#11191f] text-[#aebbc0] hover:border-[#00b98d] hover:text-white disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {error ? (
            <div role="alert" className="mx-4 mb-3 border border-[#793f36] bg-[#3a2522] px-3 py-2 text-sm text-[#ff9b83]">
              {error}
            </div>
          ) : null}
          {loading ? (
            <div role="status" className="mx-4 mb-4 border border-[#354149] bg-[#141e24] px-3 py-6 text-sm text-[#9baab0]">
              Loading {category?.label || 'market'} prices for {league || 'league'}…
            </div>
          ) : null}

          {!loading && !error && market?.categoryId === category?.id && market?.league === league ? (
            <>
              {currencyIconError ? (
                <p role="status" className="mx-4 mb-2 text-xs text-[#9baab0]">
                  Additional icon mapping is unavailable; using item icons or initials where possible.
                </p>
              ) : null}
              <div className="overflow-x-auto px-4 pb-4">
                <table className="w-full max-w-full border-collapse table-auto font-sans">
                  <thead>
                    <tr className="border-b border-white/[0.11]">
                      <th className={columnClass(nameSortKey, 'w-auto min-w-[160px] max-w-[360px] px-2 py-2 text-left')}>{sortHeader('Name', nameSortKey, 'left')}</th>
                      {showTierColumn ? <th className={columnClass('tierValue', 'w-[1%] whitespace-nowrap px-5 py-2 text-center')}>{sortHeader('Tier', 'tierValue', 'center')}</th> : null}
                      {showAscendancy ? <th className={columnClass('displayAscendancy', 'w-[1%] whitespace-nowrap px-5 py-2 text-center')}>{sortHeader('Ascendancy', 'displayAscendancy', 'center')}</th> : null}
                      {showLevel ? <th className={columnClass(isSkillGemCategory ? 'gemLevel' : 'levelRequired', 'w-[1%] whitespace-nowrap px-5 py-2 text-center')}>{sortHeader('Level', isSkillGemCategory ? 'gemLevel' : 'levelRequired', 'center')}</th> : null}
                      {showInfluence ? <th className={columnClass('displayInfluence', 'w-[1%] whitespace-nowrap px-5 py-2 text-center')}>{sortHeader('Influence', 'displayInfluence', 'center')}</th> : null}
                      {isSkillGemCategory ? <th className={columnClass('gemQuality', 'w-[1%] whitespace-nowrap px-5 py-2 text-center')}>{sortHeader('Quality', 'gemQuality', 'center')}</th> : null}
                      {isSkillGemCategory ? <th className="w-[1%] whitespace-nowrap px-5 py-2 text-center text-[13.5px] font-semibold uppercase tracking-wide text-[#f1f5f9]">Corrupted</th> : null}
                      <th className={columnClass('priceChaos', 'w-[1%] whitespace-nowrap px-5 py-2 text-center')}>{sortHeader('Value', 'priceChaos', 'center')}</th>
                      <th className={columnClass('change', 'w-[1%] whitespace-nowrap px-5 py-2 text-center')}>{sortHeader('Last 7 days', 'change', 'center')}</th>
                      {showVolume ? <th className={columnClass('volumePerHour', 'w-[1%] whitespace-nowrap px-5 py-2 text-center')}>{sortHeader('Volume / hour', 'volumePerHour', 'center')}</th> : null}
                      <th className="w-[1%] whitespace-nowrap px-5 py-2 text-center text-[13.5px] font-semibold uppercase tracking-wide text-[#f1f5f9]">TRADE</th>
                    </tr>
                  </thead>
                  <tbody>
                  {visibleRows.map((item) => (
                    <tr
                      key={item.id}
                      className="min-h-[48px] border-b border-white/[0.09] transition hover:bg-white/[0.06]"
                    >
                      <td className={columnClass(nameSortKey, 'w-auto min-w-[160px] max-w-[360px] px-2 py-2.5 text-left')}>
                        <div className="flex min-w-0 items-center gap-2.5">
                        <ItemIcon item={item} iconUrl={currencyIconMap[item.name]} />
                        <WikiItemTooltip
                          item={item}
                          displayName={item.displayName}
                          showVariant={!isSkillGemCategory && !hideCompositeName}
                          showBaseType={!hideCompositeName}
                          fallbackIcon={currencyIconMap[item.name] || item.icon}
                        />
                        </div>
                      </td>
                      {showTierColumn ? <td className={columnClass('tierValue', 'w-[1%] whitespace-nowrap px-5 py-2 text-center font-sans text-sm font-normal tabular-nums text-white')}><div className="flex w-full items-center justify-center">{item.tierValue ?? '-'}</div></td> : null}
                      {showAscendancy ? (
                        <td className={columnClass('displayAscendancy', 'w-[1%] whitespace-nowrap px-5 py-2 text-center font-sans text-sm font-normal tabular-nums text-white')}>
                          {item.displayAscendancy || '—'}
                        </td>
                      ) : null}
                      {showLevel ? (
                        <td className={columnClass(isSkillGemCategory ? 'gemLevel' : 'levelRequired', 'w-[1%] whitespace-nowrap px-5 py-2 text-center font-sans text-sm font-normal tabular-nums text-white')}>
                          {getMarketLevel(item, category?.id) || '—'}
                        </td>
                      ) : null}
                      {showInfluence ? (
                        <td className={columnClass('displayInfluence', 'w-[1%] whitespace-nowrap px-5 py-2 text-center font-sans text-sm font-normal tabular-nums text-white')}>
                          {item.displayInfluence || ''}
                        </td>
                      ) : null}
                      {isSkillGemCategory ? (
                        <>
                          <td className={columnClass('gemQuality', 'w-[1%] whitespace-nowrap px-5 py-2 text-center font-sans text-sm font-normal tabular-nums text-white')}>
                            {item.gemQuality > 0 ? item.gemQuality : '—'}
                          </td>
                          <td className="w-[1%] whitespace-nowrap px-5 py-2 text-center font-sans text-sm font-normal tabular-nums text-white">
                            <span className={item.corrupted ? 'font-semibold text-[#d20000]' : 'text-white'}>
                              {item.corrupted ? 'yes' : 'no'}
                            </span>
                          </td>
                        </>
                      ) : null}
                      <td className={columnClass('priceChaos', 'w-[1%] whitespace-nowrap px-5 py-2 text-center')}>
                        <ValueCell item={item} display={valueDisplay} divineToChaos={market.divineToChaos} currencyIcons={currencyIcons} />
                      </td>
                      <td className={columnClass('change', 'w-[1%] whitespace-nowrap px-5 py-2 text-center')}>
                        <div className="flex w-full items-center justify-center gap-2">
                        <Sparkline values={item.sparkline} change={item.change} />
                        <span className={`min-w-12 text-right font-sans text-[13.5px] font-medium tabular-nums ${
                          item.change > 0 ? 'text-[#34d399]' : item.change < 0 ? 'text-[#fb7185]' : 'text-[#8a9ba8]'
                        }`}>
                          {item.change == null ? '—' : `${item.change > 0 ? '+' : ''}${number.format(item.change)}%`}
                        </span>
                        </div>
                      </td>
                      {showVolume ? (
                        <td className={columnClass('volumePerHour', 'w-[1%] whitespace-nowrap px-5 py-2 text-center')}>
                          <div className="flex w-full items-center justify-center"><VolumeCell item={item} currencyIcons={currencyIcons} /></div>
                        </td>
                      ) : null}
                      <td className="w-[1%] whitespace-nowrap px-5 py-2 text-center">
                        <TradeCell item={item} league={league} statusOption={saleType} variantSiblings={variantSiblingsByName.get(item.name.toLowerCase().replace(/^foulborn\s+/i, '')) || []} />
                      </td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
              {visibleCount < rows.length ? (
                <div className="px-4 pb-4 text-center">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                    className="border border-[#3b4951] bg-[#202c32] px-4 py-2 text-xs text-[#d3dcde] hover:border-[#00b98d]"
                  >
                    Show more
                  </button>
                </div>
              ) : null}
              {rows.length === 0 ? (
                <p className="mx-4 mb-4 border border-[#354149] px-4 py-6 text-sm text-[#9baab0]">
                  {filterText || query
                    ? 'No items match this filter.'
                    : `poe.ninja returned no listings for ${category?.label || 'this category'} in ${(market?.fallbackTriedLeagues || [league]).join(' or ')}.`}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  )
}
