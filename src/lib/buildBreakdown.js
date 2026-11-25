export const INSPECTABLE_STATS = {
  FireResist: ['Fire Resistance', '%'], ColdResist: ['Cold Resistance', '%'], LightningResist: ['Lightning Resistance', '%'], ChaosResist: ['Chaos Resistance', '%'],
  Life: ['Life', ''], EnergyShield: ['Energy Shield', ''], Mana: ['Mana', ''], Armour: ['Armour', ''], Evasion: ['Evasion', ''],
  BlockChance: ['Block', '%'], SpellBlockChance: ['Spell Block', '%'], SpellSuppressionChance: ['Spell Suppression', '%'],
  EnergyShieldRecharge: ['ES Recharge', '/s'], LifeRegen: ['Life Regen', '/s'], ManaRegen: ['Mana Regen', '/s'],
  ...Object.fromEntries(['Fire', 'Cold', 'Lightning', 'Chaos'].map(element => [`PhysicalDamageTakenAs${element}`, [`Physical taken as ${element}`, '%']])),
}
export const canonicalStat = (key) => ({ NetLifeRegen: 'LifeRegen', LifeRegenRecovery: 'LifeRegen', NetManaRegen: 'ManaRegen', ManaRegenRecovery: 'ManaRegen', 'Spec:Life': 'Life', UnreservedMana: 'Mana' })[key] || key
export const baseSource = (label) => ({ label, category: 'BASE' })
export const itemSource = (item) => ({ label: [item.name, item.baseType || item.typeLine].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(', ') || 'Equipment', category: 'ITEM', rarity: item.frameType })
export const nodeSource = (node) => ({ label: node.name || `Passive ${node.id || ''}`, category: node.kind === 'Ascendancy' || /^(Tasalio|Valako),/.test(node.name || '') ? 'ASCENDANCY' : 'TREE' })
export const skillSource = (skill) => ({ label: skill.isGranted ? `${skill.name} (${skill.grantedBy || skill.sourceItemName})` : `${skill.name} Lv ${skill.level}${skill.grantedBy ? ` (Granted by ${skill.grantedBy})` : ''}`, category: 'SKILL' })
export function recordStat(trace, key, source, section, value, unit = '', detail) {
  if (!trace || !Number.isFinite(value)) return
  ;(trace[canonicalStat(key)] ||= []).push({ ...source, section, value, unit, ...(detail ? { detail } : {}) })
}

export function resistanceMod(line) {
  if (typeof line !== 'string') return null
  const match = line.match(/^([+-]?\d+(?:\.\d+)?)% to (.+) Resistances?$/i)
  if (!match) return null
  const target = match[2].toLowerCase(), maximum = /\bmaximum\b/.test(target)
  const names = target.replace(/\bmaximum\s*/g, '').trim()
  let elements
  if (names === 'all elemental') elements = ['Fire', 'Cold', 'Lightning']
  else if (names === 'all') elements = ['Fire', 'Cold', 'Lightning', 'Chaos']
  else {
    const tokens = names.split(/\s+and\s+|,\s*/)
    if (!tokens.length || tokens.some((token) => !['fire', 'cold', 'lightning', 'chaos'].includes(token))) return null
    elements = tokens.map((token) => token[0].toUpperCase() + token.slice(1))
  }
  return { value: Number(match[1]), maximum, elements }
}

export function snapshotBreakdown(build, contributions = build.breakdown || {}) {
  const trace = Object.fromEntries(Object.entries(contributions).map(([key, rows]) => [key, rows.filter(row => row.section !== 'Snapshot' && row.category !== 'POB_XML')]))
  const keys = build.savedStatKeys || Object.keys(build.stats)
  for (const [canonical, [, unit]] of Object.entries(INSPECTABLE_STATS)) {
    const aliases = canonical === 'LifeRegen' ? ['NetLifeRegen', 'LifeRegenRecovery', 'LifeRegen']
      : canonical === 'ManaRegen' ? ['NetManaRegen', 'ManaRegenRecovery', 'ManaRegen']
        : canonical === 'BlockChance' ? ['BlockChance', 'EffectiveBlockChance']
          : canonical === 'SpellBlockChance' ? ['SpellBlockChance', 'EffectiveSpellBlockChance']
            : canonical === 'Life' ? ['Life', 'Spec:Life'] : canonical === 'Mana' ? ['Mana', 'UnreservedMana']
              : canonical === 'SpellSuppressionChance' ? ['SpellSuppressionChance', 'EffectiveSpellSuppressionChance', 'SuppressionChance']
                : canonical.endsWith('Resist') ? [canonical, `Effective${canonical}`, `Effective${canonical}ance`] : [canonical]
    const savedKey = aliases.flatMap((alias) => keys.filter((key) => key.toLowerCase() === alias.toLowerCase())).find((key) => Number.isFinite(build.stats[key]))
    const value = savedKey ? build.stats[savedKey] : build.stats[canonical]
    const summary = {}
    recordStat(summary, canonical, { label: savedKey ? `PlayerStat: ${savedKey}` : 'Calculated from XML mods (not an exported PlayerStat)', category: savedKey ? 'POB_XML' : 'BASE' }, 'Snapshot', value, unit)
    trace[canonical] = [...(summary[canonical] || []), ...(trace[canonical] || [])]
  }
  // Linked recovery is authoritative and is applied after XML parsing.
  for (const [key, value] of Object.entries(build.recovery || {})) {
    const canonical = canonicalStat(key)
    if (!INSPECTABLE_STATS[canonical]) continue
    trace[canonical] = (trace[canonical] || []).filter(row => row.section !== 'Snapshot')
    const summary = {}
    recordStat(summary, canonical, { label: 'pobb.in displayed Recovery', category: 'POB_XML' }, 'Snapshot', value, '/s')
    trace[canonical].unshift(...(summary[canonical] || []))
  }
  return trace
}
