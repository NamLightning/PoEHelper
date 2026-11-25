import { AURA_DATA } from './buildAuraData.js'

const auraNames = new Set(Object.keys(AURA_DATA).filter(name => !['Tempest Shield', 'Arctic Armour'].includes(name)))

// GGG does not expose live reservation toggles. Use the same enabled, self-affecting
// skill selection as the aura estimator; aspects, heralds and ordinary buffs are not auras.
export function playerAuraCount(skills) {
  return new Set(skills.filter(skill => skill.enabled !== false && skill.appliesToSelf !== false && !skill.support &&
    (auraNames.has(skill.name) || skill.skillTags?.includes('Aura') && !skill.skillTags.some(tag => ['Minion', 'Herald', 'Curse'].includes(tag))))
    .map(skill => skill.name.toLowerCase())).size
}

function conditionValue(text, context) {
  if (/^you (?:have|are affected by) (?:an|at least one) aura(?: affecting you)?$/i.test(text)) return context.auraCount > 0
  const count = text.match(/^you have (?:at least )?(\d+) auras?(?: affecting you)?$/i)
  if (count) return context.auraCount >= Number(count[1])
  if (/^(?:you (?:have a shield equipped|are holding a shield)|holding a shield)$/i.test(text)) return context.hasShield
  return undefined
}

export function resolvePassiveConditions(nodes, skills, items) {
  const auraCount = playerAuraCount(skills)
  const context = { auraCount, hasShield: items.some(item => ['Offhand', 'Offhand2'].includes(item.inventoryId) &&
    (/shield|buckler/i.test(`${item.baseType || ''} ${item.typeLine || ''}`) || item.properties?.some(prop => /^(?:Chance to Block|Block Chance)$/i.test(prop.name)))) }
  const notes = []
  const resolved = nodes.map(node => ({ ...node, stats: (node.stats || []).flatMap(original => {
    if (typeof original !== 'string') return []
    let line = original.trim()
    const prefix = line.match(/^While (.+?),\s*(.+)$/i)
    const suffix = line.match(/^(.+?) while (.+)$/i)
    const conditional = prefix || (suffix && [suffix[0], suffix[2], suffix[1]])
    if (conditional) {
      const active = conditionValue(conditional[1], context)
      notes.push({ node: node.name, text: original, status: active === undefined ? 'unknown' : active ? 'applied' : 'inactive' })
      if (!active) return []
      line = conditional[2]
    }
    const perAura = line.match(/^Auras from your Skills grant (.+?) to you and (?:nearby )?Allies$/i)
    if (perAura) {
      const amount = perAura[1].match(/^([+-]?\d+(?:\.\d+)?)(% .+)$/)
      if (!amount) return []
      line = `${Number(amount[1]) * auraCount}${amount[2]}`
    }
    line = line.replace(/^(?:You and nearby Allies|You and Allies within \d+(?:\.\d+)? metres|You) (?:have|gain) /i, '')
      .replace(/^([+-]?\d+(?:\.\d+)?% to )Elemental Resistances$/i, '$1all Elemental Resistances')
      .replace(/^\+?(\d+(?:\.\d+)?)% (?:additional )?Spell Block Chance$/i, '$1% chance to Block Spell Damage')
      .replace(/^\+?(\d+(?:\.\d+)?)% (?:additional )?Block Chance$/i, '$1% chance to Block Attack Damage')
      .replace(/^\+?(\d+(?:\.\d+)?)% Spell Suppression Chance$/i, '$1% chance to Suppress Spell Damage')
      .replace(/^\+?(\d+(?:\.\d+)?)% (?:of (?:maximum )?)?Life (?:Regeneration|Regenerated per second)$/i, 'Regenerate $1% of Life per second')
      .replace(/^(?:You and nearby Allies|You and Allies within \d+(?:\.\d+)? metres|You) Regenerate /i, 'Regenerate ')
      .replace(/^([+-]?\d+(?:\.\d+)?) (Armour|Evasion(?: Rating)?|(?:maximum )?Energy Shield)$/i, '$1 to $2')
    return [line]
  }) }))
  return { nodes: resolved, notes, auraCount }
}
