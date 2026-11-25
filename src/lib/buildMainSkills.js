import { DAMAGE_SKILLS, GEM_TAGS, DAMAGE_SUPPORTS, SKILL_RADII } from './buildGemMetadata.js'

import { calculateGemGroups, gemTags, gemKey, gemMatches, gemModSources, gemMods as mods, gemSupportEffects, auxiliaryGemStats } from './buildGemCalculator.js'
import { GEM_QUALITY_AOE } from './buildGemMetadata.js'
const lookup = (stats, keys) => keys.map(key => stats?.[key]).find(Number.isFinite)

export const withSocketedQuality = calculateGemGroups

export function withPobGemQuality(build) {
  return build.source === 'pob' ? { ...build, skills: withSocketedQuality(build.skills || [], build.equipment || {}, build.jewels || [], build.tree?.allocated || [], build.conditions || {}, build.customMods || []) } : build
}

export function selectedActiveGem(group) {
  const active = group?.gems.filter(gem => !gem.support) || []
  const selected = active[group?.mainActiveSkill || 0]
  return selected && selected.enabled !== false ? selected : active.find(gem => gem.enabled !== false)
}

export function damageSummary(stats) {
  const hit = lookup(stats, ['TotalDPS'])
  const dotAliases = ['TotalDot', 'TotalDotDPS', 'DotDPS']
  const aggregateDot = dotAliases.map(key => stats[key]).find(value => Number.isFinite(value) && value > 0) ?? lookup(stats, dotAliases)
  const componentDot = ['BurnDPS', 'BleedDPS', 'PoisonDPS'].reduce((total, key) => total + Math.max(0, stats[key] || 0), 0)
  const dot = aggregateDot > 0 ? aggregateDot : componentDot || aggregateDot
  const dotOnly = hit === 0 && dot > 0
  const totals = ['FullDPS', 'CombinedDPS', 'TotalDPS']
  return { dotOnly, dot, total: dotOnly ? dot : totals.map(key => stats[key]).find(value => Number.isFinite(value) && value > 0) ?? lookup(stats, totals) }
}

export function skillAreaModifiers(build, gem, group) {
  let parsedIncrease = 0, moreLess = 1
  const matches = []
  const sources = gemModSources(build.equipment, build.jewels, build.tree?.allocated, build.customMods)
  for (const source of sources) {
    const match = source.line.match(/^(\d+(?:\.\d+)?)% (increased|reduced|more|less) Area of Effect(?: per ([A-Za-z]+))?$/i)
    if (!match) continue
    const count = match[3] ? build.conditions?.[`multiplier:${match[3]}`] ?? build.conditions?.[match[3]] : 1
    if (!Number.isFinite(count)) continue
    const value = Number(match[1]) * Math.max(0, count), operation = match[2].toLowerCase()
    matches.push({ ...source, scope: 'global', operation, value })
    if (operation === 'increased' || operation === 'reduced') parsedIncrease += value * (operation === 'reduced' ? -1 : 1)
    else moreLess *= Math.max(0, 1 + value / 100 * (operation === 'less' ? -1 : 1))
  }
  const linked = group || build.skills?.find(group => group.gems.includes(gem))
  for (const line of mods(build.equipment?.[linked?.slot])) {
    const match = line.match(/^(\d+(?:\.\d+)?)% (increased|reduced) Area of Effect of Socketed (?:(.*?) )?Gems$/i)
    if (match && !gem.isGranted && gemMatches(gem, match[3])) {
      const value = Number(match[1]), operation = match[2].toLowerCase()
      parsedIncrease += value * (operation === 'reduced' ? -1 : 1)
      matches.push({ label: linked.slot, category: 'ITEM', line, scope: 'local', operation, value })
    }
  }
  const effects = gemSupportEffects(linked, gem, build.conditions || {}).effects
  const qualityArea = (GEM_QUALITY_AOE[gemKey(gem)] || 0) * (gem.quality || 0)
  parsedIncrease += qualityArea
  if (qualityArea) matches.push({ label: gem.name, category: 'SKILL', scope: 'quality', operation: 'increased', value: qualityArea })
  for (const effect of effects.filter(effect => effect.stat === 'area')) {
    matches.push({ label: effect.source, category: 'SUPPORT', scope: effect.isItemSupport ? 'itemSupport' : 'support', operation: effect.type, value: effect.value })
    if (effect.type === 'INC') parsedIncrease += effect.value
    if (effect.type === 'MORE') moreLess *= Math.max(0, 1 + effect.value / 100)
  }
  return { totalIncreasedAoE: parsedIncrease, moreLessAreaMultiplier: moreLess, matches }
}

export function skillRadius(build, gem, stats, group) {
  if (!gemTags(gem).has('area')) return null
  const saved = lookup(stats, ['AreaOfEffectRadius', 'Radius'])
  if (saved !== undefined) return { value: saved, estimated: false }
  const data = SKILL_RADII[gemKey(gem)]
  if (!data) return null
  const { totalIncreasedAoE: parsedIncrease, moreLessAreaMultiplier: moreLess } = skillAreaModifiers(build, gem, group)
  // This is the mod-based estimate. Intermediate PoB multipliers must not hide
  // item/jewel contributions. Only a saved final radius is authoritative above.
  const areaMultiplier = Math.max(0, 1 + parsedIncrease / 100) * moreLess
  const base = data.levels[Math.max(0, Math.min(data.levels.length - 1, Math.floor(gem.level || 1) - 1))] + (gem.quality || 0) * data.qualityRadius
  return { value: +(base * Math.sqrt(Math.max(0.01, areaMultiplier))).toFixed(1), estimated: true }
}

function isUtility(gem) {
  const tags = gemTags(gem)
  return ['aura', 'curse', 'guard', 'travel', 'blink'].some(tag => tags.has(tag)) || Boolean(GEM_TAGS[gemKey(gem)] && !DAMAGE_SKILLS.has(gemKey(gem)))
}

export function mainSkillEntries(build) {
  if (!['pob', 'ggg'].includes(build?.source)) return []
  const primaryIndex = build.source === 'ggg' ? (build.skills || []).map((group, index) => ({ group, index })).filter(({ group }) => group.enabled !== false && group.gems.some(gem => !gem.support && gem.enabled !== false && DAMAGE_SKILLS.has(gemKey(gem)) && !isUtility(gem))).sort((a, b) => b.group.gems.length - a.group.gems.length)[0]?.index : build.mainSkill
  const entries = []
  for (const [index, group] of (build.skills || []).entries()) {
    if (group.enabled === false) continue
    const primary = index === primaryIndex
    const enabled = group.gems.filter(gem => gem.enabled !== false)
    const supports = enabled.filter(gem => gem.support)
    const active = enabled.filter(gem => !gem.support)
    const damageSupports = supports.filter(gem => DAMAGE_SUPPORTS.has(gemKey(gem)))
    if (!primary && !group.includeInFullDPS && !(enabled.length >= 4 && damageSupports.length >= 2)) continue
    const gems = primary ? [selectedActiveGem(group)].filter(Boolean) : active.filter(gem => DAMAGE_SKILLS.has(gemKey(gem)))
    for (const gem of gems.filter(gem => !isUtility(gem))) {
      const stats = build.source === 'ggg' ? {} : primary ? build.stats : gem === selectedActiveGem(group) ? group.stats || {} : {}
      const damage = damageSummary(stats)
      entries.push({ gem, group, index, primary, supports, stats, damage, auxiliary: auxiliaryGemStats(gem, group, build.conditions || {}), radius: skillRadius(build, gem, stats, group), hasDps: Number.isFinite(damage.total) || Number.isFinite(damage.dot) })
    }
  }
  return entries.sort((a, b) => Number(b.primary) - Number(a.primary))
}
