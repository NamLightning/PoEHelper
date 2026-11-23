import { getImbuedStatId } from '../data/imbuedStats.js'

const CACHE_KEY = 'poe.trade.variant-stats.v4'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FOULBORN_CACHE_KEY = 'poe.trade.foulborn-modifiers.v1'
const FOULBORN_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const STATS_ENDPOINT = '/api/trade/stats'
const FOULBORN_ENDPOINT = '/api/wiki/foulborn-modifiers'
const MODIFIER_NUMBER_PATTERN = /([+-]?)\(?\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\)?/g
const STAT_GROUPS = ['explicit', 'implicit', 'enchant', 'pseudo']
const GENERIC_MODIFIER_TOKENS = new Set([
  'a', 'an', 'and', 'are', 'be', 'by', 'each', 'for', 'from', 'have',
  'in', 'is', 'of', 'on', 'or', 'the', 'to', 'when', 'while', 'with',
  'you', 'your',
])
const FOULBORN_MATCH_DEBUG_CATEGORIES = new Set([
  'Unique Armours',
  'Unique Jewels',
  'Unique Weapons',
])
const VARIANT_ALIAS_MAP = {
  'soul eater': ['soul eater'],
  'culling strike': ['culling strike'],
  'spell block': ['+#% chance to block spell damage'],
  'avoid damage': ['#% chance to avoid damage of each type from hits', 'chance to avoid damage'],
  'dot per life': ['damage over time multiplier'],
  'blood magic': ['blood magic'],
  'gem level': ['level of all', 'level of socketed', 'gems socketed'],
  'max quality': ['maximum quality'],
  'global multi': ['+#% to global critical strike multiplier'],
  'global defences': ['#% increased global defences'],
  'shield regen': [
    'shield regen',
    'regenerate energy shield',
    'energy shield regeneration',
  ],
  'uncorrupted shield': [
    'extra maximum energy shield if no equipped items are corrupted',
  ],
  'uncorrupted regen': [
    'life regeneration also applies to energy shield if no equipped items are corrupted',
  ],
  'no requirements': [
    'ignore attribute requirements of socketed gems',
    'attribute requirements',
    'requirements',
  ],
}
let cachedEntries = null
let cachedAt = 0
let pendingRequest = null
let cachedFoulbornRows = null
let foulbornRowsFetchedAt = 0
let pendingFoulbornRequest = null
const statTextGroupCache = new WeakMap()

function shouldLogFoulbornMatcher(item, tags) {
  return typeof import.meta.env !== 'undefined'
    && import.meta.env.DEV
    && FOULBORN_MATCH_DEBUG_CATEGORIES.has(item?.category)
    && (
      /^Foulborn\s+/i.test(item?.name || '')
      || (Array.isArray(item?.mutatedModifiers) && item.mutatedModifiers.length > 0)
      || tags.length > 1
    )
}

function getModifierList(value) {
  return Array.isArray(value)
    ? value.map((modifier) => typeof modifier === 'string' ? modifier : modifier?.text)
      .filter((modifier) => typeof modifier === 'string' && modifier.trim())
    : []
}

function summarizeMatcherCandidates(candidates) {
  return candidates.map((candidate) => ({
    statId: candidate.statId,
    statText: candidate.statText,
    group: candidate.group,
    tagScore: candidate.tagScore,
    statScore: candidate.statScore,
    isExact: candidate.isExact,
    sourceScore: candidate.sourceScore,
    specificityScore: candidate.specificityScore,
    groupScore: candidate.groupScore,
    sourceModifier: candidate.sourceModifier,
    foulbornMod: candidate.foulbornMod,
    originalMod: candidate.originalMod,
    foulbornKey: candidate.foulbornKey,
  }))
}

function compareMatcherCandidateQuality(left, right) {
  return (right.tagScore || 0) - (left.tagScore || 0)
    || Number(right.isExact) - Number(left.isExact)
    || (right.sourceScore || 0) - (left.sourceScore || 0)
    || (right.specificityScore || 0) - (left.specificityScore || 0)
    || (right.statScore || 0) - (left.statScore || 0)
    || (right.groupScore || 0) - (left.groupScore || 0)
}

function compareMatcherCandidates(left, right) {
  return compareMatcherCandidateQuality(left, right)
    || String(left.statId).localeCompare(String(right.statId))
    || String(left.foulbornKey || '').localeCompare(String(right.foulbornKey || ''))
}

function isStatEntry(entry) {
  return typeof entry?.id === 'string'
    && STAT_GROUPS.some((group) => entry.id.startsWith(`${group}.`))
    && typeof entry.text === 'string'
}

function readCachedEntries() {
  if (typeof localStorage === 'undefined') return null

  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw)
    const age = Date.now() - cached?.fetchedAt
    if (
      !Number.isFinite(cached?.fetchedAt)
      || age < 0
      || age >= CACHE_TTL_MS
      || !Array.isArray(cached.entries)
      || !cached.entries.every(isStatEntry)
    ) {
      return null
    }
    cachedAt = cached.fetchedAt
    return cached.entries
  } catch {
    return null
  }
}

function writeCachedEntries(entries) {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      fetchedAt: Date.now(),
      entries,
    }))
  } catch {}
}

function isFoulbornModifierRow(row) {
  return typeof row?.uniqueItem === 'string'
    && typeof row?.originalModifier === 'string'
    && typeof row?.foulbornModifier === 'string'
    && row.uniqueItem.trim() !== ''
    && row.originalModifier.trim() !== ''
    && row.foulbornModifier.trim() !== ''
}

function readCachedFoulbornRows() {
  if (typeof localStorage === 'undefined') return null

  try {
    const raw = localStorage.getItem(FOULBORN_CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw)
    const age = Date.now() - cached?.fetchedAt
    if (
      !Number.isFinite(cached?.fetchedAt)
      || age < 0
      || age >= FOULBORN_CACHE_TTL_MS
      || !Array.isArray(cached.rows)
      || !cached.rows.every(isFoulbornModifierRow)
    ) {
      return null
    }
    foulbornRowsFetchedAt = cached.fetchedAt
    return cached.rows
  } catch {
    return null
  }
}

function writeCachedFoulbornRows(rows) {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(FOULBORN_CACHE_KEY, JSON.stringify({
      fetchedAt: Date.now(),
      rows,
    }))
  } catch {}
}

async function loadVariantStats() {
  if (cachedEntries && Date.now() - cachedAt < CACHE_TTL_MS) return cachedEntries
  cachedEntries = null
  cachedAt = 0
  if (pendingRequest) return pendingRequest

  const storedEntries = readCachedEntries()
  if (storedEntries) {
    cachedEntries = storedEntries
    return cachedEntries
  }

  pendingRequest = (async () => {
    const response = await fetch(STATS_ENDPOINT)
    if (!response.ok) {
      throw new Error(`PoE Trade stats request failed (${response.status}).`)
    }

    const payload = await response.json()
    const entries = Array.isArray(payload?.result)
      ? payload.result
        .filter((group) => STAT_GROUPS.includes(group?.id))
        .flatMap((group) => Array.isArray(group.entries) ? group.entries : [])
        .filter(isStatEntry)
      : []
    if (!entries.length) {
      throw new Error('PoE Trade stats response did not contain explicit or implicit stat IDs.')
    }

    cachedEntries = entries
    cachedAt = Date.now()
    writeCachedEntries(entries)
    return entries
  })()

  try {
    return await pendingRequest
  } finally {
    pendingRequest = null
  }
}

async function loadFoulbornModifierRows() {
  if (
    cachedFoulbornRows
    && Date.now() - foulbornRowsFetchedAt < FOULBORN_CACHE_TTL_MS
  ) {
    return cachedFoulbornRows
  }
  cachedFoulbornRows = null
  foulbornRowsFetchedAt = 0
  if (pendingFoulbornRequest) return pendingFoulbornRequest

  const storedRows = readCachedFoulbornRows()
  if (storedRows) {
    cachedFoulbornRows = storedRows
    return cachedFoulbornRows
  }

  pendingFoulbornRequest = (async () => {
    const response = await fetch(FOULBORN_ENDPOINT)
    if (!response.ok) {
      throw new Error(`PoE Wiki Foulborn modifier request failed (${response.status}).`)
    }

    const payload = await response.json()
    const rows = Array.isArray(payload?.rows)
      ? payload.rows.filter(isFoulbornModifierRow)
      : []
    if (!rows.length) {
      throw new Error('PoE Wiki response did not contain usable Foulborn modifier rows.')
    }

    cachedFoulbornRows = rows
    foulbornRowsFetchedAt = Date.now()
    writeCachedFoulbornRows(rows)
    return rows
  })()

  try {
    return await pendingFoulbornRequest
  } finally {
    pendingFoulbornRequest = null
  }
}

function normalizeModifierText(value) {
  return value
    .replace(MODIFIER_NUMBER_PATTERN, (_match, sign) => `${sign}#`)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeModifierKey(value) {
  return normalizeModifierText(value)
    .replace(/[^a-z0-9#+%.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getVariantTags(variant) {
  if (Array.isArray(variant)) {
    return variant
      .filter((tag) => typeof tag === 'string')
      .flatMap((tag) => tag.split(','))
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
  }
  return typeof variant === 'string'
    ? variant.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean)
    : []
}

function getVariantAliasConfig(_item, tag) {
  return { aliases: VARIANT_ALIAS_MAP[tag] || [tag] }
}

function getVariantAliases(item, tag) {
  return getVariantAliasConfig(item, tag).aliases
}

function getModifierLines(item) {
  return [
    ['explicit', item?.explicitModifiers],
    ['implicit', item?.implicitModifiers],
    ['explicit', item?.mutatedModifiers],
  ].flatMap(([group, modifiers]) => (
    Array.isArray(modifiers)
      ? modifiers
        .map((modifier) => typeof modifier === 'string' ? modifier : modifier?.text)
        .filter((text) => typeof text === 'string' && text.trim())
        .map((text) => ({ group, text, normalizedText: normalizeModifierText(text) }))
      : []
  ))
}

function getVariantFamily(item, siblings, includeBaseFoulborn = false) {
  const itemName = typeof item?.name === 'string' ? item.name.trim().toLowerCase() : ''
  const itemBaseName = itemName.replace(/^foulborn\s+/i, '')
  const itemCategory = typeof item?.category === 'string' ? item.category : ''
  const family = (Array.isArray(siblings) ? siblings : []).filter((sibling) => (
    typeof sibling?.name === 'string'
    && (
      sibling.name.trim().toLowerCase() === itemName
      || (
        includeBaseFoulborn
        && sibling.name.trim().toLowerCase().replace(/^foulborn\s+/i, '') === itemBaseName
      )
    )
    && (!itemCategory || sibling.category === itemCategory)
  ))
  if (!family.some((sibling) => sibling === item || (item?.id && sibling?.id === item.id))) {
    family.push(item)
  }
  return family.length ? family : [item]
}

function getVariantDiffLines(item, siblings) {
  const family = getVariantFamily(item, siblings)
  if (family.length < 2) {
    return getModifierLines(item).map((line) => ({ ...line, frequency: 0 }))
  }
  const modifierFrequency = new Map()
  const itemLines = getModifierLines(item)
  const explicitTexts = new Set(
    itemLines
      .filter((line) => line.group === 'explicit')
      .map((line) => line.normalizedText),
  )

  for (const sibling of family) {
    const keys = new Set(getModifierLines(sibling).map(({ group, normalizedText }) => (
      `${group}:${normalizedText}`
    )))
    for (const key of keys) {
      modifierFrequency.set(key, (modifierFrequency.get(key) || 0) + 1)
    }
  }

  const commonLimit = family.length > 1 ? Math.floor(family.length / 2) : 1
  return itemLines
    .map((line) => ({
      ...line,
      frequency: modifierFrequency.get(`${line.group}:${line.normalizedText}`) || 0,
    }))
    .filter((line) => (
      line.frequency <= commonLimit
      && !(line.group === 'implicit' && explicitTexts.has(line.normalizedText))
    ))
    .sort((left, right) => left.frequency - right.frequency)
}

function aliasMatchScore(text, item, tag) {
  const normalizedText = normalizeModifierText(text)
  const textTokens = new Set(
    (normalizedText.match(/[a-z]+/g) || []).map(normalizeComparisonToken),
  )
  return getVariantAliases(item, tag)
    .map((alias) => normalizeModifierText(alias))
    .filter(Boolean)
    .reduce((bestScore, alias) => {
      if (normalizedText.includes(alias)) return Math.max(bestScore, alias.length * 2)

      const aliasTokens = [...new Set(
        (alias.match(/[a-z]+/g) || []).map(normalizeComparisonToken),
      )]
      if (aliasTokens.length === 1) {
        return Math.max(
          bestScore,
          textTokens.has(aliasTokens[0]) ? alias.length : 0,
        )
      }
      const minimumTokenMatches = Math.max(2, Math.ceil(aliasTokens.length * 0.6))
      const matchingTokens = aliasTokens.filter((token) => textTokens.has(token)).length
      const overlapScore = matchingTokens >= minimumTokenMatches
        ? (matchingTokens / aliasTokens.length) * alias.length
        : 0
      return Math.max(bestScore, overlapScore)
    }, 0)
}

function preferredGroupEntries(entries, preferredGroup = 'explicit') {
  const preferred = entries.filter((entry) => entry.id.startsWith(`${preferredGroup}.`))
  const fallbackGroup = preferredGroup === 'implicit' ? 'explicit' : 'implicit'
  const selected = preferred.length
    ? preferred
    : entries.filter((entry) => entry.id.startsWith(`${fallbackGroup}.`))
  return [...new Map(selected.map((entry) => [entry.id, entry])).values()]
}

function normalizeComparisonToken(token) {
  const tokenForms = {
    avoidance: 'avoid',
    avoided: 'avoid',
    avoids: 'avoid',
    bleed: 'bleed',
    bleeding: 'bleed',
    bled: 'bleed',
    chance: 'chance',
    chances: 'chance',
    eater: 'eat',
    increase: 'increase',
    increased: 'increase',
    increases: 'increase',
    regeneration: 'regen',
    regenerate: 'regen',
    regenerated: 'regen',
    regenerates: 'regen',
    regen: 'regen',
    immunity: 'immune',
    immune: 'immune',
    required: 'require',
    requirement: 'require',
    requirements: 'require',
    requires: 'require',
    suppress: 'suppress',
    suppressed: 'suppress',
    suppresses: 'suppress',
    suppression: 'suppress',
    suppressions: 'suppress',
  }
  if (tokenForms[token]) return tokenForms[token]
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 4) return token.slice(0, -1)
  return token
}

function getComparisonTokenList(value) {
  return (normalizeModifierText(value).match(/[a-z]+/g) || [])
    .map(normalizeComparisonToken)
}

function getComparisonTokens(value) {
  return new Set(getComparisonTokenList(value))
}

function modifierSimilarity(left, right) {
  const leftList = getComparisonTokenList(left)
  const rightList = getComparisonTokenList(right)
  const leftTokens = getComparisonTokens(left)
  const rightTokens = getComparisonTokens(right)
  if (!leftTokens.size || !rightTokens.size) return 0
  if (normalizeModifierText(left) === normalizeModifierText(right)) return 1

  let sharedTokens = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) sharedTokens += 1
  }
  const diceScore = (2 * sharedTokens) / (leftTokens.size + rightTokens.size)
  let longestPhrase = 0
  for (let leftIndex = 0; leftIndex < leftList.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < rightList.length; rightIndex += 1) {
      let phraseLength = 0
      while (
        leftList[leftIndex + phraseLength]
        && leftList[leftIndex + phraseLength] === rightList[rightIndex + phraseLength]
      ) {
        phraseLength += 1
      }
      longestPhrase = Math.max(longestPhrase, phraseLength)
    }
  }
  const phraseScore = longestPhrase / Math.min(leftList.length, rightList.length)
  return Math.max(diceScore, phraseScore * 0.9)
}

function modifierSpecificityScore(left, right) {
  const sourceTokens = [...getComparisonTokens(left)]
    .filter((token) => !GENERIC_MODIFIER_TOKENS.has(token))
  const statTokens = getComparisonTokens(right)
  if (!sourceTokens.length) return 0
  const sharedTokens = sourceTokens.filter((token) => statTokens.has(token)).length
  return sharedTokens / sourceTokens.length
}

function decodeHtmlEntities(value) {
  const entities = {
    '&amp;': '&',
    '&apos;': "'",
    '&gt;': '>',
    '&lt;': '<',
    '&quot;': '"',
    '&#039;': "'",
    '&#39;': "'",
    '&#x27;': "'",
  }
  return String(value || '').replace(
    /&(?:amp|apos|gt|lt|quot);|&#(?:0*39|x0*27);/gi,
    (entity) => entities[entity.toLowerCase()] ?? entity,
  )
}

function normalizeFoulbornItemName(name) {
  return decodeHtmlEntities(name)
    .replace(/^Foulborn\s+/i, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function getFoulbornRowsForItem(item, rows) {
  const itemName = normalizeFoulbornItemName(item?.name)
  return rows.filter((row) => normalizeFoulbornItemName(row.uniqueItem) === itemName)
}

function modifiersAreEquivalent(left, right) {
  return normalizeModifierKey(left) === normalizeModifierKey(right)
}

function getActiveFoulbornRows(item, siblings, foulbornRows) {
  const itemModifiers = getModifierLines(item)
  const family = getVariantFamily(item, siblings, true)
  const siblingModifiers = family
    .filter((sibling) => !(
      sibling === item
      || (item?.id && sibling?.id === item.id)
    ))
    .flatMap(getModifierLines)

  return foulbornRows.filter((row) => {
    const foulbornModifierIsPresent = itemModifiers.some((modifier) => (
      modifiersAreEquivalent(modifier.text, row.foulbornModifier)
    ))
    if (foulbornModifierIsPresent) return true
    const originalIsPresent = itemModifiers.some((modifier) => (
      modifiersAreEquivalent(modifier.text, row.originalModifier)
    ))
    if (originalIsPresent) return false
    return siblingModifiers.some((modifier) => (
      modifiersAreEquivalent(modifier.text, row.originalModifier)
    ))
  })
}

function getStatCandidates(modifier, stats, item, tag, diagnostics = null) {
  const normalizedModifier = normalizeModifierText(modifier)
  const maximumAliasLength = Math.max(
    1,
    ...getVariantAliases(item, tag).map((alias) => normalizeModifierText(alias).length),
  )
  let groups = statTextGroupCache.get(stats)
  if (!groups) {
    const byText = new Map()
    for (const entry of stats) {
      const normalizedText = normalizeModifierText(entry.text)
      const entries = byText.get(normalizedText) || []
      entries.push(entry)
      byText.set(normalizedText, entries)
    }
    groups = [...byText.entries()].map(([normalizedText, entries]) => ({
      normalizedText,
      statEntry: preferredGroupEntries(entries)
        .sort((left, right) => left.id.localeCompare(right.id))[0],
    }))
    statTextGroupCache.set(stats, groups)
  }

  const modifierTokens = getComparisonTokens(modifier)
  const rejectedCandidates = diagnostics ? [] : null
  const passingCandidateBreakdowns = diagnostics ? [] : null
  const statTextById = diagnostics
    ? new Map(groups.map(({ statEntry }) => [statEntry?.id, statEntry?.text]))
    : null
  const candidates = groups
    .map(({ normalizedText, statEntry }) => {
      if (!statEntry) return null
      const isExact = normalizedModifier === normalizedText
      const sourceScore = modifierSimilarity(modifier, statEntry.text)
      const tagAliasScore = aliasMatchScore(statEntry.text, item, tag)
        / (maximumAliasLength * 2)
      const score = isExact
        ? 2
        : sourceScore * 0.8 + tagAliasScore * 0.2
      const statTokens = getComparisonTokens(statEntry.text)
      const sharedTokenCount = [...modifierTokens]
        .filter((token) => statTokens.has(token))
        .length
      if (!isExact && (score < 0.42 || (sharedTokenCount < 2 && tagAliasScore < 0.5))) {
        if (rejectedCandidates) {
          rejectedCandidates.push({
            statId: statEntry.id,
            statText: statEntry.text,
            score,
            sourceScore,
            tagAliasScore,
            sharedTokenCount,
            reason: score < 0.42
              ? 'Below 0.42 score threshold.'
              : 'Fewer than two shared tokens and tag alias score below 0.5.',
          })
        }
        return null
      }
      if (passingCandidateBreakdowns) {
        passingCandidateBreakdowns.push({
          modifier,
          statId: statEntry.id,
          statText: statEntry.text,
          group: statEntry.id.startsWith('explicit.') ? 'explicit' : 'implicit',
          normalizedModifier,
          normalizedStatText: normalizedText,
          isExact,
          sourceScore,
          tagAliasScore,
          statsScore: score,
          sharedTokenCount,
          specificityScore: modifierSpecificityScore(modifier, statEntry.text),
          scoring: isExact
            ? 'Exact normalized text; statsScore = 2.'
            : 'statsScore = sourceScore * 0.8 + tagAliasScore * 0.2.',
        })
      }
      return {
        statId: statEntry.id,
        statText: statEntry.text,
        group: statEntry.id.startsWith('explicit.') ? 'explicit' : 'implicit',
        score,
        isExact,
        sourceScore,
        tagAliasScore,
        sharedTokenCount,
        specificityScore: modifierSpecificityScore(modifier, statEntry.text),
        groupScore: statEntry.id.startsWith('explicit.') ? 1 : 0.5,
      }
    })
    .filter(Boolean)
    .sort((left, right) => (
      right.score - left.score
      || Number(right.isExact) - Number(left.isExact)
      || right.sourceScore - left.sourceScore
      || right.specificityScore - left.specificityScore
      || right.groupScore - left.groupScore
      || left.statId.localeCompare(right.statId)
    ))
  if (diagnostics) {
    diagnostics.modifier = modifier
    diagnostics.tag = tag
    diagnostics.normalizedModifier = normalizedModifier
    diagnostics.aliases = getVariantAliases(item, tag)
    diagnostics.passingCandidateBreakdowns = passingCandidateBreakdowns
    diagnostics.passingCandidates = candidates.map((candidate) => ({
      ...candidate,
      statText: statTextById.get(candidate.statId),
    }))
    diagnostics.rejectedCount = rejectedCandidates.length
    diagnostics.nearMisses = rejectedCandidates
      .sort((left, right) => right.score - left.score)
      .slice(0, 5)
  }
  return candidates
}

function getOriginalModifierKeys(rows) {
  return new Set(rows.map((row) => normalizeModifierText(row.originalModifier)))
}

function getFoulbornModifierKey(row) {
  return `${normalizeModifierText(row.originalModifier)}\u0000${normalizeModifierText(row.foulbornModifier)}`
}

function getBestFoulbornRow(item, tag, rows, usedFoulbornRows) {
  const candidates = rows
    .map((row) => ({
      row,
      key: getFoulbornModifierKey(row),
      score: aliasMatchScore(row.foulbornModifier, item, tag),
    }))
    .filter(({ key, score }) => score > 0 && !usedFoulbornRows.has(key))
    .sort((left, right) => right.score - left.score)
  if (!candidates.length || candidates[0].score === candidates[1]?.score) return null
  return candidates[0]
}

function getRetainedOriginalKeys(item, tag, rows) {
  const tagMappedFoulbornRows = rows.filter((row) => (
    aliasMatchScore(row.foulbornModifier, item, tag) > 0
  ))
  if (tagMappedFoulbornRows.length) return new Set()
  return new Set(
    rows
      .filter((row) => aliasMatchScore(row.originalModifier, item, tag) > 0)
      .map((row) => normalizeModifierText(row.originalModifier)),
  )
}

function getTagCandidates(
  item,
  tag,
  stats,
  modifierLines,
  foulbornRows,
  originalRows = foulbornRows,
  includeUnlabelledFoulborn = false,
  diagnostics = null,
) {
  const candidates = []
  const foulbornRowChecks = []
  if (diagnostics) diagnostics.statSearchBreakdowns = []

  for (let rowIndex = 0; rowIndex < foulbornRows.length; rowIndex += 1) {
    const row = foulbornRows[rowIndex]
    const tagScore = aliasMatchScore(row.foulbornModifier, item, tag)
    const originalModifierTagScore = diagnostics
      ? aliasMatchScore(row.originalModifier, item, tag)
      : undefined
    if (!tagScore && !includeUnlabelledFoulborn) {
      foulbornRowChecks.push({
        rowIndex,
        key: getFoulbornModifierKey(row),
        foulbornModifier: row.foulbornModifier,
        originalModifier: row.originalModifier,
        tagScore,
        originalModifierTagScore,
        pairingBasis: 'Foulborn modifier alias score against this tag; original modifier is recorded for row identity/replacement handling.',
        status: 'skipped',
        reason: 'No alias/tag match.',
      })
      continue
    }
    const statSearch = diagnostics ? {} : null
    const statCandidates = getStatCandidates(row.foulbornModifier, stats, item, tag, statSearch)
    if (diagnostics) {
      diagnostics.statSearchBreakdowns.push(...statSearch.passingCandidateBreakdowns)
    }
    if (!statCandidates.length) {
      foulbornRowChecks.push({
        rowIndex,
        key: getFoulbornModifierKey(row),
        foulbornModifier: row.foulbornModifier,
        originalModifier: row.originalModifier,
        tagScore,
        originalModifierTagScore,
        pairingBasis: includeUnlabelledFoulborn && !tagScore
          ? 'Included without a tag alias score because active Foulborn rows are being considered.'
          : 'Foulborn modifier alias score against this tag.',
        statSearch,
        status: 'miss',
        reason: 'No stat candidate passed the matcher thresholds.',
      })
    }
    for (const stat of statCandidates) {
      candidates.push({
        tagScore: tagScore || 0.001,
        statScore: stat.score,
        statId: stat.statId,
        statText: stat.statText,
        group: stat.group,
        isExact: stat.isExact,
        sourceScore: stat.sourceScore,
        tagAliasScore: stat.tagAliasScore,
        sharedTokenCount: stat.sharedTokenCount,
        specificityScore: stat.specificityScore,
        groupScore: stat.groupScore,
        originalMod: row.originalModifier,
        foulbornMod: row.foulbornModifier,
        sourceModifier: row.foulbornModifier,
        foulbornKey: getFoulbornModifierKey(row),
      })
    }
    if (statCandidates.length) {
      foulbornRowChecks.push({
        rowIndex,
        key: getFoulbornModifierKey(row),
        foulbornModifier: row.foulbornModifier,
        originalModifier: row.originalModifier,
        tagScore,
        originalModifierTagScore,
        pairingBasis: includeUnlabelledFoulborn && !tagScore
          ? 'Included without a tag alias score because active Foulborn rows are being considered.'
          : 'Foulborn modifier alias score against this tag.',
        statSearch,
        status: 'candidate',
        statCandidates: statCandidates.map((stat) => ({
          statId: stat.statId,
          group: stat.group,
          score: stat.score,
        })),
      })
    }
  }

  if (candidates.length) {
    if (diagnostics) {
      diagnostics.candidateSource = 'foulborn rows'
      diagnostics.foulbornRowChecks = foulbornRowChecks
      diagnostics.itemModifierLineChecks = 'Not evaluated; Foulborn row candidates were found.'
      diagnostics.candidates = summarizeMatcherCandidates(candidates)
    }
    return candidates
  }

  const excludedOriginals = getOriginalModifierKeys(originalRows)
  const retainedOriginals = getRetainedOriginalKeys(item, tag, originalRows)
  const itemModifierLineChecks = []
  for (let lineIndex = 0; lineIndex < modifierLines.length; lineIndex += 1) {
    const line = modifierLines[lineIndex]
    const isOriginal = excludedOriginals.has(line.normalizedText)
    if (isOriginal && !retainedOriginals.has(line.normalizedText)) {
      itemModifierLineChecks.push({
        lineIndex,
        modifier: line.text,
        source: line.group,
        normalizedText: line.normalizedText,
        exclusionKey: line.normalizedText,
        status: 'skipped',
        reason: 'Matches an Original modifier that is replaced by a Foulborn modifier.',
      })
      continue
    }
    const statSearch = diagnostics ? {} : null
    const statCandidates = getStatCandidates(line.text, stats, item, tag, statSearch)
    if (diagnostics) {
      diagnostics.statSearchBreakdowns.push(...statSearch.passingCandidateBreakdowns)
    }
    if (!statCandidates.length) {
      itemModifierLineChecks.push({
        lineIndex,
        modifier: line.text,
        source: line.group,
        normalizedText: line.normalizedText,
        statSearch,
        status: 'miss',
        reason: 'No stat candidate passed the matcher thresholds.',
      })
    }
    let matchedTag = false
    for (const stat of statCandidates) {
      const tagScore = Math.max(
        aliasMatchScore(line.text, item, tag),
        aliasMatchScore(stats.find((entry) => entry.id === stat.statId)?.text || '', item, tag),
      )
      if (!tagScore) continue
      matchedTag = true
      candidates.push({
        tagScore,
        statScore: stat.score,
        statId: stat.statId,
        statText: stat.statText,
        group: stat.group,
        isExact: stat.isExact,
        sourceScore: stat.sourceScore,
        tagAliasScore: stat.tagAliasScore,
        sharedTokenCount: stat.sharedTokenCount,
        specificityScore: stat.specificityScore,
        groupScore: stat.groupScore,
        originalMod: null,
        foulbornMod: null,
        sourceModifier: line.text,
        foulbornKey: null,
      })
    }
    if (matchedTag) {
      itemModifierLineChecks.push({
        lineIndex,
        modifier: line.text,
        source: line.group,
        normalizedText: line.normalizedText,
        statSearch,
        status: 'candidate',
        candidates: candidates
          .filter((candidate) => candidate.sourceModifier === line.text)
          .map((candidate) => ({
            statId: candidate.statId,
            group: candidate.group,
            tagScore: candidate.tagScore,
            statScore: candidate.statScore,
          })),
      })
    } else if (statCandidates.length) {
      itemModifierLineChecks.push({
        lineIndex,
        modifier: line.text,
        source: line.group,
        normalizedText: line.normalizedText,
        statSearch,
        status: 'skipped',
        reason: 'Stat candidates found, but none matched this tag alias.',
      })
    }
  }
  if (diagnostics) {
    diagnostics.candidateSource = 'item modifier lines'
    diagnostics.foulbornRowChecks = foulbornRowChecks
    diagnostics.itemModifierLineChecks = itemModifierLineChecks
    diagnostics.candidates = summarizeMatcherCandidates(candidates)
  }
  return candidates
}

function pickTagCandidate(candidates, usedStatIds, usedFoulbornRows, diagnostics = null) {
  const available = candidates
    .filter((candidate) => (
      !usedStatIds.has(candidate.statId)
      && (!candidate.foulbornKey || !usedFoulbornRows.has(candidate.foulbornKey))
    ))
    .sort(compareMatcherCandidates)
  if (diagnostics) {
    diagnostics.availableCandidates = summarizeMatcherCandidates(available)
    diagnostics.filteredCandidates = summarizeMatcherCandidates(
      candidates.filter((candidate) => !available.includes(candidate)),
    )
  }
  if (!available.length) {
    if (diagnostics) diagnostics.reason = candidates.length
      ? 'All candidates were already used by another tag.'
      : 'No candidates were available for this tag.'
    return null
  }

  const best = available[0]
  const tied = available.filter((candidate) => (
    compareMatcherCandidateQuality(candidate, best) === 0
  ))
  const ids = new Set(tied.map((candidate) => candidate.statId))
  if (ids.size > 1) {
    if (diagnostics) {
      diagnostics.reason = 'Quality scores tied; resolved by stable statId ordering after semantic and group scores.'
      diagnostics.tiedStatIds = [...ids]
      diagnostics.tiedCandidates = tied.map((candidate) => ({
        ...summarizeMatcherCandidates([candidate])[0],
        statsScore: candidate.statScore,
        tagScore: candidate.tagScore,
        sourceScore: candidate.sourceScore,
        specificityScore: candidate.specificityScore,
        groupScore: candidate.groupScore,
      }))
    }
  }
  if (diagnostics) {
    if (!diagnostics.reason) {
      diagnostics.reason = 'Selected highest-ranked unconsumed candidate.'
    }
    diagnostics.selected = summarizeMatcherCandidates([best])[0]
  }
  return best
}

function scoreTagCandidateAssignment(assignments) {
  const selected = assignments.filter(Boolean)
  return [
    selected.length,
    selected.reduce((sum, candidate) => sum + (candidate.tagScore || 0), 0),
    selected.reduce((sum, candidate) => sum + Number(candidate.isExact), 0),
    selected.reduce((sum, candidate) => sum + (candidate.sourceScore || 0), 0),
    selected.reduce((sum, candidate) => sum + (candidate.specificityScore || 0), 0),
    selected.reduce((sum, candidate) => sum + (candidate.groupScore || 0), 0),
    selected.reduce((sum, candidate) => sum + (candidate.statScore || 0), 0),
  ]
}

function compareScoreVectors(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0)
    if (difference) return difference
  }
  return 0
}

function resolveTagCandidateAssignments(candidateSets) {
  const orderedCandidates = candidateSets.map((candidates) => {
    const remaining = [...candidates]
    const ordered = []
    while (remaining.length) {
      const best = pickTagCandidate(remaining, new Set(), new Set())
      ordered.push(best)
      remaining.splice(remaining.indexOf(best), 1)
    }
    return ordered
  })
  const assignments = Array(orderedCandidates.length).fill(null)
  const usedStatIds = new Set()
  const usedFoulbornRows = new Set()
  let bestAssignments = assignments.slice()
  let bestScore = scoreTagCandidateAssignment(bestAssignments)

  function isPreferredAssignment(candidateAssignment, currentBest, candidateScore, currentBestScore) {
    const scoreDifference = compareScoreVectors(candidateScore, currentBestScore)
    if (scoreDifference) return scoreDifference > 0
    for (let index = 0; index < candidateAssignment.length; index += 1) {
      const candidate = candidateAssignment[index]
      const best = currentBest[index]
      if (!candidate && !best) continue
      if (candidate && !best) return true
      if (!candidate && best) return false
      const qualityDifference = compareMatcherCandidateQuality(candidate, best)
      if (qualityDifference) return qualityDifference < 0
      const idDifference = String(candidate.statId).localeCompare(String(best.statId))
      if (idDifference) return idDifference < 0
    }
    return false
  }

  function visit(tagIndex) {
    if (tagIndex === orderedCandidates.length) {
      const score = scoreTagCandidateAssignment(assignments)
      if (isPreferredAssignment(assignments, bestAssignments, score, bestScore)) {
        bestAssignments = assignments.slice()
        bestScore = score
      }
      return
    }

    for (const candidate of orderedCandidates[tagIndex]) {
      if (
        usedStatIds.has(candidate.statId)
        || (candidate.foulbornKey && usedFoulbornRows.has(candidate.foulbornKey))
      ) {
        continue
      }
      assignments[tagIndex] = candidate
      usedStatIds.add(candidate.statId)
      if (candidate.foulbornKey) usedFoulbornRows.add(candidate.foulbornKey)
      visit(tagIndex + 1)
      usedStatIds.delete(candidate.statId)
      if (candidate.foulbornKey) usedFoulbornRows.delete(candidate.foulbornKey)
    }

    assignments[tagIndex] = null
    visit(tagIndex + 1)
  }

  visit(0)
  return { assignments: bestAssignments, score: bestScore }
}

function getVariantTagsForItem(item) {
  const variant = Array.isArray(item?.variantTags) && item.variantTags.length
    ? item.variantTags.join(',')
    : item?.variant
  return typeof variant === 'string'
    ? variant.split(',').map((tag) => tag.trim()).filter(Boolean)
    : []
}

function getTradeInfoMatches(item, stats, diagnostics = null) {
  if (!Array.isArray(item?.tradeInfo)) {
    if (diagnostics) diagnostics.push({
      status: 'unavailable',
      reason: 'Item has no tradeInfo array.',
    })
    return null
  }
  const entriesById = new Map(stats.map((entry) => [entry.id, entry]))
  const variantTags = getVariantTagsForItem(item)
  const modifierLines = getModifierLines(item)
  const usedModifierIndexes = new Set()
  const matches = []
  const seenStatIds = new Set()
  for (const info of item.tradeInfo) {
    const statId = typeof info?.mod === 'string' ? info.mod : ''
    const entry = entriesById.get(statId)
    if (!entry) {
      if (diagnostics) diagnostics.push({
        statId,
        status: 'skipped',
        reason: 'tradeInfo stat ID was not found in loaded stats.',
      })
      continue
    }
    if (seenStatIds.has(statId)) {
      if (diagnostics) diagnostics.push({
        statId,
        status: 'deduped',
        reason: 'Duplicate tradeInfo stat ID.',
      })
      continue
    }
    const modifierMatch = modifierLines
      .map((line, index) => ({
        line,
        index,
        score: usedModifierIndexes.has(index) ? 0 : modifierSimilarity(line.text, entry.text),
      }))
      .sort((left, right) => right.score - left.score)[0]
    const sourceModifier = modifierMatch?.score >= 0.42 ? modifierMatch.line.text : null
    if (!sourceModifier) {
      if (diagnostics) diagnostics.push({
        statId,
        statText: entry.text,
        bestSourceModifier: modifierMatch?.line.text || null,
        similarityScore: modifierMatch?.score ?? 0,
        status: 'skipped',
        reason: 'No item modifier reached the 0.42 tradeInfo similarity threshold.',
      })
      continue
    }
    usedModifierIndexes.add(modifierMatch.index)
    seenStatIds.add(statId)
    matches.push({
      tag: variantTags[matches.length] || entry.text,
      originalMod: null,
      foulbornMod: null,
      sourceModifier,
      matchedStatId: statId,
      group: statId.startsWith('explicit.') ? 'explicit' : 'implicit',
      source: 'tradeInfo',
    })
    if (diagnostics) diagnostics.push({
      statId,
      statText: entry.text,
      sourceModifier,
      similarityScore: modifierMatch.score,
      tag: variantTags[matches.length - 1] || entry.text,
      status: 'matched',
    })
  }
  return matches.length ? matches : null
}

function matchVariantStatTags(item, stats, siblings = [], foulbornRows = []) {
  const variantTags = getVariantTagsForItem(item)
  const shouldDebug = shouldLogFoulbornMatcher(item, variantTags)
  const allStats = Array.isArray(stats) ? stats : []
  const validStats = allStats.every(isStatEntry) ? allStats : allStats.filter(isStatEntry)
  const isFoulbornItem = /^Foulborn\s+/i.test(item?.name || '')
    || (Array.isArray(item?.mutatedModifiers) && item.mutatedModifiers.length > 0)
  const allItemFoulbornRows = /^Foulborn\s+/i.test(item?.name || '')
    ? getFoulbornRowsForItem(item, foulbornRows)
    : []
  const tradeInfoMatches = getTradeInfoMatches(item, validStats)
  const canUseTradeInfo = Boolean(
    tradeInfoMatches
    && (!isFoulbornItem || !allItemFoulbornRows.length)
    && (!variantTags.length || tradeInfoMatches.length === variantTags.length)
  )
  if (tradeInfoMatches && canUseTradeInfo) {
    return tradeInfoMatches
  }
  const activeFoulbornRows = getActiveFoulbornRows(item, siblings, allItemFoulbornRows)
  const tags = variantTags.length
    ? variantTags
    : activeFoulbornRows.map((row) => row.foulbornModifier)
  if (!tags.length) return []

  const foulbornRowsForMatching = activeFoulbornRows.length
    ? activeFoulbornRows
    : allItemFoulbornRows
  const modifierLines = getVariantDiffLines(item, siblings)
  const tagCandidateSets = tags.map((tag) => {
    const foulbornCandidateDiagnostics = shouldDebug ? {} : null
    const foulbornCandidates = getTagCandidates(
      item,
      tag.toLowerCase(),
      validStats,
      modifierLines,
      foulbornRowsForMatching,
      allItemFoulbornRows,
      tags.length === 1 && activeFoulbornRows.length === 1,
      foulbornCandidateDiagnostics,
    )
    let candidates = foulbornCandidates
    if (!candidates.length && allItemFoulbornRows.length && !activeFoulbornRows.length) {
      candidates = getTagCandidates(
        item,
        tag.toLowerCase(),
        validStats,
        modifierLines,
        [],
        allItemFoulbornRows,
        false,
        shouldDebug ? {} : null,
      )
    }
    return { tag, candidates }
  })
  const candidateResolution = resolveTagCandidateAssignments(
    tagCandidateSets.map(({ candidates }) => candidates),
  )
  const usedStatIds = new Set()
  const usedFoulbornRows = new Set()
  const matches = tagCandidateSets.map((tagSet, tagIndex) => {
    const { tag, candidates } = tagSet
    const match = candidateResolution.assignments[tagIndex]
    if (match) {
      usedStatIds.add(match.statId)
      if (match.foulbornKey) usedFoulbornRows.add(match.foulbornKey)
    }
    const unmatchedFoulbornRow = !match && tags.length === 1
      ? getBestFoulbornRow(item, tag.toLowerCase(), foulbornRowsForMatching, usedFoulbornRows)
        || (activeFoulbornRows.length === 1
          ? {
            row: activeFoulbornRows[0],
            key: getFoulbornModifierKey(activeFoulbornRows[0]),
          }
          : null)
      : null
    const result = {
      tag,
      originalMod: match?.originalMod ?? unmatchedFoulbornRow?.row.originalModifier ?? null,
      foulbornMod: match?.foulbornMod ?? unmatchedFoulbornRow?.row.foulbornModifier ?? null,
      sourceModifier: match?.sourceModifier ?? unmatchedFoulbornRow?.row.foulbornModifier ?? null,
      matchedStatId: match?.statId ?? null,
      group: match?.group ?? null,
    }
    return result
  })

  const mutatedModifierCount = Array.isArray(item?.mutatedModifiers)
    ? item.mutatedModifiers.length
    : 0
  const mutatedModifierLines = getModifierList(item?.mutatedModifiers)
  let supplementalSlots = Math.max(0, mutatedModifierCount - usedFoulbornRows.size)
  for (const row of activeFoulbornRows) {
    const key = getFoulbornModifierKey(row)
    if (usedFoulbornRows.has(key)) {
      continue
    }
    const directlyPresentMutation = mutatedModifierLines.some((modifier) => (
      modifiersAreEquivalent(modifier, row.foulbornModifier)
    ))
    if (supplementalSlots <= 0 || !directlyPresentMutation) {
      continue
    }
    const tag = tags.find((candidateTag) => !matches.some((match) => (
      match.tag === candidateTag && match.foulbornMod
    ))) || row.foulbornModifier
    const candidates = getStatCandidates(
      row.foulbornModifier,
      validStats,
      item,
      tag.toLowerCase(),
      null,
    )
    const candidate = candidates.find((stat) => !usedStatIds.has(stat.statId))
    if (candidate) {
      usedStatIds.add(candidate.statId)
      supplementalSlots -= 1
    }
    usedFoulbornRows.add(key)
    matches.push({
      tag,
      originalMod: row.originalModifier,
      foulbornMod: row.foulbornModifier,
      sourceModifier: row.foulbornModifier,
      matchedStatId: candidate?.statId ?? null,
      group: candidate?.group ?? null,
    })
  }

  return matches
}

export function matchVariantStatIds(item, stats, siblings = [], foulbornRows = []) {
  return [...new Set(
    matchVariantStatTags(item, stats, siblings, foulbornRows)
      .map((match) => match.matchedStatId)
      .filter(Boolean),
  )]
}

export async function getVariantStatMatches(item, siblings = []) {
  const tags = getVariantTagsForItem(item)
  const isFoulborn = typeof item?.name === 'string' && /^Foulborn\s+/i.test(item.name)
  if (!tags.length && !isFoulborn) {
    return []
  }

  const stats = await loadVariantStats()
  let foulbornRows = []
  if (isFoulborn) {
    try {
      foulbornRows = await loadFoulbornModifierRows()
    } catch (error) {
      console.warn('Could not load Foulborn modifier mappings from PoE Wiki:', error)
    }
  }
  return matchVariantStatTags(item, stats, siblings, foulbornRows)
}

export async function getImbuedStatMatches(item) {
  const category = String(item?.category || '').toLowerCase()
  if (!category.includes('imbued gem')) return []
  const match = getImbuedStatId(item)
  return match ? [{ tag: match.name, matchedStatId: match.id }] : []
}

function getForbiddenJewelNodeName(item) {
  const raw = typeof item?.displayPassiveName === 'string' && item.displayPassiveName.trim()
    ? item.displayPassiveName
    : typeof item?.passiveName === 'string' && item.passiveName.trim()
      ? item.passiveName
      : typeof item?.name === 'string' ? item.name : ''
  return raw
    .replace(/,\s*Forbidden\s+(?:Flame|Flesh)\s*$/i, '')
    .replace(/^allocates?\s+/i, '')
    .replace(/\s+if\s+you\s+have\s+the\s+matching\s+modifier\s+on\s+Forbidden\s+(?:Flame|Flesh)\s*$/i, '')
    .trim()
}

function getForbiddenJewelVariant(item) {
  const values = [item?.variant, ...(Array.isArray(item?.variantTags) ? item.variantTags : [])]
  return values.find((value) => typeof value === 'string' && /^Forbidden\s+(?:Flame|Flesh)$/i.test(value.trim()))?.trim() || ''
}

export async function getForbiddenJewelStatMatches(item) {
  const variant = getForbiddenJewelVariant(item)
  const node = getForbiddenJewelNodeName(item)
  if (!variant || !node) return []

  const entries = await loadVariantStats()
  // A Forbidden Flame is identified by the modifier referring to its matching
  // Forbidden Flesh, and vice versa. Resolve the real Trade entry by text so
  // the complete stat ID (including its suffix) always comes from GGG's API.
  const matchingVariant = /^Forbidden\s+Flame$/i.test(variant)
    ? 'Forbidden Flesh'
    : 'Forbidden Flame'
  const expected = `allocates ${node.toLowerCase()} if you have the matching modifier on ${matchingVariant.toLowerCase()}`
  const match = entries.find((entry) => normalizeModifierKey(entry.text) === normalizeModifierKey(expected))
  return match ? [{ tag: node, matchedStatId: match.id }] : []
}

const BASE_TYPE_INFLUENCES = ['Shaper', 'Elder', 'Redeemer', 'Crusader', 'Hunter', 'Warlord']

function getBaseTypeInfluences(item) {
  const values = [
    item?.displayInfluence,
    item?.variant,
    ...(Array.isArray(item?.variantTags) ? item.variantTags : []),
    item?.name,
  ].filter((value) => typeof value === 'string' && value.trim())
  if (values.some((value) => /^all$/i.test(value.trim()))) return [...BASE_TYPE_INFLUENCES]

  const found = new Set()
  for (const value of values) {
    for (const match of value.matchAll(/\b(Shaper|Elder|Redeemer|Crusader|Hunter|Warlord)\b/gi)) {
      const influence = BASE_TYPE_INFLUENCES.find((entry) => entry.toLowerCase() === match[1].toLowerCase())
      if (influence) found.add(influence)
    }
  }
  return BASE_TYPE_INFLUENCES.filter((influence) => found.has(influence))
}

function findPseudoStat(entries, text) {
  const normalizedText = normalizeModifierKey(text)
  return entries.find((entry) => (
    entry.id.startsWith('pseudo.')
    && normalizeModifierKey(entry.text) === normalizedText
  ))
}

export async function getBaseTypeStatMatches(item) {
  const entries = await loadVariantStats()
  const matches = []
  const countEntry = findPseudoStat(entries, 'Has # Influences')
  if (countEntry) {
    matches.push({ tag: 'influence-count', matchedStatId: countEntry.id, role: 'influence-count' })
  }

  for (const influence of getBaseTypeInfluences(item)) {
    const entry = findPseudoStat(entries, `Has ${influence} Influence`)
    if (entry) {
      matches.push({ tag: influence, matchedStatId: entry.id, role: 'influence' })
    }
  }
  return matches
}

export async function getVariantStatIds(item, siblings = []) {
  return [...new Set(
    (await getVariantStatMatches(item, siblings))
      .map((match) => match.matchedStatId)
      .filter(Boolean),
  )]
}
