import { GEM_TAGS, GEM_COLOURS, GEM_ALIASES, GEM_TYPES, SUPPORT_EFFECTS, GEM_BASE_STATS } from './buildGemMetadata.js'

const fields = ['implicitMods', 'explicitMods', 'enchantMods', 'craftedMods', 'fracturedMods', 'crucibleMods', 'scourgeMods']
export const sanitizeGemMod = line => typeof line === 'string' ? line.replace(/\{[^}]*\}/g, '').replace(/\[[^\]|]+\|([^\]]+)\]/g, '$1').replace(/\s+/g, ' ').trim() : ''
export function gemMods(item) {
  const parsed = fields.flatMap(key => item?.[key] || []).flatMap(value => {
  const text = typeof value === 'string' ? value : value?.text || value?.description || value?.name
  return typeof text === 'string' ? text.split(/\r?\n/) : []
  }).map(sanitizeGemMod).filter(Boolean)
  if (typeof item?.rawText !== 'string') return parsed
  // Recover omitted raw lines without doubling mods already present in arrays.
  // Keep occurrence counts: two identical legitimate mods must both contribute.
  const raw = item.rawText.split(/\r?\n/)
  const variant = Number(raw.find(line => /^Selected Variant:/i.test(line.trim()))?.split(':')[1] || 1)
  const counts = new Map()
  for (const line of parsed) counts.set(line, (counts.get(line) || 0) + 1)
  for (const original of raw) {
    const variants = original.match(/\{variant:([^}]+)\}/i)?.[1]
    if (variants && !variants.split(',').map(Number).includes(variant)) continue
    const line = sanitizeGemMod(original)
    if (!/^(?:[+\-]?\d|Gems(?: Socketed)? in |Socketed Gems|(?:Red|Green|Blue|White) (?:Skill )?Gems)/i.test(line) || line.includes(':')) continue
    const remaining = counts.get(line) || 0
    if (remaining) counts.set(line, remaining - 1)
    else parsed.push(line)
  }
  return parsed
}
export function gemQualityExplanation(gem) {
  return [`${gem.baseQuality ?? gem.quality ?? 0}% gốc`, ...(gem.qualitySources || []).map(source =>
    `${source.value >= 0 ? '+' : ''}${source.value}% ${source.label}${/Gems(?: Socketed)? in |Quality of(?: Socketed)? (Red|Green|Blue|White) (?:Skill )?Gems|^(Red|Green|Blue|White) (?:Skill )?Gems have/i.test(source.detail || '') ? ' (Socket Colour)' : ''}`), `= ${gem.quality}%`].join(' ')
}
const colours = { 1: 'R', 2: 'G', 3: 'B', red: 'R', green: 'G', blue: 'B', white: 'W', S: 'R', D: 'G', I: 'B' }
export const gemKey = gem => GEM_ALIASES[gem.name] || gem.name.replace(/ Support$/i, '')
export const normalizeGemTag = tag => ({ aoe: 'area', channelling: 'channel', channeling: 'channel', active: 'skill' })[tag.toLowerCase()] || tag.toLowerCase()
export const gemTags = gem => new Set([...(GEM_TAGS[gemKey(gem)] || []), ...(gem.skillTags || [])].map(normalizeGemTag))
export const gemColour = gem => colours[gem.gemColor ?? gem.color] || GEM_COLOURS[gemKey(gem)] || gem.gemColor || gem.color || 'W'
// GGG supplies socket objects; imported builds may supply a linked colour string.
export function itemSockets(item) {
  if (typeof item?.sockets === 'string') {
    return (item.sockets.toUpperCase().match(/[RGBW]/g) || []).map(sColour => ({ group: 0, sColour }))
  }
  return Array.isArray(item?.sockets) ? item.sockets : []
}
const label = item => [item?.name, item?.baseType || item?.typeLine].filter(Boolean).join(', ') || 'Equipment / Jewel'
export const isGemAuxiliaryItem = item => /Runegraft|Tincture/i.test([item?.inventoryId, item?.baseType, item?.typeLine].filter(Boolean).join(' '))
export function activeGemItems(equipment, jewels = []) {
  const seen = new Set()
  return [...Object.entries(equipment).filter(([slot, item]) => !/Swap/i.test(slot) && (!/Flask/i.test(slot) || isGemAuxiliaryItem(item))).map(([, item]) => item), ...jewels].filter(item => {
    if (!item || seen.has(item.id || item)) return false
    seen.add(item.id || item); return true
  })
}
export function gemModSources(equipment = {}, jewels = [], allocated = [], customMods = []) {
  return [...activeGemItems(equipment, jewels).flatMap(item => gemMods(item).map(line => ({ line, label: label(item), category: 'ITEM' }))),
    ...allocated.flatMap(node => gemMods({ explicitMods: node.stats }).map(line => ({ line, label: node.name || 'Passive / Mastery', category: 'TREE' }))),
    ...gemMods({ explicitMods: customMods }).map(line => ({ line, label: 'PoB Config / Custom Mods', category: 'CONFIG' }))]
}
export function gemMatches(gem, target = '') {
  if (!target) return true
  const tags = gemTags(gem)
  return target.toLowerCase().split(/\s+or\s+/).some(option => option.split(/\s+/).every(raw => {
    const tag = normalizeGemTag(raw)
    if (tag === 'skill') return !gem.support
    if (tag === 'support') return gem.support
    return colours[tag] ? colours[tag] === gemColour(gem) : tags.has(tag)
  }))
}
export const supportData = gem => SUPPORT_EFFECTS[gemKey(gem)]
const curveValue = (curve, level) => curve?.[Math.max(0, Math.min(curve.length - 1, Math.floor(level || 1) - 1))] || 0

function typeExpression(expression, types) {
  const stack = []
  for (const type of expression) {
    if (type === 'NOT') stack.push(!stack.pop())
    else if (type === 'AND' || type === 'OR') {
      const b = stack.pop() || false, a = stack.pop() || false
      stack.push(type === 'AND' ? a && b : a || b)
    } else stack.push(types.has(type))
  }
  return stack.some(Boolean)
}

export function supportApplies(support, gem, effectiveTypes) {
  const data = supportData(support)
  if (!data || gem.support || data.gemsOnly && gem.isGranted) return false
  const types = effectiveTypes || new Set(GEM_TYPES[gemKey(gem)] || [...gemTags(gem)].map(tag => tag[0].toUpperCase() + tag.slice(1)))
  return !typeExpression(data.excludes, types) && (!data.requires.length || typeExpression(data.requires, types))
}

export function linkedSupports(group) {
  const unique = new Map()
  for (const gem of group?.gems || []) if (gem.support && gem.enabled !== false) {
    const name = gemKey(gem), key = name.replace(/^Awakened /, ''), previous = unique.get(key)
    const awakened = /^Awakened /.test(name), previousAwakened = previous && /^Awakened /.test(gemKey(previous))
    if (!previous || awakened && !previousAwakened || awakened === previousAwakened && (gem.level > previous.level || gem.level === previous.level && gem.quality > previous.quality)) unique.set(key, gem)
  }
  return [...unique.values()]
}

export function gemSupportEffects(group, gem, conditions = {}) {
  const effects = [], notes = []
  const supports = linkedSupports(group)
  const types = new Set(GEM_TYPES[gemKey(gem)] || [])
  // Supports can turn an ordinary spell into a trap/totem, enabling other
  // supports in that same group. Resolve these added types to a fixed point.
  for (let pass = 0; pass <= supports.length; pass++) {
    const before = types.size
    for (const support of supports) if (supportApplies(support, gem, types)) for (const type of supportData(support).adds || []) types.add(type)
    if (types.size === before) break
  }
  for (const support of supports) {
    const data = supportData(support)
    if (!data) { notes.push(`${support.name}: no modifier metadata available.`); continue }
    if (!supportApplies(support, gem, types)) continue
    const mana = curveValue(data.mana, support.level)
    if (mana) effects.push({ stat: 'manaCost', type: 'MORE', value: mana, source: support.name, isItemSupport: support.isItemSupport })
    for (const mod of data.modifiers) {
      if (['level', 'quality'].includes(mod.stat)) continue
      const knownFlags = (mod.flags || []).filter(flag => ['Area', 'Spell', 'Attack', 'Melee', 'Projectile', 'Trap', 'Mine'].includes(flag))
      if (knownFlags.length && !knownFlags.some(flag => gemTags(gem).has(normalizeGemTag(flag)) || types.has(flag) || flag === 'Trap' && types.has('Trapped') || flag === 'Mine' && types.has('RemoteMined'))) continue
      let value = curveValue(mod.values, support.level) + (mod.quality || 0) * (support.quality || 0)
      if (mod.perStack) {
        const count = conditions[`multiplier:${mod.perStack}`] ?? conditions[mod.perStack]
        if (!Number.isFinite(count)) { notes.push(`${support.name}: ${mod.perStack} stacks unknown; conditional modifier not applied.`); continue }
        value *= Math.max(0, count)
      }
      if (value) effects.push({ stat: mod.stat, type: mod.type, value, flags: mod.flags, source: support.name, isItemSupport: support.isItemSupport })
    }
  }
  return { effects, notes: [...new Set(notes)] }
}

export function auxiliaryGemStats(gem, group, conditions = {}) {
  const { effects, notes } = gemSupportEffects(group, gem, conditions)
  const totals = {}
  for (const effect of effects) {
    const total = totals[effect.stat] ||= { increased: 0, more: 1 }
    if (effect.type === 'INC') total.increased += effect.value
    if (effect.type === 'MORE') total.more *= Math.max(0, 1 + effect.value / 100)
  }
  const scale = stat => Math.max(0, 1 + (totals[stat]?.increased || 0) / 100) * (totals[stat]?.more ?? 1)
  const base = GEM_BASE_STATS[gemKey(gem)] || {}
  return { effects, notes, totals,
    ...(base.mana ? { manaCost: curveValue(base.mana, gem.level) * scale('manaCost') } : {}),
    ...(base.duration ? { duration: curveValue(base.duration, gem.level) * scale('duration') } : {}),
    ...(base.castTime ? { castRate: scale('castSpeed') / base.castTime } : {}),
  }
}

function itemSupports(item) {
  return gemMods(item).flatMap(line => {
    const match = line.match(/^Socketed Gems are Supported by Level (\d+) (.+?)(?: with \d+% increased .+)?$/i)
    if (!match) return []
    const name = GEM_ALIASES[match[2]] || match[2].replace(/ Support$/i, '')
    return [{ name: `${name} Support`, level: Number(match[1]), baseLevel: Number(match[1]), baseQuality: 0, quality: 0, support: true, enabled: true, isItemSupport: true, sourceItemName: label(item) }]
  })
}

// Deterministic two-pass calculation: first item/tree bonuses (including support
// levels), then linked gem-level/quality supports. Always restart from raw bases.
export function calculateGemGroups(groups, equipment = {}, jewels = [], allocated = [], conditions = {}, customMods = []) {
  const globals = gemModSources(equipment, jewels, allocated, customMods)
  const slotGroups = new Map()
  return groups.map(group => {
    const item = equipment[group.slot], local = gemMods(item), actual = group.gems.filter(gem => !gem.isItemSupport)
    const ordinal = slotGroups.get(group.slot) || 0
    if (!group.grantedBy) slotGroups.set(group.slot, ordinal + 1)
    const allSockets = itemSockets(item)
    const socketGroup = group.socketGroup ?? [...new Set(allSockets.map(socket => socket.group))][ordinal]
    const sockets = allSockets.filter(socket => socketGroup === undefined || socket.group === socketGroup)
    const prepared = [...actual, ...(group.grantedBy ? [] : itemSupports(item))].map((gem, index) => {
      if (!gem.support && SUPPORT_EFFECTS[gemKey(gem)]) gem = { ...gem, support: true }
      if (GEM_ALIASES[gem.name]) gem = { ...gem, name: `${GEM_ALIASES[gem.name]}${gem.support ? ' Support' : ''}` }
      const baseLevel = Number(gem.baseLevel ?? gem.level) || 1, baseQuality = Number.parseInt(gem.baseQuality ?? gem.quality ?? 0, 10) || 0
      const levelSources = [], qualitySources = []
      const socket = allSockets[gem.socketIndex] || sockets[index]
      const socketIndex = Number.isInteger(gem.socketIndex) ? gem.socketIndex : allSockets.indexOf(socket)
      const rawColour = socket?.sColour || socket?.attr || gem.socketColor || gemColour(gem)
      const socketColor = colours[rawColour] || rawColour
      function add(list, amount, source, scope, line) { list.push({ value: Number(amount), label: source, scope, detail: line }) }
      if (!gem.isGranted && !gem.isItemSupport) {
        for (const line of local) {
          let match = line.match(/^\+(\d+) to Level of Socketed (?:(.*?) )?Gems$/i)
          if (match && gemMatches(gem, match[2])) add(levelSources, match[1], label(item), 'local', line)
          match = line.match(/^\+(\d+)% to Quality of (?:all )?Socketed (?:(.*?) )?Gems$/i)
          if (match && !/^(Red|Green|Blue|White)(?: Skill)?$/i.test(match[2] || '') && gemMatches(gem, match[2])) add(qualitySources, match[1], label(item), 'local', line)
        }
        for (const { line, label: source, category } of globals) {
          let match = line.match(/^\+(\d+) to Level of all (.*?) Gems$/i)
          if (match && gemMatches(gem, match[2])) add(levelSources, match[1], source, 'global', line)
          match = line.match(/^\+(\d+)% to Quality of all (.*?) Gems$/i)
          if (match && gemMatches(gem, match[2])) add(qualitySources, match[1], source, 'global', line)
          match = line.match(/Gems(?: Socketed)? in (Red|Green|Blue|White) Sockets have \+(\d+)% to Quality/i)
          if (match && (socketColor === 'W' || colours[match[1].toLowerCase()] === socketColor)) add(qualitySources, match[2], source, 'global', line)
          match = line.match(/\+(\d+)% to Quality of(?: Socketed)? (Red|Green|Blue|White) (?:Skill )?Gems/i)
          if (match && (socketColor === 'W' || colours[match[2].toLowerCase()] === socketColor)) add(qualitySources, match[1], source, 'global', line)
          match = line.match(/^(Red|Green|Blue|White) (?:Skill )?Gems have \+(\d+)% to Quality/i)
          if (match && (socketColor === 'W' || colours[match[1].toLowerCase()] === socketColor)) add(qualitySources, match[2], source, 'global', line)
          // Item-local uncoloured bonuses were applied above. Tree/config text
          // has no owning socket item and applies to each socketed gem.
          match = line.match(/^\+(\d+)% to Quality of(?: all)? Socketed Gems$/i)
          if (match && category !== 'ITEM') add(qualitySources, match[1], source, 'global', line)
        }
      }
      const sum = list => list.reduce((sum, source) => sum + source.value, 0)
      return { ...gem, socketIndex: socketIndex >= 0 ? socketIndex : undefined, color: gemColour(gem), gemColor: gemColour(gem), gemTags: [...gemTags(gem)], socketColor, baseLevel, baseQuality, levelSources, qualitySources, level: baseLevel + sum(levelSources), quality: Math.max(0, baseQuality + sum(qualitySources)) }
    })
    const preliminary = { ...group, gems: prepared }
    const gems = prepared.map(gem => {
      if (!gem.support && !gem.isGranted) {
        for (const stat of ['level', 'quality']) {
          let best = { value: 0 }
          for (const support of linkedSupports(preliminary)) if (supportApplies(support, gem)) {
            for (const modifier of supportData(support).modifiers.filter(mod => mod.stat === stat)) {
              const value = curveValue(modifier.values, support.level)
              if (value > best.value) best = { value, label: support.name, scope: 'support' }
            }
          }
          if (best.value) { gem[stat] += best.value; gem[stat === 'level' ? 'levelSources' : 'qualitySources'].push(best) }
        }
      }
      if (Number.isFinite(gem.savedFinalQuality)) {
        const adjustment = gem.savedFinalQuality - gem.quality
        if (adjustment) gem.qualitySources.push({ value: adjustment, label: 'PoB XML final quality', scope: 'POB_XML', detail: 'Explicit finalQuality / effectiveQuality; replaces the calculated total.' })
        gem.quality = gem.savedFinalQuality
      }
      return { ...gem, levelBonus: gem.level - gem.baseLevel, qualityBonus: gem.quality - gem.baseQuality }
    })
    const result = { ...group, gems }
    return { ...result, gems: gems.map(gem => gem.support ? gem : { ...gem, supportEffects: gemSupportEffects(result, gem, conditions) }) }
  })
}
