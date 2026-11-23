function numberFrom(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const match = value.match(/\d+(?:\.\d+)?/)
      if (match) return Number(match[0])
    }
  }
  return null
}

function parseGemText(value) {
  const text = Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string').join(' ')
    : typeof value === 'string'
      ? value
      : ''
  if (!text) return {}

  const compact = text.match(/(?:^|[\s,;])(\d{1,2})(?:\s*\/\s*(\d{1,3}))?\s*(c|corrupted)?\s*$/i)
  const level = compact?.[1] ?? text.match(/\blevel\s*[:=]?\s*(\d{1,2})\b/i)?.[1]
  const quality = compact?.[2]
    ?? text.match(/\bquality\s*[:=]?\s*(\d{1,3})\s*%?/i)?.[1]
    ?? text.match(/(\d{1,3})\s*%\s*quality\b/i)?.[1]

  return {
    ...(level !== undefined ? { level: Number(level) } : {}),
    ...(quality !== undefined ? { quality: Number(quality) } : {}),
    corrupted: Boolean(compact?.[3] || /\bcorrupted\b/i.test(text)),
  }
}

function parseGemDetailsId(value) {
  if (typeof value !== 'string') return {}
  const match = value.match(/-(\d{1,2})(?:-(\d{1,3}))?(c)?$/i)
  return match
    ? {
      level: Number(match[1]),
      ...(match[2] !== undefined ? { quality: Number(match[2]) } : {}),
      corrupted: Boolean(match[3]),
    }
    : {}
}

export function normalizeSkillGem(item) {
  const source = item && typeof item === 'object' ? item : {}
  const name = typeof source.name === 'string' ? source.name : ''
  const nameSuffix = name.match(/,\s*(\d{1,2})(?:\s*\/\s*(\d{1,3}))?\s*(c|corrupted)?\s*$/i)
  const cleanName = nameSuffix ? name.slice(0, nameSuffix.index).trim() : name
  const variant = parseGemText(source.variant)
  const variantTags = parseGemText(source.variantTags)
  const detailsId = parseGemDetailsId(source.detailsId)
  const nameDetails = parseGemText(name)
  const rawLevel = numberFrom(source.gemLevel, source.gem_level)
  const fallbackLevel = numberFrom(source.level)
  const corruptedFlag = source.corrupted === true
    || source.isCorrupted === true
    || source.corrupted === 1
    || source.isCorrupted === 1
    || (typeof source.corrupted === 'string' && ['true', 'yes', '1', 'corrupted'].includes(source.corrupted.toLowerCase()))
    || (typeof source.isCorrupted === 'string' && ['true', 'yes', '1', 'corrupted'].includes(source.isCorrupted.toLowerCase()))

  return {
    displayName: cleanName || name,
    gemLevel: rawLevel
      ?? variant.level
      ?? variantTags.level
      ?? detailsId.level
      ?? nameDetails.level
      ?? (fallbackLevel != null && fallbackLevel <= 40 ? fallbackLevel : null),
    gemQuality: numberFrom(source.gemQuality, source.gem_quality, source.quality)
      ?? variant.quality
      ?? variantTags.quality
      ?? detailsId.quality
      ?? nameDetails.quality
      ?? null,
    corrupted: corruptedFlag
      || variant.corrupted
      || variantTags.corrupted
      || detailsId.corrupted
      || nameDetails.corrupted
      || Boolean(nameSuffix?.[3]),
  }
}
