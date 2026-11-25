import test from 'node:test'
import assert from 'node:assert/strict'
import { fromGgg, completePobStats, mergeAllocatedPassives, withPobbinRecovery } from './buildCodec.js'
import { INSPECTABLE_STATS, resistanceMod } from './buildBreakdown.js'

const sum = (rows, section) => rows.filter(row => row.section === section).reduce((total, row) => total + row.value, 0)
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`)

test('only self resistance modifiers are accepted; enemy, penetration and conditional text never leaks into player stats', () => {
  for (const text of ['Enemies have -40% to Fire Resistance', 'Nearby Enemies have -20% to all Elemental Resistances', 'Penetrates 15% Fire Resistance', 'Damage Penetrates 10% Fire Resistance', '-10% to Enemy Fire Resistance', '-30% to Fire Resistance while on Low Life', 'Exposure applies -15% to Fire Resistance']) assert.equal(resistanceMod(text), null, text)
  assert.deepEqual(resistanceMod('-10% to Fire Resistance'), { value: -10, maximum: false, elements: ['Fire'] })
  assert.deepEqual(resistanceMod('+2% to all maximum Elemental Resistances'), { value: 2, maximum: true, elements: ['Fire', 'Cold', 'Lightning'] })
  const build = fromGgg({ level: 84 }, { items: [{ inventoryId: 'BodyArmour', name: 'Player armour', explicitMods: ['+100% to Fire Resistance', '-10% to Fire Resistance', '+5% to all Resistances', 'Enemies have -40% to Fire Resistance', 'Penetrates 15% Fire Resistance'] }], passives: {} }, { nodes: [] })
  assert.equal(build.stats.FireResist, 35)
  assert.equal(sum(build.breakdown.FireResist, 'Base / Flat'), 35)
  assert.ok(!build.breakdown.FireResist.some(row => /Enemies|Penetrates/.test(row.detail || '')))
})

test('resistance provenance reconciles item, jewel, allocated node, aura, ascendancy, penalty and maximum cap', () => {
  const nodes = [{ id: '1', name: 'Prismatic Skin', stats: ['+2% to all maximum Elemental Resistances'] }, { id: '2', name: 'Tasalio, Cleansing Water', kind: 'Ascendancy', stats: [] }, { id: '3', name: "Valako, Storm's Embrace", kind: 'Ascendancy', stats: [] }, { id: '4', name: 'Fire Resistance', stats: ['+20% to Fire Resistance'] }]
  const build = fromGgg({ level: 84 }, { items: [{ inventoryId: 'BodyArmour', name: 'Cloak of Flame', baseType: "Scholar's Robe", frameType: 3, explicitMods: ['+62% to Fire Resistance'] }, { inventoryId: 'Amulet', name: 'Tear of Purity', frameType: 3, explicitMods: ['Grants Level 10 Purity of Elements Skill'] }], passives: { hashes: [1, 2, 3, 4], items: [{ id: 'jewel', inventoryId: 'PassiveJewels', name: 'Jewel', explicitMods: ['+12% to Fire Resistance'] }] } }, { nodes })
  for (const element of ['Fire', 'Cold', 'Lightning', 'Chaos']) {
    const key = `${element}Resist`, rows = build.breakdown[key]
    assert.equal(sum(rows, 'Base / Flat') + sum(rows, 'Conversion'), build.stats[`${key}Total`])
    assert.equal(sum(rows, 'Maximum Cap'), build.stats[`${key}Max`])
    assert.equal(build.stats[key], Math.min(build.stats[`${key}Total`], build.stats[`${key}Max`]))
  }
  const fire = build.breakdown.FireResist
  assert.ok(fire.some(row => row.label === "Cloak of Flame, Scholar's Robe" && row.category === 'ITEM' && row.value === 62 && row.rarity === 3))
  assert.ok(fire.some(row => row.category === 'TREE' && row.value === 20))
  assert.ok(fire.some(row => row.category === 'SKILL' && row.label === 'Purity of Elements (Tear of Purity)'))
  assert.ok(build.breakdown.ColdResist.some(row => row.category === 'ASCENDANCY' && row.section === 'Conversion'))
  assert.equal(JSON.stringify(build).includes('POESESSID'), false)
})

test('core traces reproduce flat, global increases and separate more multipliers without counting local armour twice', () => {
  const build = fromGgg({ name: 'Defences', level: 80 }, { items: [{ inventoryId: 'BodyArmour', name: 'Local armour', properties: [{ name: 'Armour', values: [['1000', 0]] }, { name: 'Chance to Block', values: [['25%', 0]] }], explicitMods: ['+100 to maximum Life', '100% increased Armour', 'Regenerate 20 Life per second', 'Regenerate 1% of Life per second', '20% increased Energy Shield Recharge Rate'] }, { inventoryId: 'Amulet', name: 'Aura source', explicitMods: ['Grants Level 20 Determination Skill', 'Grants Level 20 Discipline Skill', 'Grants Level 20 Vitality Skill', 'Grants Level 20 Clarity Skill', 'Grants Level 20 Tempest Shield Skill'] }], passives: {} }, { nodes: [{ name: 'Global defence', stats: ['20% increased Armour', '50% increased maximum Life'] }] })
  for (const key of Object.keys(INSPECTABLE_STATS)) assert.ok(Array.isArray(build.breakdown[key]), key)
  for (const key of ['Life', 'Mana', 'EnergyShield', 'Armour', 'Evasion']) {
    const rows = build.breakdown[key]
    const increased = Math.floor(sum(rows, 'Base / Flat') * (1 + sum(rows, 'Increased / Reduced') / 100) + 1e-8)
    const more = rows.filter(row => row.section === 'More / Less').reduce((product, row) => product * (1 + row.value / 100), 1)
    assert.equal(Math.floor(increased * more), build.stats[key], key)
  }
  assert.ok(!build.breakdown.Armour.some(row => row.detail === '100% increased Armour'))
  close(sum(build.breakdown.LifeRegen, 'Base / Flat'), build.stats.LifeRegen)
  const recharge = build.breakdown.EnergyShieldRecharge
  close(sum(recharge, 'Base / Flat') * (1 + sum(recharge, 'Increased / Reduced') / 100), build.stats.EnergyShieldRecharge)
  close(sum(build.breakdown.SpellBlockChance, 'Base / Flat'), build.stats.SpellBlockChance)
})

test('PoB inspector uses exact saved values through metadata updates and linked recovery remains authoritative', () => {
  const saved = { FireResist: 85, FireResistOverCap: 166, Life: 3344, Armour: 12345, NetLifeRegen: 1198.62, NetManaRegen: 15.1 }
  let build = completePobStats({ source: 'pob', stats: saved, equipment: { Amulet: { explicitMods: ['+999% to Fire Resistance', 'Grants Level 30 Determination Skill'] } }, tree: { nodes: ['1'], allocated: [] } })
  build = completePobStats(mergeAllocatedPassives(build, { nodes: [{ id: '1', name: 'Fire Resistance', stats: ['+999% to Fire Resistance'] }] }))
  assert.equal(build.breakdown.FireResist[0].category, 'POB_XML')
  assert.equal(build.breakdown.FireResist[0].value, 85)
  assert.equal(build.stats.FireResistTotal, 251)
  assert.equal(build.breakdown.Armour[0].value, 12345)
  assert.equal(build.breakdown.LifeRegen[0].value, 1198.62)
  build = withPobbinRecovery(build, { EnergyShieldRecharge: 67, NetLifeRegen: 1198 })
  assert.equal(build.breakdown.EnergyShieldRecharge[0].value, 67)
  assert.equal(build.breakdown.LifeRegen[0].value, 1198)
  assert.equal(build.stats.NetLifeRegen, 1198.62)
  assert.equal(saved.FireResist, 85)
})

test('PoB snapshot retains separate item, flask, abyss jewel, mastery and cluster contributions after recovery updates', () => {
  const abyss = { id: 'abyss', baseType: 'Ghastly Eye Jewel', explicitMods: ['+12% to Fire Resistance'] }
  const build = completePobStats({ source: 'pob', character: { level: 90 }, stats: { FireResist: 84, FireResistOverCap: 17, Life: 5000, Armour: 12345, EnergyShield: 161, NetLifeRegen: 1198.62 }, equipment: {
    Helmet: { name: 'Ghoul Chant', explicitMods: ['+42% to Fire Resistance', '+100 to maximum Life', 'Regenerate 1% of Life per second', '11% of Physical Damage taken as Fire Damage'] },
    Belt: { socketedItems: [abyss] }, 'Abyssal Socket': abyss,
    'Wickerman Head': { name: 'Special Head', explicitMods: ['+10% to Fire Resistance'] },
    'Flask 1': { name: 'Ruby Flask', explicitMods: ['+20% to Fire Resistance', '40% increased Armour'] },
  }, jewels: [abyss], tree: { allocated: [{ id: '1', name: 'Fire Mastery', kind: 'Mastery', stats: ['+15% to Fire Resistance'] }, { id: '65536', name: 'Cluster Notable', stats: ['+5% to Fire Resistance', '25% increased Energy Shield Recharge Rate'] }] } })
  assert.equal(build.stats.FireResist, 84)
  assert.equal(build.stats.Armour, 12345)
  const fire = build.breakdown.FireResist
  assert.equal(fire[0].section, 'Snapshot')
  for (const [label, value] of [['Ghoul Chant', 42], ['Special Head', 10], ['Ruby Flask', 20], ['Ghastly Eye Jewel', 12], ['Fire Mastery', 15], ['Cluster Notable', 5]]) assert.ok(fire.some(row => row.label === label && row.value === value), label)
  assert.equal(fire.filter(row => row.label === 'Ghastly Eye Jewel').length, 1)
  assert.ok(build.breakdown.Life.some(row => row.value === 100 && row.detail === '+100 to maximum Life'))
  assert.ok(build.breakdown.LifeRegen.some(row => row.value === 50 && /Regenerate 1%/.test(row.detail)))
  assert.ok(build.breakdown.PhysicalDamageTakenAsFire.some(row => row.value === 11 && row.category === 'ITEM'))
  assert.ok(build.breakdown.Armour.some(row => row.label === 'Ruby Flask' && row.value === 40))
  const linked = withPobbinRecovery(withPobbinRecovery(build, { EnergyShieldRecharge: 67 }), { EnergyShieldRecharge: 67 })
  assert.equal(linked.breakdown.EnergyShieldRecharge[0].value, 67)
  assert.equal(linked.breakdown.EnergyShieldRecharge.filter(row => row.label === 'Cluster Notable').length, 1)
  assert.equal(linked.breakdown.FireResist.length, fire.length)
})
