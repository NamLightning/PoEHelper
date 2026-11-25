// Imbued stat IDs are supplied per item by poe.ninja's itemoverview `tradeInfo`.
// They are hashes, so hardcoding guessed IDs would create invalid Trade queries.
// This module keeps an in-memory name -> verified ID map populated only from
// those authoritative item records; it never calls the PoE Trade stats API.
export const IMBUED_STAT_MAP = Object.freeze({
  lifetap: 'imbued.pseudo_built_in_support|3918067187',
  inspiration: 'imbued.pseudo_built_in_support|282207976',
  efficacy: 'imbued.pseudo_built_in_support|830701349',
  'culling strike': 'imbued.pseudo_built_in_support|3346867338',
  'increased area of effect': 'imbued.pseudo_built_in_support|1466145569',
  'controlled destruction': 'imbued.pseudo_built_in_support|1716224442',
  'increased critical strikes': 'imbued.pseudo_built_in_support|3398161162',
  'power charge on critical': 'imbued.pseudo_built_in_support|3106835412',
  'item rarity': 'imbued.pseudo_built_in_support|1787283513',
  'increased critical damage': 'imbued.pseudo_built_in_support|191534163',
  'more duration': 'imbued.pseudo_built_in_support|48249346',
  'elemental focus': 'imbued.pseudo_built_in_support|770262833',
  'greater multiple projectiles': 'imbued.pseudo_built_in_support|3950169394',
  'concentrated effect': 'imbued.pseudo_built_in_support|2571880157',
  'energy leech': 'imbued.pseudo_built_in_support|1237276220',
  devour: 'imbued.pseudo_built_in_support|2451084442',
  hypothermia: 'imbued.pseudo_built_in_support|114272251',
  'faster attacks': 'imbued.pseudo_built_in_support|262345857',
  combustion: 'imbued.pseudo_built_in_support|3488848533',
  'lightning penetration': 'imbued.pseudo_built_in_support|3248757232',
  'cast while channelling': 'imbued.pseudo_built_in_support|1089139173',
  'ignite proliferation': 'imbued.pseudo_built_in_support|2520596918',
  'cold penetration': 'imbued.pseudo_built_in_support|1660360583',
  'life leech': 'imbued.pseudo_built_in_support|2811214937',
  'added fire damage': 'imbued.pseudo_built_in_support|2554120916',
  'cast on melee kill': 'imbued.pseudo_built_in_support|3582467606',
  'cast on critical strike': 'imbued.pseudo_built_in_support|826020281',
  'void manipulation': 'imbued.pseudo_built_in_support|538077215',
  'critical strike affliction': 'imbued.pseudo_built_in_support|2533131557',
  'physical to lightning': 'imbued.pseudo_built_in_support|817697514',
  'chance to poison': 'imbued.pseudo_built_in_support|2392994107',
  'ice bite': 'imbued.pseudo_built_in_support|3232085103',
  'summon phantasm': 'imbued.pseudo_built_in_support|21787019',
  immolate: 'imbued.pseudo_built_in_support|4236314787',
  'added lightning damage': 'imbued.pseudo_built_in_support|3321425861',
  'unbound ailments': 'imbued.pseudo_built_in_support|796460095',
  'faster projectiles': 'imbued.pseudo_built_in_support|1049046441',
  bonechill: 'imbued.pseudo_built_in_support|2451064053',
  'deadly ailments': 'imbued.pseudo_built_in_support|3092222470',
  sadism: 'imbued.pseudo_built_in_support|1591272514',
  innervate: 'imbued.pseudo_built_in_support|110946631',
  'elemental proliferation': 'imbued.pseudo_built_in_support|1666671509',
  'cold to fire': 'imbued.pseudo_built_in_support|3990013913',
  overcharge: 'imbued.pseudo_built_in_support|1961131194',
  blind: 'imbued.pseudo_built_in_support|1221753837',
  volatility: 'imbued.pseudo_built_in_support|1677409971',
  'point blank': 'imbued.pseudo_built_in_support|910857224',
  'arcane surge': 'imbued.pseudo_built_in_support|2744614343',
  brutality: 'imbued.pseudo_built_in_support|1281012522',
  'life gain on hit': 'imbued.pseudo_built_in_support|763543857',
  'slower projectiles': 'imbued.pseudo_built_in_support|663883068',
  'burning damage': 'imbued.pseudo_built_in_support|19679479',
  'swift affliction': 'imbued.pseudo_built_in_support|2290801007',
  'chance to flee': 'imbued.pseudo_built_in_support|2632782139',
  chain: 'imbued.pseudo_built_in_support|2300092378',
  'added chaos damage': 'imbued.pseudo_built_in_support|1826945816',
  hextouch: 'imbued.pseudo_built_in_support|2883596469',
  'additional accuracy': 'imbued.pseudo_built_in_support|3356250656',
  'mana leech': 'imbued.pseudo_built_in_support|1236685577',
  'fire penetration': 'imbued.pseudo_built_in_support|3376396961',
  cruelty: 'imbued.pseudo_built_in_support|1246588902',
  'greater volley': 'imbued.pseudo_built_in_support|1088438448',
  fork: 'imbued.pseudo_built_in_support|1584251003',
  decay: 'imbued.pseudo_built_in_support|4149556221',
  trinity: 'imbued.pseudo_built_in_support|1826317887',
  'added cold damage': 'imbued.pseudo_built_in_support|2368767632',
  'returning projectiles': 'imbued.pseudo_built_in_support|2342654864',
  'cast when stunned': 'imbued.pseudo_built_in_support|3311033584',
  'vile toxins': 'imbued.pseudo_built_in_support|3064536173',
  pulverise: 'imbued.pseudo_built_in_support|687583659',
  'multiple projectiles': 'imbued.pseudo_built_in_support|89542028',
  momentum: 'imbued.pseudo_built_in_support|3400389576',
  'damage on full life': 'imbued.pseudo_built_in_support|2721225790',
  knockback: 'imbued.pseudo_built_in_support|2003102433',
  multistrike: 'imbued.pseudo_built_in_support|646275157',
  'elemental damage with attacks': 'imbued.pseudo_built_in_support|638399684',
  blastchain: 'imbued.pseudo_built_in_support|1874477201',
  'less duration': 'imbued.pseudo_built_in_support|4224789409',
  impale: 'imbued.pseudo_built_in_support|578583560',
  'vicious projectiles': 'imbued.pseudo_built_in_support|2679148081',
  pierce: 'imbued.pseudo_built_in_support|4016557208',
  'spell totem': 'imbued.pseudo_built_in_support|1342846117',
  hallow: 'imbued.pseudo_built_in_support|22608709',
  'spell echo': 'imbued.pseudo_built_in_support|3076322868',
  'withering touch': 'imbued.pseudo_built_in_support|1337767102',
  'endurance charge on melee stun': 'imbued.pseudo_built_in_support|1251682852',
  'high-impact mine': 'imbued.pseudo_built_in_support|3520866002',
  excommunicate: 'imbued.pseudo_built_in_support|2952549466',
  fortify: 'imbued.pseudo_built_in_support|4141042029',
  maim: 'imbued.pseudo_built_in_support|86502960',
  rage: 'imbued.pseudo_built_in_support|973619657',
  rupture: 'imbued.pseudo_built_in_support|1235991958',
  trap: 'imbued.pseudo_built_in_support|865602902',
  stun: 'imbued.pseudo_built_in_support|3378399298',
  bloodthirst: 'imbued.pseudo_built_in_support|3290360578',
  'melee physical damage': 'imbued.pseudo_built_in_support|3626246352',
  'faster casting': 'imbued.pseudo_built_in_support|1255849548',
  spellblade: 'imbued.pseudo_built_in_support|2139519964',
  unleash: 'imbued.pseudo_built_in_support|2395805465',
  volley: 'imbued.pseudo_built_in_support|1041958248',
  'chance to bleed': 'imbued.pseudo_built_in_support|3078658653',
  'iron will': 'imbued.pseudo_built_in_support|3373854464',
  overexertion: 'imbued.pseudo_built_in_support|3676897366',
  ruthless: 'imbued.pseudo_built_in_support|4081846217',
  'controlled blaze': 'imbued.pseudo_built_in_support|3498757786',
  'melee splash': 'imbued.pseudo_built_in_support|2277529223',
  intensify: 'imbued.pseudo_built_in_support|1796692633',
  'second wind': 'imbued.pseudo_built_in_support|3226210172',
  bloodlust: 'imbued.pseudo_built_in_support|2069099215',
  'ancestral call': 'imbued.pseudo_built_in_support|4269882850',
  trauma: 'imbued.pseudo_built_in_support|2380689033',
  barrage: 'imbued.pseudo_built_in_support|1190052435',
  archmage: 'imbued.pseudo_built_in_support|1887128856',
  arrogance: 'imbued.pseudo_built_in_support|4029843952',
  'iron grip': 'imbued.pseudo_built_in_support|1332031472',
  sacrifice: 'imbued.pseudo_built_in_support|2276372010',
  behead: 'imbued.pseudo_built_in_support|3471518268',
  'minion speed': 'imbued.pseudo_built_in_support|695144847',
  'minion damage': 'imbued.pseudo_built_in_support|344293939',
  'locus mine': 'imbued.pseudo_built_in_support|3320826005',
  'mirage archer': 'imbued.pseudo_built_in_support|683812711',
  'manaforged arrows': 'imbued.pseudo_built_in_support|2816032231',
  exemplar: 'imbued.pseudo_built_in_support|2763365156',
  'mark on hit': 'imbued.pseudo_built_in_support|3719049861',
  'infused channelling': 'imbued.pseudo_built_in_support|3128644425',
  'cast on death': 'imbued.pseudo_built_in_support|2894953063',
  'eternal blessing': 'imbued.pseudo_built_in_support|1371874082',
  'close combat': 'imbued.pseudo_built_in_support|947240231',
  'infernal legion': 'imbued.pseudo_built_in_support|4159921771',
  pinpoint: 'imbued.pseudo_built_in_support|734543851',
  'feeding frenzy': 'imbued.pseudo_built_in_support|3519811388',
  'arrow nova': 'imbued.pseudo_built_in_support|2067275224',
  "guardian's blessing": 'imbued.pseudo_built_in_support|71388113',
  'meat shield': 'imbued.pseudo_built_in_support|3535984827',
  'elemental army': 'imbued.pseudo_built_in_support|3849702703',
  'fresh meat': 'imbued.pseudo_built_in_support|3131076360',
  generosity: 'imbued.pseudo_built_in_support|1892604624',
  nightblade: 'imbued.pseudo_built_in_support|3345636521',
  'minion life': 'imbued.pseudo_built_in_support|1181489488',
  'ballista totem': 'imbued.pseudo_built_in_support|379055421',
  'fist of war': 'imbued.pseudo_built_in_support|172023623',
  'spell cascade': 'imbued.pseudo_built_in_support|3802739165',
  'cursed ground': 'imbued.pseudo_built_in_support|2011379008',
  'swift assembly': 'imbued.pseudo_built_in_support|3993822420',
  'blessed call': 'imbued.pseudo_built_in_support|3277324447',
  blasphemy: 'imbued.pseudo_built_in_support|1496371093',
  'corrupting cry': 'imbued.pseudo_built_in_support|2972801927',
  'advanced traps': 'imbued.pseudo_built_in_support|2633900295',
  swiftbrand: 'imbued.pseudo_built_in_support|1597853541',
  'focused channelling': 'imbued.pseudo_built_in_support|544627868',
  'trap and mine damage': 'imbued.pseudo_built_in_support|2222630080',
  'multiple traps': 'imbued.pseudo_built_in_support|3313613094',
  'urgent orders': 'imbued.pseudo_built_in_support|3288860132',
  minefield: 'imbued.pseudo_built_in_support|3322685172',
  'hex bloom': 'imbued.pseudo_built_in_support|318949620',
  'multiple totems': 'imbued.pseudo_built_in_support|33708788',
  'cluster traps': 'imbued.pseudo_built_in_support|2007342753',
  'charged mines': 'imbued.pseudo_built_in_support|619178891',
  'charged traps': 'imbued.pseudo_built_in_support|1587233226',
  destitution: 'imbued.pseudo_built_in_support|2208650143',
  'focused ballista': 'imbued.pseudo_built_in_support|3255037645',
  'expert retaliation': 'imbued.pseudo_built_in_support|2266469129',
  'frigid bond': 'imbued.pseudo_built_in_support|2096466553',
  lethargy: 'imbued.pseudo_built_in_support|3435483009',
  encumbrance: 'imbued.pseudo_built_in_support|3989015253',
  constriction: 'imbued.pseudo_built_in_support|2642139747',
  taxation: 'imbued.pseudo_built_in_support|2082748837',
  mediocrity: 'imbued.pseudo_built_in_support|3186808105',
  disempower: 'imbued.pseudo_built_in_support|3192305202',
  diminishment: 'imbued.pseudo_built_in_support|1452519409',
  nullification: 'imbued.pseudo_built_in_support|601991273',
  impotence: 'imbued.pseudo_built_in_support|3674002686',
  'cast when damage taken': 'imbued.pseudo_built_in_support|2842604691',
  penance: 'imbued.pseudo_built_in_support|3870057454',
  poverty: 'imbued.pseudo_built_in_support|2327564307',
})

export function normalizeImbuedSupportName(value) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const supported = text.match(/(?:skills?\s+are\s+)?supported\s+by\s+level\s+(?:#|\d+)\s+(.+)$/i)
  return (supported?.[1] || text)
    .replace(/[.,:;]+$/g, '')
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function getCandidateNames(item) {
  return [
    ...(typeof item?.name === 'string' ? item.name.split(',').slice(1) : []),
    item?.variant,
    item?.details,
    item?.baseType,
    ...(Array.isArray(item?.variantTags) ? item.variantTags : [item?.variantTags]),
    ...(Array.isArray(item?.explicitModifiers) ? item.explicitModifiers : [item?.explicitModifiers]),
    ...(Array.isArray(item?.implicitModifiers) ? item.implicitModifiers : [item?.implicitModifiers]),
  ]
    .map((value) => typeof value === 'string' ? value : value?.text)
    .filter((value) => typeof value === 'string' && value.trim())
}

export function getImbuedStatId(item) {
  const tradeInfo = Array.isArray(item?.tradeInfo) ? item.tradeInfo : []
  const candidateNames = getCandidateNames(item)
    .map(normalizeImbuedSupportName)
    .filter(Boolean)

  for (const entry of tradeInfo) {
    const id = typeof entry?.mod === 'string' ? entry.mod : entry?.id
    if (!/^imbued\.stat_/i.test(id || '')) continue
    const name = candidateNames.find((candidate) => candidate)
    return { id, name: name || '' }
  }

  for (const name of candidateNames) {
    const id = IMBUED_STAT_MAP[name]
    if (id) return { id, name }
  }
  return null
}

export async function getImbuedStatMap(item) {
  getImbuedStatId(item)
  return IMBUED_STAT_MAP
}
