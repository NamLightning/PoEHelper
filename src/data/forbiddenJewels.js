export const FORBIDDEN_BASE_CLASS_ASCENDANCIES = {
  Marauder: ['Juggernaut', 'Berserker', 'Chieftain'],
  Ranger: ['Warden', 'Deadeye', 'Pathfinder'],
  Witch: ['Occultist', 'Elementalist', 'Necromancer'],
  Duelist: ['Slayer', 'Gladiator', 'Champion'],
  Templar: ['Inquisitor', 'Hierophant', 'Guardian'],
  Shadow: ['Assassin', 'Trickster', 'Saboteur'],
  Scion: ['Ascendant'],
}

export const FORBIDDEN_BASE_CLASSES = Object.keys(FORBIDDEN_BASE_CLASS_ASCENDANCIES)

export const FORBIDDEN_ASCENDANCY_BASE_CLASS = Object.entries(FORBIDDEN_BASE_CLASS_ASCENDANCIES)
  .reduce((result, [baseClass, ascendancies]) => {
    for (const ascendancy of ascendancies) result[ascendancy] = baseClass
    return result
  }, {})

// Fallback for older poe.ninja payloads that do not include `metadata`.
// The live metadata remains authoritative because Scion reuses the names of
// several original-class ascendancies (for example Assassin and Slayer).
const FORBIDDEN_NODE_FALLBACKS = {
  'Ancestral Fury': ['Berserker', 'Marauder'],
  'Arcane Blessing': ['Hierophant', 'Templar'],
  'Avatar of the Wilds': ['Warden', 'Ranger'],
  'Avidity': ['Deadeye', 'Ranger'],
  'Bane of Legends': ['Slayer', 'Duelist'],
  'Forbidden Power': ['Occultist', 'Witch'],
  'Gathering Winds': ['Deadeye', 'Ranger'],
  'Liege of the Primordial': ['Elementalist', 'Witch'],
  'Oath of Spring': ['Warden', 'Ranger'],
  'Oath of Summer': ['Warden', 'Ranger'],
  'Oath of Winter': ['Warden', 'Ranger'],
  'Unstoppable': ['Juggernaut', 'Marauder'],
  'Vile Bastion': ['Occultist', 'Witch'],
}

// Complete passive-node fallback table. The API metadata wins when available;
// this table covers payloads from older economy endpoints.
const FORBIDDEN_NODE_FALLBACK_GROUPS = {
  Warden: ['Ranger', `Avatar of the Wilds|Enduring Suffusion|Experienced Herbalist|Fury of Nature|Lesson of the Seasons|Mother's Teachings|Oath of Spring|Oath of Summer|Oath of Winter|Seasoned Hunter`],
  Ascendant: ['Scion', 'Assassin|Berserker|Champion|Chieftain|Deadeye|Elementalist|Gladiator|Guardian|Hierophant|Inquisitor|Juggernaut|Necromancer|Occultist|Pathfinder|Saboteur|Slayer|Trickster|Unleashed Potential|Warden'],
  Berserker: ['Marauder', 'Ancestral Fury|Aspect of Carnage|Crave the Slaughter|Defy Pain|Gore Dancer|Indomitable Resolve|Rite of Ruin|War Bringer'],
  Gladiator: ['Duelist', 'Determined Survivor|Gratuitous Violence|Jagged Technique|Measured Retaliation|More Than Skill|War of Attrition|Weapon Master'],
  Necromancer: ['Witch', 'Bone Barrier|Commander of Darkness|Corpse Pact|Essence Glutton|Mindless Aggression|Mistress of Sacrifice|Nine Lives|Plaguebringer|Unnatural Strength'],
  Assassin: ['Shadow', 'Deathmarked|For the Jugular|Infused Toxins|Knife in the Back|Mistwalker|Mystical Infusion|Opportunistic|Shadowed Blood|Toxic Delivery|Unstable Infusion'],
  Occultist: ['Witch', 'Forbidden Power|Frigid Wake|Profane Bloom|Unhallowed Rite|Unholy Authority|Vile Bastion|Void Beacon|Withering Presence'],
  Elementalist: ['Witch', 'Bastion of Elements|Bringer of Ruin|Heart of Destruction|Liege of the Primordial|Mastermind of Discord|Shaper of Flames|Shaper of Storms|Shaper of Winter'],
  Chieftain: ['Marauder', `Hinekora, Death's Fury|Ngamahu, Flame's Advance|Ramako, Sun's Light|Sione, Sun's Roar|Tasalio, Cleansing Water|Tawhoa, Forest's Strength|Tukohama, War's Herald|Valako, Storm's Embrace`],
  Champion: ['Duelist', 'Fatal Flourish|First to Strike, Last to Fall|Fortitude|Inspirational|Master of Metal|Unstoppable Hero|Worthy Causes|Worthy Foe'],
  Guardian: ['Templar', 'Bastion of Hope|Harmony of Purpose|Marshal of Divinity|Radiant Crusade|Radiant Faith|Searing Purity|Time of Need|Unwavering Crusade|Unwavering Faith'],
  Slayer: ['Duelist', 'Bane of Legends|Brutal Fervour|Endless Hunger|Headsman|Impact|Masterful Form|Overwhelm'],
  Juggernaut: ['Marauder', 'Unbreakable|Undeniable|Unflinching|Unrelenting|Unstoppable|Untiring|Unyielding'],
  Saboteur: ['Shadow', 'Bomb Specialist|Born in the Shadows|Calculated Risk|Chain Reaction|Demolitions Specialist|Like Clockwork|Perfect Crime|Pyromaniac|Shrapnel Specialist'],
  Deadeye: ['Ranger', 'Avidity|Endless Munitions|Far Shot|Focal Point|Gathering Winds|Occupying Force|Ricochet|Wind Ward'],
  Hierophant: ['Templar', 'Arcane Blessing|Conviction of Power|Divine Guidance|Illuminated Devotion|Pursuit of Faith|Ritual of Awakening|Sanctuary of Thought|Sign of Purpose'],
  Inquisitor: ['Templar', 'Augury of Penitence|Inevitable Judgement|Instruments of Justice|Instruments of Virtue|Instruments of Zeal|Pious Path|Righteous Providence|Sanctuary'],
  Trickster: ['Shadow', 'Escape Artist|Harness the Void|Heartstopper|One Step Ahead|Polymath|Soul Drinker|Spellbreaker|Swift Killer'],
  Pathfinder: ['Ranger', `Master Alchemist|Master Distiller|Master Surgeon|Master Toxicist|Nature's Adrenaline|Nature's Boon|Nature's Reprisal`],
}
for (const [ascendancy, [baseClass, nodes]] of Object.entries(FORBIDDEN_NODE_FALLBACK_GROUPS)) {
  for (const node of nodes.split('|')) FORBIDDEN_NODE_FALLBACKS[node] = [ascendancy, baseClass]
}

const SCION_PASSIVE_NAMES = new Set([
  'Assassin', 'Berserker', 'Champion', 'Chieftain', 'Deadeye', 'Elementalist',
  'Gladiator', 'Guardian', 'Hierophant', 'Inquisitor', 'Juggernaut', 'Necromancer',
  'Occultist', 'Pathfinder', 'Saboteur', 'Slayer', 'Trickster', 'Warden',
])

export function extractForbiddenNodeName(source) {
  const modifierTexts = (values) => Array.isArray(values)
    ? values.map((value) => typeof value === 'string' ? value : value?.text).filter(Boolean)
    : []
  const candidates = [
    source?.passiveName,
    source?.metadata?.passiveName,
    source?.name,
    ...(Array.isArray(source?.variantTags) ? source.variantTags : []),
    source?.variant,
    ...modifierTexts(source?.explicitModifiers),
    ...modifierTexts(source?.implicitModifiers),
    ...modifierTexts(source?.mutatedModifiers),
    ...(Array.isArray(source?.tradeInfo) ? source.tradeInfo.map((entry) => entry?.mod) : []),
    source?.detailsId,
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    let value = candidate.trim()
    const allocation = value.match(/allocates?\s+(.+?)(?:\s+if\s+you\s+have\s+the\s+matching\s+modifier\s+on\s+forbidden\s+(?:flame|flesh))?$/i)
    if (allocation) value = allocation[1]
    const wasDetailsId = /^forbidden-(?:flame|flesh)-/i.test(value)
    value = value
      .replace(/^forbidden-(?:flame|flesh)-/i, '')
      .replace(/,?\s*forbidden\s+(?:flame|flesh)\s*$/i, '')
      .replace(/^allocates?\s+/i, '')
      .replace(/\s+if\s+you\s+have\s+the\s+matching\s+modifier\s+on\s+forbidden\s+(?:flame|flesh)\s*$/i, '')
      .trim()
    if (wasDetailsId) value = value.replace(/-/g, ' ')
    const match = Object.keys(FORBIDDEN_NODE_FALLBACKS).find((node) => node.toLowerCase() === value.toLowerCase())
    if (match) return match
    const scionName = [...SCION_PASSIVE_NAMES].find((node) => node.toLowerCase() === value.toLowerCase())
    if (scionName) return scionName
  }
  return ''
}

export function normalizeForbiddenJewelsMetadata(source) {
  const metadata = source?.metadata && typeof source.metadata === 'object' ? source.metadata : {}
  const passiveName = (typeof source?.passiveName === 'string' ? source.passiveName.trim() : '')
    || (typeof metadata.passiveName === 'string' ? metadata.passiveName.trim() : '')
    || extractForbiddenNodeName(source)
  const fallback = FORBIDDEN_NODE_FALLBACKS[passiveName]
  const isScionNode = [...SCION_PASSIVE_NAMES].some((node) => node.toLowerCase() === passiveName.toLowerCase())
  const baseClass = (typeof source?.baseClass === 'string' ? source.baseClass.trim() : '')
    || (typeof metadata.baseClass === 'string' ? metadata.baseClass.trim() : '')
    || fallback?.[1]
    || (isScionNode ? 'Scion' : '')
  const ascendancy = (typeof source?.ascendancy === 'string' ? source.ascendancy.trim() : '')
    || (typeof metadata.ascendancy === 'string' ? metadata.ascendancy.trim() : '')
    || fallback?.[0]
    || (isScionNode ? 'Ascendant' : '')
  return {
    baseClass: baseClass || '-',
    ascendancy: ascendancy || '-',
    passiveName,
  }
}

