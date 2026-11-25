import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateGemGroups, gemTags, gemSupportEffects, linkedSupports, auxiliaryGemStats, gemQualityExplanation, gemMods } from './buildGemCalculator.js'
import { skillRadius, skillAreaModifiers } from './buildMainSkills.js'
import { gggSkills, fromGgg, completePobStats, decodePob, parseItemText, mergeAllocatedPassives } from './buildCodec.js'
import { compactTree } from '../../server/buildData.js'

const gem = (name, level = 20, quality = 0, extra = {}) => ({ name, level, quality, support: / Support$/.test(name), enabled: true, ...extra })
const group = (gems, extra = {}) => ({ slot: 'Helmet', enabled: true, gems, ...extra })

test('only explicit PoB final quality overrides sums; two 30+10 mods never invent another 10', () => {
  const equipment = { Helmet: { explicitMods: ['+10% to Quality of all Skill Gems'] }, Amulet: { explicitMods: ['+30% to Quality of all Skill Gems'] } }
  const groups = [group([gem('Fireball', 20, 20), gem('Arc', 20, 20, { savedFinalQuality: 70 }), gem('Ice Nova', 20, 20, { savedFinalQuality: 0 })])]
  const skills = calculateGemGroups(groups, equipment)
  assert.deepEqual(skills[0].gems.map(gem => gem.quality), [60, 70, 0])
  assert.deepEqual(calculateGemGroups(skills, equipment), skills)
})

test('three selected 12% AoE nodes, including cluster nodes, contribute 36 without unallocated nodes', () => {
  const equipment = { Helmet: { explicitMods: ['11% increased Area of Effect', '10% increased Area of Effect', 'Socketed Gems are Supported by Level 18 Increased Area of Effect'] } }
  const original = { source: 'pob', mainSkill: 0, stats: {}, equipment, skills: [group([gem('Storm Burst of Repulsion', 27, 20)])], tree: { nodes: ['1', '2', '65536'], allocated: [] } }
  const build = mergeAllocatedPassives(original, { nodes: [{ id: '1', stats: ['12% increased Area of Effect'] }, { id: '2', stats: ['12% increased Area of Effect'] }, { id: '99', stats: ['999% increased Area of Effect'] }], clusterNodes: [{ id: '65536', stats: ['12% increased Area of Effect'] }] })
  const active = build.skills[0].gems[0], trace = skillAreaModifiers(build, active, build.skills[0])
  assert.equal(trace.matches.filter(row => row.category === 'TREE').reduce((sum, row) => sum + row.value, 0), 36)
  assert.equal(trace.totalIncreasedAoE, 104)
  assert.equal(skillRadius(build, active, {}, build.skills[0]).value, 3.1)
})

test('colour-first quality wording scans Grafts, jewels, passives and Config using physical sockets', () => {
  const gear = { Helmet: { sockets: 'B-R-W' }, 'Graft 1': { name: 'Graft', explicitMods: ['{mutated}Blue Skill Gems have +10% to Quality'] } }
  const jewels = [{ name: 'Jewel', explicitMods: ['Blue Gems have +3% to Quality'] }]
  const nodes = [{ name: 'Mastery', stats: ['Red Gems have +4% to Quality'] }]
  const customMods = ['{tags:gem}Green Skill Gems have +5% to Quality']
  const skills = calculateGemGroups([group([0, 1, 2].map(socketIndex => gem('Fireball', 20, 20, { socketIndex })))], gear, jewels, nodes, {}, customMods)
  assert.deepEqual(skills[0].gems.map(gem => gem.quality), [33, 24, 42])
  assert.deepEqual(calculateGemGroups(skills, gear, jewels, nodes, {}, customMods), skills)
})

test('quality variants and Config mods apply once and survive repeated PoB stat completion', () => {
  const customMods = ['{tags:gem}Gems in Blue Sockets have +10% to Quality',
    '+3% to Quality of Blue Skill Gems', '+2% to Quality of all Socketed Gems', '5% increased Area of Effect']
  const original = { source: 'pob', stats: {}, mainSkill: 0, customMods,
    equipment: { Helmet: { sockets: 'B-R-W', explicitMods: ['+4% to Quality of Socketed Blue Skill Gems'] } },
    tree: { nodes: ['65536'], allocated: [{ id: '65536', name: 'Cluster Passive', stats: ['+6% to Quality of Socketed Blue Gems', '36% increased Area of Effect'] }] },
    skills: [group([0, 1, 2].map(socketIndex => gem('Fireball', 20, 20, { socketIndex })))] }
  const build = completePobStats(original)
  assert.deepEqual(build.skills[0].gems.map(gem => gem.quality), [45, 22, 45])
  assert.equal(skillAreaModifiers(build, build.skills[0].gems[0], build.skills[0]).totalIncreasedAoE, 41)
  assert.deepEqual(completePobStats(build).skills, build.skills)
  assert.equal(build.skills[0].gems[0].qualitySources.filter(source => source.value === 4).length, 1)
})

test('raw item recovery and selected mastery retain 104% AoE and 70% quality through PoB completion', () => {
  const helmet = parseItemText(`Rarity: RARE\nAny Helm\nHubris Circlet\nSockets: B\n11% increased Area of Effect\n{crafted}10% increased Area of Effect\nSocketed Gems are Supported by Level 18 Increased Area of Effect`, 'h')
  // Reproduce an older/partial parsed object; raw text is still authoritative.
  helmet.explicitMods = []; helmet.craftedMods = []
  const data = { nodes: { 1: { name: 'Area', stats: ['36% increased Area of Effect'] },
    42: { name: 'Quality Mastery', isMastery: true, masteryEffects: [{ effect: 7, stats: ['{tags:gem}Gems Socketed in Blue Sockets have +10% to Quality'] }, { effect: 8, stats: ['+99% to Quality of all Skill Gems'] }] } }, constants: { skillsPerOrbit: [1], orbitRadii: [0] } }
  const metadata = compactTree(data, ['1'], { 42: 7 })
  const original = { source: 'pob', mainSkill: 0, stats: { TotalDPS: 19400000, AreaOfEffectInc: 83, AreaOfEffectMod: 1.83 },
    equipment: { Helmet: helmet, Amulet: { explicitMods: ['+30% to Quality of all Skill Gems'] }, Ring: { explicitMods: ['+10% to Quality of all Skill Gems'] } },
    skills: [group([gem('Storm Burst of Repulsion', 27, 20)])], tree: { nodes: ['1'], masteries: { 42: 7 } } }
  const build = completePobStats(mergeAllocatedPassives(original, metadata)), active = build.skills[0].gems[0]
  assert.equal(active.quality, 70)
  assert.equal(skillAreaModifiers(build, active, build.skills[0]).totalIncreasedAoE, 104)
  assert.equal(skillRadius(build, active, build.stats, build.skills[0]).value, 3.1)
  assert.equal(build.stats.TotalDPS, 19400000)
  assert.equal(completePobStats(build).skills[0].gems[0].quality, 70)
  assert.ok(active.qualitySources.some(row => row.label === 'Quality Mastery' && row.value === 10))
})

test('raw fallback respects variants and repeated occurrences without duplicating parsed mods', () => {
  const item = { explicitMods: ['11% increased Area of Effect'], rawText: 'Selected Variant: 2\n{variant:1}99% increased Area of Effect\n{variant:2}11% increased Area of Effect\n{crafted}11% increased Area of Effect' }
  assert.deepEqual(gemMods(item), ['11% increased Area of Effect', '11% increased Area of Effect'])
})

test('AoE trace counts every item line, jewel, tree, skill/support and auxiliary source before the radius formula', () => {
  const helmet = parseItemText(`Rarity: RARE\nAny Helm\nHubris Circlet\nSockets: B\n{tags:area}11% increased Area of Effect\n{crafted}10% increased Area of Effect\n{fractured}5% increased Area of Effect of Socketed Fire Gems\n{tags:support}Socketed Gems are Supported by Level 20 Increased Area of Effect`, 'helm')
  const equipment = { Helmet: helmet, Body: { explicitMods: ['9% increased Area of Effect'] },
    Gloves: { explicitMods: ['999% increased Area of Effect of Socketed Gems'] },
    'Flask 1': { baseType: 'Prismatic Tincture', explicitMods: ['{mutated}3% increased Area of Effect'] },
    'Flask 2': { baseType: 'Ruby Flask', explicitMods: ['999% increased Area of Effect'] },
    Runegraft: { explicitMods: ['4% increased Area of Effect'] },
    'Weapon 1 Swap': { explicitMods: ['999% increased Area of Effect'] } }
  const jewels = [{ name: 'Any Jewel', explicitMods: ['{range:0.5}7% increased Area of Effect'] }]
  const allocated = [{ name: 'Allocated Mastery', stats: ['{tags:area}13% increased Area of Effect\n2% reduced Area of Effect', '10% less Area of Effect'] }]
  const skills = calculateGemGroups([group([gem('Fireball', 20, 0), gem('Concentrated Effect Support')])], equipment, jewels, allocated)
  const build = { equipment, jewels, skills, tree: { allocated } }, active = skills[0].gems[0]
  const trace = skillAreaModifiers(build, active, skills[0])
  assert.equal(trace.totalIncreasedAoE, 109) // 60 from item/jewel/tree/local + 49 from the level-20 support.
  assert.ok(Math.abs(trace.moreLessAreaMultiplier - 0.63) < 1e-8)
  assert.deepEqual(trace.matches.filter(row => row.label.includes('Any Helm') && row.scope === 'global').map(row => row.value), [11, 10])
  const bare = skillRadius({ equipment: {}, skills: [] }, active, {}).value
  assert.equal(skillRadius(build, active, {}, skills[0]).value, +(bare * Math.sqrt(2.09 * 0.63)).toFixed(1))
  assert.deepEqual(skillRadius(build, active, { AreaOfEffectRadius: 5.5 }, skills[0]), { value: 5.5, estimated: false })
})

test('both socket quality syntaxes scan all sources and use the actual socket, with white matching every colour', () => {
  const equipment = { Helmet: { sockets: 'R-W-B', explicitMods: ['{crafted}+3% to Quality of Socketed Red Gems'] },
    Ring: { explicitMods: ['{tags:gem}+5% to Quality of Socketed Green Gems'] },
    'Flask 1': { baseType: 'Any Tincture', explicitMods: ['{tags:gem}+7% to Quality of Socketed Blue Gems'] },
    Runegraft: { implicitMods: ['Gems Socketed in White Sockets have +1% to Quality'] } }
  const jewel = { id: 'j', explicitMods: ['{range:0.5}Gems Socketed in Blue Sockets have +11% to Quality'] }
  equipment.Jewel = jewel
  const allocated = [{ name: 'Mastery', stats: ['{mutated}+13% to Quality of Socketed Blue Gems'] }]
  const result = calculateGemGroups([group([0, 1, 2].map(socketIndex => gem('Fireball', 20, 20, { socketIndex })))], equipment, [jewel], allocated)
  assert.deepEqual(result[0].gems.map(gem => gem.quality), [23, 60, 51])
  assert.equal(result[0].gems[1].qualitySources.length, 6)
  assert.deepEqual(calculateGemGroups(result, equipment, [jewel], allocated), result)
})

test('GGG parsing and exported codes retain Runegraft and Tincture gem modifier sources', () => {
  const items = [
    { id: 'h', inventoryId: 'Helm', name: 'Any Helm', sockets: [{ group: 0, sColour: 'B' }], socketedItems: [{ frameType: 4, socket: 0, typeLine: 'Fireball', properties: [{ name: 'Level', values: [['20', 0]] }] }] },
    { id: 't', inventoryId: 'Flask', x: 0, baseType: 'Any Tincture', explicitMods: ['+5% to Quality of Socketed Blue Gems'] },
    { id: 'r', inventoryId: 'Runegraft', x: 0, baseType: 'Any Runegraft', explicitMods: ['+7% to Quality of Socketed Blue Gems'] },
  ]
  assert.equal(gggSkills(items)[0].gems[0].quality, 12)
  const build = fromGgg({ level: 90 }, { items, passives: {} })
  assert.equal(build.skills[0].gems[0].quality, 12)
  assert.match(decodePob(build.code), /Any Runegraft/)
  assert.match(decodePob(build.code), /Any Tincture/)
})

test('PoB technical prefixes are stripped before filtering and matching quality, AoE and item supports', () => {
  const helmet = parseItemText(`Rarity: RARE\nAny Helmet\nHubris Circlet\nSockets: B-B-B-B\n{tags:gem}{mutated}Gems Socketed in Blue Sockets have +10% to Quality\n{crafted}{range:0.5}21% increased Area of Effect of Socketed Gems\n{fractured}+10% to Quality of Socketed Gems\n{tags:gem}Socketed Gems are Supported by Level 20 Increased Area of Effect`, 'helmet')
  assert.ok(helmet.explicitMods.includes('Gems Socketed in Blue Sockets have +10% to Quality'))
  assert.ok(helmet.craftedMods.includes('21% increased Area of Effect of Socketed Gems'))
  const equipment = { Helmet: helmet, Amulet: { name: 'Any Amulet', explicitMods: ['{tags:gem}+30% to Quality of all Skill Gems'] } }
  const groups = calculateGemGroups([group([gem('Storm Burst of Repulsion', 27, 20)])], equipment)
  const active = groups[0].gems[0]
  assert.equal(active.quality, 70)
  assert.match(gemQualityExplanation(active), /20% gốc.*\+10%.*\+10%.*Socket Colour.*\+30%.*= 70%/)
  assert.equal(groups[0].gems.filter(gem => gem.isItemSupport).length, 1)
  const radius = skillRadius({ equipment, skills: groups }, active, {}, groups[0])
  const noLocal = { ...helmet, rawText: '', craftedMods: [] }
  const without = skillRadius({ equipment: { ...equipment, Helmet: noLocal }, skills: groups }, active, {}, groups[0])
  assert.ok(radius.value > without.value)
  assert.deepEqual(calculateGemGroups(groups, equipment), groups)
})

test('socket colour contributions scan equipment, jewels and selected passives exactly once', () => {
  const line = '{tags:gem}Gems Socketed in Blue Sockets have +10% to Quality'
  const jewel = { id: 'jewel', name: 'Jewel source', explicitMods: [line] }
  const equipment = { Helmet: { sockets: 'B', implicitMods: [line] }, Ring: { name: 'Ring source', explicitMods: [line] },
    'Weapon 1 Swap': { explicitMods: [line] }, Jewel: jewel }
  const nodes = [{ name: 'Mastery source', stats: [line, '{mutated}21% increased Area of Effect'] }]
  const groups = calculateGemGroups([group([gem('Storm Burst of Repulsion', 20, 20)])], equipment, [jewel], nodes)
  assert.equal(groups[0].gems[0].quality, 60)
  assert.equal(groups[0].gems[0].qualitySources.length, 4)
  const radius = skillRadius({ equipment, jewels: [jewel], skills: groups, tree: { allocated: nodes } }, groups[0].gems[0], {}, groups[0])
  const bare = skillRadius({ equipment, jewels: [jewel], skills: groups }, groups[0].gems[0], {}, groups[0])
  assert.ok(radius.value > bare.value)
})

test('all tags drive local OR and global conjunctions without double counting or item-name rules', () => {
  const gear = { Helmet: { explicitMods: ['+1 to Level of Socketed Gems', '+2 to Level of Socketed Fire or Spell Gems', '+3 to Level of Socketed Projectile Gems'] },
    Amulet: { implicitMods: ['+1 to Level of all Skill Gems', '+2 to Level of all Fire Spell Skill Gems', '+3 to Level of all Projectile Skill Gems'] },
    Gloves: { explicitMods: ['+99 to Level of Socketed Gems'] } }
  const nodes = [{ name: 'Mastery', stats: ['+1 to Level of all Spell Skill Gems'] }]
  const result = calculateGemGroups([group([gem('Fireball'), gem('Arc'), gem('Added Cold Damage Support')])], gear, [], nodes)[0].gems
  assert.equal(result[0].level, 33) // base20 + local1+2+3 + global1+2+3+1
  assert.equal(result[1].level, 25) // base20 + local1+2 + global1+1
  assert.equal(result[2].level, 21)
  assert.ok(gemTags(gem('Ice Nova')).has('nova'))
  assert.ok(gemTags(gem('Storm Brand')).has('brand'))
  assert.ok(gemTags(gem('Blade Flurry')).has('channel'))
})

test('physical white sockets match every requested socket colour; global support quality works', () => {
  const equipment = { Helmet: { sockets: [{ group: 0, sColour: 'W' }, { group: 0, sColour: 'R' }],
    explicitMods: ['Gems Socketed in White Sockets have +10% to Quality', 'Gems Socketed in Blue Sockets have +99% to Quality', '+2% to Quality of Socketed Blue Gems'] },
    Amulet: { explicitMods: ['+3% to Quality of all Skill Gems', '+7% to Quality of all Support Gems'] } }
  const groups = [group([gem('Fireball', 20, 5), gem('Elemental Focus Support', 20, 5)])]
  const result = calculateGemGroups(groups, equipment)
  assert.equal(result[0].gems[0].quality, 119)
  assert.equal(result[0].gems[0].socketColor, 'W')
  assert.equal(result[0].gems[0].color, 'B')
  assert.equal(result[0].gems[1].quality, 12) // Physical red socket does not match the blue quality mod.
  assert.deepEqual(calculateGemGroups(result, equipment), result)
  assert.equal(groups[0].gems[0].quality, 5)
})

test('support levels are resolved before Empower/Enhance, and only linked active gems gain their bonuses', () => {
  const groups = [group([gem('Fireball', 20, 10), gem('Empower Support', 3), gem('Enhance Support', 3)]), group([gem('Arc', 20, 10)])]
  const equipment = { Helmet: { craftedMods: ['+1 to Level of Socketed Support Gems'] } }
  const result = calculateGemGroups(groups, equipment)
  assert.deepEqual(result[0].gems.map(gem => gem.level), [23, 4, 4])
  assert.equal(result[0].gems[0].quality, 34)
  assert.equal(result[1].gems[0].level, 20)
  assert.equal(result[1].gems[0].quality, 10)
  assert.deepEqual(calculateGemGroups(result, equipment), result)
})

test('socket strings preserve physical order and explicit indices independently of gem colour', () => {
  const equipment = { Helmet: { sockets: ' W - B - R - G ', scourgeMods: [
    'Gems Socketed in Red Sockets have +1% to Quality',
    'Gems Socketed in Green Sockets have +2% to Quality',
    'Gems Socketed in Blue Sockets have +4% to Quality',
    'Gems Socketed in White Sockets have +8% to Quality',
  ] } }
  const groups = [group([0, 2, 1, 3].map(socketIndex => gem('Fireball', 20, 5, { socketIndex })))]
  const result = calculateGemGroups(groups, equipment)
  assert.deepEqual(result[0].gems.map(gem => gem.socketColor), ['W', 'R', 'B', 'G'])
  assert.deepEqual(result[0].gems.map(gem => gem.quality), [20, 6, 9, 7])
  assert.ok(result[0].gems.every(gem => gem.gemColor === 'B'))
  assert.deepEqual(calculateGemGroups(result, equipment), result)
  const fallback = calculateGemGroups([group([gem('Unknown', 1, 0, { gemColor: 'G' })])], {
    Helmet: { explicitMods: ['Gems Socketed in Green Sockets have +7% to Quality'] },
  })[0].gems[0]
  assert.equal(fallback.quality, 7)
  assert.equal(fallback.socketColor, 'G')
})

test('local AoE modifiers follow the socketing item and matching tags without leaking globally', () => {
  const skills = [group([gem('Fireball', 20, 0)]), group([gem('Fireball', 20, 0)], { slot: 'Gloves' })]
  const equipment = {
    Helmet: { explicitMods: ['20% increased Area of Effect', '30% increased Area of Effect of Socketed Gems',
      '40% increased Area of Effect of Socketed Fire Gems', '99% increased Area of Effect of Socketed Cold Gems'] },
    Gloves: { explicitMods: ['10% reduced Area of Effect of Socketed Spell Gems'] },
  }
  const jewels = [{ explicitMods: ['999% increased Area of Effect of Socketed Gems'] }]
  const prepared = calculateGemGroups(skills, equipment, jewels)
  const build = { equipment, jewels, skills: prepared }
  const base = skillRadius({ skills, equipment: {} }, skills[0].gems[0], {}, skills[0]).value
  assert.equal(skillRadius(build, prepared[0].gems[0], {}, prepared[0]).value, +(base * Math.sqrt(1.9)).toFixed(1))
  assert.equal(skillRadius(build, prepared[1].gems[0], {}, prepared[1]).value, +(base * Math.sqrt(1.1)).toFixed(1))
  assert.equal(skillRadius(build, prepared[0].gems[0], { AreaOfEffectMod: 1 }, prepared[0]).value, +(base * Math.sqrt(1.9)).toFixed(1))
  assert.deepEqual(skillRadius(build, prepared[0].gems[0], { AreaOfEffectRadius: 7 }, prepared[0]), { value: 7, estimated: false })
})

test('item supports reach every socket group, deduplicate with gems, and affect AoE, duration, mana and cast speed', () => {
  const equipment = { Helmet: { explicitMods: [
    'Socketed Gems are Supported by Level 20 Increased Area of Effect',
    'Socketed Gems are Supported by Level 20 Concentrated Effect with 10% increased Damage',
    'Socketed Gems are Supported by Level 20 Faster Casting',
    'Socketed Gems are Supported by Level 20 More Duration',
  ] } }
  const result = calculateGemGroups([group([gem('Vortex'), gem('Increased Area of Effect Support', 10)]), group([gem('Firestorm')])], equipment)
  for (const item of result) {
    assert.equal(item.gems.filter(gem => gem.isItemSupport).length, 4)
    const supports = linkedSupports(item)
    assert.equal(supports.filter(gem => /Increased Area of Effect/.test(gem.name)).length, 1)
    const effects = gemSupportEffects(item, item.gems[0]).effects
    assert.equal(effects.filter(effect => effect.stat === 'area' && effect.type === 'INC')[0].value, 49)
    assert.ok(effects.some(effect => effect.stat === 'area' && effect.value === -30))
    assert.ok(effects.some(effect => effect.stat === 'castSpeed' && effect.value > 0))
    assert.ok(effects.some(effect => effect.stat === 'duration' && effect.value > 0))
    assert.ok(auxiliaryGemStats(item.gems[0], item).manaCost > 0)
  }
  assert.deepEqual(calculateGemGroups(result, equipment), result)
})

test('AoE respects tags, final level/quality, support families and explicit Intensity without assuming max stacks', () => {
  const skill = gem('Firestorm'), linked = group([skill, gem('Intensify Support')])
  const unknown = gemSupportEffects(linked, skill)
  assert.ok(unknown.notes.some(note => note.includes('Intensity stacks unknown')))
  const known = gemSupportEffects(linked, skill, { 'multiplier:Intensity': 2 })
  assert.equal(known.effects.find(effect => effect.stat === 'area' && effect.type === 'MORE').value, -30)
  const build = { equipment: {}, tree: { allocated: [] }, skills: [linked], conditions: { 'multiplier:Intensity': 2 } }
  assert.ok(skillRadius(build, skill, {}, linked).value < skillRadius({ ...build, conditions: {} }, skill, {}, linked).value)
  assert.equal(skillRadius(build, gem('Arc'), { AreaOfEffectRadius: 99 }), null)
  const duplicate = group([gem('Vortex'), gem('Increased Area of Effect Support'), gem('Awakened Increased Area of Effect Support', 5)])
  assert.equal(linkedSupports(duplicate).length, 1)
  assert.equal(gemSupportEffects(duplicate, duplicate.gems[0]).effects.filter(effect => effect.stat === 'area' && effect.type === 'INC').length, 1)
})

test('added skill types enable subsequent supports while incompatible item supports are skipped', () => {
  const skill = gem('Fireball')
  const linked = group([skill, gem('Trap Support'), gem('Trap and Mine Damage Support')])
  assert.ok(gemSupportEffects(linked, skill).effects.some(effect => effect.source === 'Trap and Mine Damage Support' && effect.stat === 'damage'))
  const invalid = group([gem('Righteous Fire'), gem('Intensify Support'), gem('Faster Casting Support')])
  assert.equal(gemSupportEffects(invalid, invalid.gems[0]).effects.length, 0)
  const inferred = calculateGemGroups([group([gem('Faster Casting', 20, 0, { support: false })])])[0].gems[0]
  assert.equal(inferred.support, true)
})

test('GGG and PoB share gem maths and GGG export keeps raw bases without exporting virtual supports twice', () => {
  const item = { id: 'gear', inventoryId: 'Helm', name: 'Arbitrary Item', sockets: [{ group: 0, attr: 'W' }, { group: 0, attr: 'S' }],
    explicitMods: ['+1 to Level of Socketed Gems', '+1 to Level of Socketed Support Gems', 'Gems Socketed in White Sockets have +10% to Quality', 'Socketed Gems are Supported by Level 20 Increased Area of Effect'],
    socketedItems: [
      { frameType: 4, socket: 0, typeLine: 'Fireball', properties: [{ name: 'Level', values: [['20', 0]] }, { name: 'Quality', values: [['5%', 0]] }] },
      { frameType: 4, socket: 1, typeLine: 'Empower Support', properties: [{ name: 'Level', values: [['2', 0]] }] },
    ] }
  const live = gggSkills([item])
  const snapshot = calculateGemGroups([group([gem('Fireball', 20, 5), gem('Empower Support', 2)])], { Helmet: item })
  assert.deepEqual(live[0].gems.map(gem => [gem.name, gem.level, gem.quality]), snapshot[0].gems.map(gem => [gem.name, gem.level, gem.quality]))
  const build = fromGgg({ level: 90 }, { items: [item], passives: {} }, { nodes: [] })
  const xml = decodePob(build.code)
  assert.match(xml, /nameSpec="Fireball" level="20" quality="5"/)
  assert.doesNotMatch(xml, /nameSpec="Increased Area of Effect Support"/)
  const pob = completePobStats({ source: 'pob', equipment: { Helmet: item }, skills: snapshot, stats: { Life: 4000, TotalDPS: 12345, FireResist: 85 } })
  assert.equal(pob.stats.TotalDPS, 12345)
  assert.equal(pob.stats.FireResist, 85)
})
