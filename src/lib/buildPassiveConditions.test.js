import test from 'node:test'
import assert from 'node:assert/strict'
import { fromGgg, completePobStats } from './buildCodec.js'
import { playerAuraCount, resolvePassiveConditions } from './buildPassiveConditions.js'

const node = (stats, name = 'Commander of Darkness') => ({ id: '1', kind: 'Ascendancy', name, stats })
const build = (nodes, items = []) => fromGgg({ name: 'Necromancer', level: 90 }, { items, passives: { hashes: [1] } }, { nodes })

test('Commander self-and-allies resistances contribute once, with Ascendancy provenance and original tree text', () => {
  for (const prefix of ['You and nearby Allies', 'You and Allies within 6 metres', 'You']) {
    const nodes = [node([`${prefix} have +30% to Elemental Resistances`, `${prefix} have +12% to Chaos Resistance`])]
    const result = build(nodes)
    for (const set of [1, 2]) {
      assert.deepEqual(['Fire', 'Cold', 'Lightning', 'Chaos'].map(element => result.weaponStats[set][`${element}Resist`]), [-30, -30, -30, -48])
      const row = result.weaponBreakdowns[set].FireResist.find(row => row.label === 'Commander of Darkness')
      assert.equal(row.value, 30)
      assert.equal(row.category, 'ASCENDANCY')
    }
    assert.deepEqual(result.tree.allocated, nodes)
    assert.equal(nodes[0].stats[0], `${prefix} have +30% to Elemental Resistances`)
  }
})

test('per-aura resistance grants use distinct self-affecting auras, not aura effect or ordinary buffs', () => {
  const skills = [
    { name: 'Determination' }, { name: 'Determination' }, { name: 'Grace' },
    { name: 'Discipline', enabled: false }, { name: 'Purity of Fire', appliesToSelf: false },
    { name: 'Aspect of the Cat' }, { name: 'Tempest Shield' }, { name: 'Arctic Armour' },
    { name: 'Herald of Ash', skillTags: ['Aura', 'Herald'] },
    { name: 'Custom Aura', skillTags: ['Aura', 'Spell'] },
  ]
  assert.equal(playerAuraCount(skills), 3)
  const nodes = [node(['Auras from your Skills grant +5% to all Elemental Resistances to you and Allies'])]
  const resolved = resolvePassiveConditions(nodes, skills, [])
  assert.deepEqual(resolved.nodes[0].stats, ['15% to all Elemental Resistances'])
  assert.deepEqual(resolvePassiveConditions(nodes, [], []).nodes[0].stats, ['0% to all Elemental Resistances'])
  const items = [{ inventoryId: 'Amulet', explicitMods: ['Grants Level 20 Determination Skill', 'Grants Level 20 Grace Skill'] }]
  const result = build([...nodes, node(['100% increased Effect of Non-Curse Auras from your Skills'], 'Aura Effect')], items)
  assert.equal(result.activeAuraCount, 2)
  assert.equal(result.stats.FireResist, -50)
  assert.equal(result.breakdown.FireResist.find(row => row.label === 'Commander of Darkness').value, 10)
})

test('self and nearby ally defence, recovery and speed clauses use shared estimators', () => {
  const result = build([node([
    'You and nearby Allies have +100 to Armour', 'You have 20% increased Armour',
    'You and nearby Allies have +50 to Evasion Rating', 'You have +60 to maximum Energy Shield',
    'You have 10% increased Energy Shield', 'You and nearby Allies Regenerate 10 Life per second',
    'You have 20% increased Life Regeneration Rate', 'You and nearby Allies have 2% Life Regeneration',
    'You have 5% Block Chance', 'You and nearby Allies have 6% Spell Block Chance',
    'You have 15% Spell Suppression Chance', 'You and nearby Allies have 3% increased Attack and Cast Speed',
    'You have 4% increased Movement Speed',
  ])])
  assert.equal(result.stats.Armour, 120)
  assert.equal(result.stats.Evasion, 50)
  assert.equal(result.stats.EnergyShield, 68) // Base intelligence also increases ES.
  assert.equal(result.stats.BlockChance, 5)
  assert.equal(result.stats.SpellBlockChance, 6)
  assert.equal(result.stats.SpellSuppressionChance, 15)
  assert.equal(result.stats.LifeRegen, (10 + result.stats.Life * 0.02) * 1.2)
  assert.equal(result.stats.AttackSpeedInc, 3)
  assert.equal(result.stats.CastSpeedInc, 3)
  assert.equal(result.stats.MovementSpeedInc, 4)
  for (const key of ['Armour', 'Evasion', 'EnergyShield', 'LifeRegen', 'BlockChance', 'SpellBlockChance', 'SpellSuppressionChance', 'AttackSpeedInc']) {
    assert.ok(result.breakdown[key].some(row => row.category === 'ASCENDANCY' && row.label === 'Commander of Darkness'))
  }
})

test('observable while conditions are checked and unknown combat conditions are excluded with a reason', () => {
  const nodes = [node([
    'While you have an Aura affecting you, You have +10% to Fire Resistance',
    'You have +12% to Cold Resistance while you have a shield equipped',
    'You have +99% to Chaos Resistance while on Low Life',
    'Enemies have -100% to Fire Resistance', 'Nearby Allies have +100% to Fire Resistance',
  ])]
  const items = [
    { inventoryId: 'Amulet', explicitMods: ['Grants Level 20 Grace Skill'] },
    { inventoryId: 'Offhand', baseType: 'Tower Shield' },
  ]
  const result = build(nodes, items)
  assert.equal(result.stats.FireResist, -50)
  assert.equal(result.stats.ColdResist, -48)
  assert.equal(result.stats.ChaosResist, -60)
  assert.deepEqual(result.passiveConditions.map(note => note.status), ['applied', 'applied', 'unknown'])
  const empty = build(nodes)
  assert.equal(empty.stats.FireResist, -60)
  assert.equal(empty.stats.ColdResist, -60)
  assert.deepEqual(empty.passiveConditions.map(note => note.status), ['inactive', 'inactive', 'unknown'])
})

test('PoB PlayerStats stay authoritative even when Commander text is available', () => {
  const stats = { FireResist: 85, ColdResist: 85, LightningResist: 85, ChaosResist: 74, Life: 4000, Armour: 15000 }
  const result = completePobStats({ source: 'pob', stats, equipment: {}, tree: { allocated: [node(['You and nearby Allies have +30% to Elemental Resistances'])] } })
  for (const [key, value] of Object.entries(stats)) assert.equal(result.stats[key], value)
  assert.equal(result.breakdown.FireResist[0].category, 'POB_XML')
})

test('shield conditions follow the selected weapon set and individual resistances stay separate', () => {
  const result = build([node([
    'You and nearby Allies have +12% to Fire Resistance',
    'You and nearby Allies have +13% to Cold Resistance',
    'You and nearby Allies have +14% to Lightning Resistance',
    'You have 8% Spell Block Chance while you have a shield equipped',
  ])], [{ inventoryId: 'Offhand', baseType: 'Tower Shield' }])
  assert.deepEqual(['Fire', 'Cold', 'Lightning'].map(element => result.stats[`${element}Resist`]), [-48, -47, -46])
  assert.equal(result.weaponStats[1].SpellBlockChance, 8)
  assert.equal(result.weaponStats[2].SpellBlockChance, 0)
  assert.equal(result.weaponPassiveConditions[1][0].status, 'applied')
  assert.equal(result.weaponPassiveConditions[2][0].status, 'inactive')
})
