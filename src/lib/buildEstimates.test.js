import test from 'node:test'
import assert from 'node:assert/strict'
import { basicStats, estimateResistances, gggSkills, activeSkills, auraBonuses, withPobbinRecovery, mergeAllocatedPassives, deriveRecoveryStats, completePobStats, estimateMaximumHits, estimateCoreStats, estimateRecoveryStats, fromGgg, displayedStats } from './buildCodec.js'
import { AURA_DATA, auraStats } from './buildAuraData.js'
import { allocatedClusterNodes, clusterSortOrder } from '../../server/buildClusters.js'
import { compactTree } from '../../server/buildData.js'
import { applyBuildIcons } from './buildIcons.js'

test('PoB canonical resistances stay locked across tree hydration and never use GGG estimates', () => {
  const original = { FireResist: 85, ColdResist: 85, LightningResist: 85, ChaosResist: 74, effectivefireresist: 171, EffectiveColdResist: -45, EffectiveLightningResistance: -5, FireResistOverCap: 86, FireResistMax: 75 }
  const result = completePobStats({ source: 'pob', stats: original, equipment: {}, tree: { nodes: [], allocated: [] } })
  assert.deepEqual(['Fire', 'Cold', 'Lightning', 'Chaos'].map(e => result.stats[`${e}Resist`]), [85, 85, 85, 74])
  assert.equal(original.FireResist, 85)
  assert.equal(result.stats.FireResistTotal, 171)
  assert.equal(completePobStats(result).stats.FireResist, 85)
  const canonical = completePobStats({ source: 'pob', stats: { FireResist: 85, FireResistOverCap: 171, ColdResist: 0, LightningResist: -5 }, equipment: {} })
  assert.equal(canonical.stats.FireResist, 85)
  assert.equal(canonical.stats.ColdResist, 0)
  assert.equal(canonical.stats.LightningResist, -5)
  const totals = completePobStats({ source: 'pob', stats: { FireResistTotal: 256, FireResistOverCap: 171, ChaosResistTotal: 74 }, equipment: {} })
  assert.equal(totals.stats.FireResist, 85)
  assert.equal(totals.stats.ChaosResist, 74)
  const initial = completePobStats({ source: 'pob', stats: { ChaosResist: 74 }, equipment: { Helmet: { explicitMods: ['+320% to Fire Resistance', '+15% to Cold Resistance', '+10% to maximum Fire Resistance'] } }, tree: { nodes: ['1', '2'], allocated: [] } })
  assert.equal(initial.stats.ColdResist, undefined)
  const hydrated = completePobStats(mergeAllocatedPassives(initial, { nodes: [{ id: '1', name: 'Tasalio, Cleansing Water', stats: [] }, { id: '2', name: "Valako, Storm's Embrace", stats: [] }] }))
  assert.equal(hydrated.stats.ColdResist, undefined)
  assert.equal(hydrated.stats.ChaosResist, 74)
  assert.equal(completePobStats(hydrated).stats.ColdResist, undefined)
})

test('GGG Tasalio applies before caps, Valako shares the fire cap, and estimates drive both weapon sets and max hit', () => {
  const nodes = [{ id: '1', name: 'Tasalio, Cleansing Water', stats: [] }, { id: '2', name: "Valako, Storm's Embrace", stats: [] }]
  const mods = ['+320% to Fire Resistance', '+15% to Cold Resistance', '+55% to Lightning Resistance', '+134% to Chaos Resistance', '+10% to maximum Fire Resistance']
  const items = [{ explicitMods: mods }]
  const uncapped = basicStats(items, nodes)
  const stats = estimateResistances(items, nodes, uncapped)
  assert.deepEqual(['Fire', 'Cold', 'Lightning', 'Chaos'].map(e => stats[`${e}Resist`]), [85, 85, 85, 74])
  assert.equal(stats.ColdResistTotal, 115)
  assert.equal(stats.LightningResistTotal, 155)
  assert.equal(uncapped.ColdResist, -45)
  assert.equal(estimateResistances(items, [], uncapped).ColdResist, -45)
  assert.equal(estimateResistances(items, [nodes[0]], uncapped).ColdResist, 75)
  assert.equal(estimateMaximumHits(items, nodes, { ...stats, Life: 1500 }).ColdMaximumHitTaken, 10000)
  const build = fromGgg({ name: 'Chieftain', level: 84 }, { items: [{ inventoryId: 'BodyArmour', explicitMods: mods }], passives: { hashes: [1, 2] } }, { nodes })
  for (const set of [1, 2]) assert.deepEqual(['Fire', 'Cold', 'Lightning', 'Chaos'].map(e => displayedStats(build, set)[`${e}Resist`]), [85, 85, 85, 74])
  assert.equal(estimateResistances([{ explicitMods: ['+100% to maximum Fire Resistance'] }], nodes, { FireResist: 300, ColdResist: 0, LightningResist: 0, ChaosResist: -60 }).ColdResist, 90)
})

const purityItem = (name, level, quality = 0, supports = []) => ({
  inventoryId: 'Gloves', sockets: [{ group: 0 }, ...supports.map(() => ({ group: 0 }))],
  socketedItems: [{ frameType: 4, socket: 0, typeLine: name, properties: [{ name: 'Level', values: [[String(level), 0]] }, { name: 'Quality', values: [[String(quality), 0]] }] }, ...supports.map((name, index) => ({ frameType: 4, socket: index + 1, typeLine: name }))],
})

test('all equipment mod fields grant skills with provenance, while swap, flask and passive jewel skills are excluded', () => {
  const fields = ['explicitMods', 'implicitMods', 'enchantMods', 'craftedMods', 'fracturedMods', 'crucibleMods']
  const amulet = { inventoryId: 'Amulet', name: 'Tear of Purity', ...Object.fromEntries(fields.map((field, i) => [field, [`Grants Level ${i + 10} ${['Purity of Elements', 'Determination', 'Grace', 'Discipline', 'Vitality', 'Clarity'][i]} Skill`]])) }
  const groups = gggSkills([amulet, ...['Weapon2', 'Offhand2', 'Flask', 'PassiveJewels'].map(inventoryId => ({ inventoryId, explicitMods: ['Grants Level 30 Wrath Skill'] }))])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].grantedBy, 'Tear of Purity')
  assert.deepEqual(groups[0].gems.map(gem => gem.level).sort((a, b) => a - b), [10, 11, 12, 13, 14, 15])
  assert.ok(groups[0].gems.every(gem => gem.grantedBy === 'Tear of Purity' && !gem.support))
  assert.equal(activeSkills(groups).length, 6)
})

test('BinLightning GGG linked granted skill without Skill suffix contributes 33% with the actual 30% tree aura effect', () => {
  const amulet = { inventoryId: 'Amulet', frameType: 3, name: 'Tear of Purity', baseType: 'Lapis Amulet', explicitMods: [{ description: 'Grants Level 10 [PurityOfElements::10|Purity of Elements]' }, { description: '+7% to all Elemental Resistances' }] }
  const nodes = [{ id: '1', name: 'Influence', stats: ['14% increased effect of Non-Curse Auras from your Skills'] }, { id: '2', name: 'Sovereignty', stats: ['10% increased effect of Non-Curse Auras from your Skills'] }, { id: '3', name: 'Aura Effect', stats: ['6% increased effect of Non-Curse Auras from your Skills'] }]
  const build = fromGgg({ name: 'BinLightning', level: 67 }, { items: [amulet], passives: { hashes: [1, 2, 3] } }, { nodes })
  const skill = build.activeSkills.find(gem => gem.name === 'Purity of Elements')
  assert.equal(skill.level, 10)
  assert.equal(skill.isGranted, true)
  assert.equal(skill.sourceItemName, 'Tear of Purity, Lapis Amulet')
  assert.equal(build.skills.flatMap(group => group.gems).filter(gem => gem.isGranted).length, 1)
  const aura = build.auraEffects.find(effect => effect.name === 'Purity of Elements')
  assert.equal(aura.baseStats.ElementalResist, 26)
  assert.equal(aura.increasedAuraEffect, 30)
  assert.equal(aura.stats.ElementalResist, 33)
  for (const element of ['Fire', 'Cold', 'Lightning']) {
    const row = build.breakdown[`${element}Resist`].find(row => row.category === 'SKILL')
    assert.equal(row.label, 'Purity of Elements (Tear of Purity)')
    assert.equal(row.value, 33)
    assert.match(row.detail, /floor\(26 × \(1 \+ 30 \/ 100\)\)/)
    assert.equal(build.stats[`${element}Resist`], -20)
  }
})

test('granted skill scanner accepts linked/plain text, wrappers and annotations across every mod field', () => {
  for (const field of ['explicitMods', 'implicitMods', 'enchantMods', 'craftedMods', 'fracturedMods', 'crucibleMods']) {
    for (const text of ['Grants Level 10 Purity of Elements Skill', 'Grants Level 10 [PurityOfElements::10|Purity of Elements]', 'Grants Level 10 [PurityOfElements::10|Purity of Elements] Skill', '<<set:MS>>Grants Level 10 [PurityOfElements::10|Purity of Elements]', 'Grants Level 10 Purity of Elements Skill (Granted by equipment)']) {
      const groups = gggSkills([{ inventoryId: 'Amulet', name: 'Tear of Purity', [field]: [{ description: text }] }])
      const skill = activeSkills(groups)[0]
      assert.equal(skill.name, 'Purity of Elements', `${field}: ${text}`)
      assert.equal(skill.level, 10)
      assert.equal(skill.isGranted, true)
    }
  }
})

test('self aura effect is combined with non-curse aura effect and excludes area, damage and conditional modifiers', () => {
  const items = [{ inventoryId: 'Amulet', explicitMods: ['Grants Level 10 [PurityOfElements::10|Purity of Elements]'] }]
  const nodes = [{ stats: ['14% increased effect of Non-Curse Auras from your Skills', '10% increased Effect of Auras on you', '8% increased effect of Non-Curse Auras from your Skills', '12% increased Area of Effect of Aura Skills', '8% increased Damage for each of your Aura or Herald Skills affecting you', '100% increased Effect of Auras on you while on Low Life'] }]
  const aura = auraBonuses(items, nodes).effects[0]
  assert.equal(aura.increasedAuraEffect, 32)
  assert.equal(aura.stats.ElementalResist, Math.floor(26 * 1.32))
  assert.equal(aura.stats.ElementalResist, 34)
  assert.equal(auraStats('Purity of Elements', 1).ElementalResist, 20)
  assert.equal(auraStats('Purity of Elements', 20).ElementalResist, 34)
})

test('every supported level 1-30 aura shares identical effects for a socketed gem and an item grant', () => {
  const nodes = [{ stats: ['25% increased effect of Non-Curse Auras from your Skills'] }]
  for (const name of Object.keys(AURA_DATA)) for (let level = 1; level <= 30; level++) {
    const gem = purityItem(name, level)
    const item = { inventoryId: 'Amulet', name: 'Test Grant', explicitMods: [`Grants Level ${level} ${name} Skill`] }
    const gemAura = auraBonuses([gem], nodes), grantAura = auraBonuses([item], nodes)
    assert.deepEqual(grantAura.effects[0].stats, gemAura.effects[0].stats, `${name} Lv${level}`)
    assert.ok(Object.values(auraStats(name, level)).every(Number.isFinite))
  }
})

test('item auras deduplicate by highest level and feed core defences, recovery and active skill metadata', () => {
  const armour = { inventoryId: 'BodyArmour', properties: [{ name: 'Armour', values: [['1000', 0]] }, { name: 'Evasion Rating', values: [['500', 0]] }], explicitMods: ['Grants Level 22 Determination Skill', 'Grants Level 20 Grace Skill', 'Grants Level 20 Discipline Skill', 'Grants Level 20 Vitality Skill', 'Grants Level 20 Clarity Skill', 'Grants Level 20 Tempest Shield Skill', 'Grants Level 20 Precision Skill', 'Grants Level 20 Wrath Skill'] }
  const nodes = [{ stats: ['100% increased Armour', '100% increased Evasion Rating', '100% increased Mana Regeneration Rate'] }]
  const payload = { items: [armour, purityItem('Determination', 20)], passives: { hashes: [] } }
  const build = fromGgg({ name: 'Aura Test', level: 80 }, payload, { nodes })
  assert.equal(build.activeSkills.filter(g => g.name === 'Determination').length, 1)
  assert.equal(build.activeSkills.find(g => g.name === 'Determination').level, 22)
  assert.equal(build.activeSkills.find(g => g.name === 'Determination').grantedBy, 'Equipment')
  assert.equal(build.stats.Armour, Math.floor((1000 + auraStats('Determination', 22).ArmourFlat) * 2 * (1 + auraStats('Determination', 22).ArmourMore / 100)))
  assert.equal(build.stats.Evasion, Math.floor((500 + auraStats('Grace', 20).EvasionFlat) * 2 * 1.29))
  assert.equal(build.stats.EnergyShield, Math.floor(217 * (1 + Math.floor(build.stats.Int / 5) / 100)))
  assert.equal(build.stats.SpellBlockChance, 25)
  assert.equal(build.stats.LifeRegen, 193.2)
  assert.equal(build.stats.ManaRegen, (build.stats.Mana * 0.0175 + auraStats('Clarity', 20).ManaRegenFlat) * 2)
  assert.equal(build.stats.EnergyShieldRecharge, build.stats.EnergyShield / 3 * 1.3)
  assert.ok(build.auraEffects.some(effect => effect.name === 'Wrath' && effect.stats.AttackLightningMax > 0))
  const strongerGem = fromGgg({ level: 80 }, { ...payload, items: [armour, purityItem('Determination', 25)] }, { nodes })
  assert.equal(strongerGem.activeSkills.find(g => g.name === 'Determination').level, 25)
})

test('saved PoB core and resistances remain exact despite item auras, passive hydration and later recalculation', () => {
  const saved = { Life: 3344, Mana: 700, EnergyShield: 161, Armour: 12345, Evasion: 0, BlockChance: 0, SpellBlockChance: 0, SpellSuppressionChance: 0, FireResist: 85, ColdResist: 85, LightningResist: 85, ChaosResist: 74 }
  const equipment = { Amulet: { inventoryId: 'Amulet', explicitMods: ['Grants Level 30 Determination Skill', 'Grants Level 30 Discipline Skill', 'Grants Level 30 Tempest Shield Skill', 'Grants Level 30 Purity of Elements Skill'] } }
  const build = completePobStats({ source: 'pob', stats: saved, equipment, tree: { nodes: ['1'], allocated: [] } })
  const updated = completePobStats(mergeAllocatedPassives(build, { nodes: [{ id: '1', stats: ['100% increased effect of Non-Curse Auras from your Skills', '+10% to all maximum Resistances'] }] }))
  for (const [key, value] of Object.entries(saved)) {
    assert.equal(updated.stats[key], value, key)
    assert.ok(!updated.estimatedStats.includes(key))
  }
})

test('NamLightning resistances include level 19 Purity, aura effect and Tasalio before Kitava, then Valako caps', () => {
  const nodes = [{ name: 'Tasalio, Cleansing Water', stats: [] }, { name: "Valako, Storm's Embrace", stats: [] }, { stats: ['10% increased effect of Non-Curse Auras from your Skills', '+7% to maximum Fire Resistance'] }]
  const gear = { inventoryId: 'BodyArmour', explicitMods: ['+231% to Fire Resistance', '+15% to Cold Resistance', '+55% to Lightning Resistance', '+134% to Chaos Resistance'] }
  const gloves = purityItem('Purity of Fire', 19)
  const build = fromGgg({ name: 'NamLightning', level: 84 }, { items: [gear, gloves], passives: { hashes: [] } }, { nodes })
  for (const set of [1, 2]) {
    const stats = displayedStats(build, set)
    assert.deepEqual(['Fire', 'Cold', 'Lightning', 'Chaos'].map(e => stats[`${e}Resist`]), [85, 85, 85, 74])
    assert.equal(stats.FireResistTotal, 215)
    assert.equal(stats.ColdResistTotal, 92)
    assert.equal(stats.FireResistMax, 85)
    assert.equal(stats.FireResistOverCap, 130)
  }
})

test('Purity levels, quality, duplicate auras and linked supports affect only the appropriate element', () => {
  const estimate = (items, nodes = []) => estimateResistances(items, nodes, basicStats(items, nodes))
  assert.equal(estimate([purityItem('Purity of Fire', 19)]).FireResistMax, 78)
  assert.equal(estimate([purityItem('Purity of Fire', 20)]).FireResistMax, 79)
  assert.equal(estimate([purityItem('Purity of Fire', 23)]).FireResistMax, 80)
  assert.equal(estimate([purityItem('Purity of Ice', 20)]).ColdResistTotal, -19)
  assert.equal(estimate([purityItem('Purity of Lightning', 20, 20)]).LightningResistTotal, -9)
  assert.equal(estimate([purityItem('Purity of Elements', 20)]).FireResistTotal, -26)
  assert.equal(estimate([purityItem('Purity of Elements', 20)]).ChaosResistTotal, -60)
  assert.equal(estimate([purityItem('Purity of Fire', 20), purityItem('Purity of Fire', 19)]).FireResistTotal, -19)
  assert.equal(estimate([purityItem('Purity of Fire', 20)], [{ stats: ['25% increased effect of Non-Curse Auras from your Skills'] }]).FireResistMax, 80)
  for (const support of ['Generosity Support', 'Awakened Generosity Support']) {
    const linked = purityItem('Purity of Fire', 20, 0, [support])
    assert.equal(estimate([linked]).FireResistMax, 75)
    linked.sockets[1].group = 1
    assert.equal(estimate([linked]).FireResistMax, 79)
  }
  const disabled = purityItem('Purity of Fire', 20)
  disabled.socketedItems[0].enabled = false
  assert.equal(estimate([disabled]).FireResistMax, 75)
})

test('rendered recovery stays separate and survives later XML/passive recalculation without modifying saved PlayerStats', () => {
  const build = completePobStats({ source: 'pob', stats: { NetLifeRegen: 1198.62, EnergyShield: 161, Life: 3344 }, equipment: {}, tree: { nodes: ['1'], allocated: [] } })
  const recovery = { NetLifeRegen: 1198, ManaRegenRecovery: 15, EnergyShieldRecharge: 67, LifeRecoupRecovery: 209 }
  const linked = withPobbinRecovery(build, { ...recovery, unknown: 100, Life: 999 })
  assert.deepEqual(linked.recovery, recovery)
  assert.equal(linked.stats.NetLifeRegen, 1198.62)
  const recalculated = completePobStats(mergeAllocatedPassives(linked, { nodes: [{ id: '1', stats: ['100% increased Energy Shield Recharge Rate'] }] }))
  assert.deepEqual(recalculated.recovery, recovery)
  assert.deepEqual(applyBuildIcons({ ...recalculated, equipment: {}, jewels: [], skills: [] }, {}).recovery, recovery)
  assert.notEqual(Math.round(recalculated.stats.EnergyShieldRecharge), recovery.EnergyShieldRecharge)
  assert.strictEqual(withPobbinRecovery(build, { EnergyShieldRecharge: NaN }), build)
  assert.equal(withPobbinRecovery(build, { EnergyShieldRecharge: 0 }).recovery.EnergyShieldRecharge, 0)
})

test('allocated tree IDs and cluster nodes resolve to recovery mods before recomputing PoB stats', () => {
  const data = { constants: { skillsPerOrbit: [1], orbitRadii: [0] }, groups: { 1: { x: 0, y: 0 }, 2: { x: 50, y: 50, isProxy: true, nodes: [] } }, nodes: {
    2491: { name: 'Large Jewel Socket', group: 1, expansionJewel: { size: 2, index: 3, proxy: 50 } },
    50: { group: 2 },
    1: { name: 'Recharge', stats: ['20% increased Energy Shield Recharge Rate'] },
    2: { name: 'Recoup', group: 1, stats: ['15% of Damage taken Recouped as Life'] },
    3: { name: 'Unallocated', group: 1, stats: ['100% of Damage taken Recouped as Life'] },
    90: { name: 'Cluster Recoup', isNotable: true, stats: ['10% of Damage taken Recouped as Life'] },
  } }
  const ids = ['2491', '1', '2', '65728', '65732']
  const jewels = [{ nodeId: '2491', baseType: 'Small Cluster Jewel', mods: ['Adds 3 Passive Skills', 'Added Small Passive Skills grant: 5% increased Energy Shield Recharge Rate', '1 Added Passive Skill is Cluster Recoup'] }]
  const generated = allocatedClusterNodes(data, ids, jewels, { 'Cluster Recoup': 1 })
  assert.deepEqual(generated.map((node) => node.id).sort(), ['65728', '65732'])
  const base = { character: { level: 84 }, stats: { EnergyShield: 161, Life: 3344, PhysicalMaximumHitTaken: 100000 }, equipment: {}, tree: { nodes: ids, allocated: [] } }
  const metadata = { nodes: [...compactTree(data, ids).nodes, ...generated, generated[0], { id: '3', stats: data.nodes[3].stats }] }
  const hydrated = mergeAllocatedPassives(base, metadata)
  assert.equal(hydrated.tree.missingIds.length, 0)
  assert.equal(hydrated.tree.allocated.length, 5)
  const result = completePobStats(hydrated)
  assert.equal(Math.round(result.stats.EnergyShieldRecharge), 67)
  assert.equal(Math.round(result.stats.LifeRecoupRecovery), 209)
  assert.equal(result.stats.RecoupHit, 3344)
})

test('cluster small-passive effect scales only allocated nodes and unknown notables are not guessed', () => {
  const data = { groups: { 1: {}, 2: { nodes: [] } }, nodes: { 10: { group: 1, expansionJewel: { size: 2, index: 0, proxy: 20 } }, 20: { group: 2 } } }
  const jewels = [{ nodeId: '10', baseType: 'Small Cluster Jewel', mods: ['Adds 2 Passive Skills', 'Added Small Passive Skills grant: 5% increased Energy Shield Recharge Rate', 'Added Small Passive Skills have 35% increased Effect'] }]
  const generated = allocatedClusterNodes(data, ['10', '65536'], jewels, {})
  assert.equal(generated.length, 1)
  assert.deepEqual(generated[0].stats, ['6% increased Energy Shield Recharge Rate'])
  const partial = allocatedClusterNodes(data, ['10', '65536', '65540'], [{ ...jewels[0], mods: [...jewels[0].mods, '1 Added Passive Skill is Unknown'] }], {})
  assert.deepEqual(partial.map(node => node.id), ['65536'])
  assert.deepEqual(partial[0].stats, ['6% increased Energy Shield Recharge Rate'])
  assert.deepEqual(clusterSortOrder('notableSortOrder = { ["First"] = 12, ["Second"] = 13, }'), { First: 12, Second: 13 })
})

test('derived recovery uses exact one-third ES, gear/jewel/flask/passive increases and 3/4 second recoup', () => {
  const gear = [{ explicitMods: ['10% increased Energy Shield Recharge Rate', '20% of Damage Taken Recouped as Life'] }]
  const nodes = [{ stats: ['10% increased Energy Shield Recharge Rate', '5% of Damage Taken Recouped as Life'] }]
  const flasks = [{ explicitMods: ['5% increased Energy Shield Recharge Rate'] }]
  const stats = { EnergyShield: 161, Life: 3344 }
  const result = deriveRecoveryStats(gear, nodes, stats, flasks)
  assert.equal(Math.round(result.EnergyShieldRecharge), 67)
  assert.equal(result.LifeRecoupRecovery, 209)
  assert.equal(result.RecoupDuration, 4)
  assert.equal(deriveRecoveryStats(gear, [...nodes, { stats: ['Damage taken Recouped over 3 seconds instead'] }], stats, flasks).LifeRecoupRecovery, 3344 * 0.25 / 3)
  assert.equal(deriveRecoveryStats(gear, nodes, { ...stats, PhysicalMaximumHitTaken: 4000 }).LifeRecoupRecovery, 209)
  assert.equal(deriveRecoveryStats(gear, nodes, { EnergyShield: 161 }).LifeRecoupRecovery, undefined)
  assert.equal(deriveRecoveryStats([], [], stats).LifeRecoupRecovery, 0)
})

test('GGG recovery uses equipped gear, jewels, flask recharge and the selected weapon set hit estimate', () => {
  const build = fromGgg({ name: 'Recovery', level: 80 }, { items: [
    { inventoryId: 'Helm', properties: [{ name: 'Energy Shield', values: [['161', 0]] }], explicitMods: ['10% increased Energy Shield Recharge Rate'] },
    { inventoryId: 'Flask', x: 0, explicitMods: ['5% increased Energy Shield Recharge Rate'] },
    { inventoryId: 'Weapon', explicitMods: ['20% of Damage Taken Recouped as Life'] },
    { inventoryId: 'PassiveJewels', id: 'jewel', x: 0, explicitMods: ['10% increased Energy Shield Recharge Rate'] },
  ], passives: { character: 1 } }, { classes: [{ base_int: 0 }, { base_int: 0 }], nodes: [{ stats: ['5% of Damage Taken Recouped as Life', 'Damage taken Recouped over 3 seconds instead'] }] })
  const stats = displayedStats(build, 1)
  assert.equal(Math.round(stats.EnergyShieldRecharge), 67)
  assert.equal(stats.LifeRecoupRecovery, stats.Life * 0.25 / 3)
  assert.equal(displayedStats(build, 2).LifeRecoup, 5)
  assert.ok(build.estimatedStats.includes('LifeRecoupRecovery'))
})

test('PoB recovery recomputes mod fallbacks after passive metadata and uses NetManaRegen first', () => {
  const base = { stats: { EnergyShield: 161, Life: 3344, NetManaRegen: 14.7, ManaRegenRecovery: 999, EnergyShieldRechargeRate: 999 }, equipment: { Helmet: { explicitMods: ['10% increased Energy Shield Recharge Rate', '20% of Damage Taken Recouped as Life'] } }, tree: { allocated: [] } }
  const first = completePobStats(base)
  assert.equal(first.stats.ManaRegenRecovery, 14.7)
  assert.equal(first.stats.LifeRecoupRecovery, 167.2)
  const next = completePobStats({ ...first, tree: { allocated: [{ stats: ['15% increased Energy Shield Recharge Rate', '5% of Damage Taken Recouped as Life'] }] } })
  assert.equal(Math.round(next.stats.EnergyShieldRecharge), 67)
  assert.equal(next.stats.LifeRecoupRecovery, 209)
  assert.ok(!next.estimatedStats.includes('EnergyShieldRecharge'))
  assert.ok(!next.estimatedStats.includes('LifeRecoupRecovery'))
  assert.deepEqual(next.savedStatKeys, Object.keys(base.stats))
  const zero = completePobStats({ ...base, stats: { ...base.stats, NetManaRegen: 0 } })
  assert.equal(zero.stats.ManaRegenRecovery, 0)
})

test('PoB recovery matches case-insensitive flat recovery aliases before estimating', () => {
  for (const es of ['EnergyShieldRecharge', 'ESRecharge', 'EnergyShieldRechargeRecovery']) {
    for (const life of ['LifeRecoupRecovery', 'LifeRecoupRecoveryMax', 'LifeRecoupRecoveryAvg']) {
      const saved = { [es.toLowerCase()]: 67.4, [life.toUpperCase()]: 209.3, netliferegen: -1198.2, manaregen: 15.1, EnergyShield: 1000 }
      const result = completePobStats({ stats: saved, equipment: {} })
      assert.equal(result.stats.EnergyShieldRecharge, 67.4)
      assert.equal(result.stats.LifeRecoupRecovery, 209.3)
      assert.equal(result.stats.NetLifeRegen, -1198.2)
      assert.equal(result.stats.ManaRegenRecovery, 15.1)
      for (const key of ['EnergyShieldRecharge', 'LifeRecoupRecovery', 'NetLifeRegen', 'ManaRegenRecovery']) assert.ok(!result.estimatedStats.includes(key))
      assert.equal(completePobStats(result).stats.LifeRecoupRecovery, 209.3)
      assert.deepEqual(result.savedStatKeys, Object.keys(saved))
    }
  }
})

test('PoB recovery prioritizes explicit saved names and zero, ignoring Mana/ES recoup', () => {
  const result = completePobStats({ stats: { ENERGYSHIELDRECHARGE: 0, ESRecharge: 9, EnergyShieldRechargeRecovery: 11, LifeRecoupRecovery: 0, LifeRecoup: 25, TotalLifeRecoup: 400 }, equipment: {} })
  assert.equal(result.stats.EnergyShieldRecharge, 0)
  assert.equal(result.stats.LifeRecoupRecovery, 0)
  assert.ok(!result.estimatedStats.includes('EnergyShieldRecharge'))
  assert.ok(!result.estimatedStats.includes('LifeRecoupRecovery'))
  const ignored = completePobStats({ stats: { ManaRecoupRecovery: 100, EnergyShieldRecoupRecovery: 200, ESRecoupRecovery: 300, TotalESRecoup: 400, RecoupESRecovery: 500 }, equipment: {} })
  assert.equal(ignored.stats.LifeRecoupRecovery, 0)
  assert.equal(ignored.stats.LifeRecoup, 0)
  assert.ok(!ignored.estimatedStats.includes('LifeRecoup'))
})

test('PoB net life regen and recoup recovery preserve signed rates separately from gross regen and recoup percent', () => {
  for (const net of [-123.5, 0, 456]) {
    const saved = { NetLifeRegen: net, LifeRegenRecovery: 999, LifeRecoupRecovery: 209, LifeRecoup: 25, EnergyShield: 1000, EnergyShieldRecharge: 777, EnergyShieldRechargeRate: 888 }
    const result = completePobStats({ stats: saved, equipment: {}, tree: { allocated: [] } })
    for (const [key, value] of Object.entries(saved)) assert.equal(result.stats[key], value)
    for (const key of ['NetLifeRegen', 'LifeRegenRecovery', 'LifeRecoupRecovery', 'LifeRecoup', 'EnergyShieldRecharge']) assert.ok(!result.estimatedStats.includes(key))
    const reloaded = completePobStats(result)
    assert.equal(reloaded.stats.NetLifeRegen, net)
    assert.equal(reloaded.stats.LifeRecoupRecovery, 209)
  }
  const ratesOnly = completePobStats({ stats: { NetLifeRegen: 0, LifeRecoupRecovery: 0, EnergyShieldRecharge: 0, EnergyShield: 1000 }, equipment: {} })
  assert.equal(ratesOnly.stats.LifeRegenRecovery, undefined)
  assert.equal(ratesOnly.stats.LifeRecoup, 0)
  assert.equal(ratesOnly.stats.EnergyShieldRecharge, 0)
})

test('recovery and physical conversion sum gear, jewels, nodes and active flask conversion', () => {
  const items = [{ implicitMods: ['10% of Physical Damage from Hits taken as Fire Damage'], explicitMods: [
    '40% of Physical Damage taken as Fire Damage', '50% of Physical Damage taken as Lightning Damage',
    'Regenerate 10.5 Life per second', 'Regenerate 1.5% of Life per second',
    'Regenerate 3.5 Mana per second', '50% increased Mana Regeneration Rate',
    '30% increased Energy Shield Recharge Rate', '20% of Damage Taken Recouped as Life',
    null, 42, { name: '5% of Physical Damage taken as Chaos Damage' },
  ] }]
  const nodes = [{ stats: ['5% of Physical Damage taken as Fire Damage', 'Regenerate 1% of maximum Life per second', '10% reduced Mana Regeneration Rate', '10% reduced Energy Shield Recharge Rate', '15% of Damage Taken Recouped as Life'] }]
  const flasks = [{ explicitMods: ['20% of Physical Damage from Hits taken as Cold Damage', 'Regenerate 9999 Life per second'] }]
  const result = estimateRecoveryStats(items, nodes, { Life: 2000, Mana: 1000, EnergyShield: 500 }, flasks)
  assert.deepEqual(result, { PhysicalDamageTakenAsFire: 55, PhysicalDamageTakenAsCold: 20, PhysicalDamageTakenAsLightning: 50, PhysicalDamageTakenAsChaos: 5, LifeRecoup: 35, LifeRegen: 60.5, ManaRegen: 28, EnergyShieldRecharge: 500 / 3 * 1.2 })
})

test('missing conversion and recovery show numeric zero; conditional modifiers are excluded', () => {
  const result = estimateRecoveryStats([{ explicitMods: [
    'Regenerate 100 Life per second while on Low Life', 'Regenerate 10% of Life per second while stationary',
    '100% increased Mana Regeneration Rate while moving', '100% increased Energy Shield Recharge Rate while moving',
    '20% of Physical Damage taken as Fire Damage while stationary', '10% of Damage Taken Recouped as Life if Hit Recently',
  ] }], [], { Life: 1000, Mana: 1000, EnergyShield: 100 })
  assert.equal(result.PhysicalDamageTakenAsFire, 0)
  assert.equal(result.PhysicalDamageTakenAsCold, 0)
  assert.equal(result.PhysicalDamageTakenAsLightning, 0)
  assert.equal(result.PhysicalDamageTakenAsChaos, 0)
  assert.equal(result.LifeRegen, 0)
  assert.equal(result.LifeRecoup, 0)
  assert.equal(result.ManaRegen, 17.5)
  assert.equal(result.EnergyShieldRecharge, 100 / 3)
})

test('recovery follows the precomputed weapon set life and preserves PoB snapshot values', () => {
  const build = fromGgg({ name: 'Recovery', level: 10 }, { items: [
    { inventoryId: 'Weapon', explicitMods: ['+100 to maximum Life', 'Regenerate 10% of Life per second', '20% of Physical Damage taken as Fire Damage'] },
    { inventoryId: 'Weapon2', explicitMods: ['Regenerate 20 Life per second'] },
  ] }, { nodes: [] })
  assert.equal(build.stats.LifeRegen, build.stats.Life * 0.1)
  assert.equal(displayedStats(build, 2).LifeRegen, 20)
  assert.equal(displayedStats(build, 2).PhysicalDamageTakenAsFire, 0)
  assert.ok(build.estimatedStats.includes('LifeRegen'))
  assert.ok(build.estimatedStats.includes('PhysicalDamageTakenAsFire'))
  assert.ok(Number.isFinite(build.stats.TotalEHP))
  assert.ok(Number.isFinite(build.stats.PhysicalMaximumHitTaken))
  const snapshot = { source: 'pob', stats: { LifeRegen: 999, PhysicalDamageTakenAsFire: 90, TotalEHP: 12345 } }
  assert.strictEqual(displayedStats(snapshot, 2), snapshot.stats)
})

test('PoB aliases preserve saved zero values and fallback mods are recomputed after tree metadata arrives', () => {
  const original = { stats: { EffectiveBlockChance: 30, EffectiveSpellBlockChance: 15, EffectiveSpellSuppressionChance: 100, Life: 2000, Mana: 1000, EnergyShield: 500, LifeRegen: 0, ManaRegen: 11, EnergyShieldRechargeRate: 123, PhysicalDamageTakenAsFire: 0 }, character: { level: 80 }, equipment: { 'Body Armour': { explicitMods: ['40% of Physical Damage taken as Fire Damage', '10% of Damage Taken Recouped as Life'] }, 'Weapon 1 Swap': { explicitMods: ['99% of Physical Damage taken as Cold Damage'] } }, tree: { allocated: [] } }
  const first = completePobStats(original)
  assert.equal(first.stats.BlockChance, 30)
  assert.equal(first.stats.SpellBlockChance, 15)
  assert.equal(first.stats.SpellSuppressionChance, 100)
  assert.equal(first.stats.PhysicalDamageTakenAsFire, 0)
  assert.equal(first.stats.PhysicalDamageTakenAsCold, 0)
  assert.equal(first.stats.LifeRegenRecovery, 0)
  assert.equal(first.stats.ManaRegenRecovery, 11)
  assert.equal(first.stats.EnergyShieldRecharge, 500 / 3)
  assert.equal(first.stats.LifeRecoup, 10)
  assert.ok(!first.estimatedStats.includes('PhysicalDamageTakenAsFire'))
  assert.ok(!first.estimatedStats.includes('LifeRegenRecovery'))
  const next = completePobStats({ ...first, tree: { allocated: [{ stats: ['20% of Damage Taken Recouped as Life', '10% of Physical Damage taken as Cold Damage'] }] } })
  assert.equal(next.stats.LifeRecoup, 30)
  assert.equal(next.stats.PhysicalDamageTakenAsCold, 10)
  assert.equal(next.stats.PhysicalDamageTakenAsFire, 0)
  assert.equal(next.stats.EnergyShieldRecharge, 500 / 3)
  assert.deepEqual(next.savedStatKeys, Object.keys(original.stats))
})

test('PoB absent defensive stats default to zero and ES recharge falls back to one third of ES', () => {
  const build = completePobStats({ stats: { EnergyShield: 1000 }, equipment: {}, tree: { allocated: [] } })
  for (const key of ['BlockChance', 'SpellBlockChance', 'SpellSuppressionChance', 'LifeRecoup', 'PhysicalDamageTakenAsFire', 'PhysicalDamageTakenAsCold', 'PhysicalDamageTakenAsLightning', 'PhysicalDamageTakenAsChaos']) assert.equal(build.stats[key], 0)
  assert.equal(build.stats.EnergyShieldRecharge, 1000 / 3)
  assert.ok(!build.estimatedStats.includes('EnergyShieldRecharge'))
})

test('maximum hit estimates apply resistance caps, armour and conversion, with chaos bypassing ES', () => {
  const stats = { Life: 1000, EnergyShield: 1000, Armour: 10000, FireResist: 150, ColdResist: 75, LightningResist: 75, ChaosResist: 0 }
  const hits = estimateMaximumHits([], [], stats)
  assert.equal(hits.FireMaximumHitTaken, 8000)
  assert.equal(hits.ChaosMaximumHitTaken, 1000)
  // P^2 / (P + A/5) = 2000 gives P = 3236.0679.
  assert.equal(hits.PhysicalMaximumHitTaken, 3236)
  assert.equal(hits.TotalEHP, 1000)
  const items = [{ explicitMods: ['+5% to maximum Fire Resistance', '+1% to all maximum Resistances'] }]
  assert.equal(basicStats(items, []).FireResist, -60)
  assert.equal(estimateMaximumHits(items, [], stats).FireMaximumHitTaken, 10526)
  assert.equal(estimateMaximumHits([], [], { ...stats, Armour: 0, PhysicalDamageTakenAsFire: 100 }).PhysicalMaximumHitTaken, 8000)
  assert.equal(estimateMaximumHits([], [], { ...stats, PhysicalDamageTakenAsChaos: 100 }).PhysicalMaximumHitTaken, 1000)
  assert.equal(estimateMaximumHits([], [], { ...stats, FireResist: -60 }).FireMaximumHitTaken, 1250)
  assert.equal(estimateMaximumHits([{ explicitMods: ['+100% to maximum Fire Resistance'] }], [], stats).FireMaximumHitTaken, 20000)
})

test('core estimates apply the requested formulas without double counting local armour properties', () => {
  const armour = { properties: [
    { name: 'Energy Shield', values: [['300', 1]] }, { name: 'Armour', values: [['1,000', 1]] },
    { name: 'Evasion Rating', values: [['500', 1]] }, { name: 'Chance to Block', values: [['25%', 0]] },
  ], explicitMods: ['+100 to maximum Life', '+40 to maximum Mana', '+100 to maximum Energy Shield', '+50 to Armour', '100% increased Armour', '100% increased Energy Shield', '20% increased maximum Life', '10% increased maximum Mana', '+5% Chance to Block Attack Damage', '+6% Chance to Block Spell Damage', '+12% chance to Suppress Spell Damage'] }
  const jewel = { explicitMods: ['+50 to maximum Energy Shield', '20% increased maximum Energy Shield', '30% increased Armour', '40% increased Evasion Rating'] }
  const nodes = [{ stats: ['+150 to maximum Life', '+50 to maximum Mana', '+100 to maximum Energy Shield', '30% increased maximum Life', '40% increased maximum Mana', '40% increased maximum Energy Shield', '20% increased Armour', '10% increased Evasion Rating', '+4% Chance to Block Attack Damage', '+3% Chance to Block Spell Damage', '18% chance to Suppress Spell Damage'] }]
  const result = estimateCoreStats([armour, jewel], nodes, { Str: 200, Int: 150 }, 80)
  assert.deepEqual(result, { Life: 2022, Mana: 1018, EnergyShield: 855, Armour: 1500, Evasion: 750, BlockChance: 34, SpellBlockChance: 9, SpellSuppressionChance: 30, BlockChanceMax: 75, SpellBlockChanceMax: 75, SpellSuppressionChanceMax: 100, LifeInc: 50, ManaInc: 50, EnergyShieldInc: 60 })
})

test('estimates skip conditional stats and support hybrid defence increases', () => {
  const gear = [{ properties: [{ name: 'Armour', values: [['100', 0]] }, { name: 'Energy Shield', values: [['100', 0]] }], explicitMods: ['100% increased Armour and Energy Shield', '10% increased Global Defences', '+5% Chance to Block', '+100 to maximum Life while on Low Life'] }]
  const nodes = [{ stats: ['20% increased Armour and Evasion Rating', '100% increased maximum Life while stationary', '100% chance to Suppress Spell Damage while on Full Life'] }]
  const stats = estimateCoreStats(gear, nodes, { Str: 32, Int: 14 }, 1)
  assert.equal(stats.Life, 66)
  assert.equal(stats.Mana, 47)
  assert.equal(stats.Armour, 130)
  assert.equal(stats.EnergyShield, 112)
  assert.equal(stats.SpellSuppressionChance, 0)
})

test('GGG estimates are computed during parse for both weapon sets and exclude flasks', () => {
  const payload = { items: [
    { inventoryId: 'Weapon', baseType: 'Wand', explicitMods: ['+100 to maximum Life'] },
    { inventoryId: 'Weapon2', baseType: 'Wand', explicitMods: ['+50 to maximum Life'] },
    { inventoryId: 'Flask', x: 0, baseType: 'Flask', explicitMods: ['+9999 to maximum Life'] },
  ], passives: { character: 1, hashes: [] } }
  const build = fromGgg({ name: 'Estimate', class: 'Marauder', level: 10 }, payload, { nodes: [] })
  assert.equal(build.stats.Life, 274)
  assert.equal(displayedStats(build, 2).Life, 224)
  assert.strictEqual(displayedStats(build, 1), build.stats)
  assert.strictEqual(displayedStats(build, 2), build.weaponStats[2])
  assert.strictEqual(displayedStats(build, 2), displayedStats(build, 2))
  assert.ok(build.estimatedStats.includes('Life'))
  assert.strictEqual(displayedStats({ ...build, source: 'pob', stats: { Life: 9999 } }, 2).Life, 9999)
})
