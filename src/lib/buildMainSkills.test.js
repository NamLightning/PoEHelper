import test from 'node:test'
import assert from 'node:assert/strict'
import { withSocketedQuality, selectedActiveGem, damageSummary, skillRadius, mainSkillEntries } from './buildMainSkills.js'
import { completePobStats, mergeAllocatedPassives } from './buildCodec.js'

const gem = (name, extra = {}) => ({ name, level: 20, quality: 20, enabled: true, support: false, ...extra })
const support = name => gem(name, { support: true })
const group = (name, supports = 2, extra = {}) => ({ slot: 'Helmet', enabled: true, mainActiveSkill: 0, gems: [gem(name), ...Array.from({ length: supports }, (_, index) => support(['Elemental Focus Support', 'Burning Damage Support', 'Controlled Destruction Support'][index % 3]))], ...extra })
const fixture = (extra = {}) => ({ source: 'pob', mainSkill: 0, stats: { TotalDPS: 0, TotalDot: 185000, Speed: 0, CritChance: 0 }, skills: [group('Righteous Fire'), group('Fire Trap')], equipment: {}, tree: { allocated: [] }, ...extra })

test('pure DoT prioritizes TotalDot and component fallbacks without summing aggregate twice', () => {
  assert.deepEqual(damageSummary({ TotalDPS: 0, FullDPS: 0, TotalDot: 185000, BurnDPS: 185000 }), { dotOnly: true, dot: 185000, total: 185000 })
  for (const key of ['TotalDotDPS', 'DotDPS', 'BurnDPS', 'BleedDPS', 'PoisonDPS']) assert.equal(damageSummary({ TotalDPS: 0, [key]: 1200 }).total, 1200)
  assert.equal(damageSummary({ TotalDPS: 0, BurnDPS: 10, BleedDPS: 20, PoisonDPS: 30 }).dot, 60)
  assert.equal(damageSummary({ TotalDPS: 500, CombinedDPS: 750, TotalDot: 250 }).dotOnly, false)
  assert.equal(damageSummary({ TotalDPS: 500, CombinedDPS: 750, TotalDot: 250 }).total, 750)
  assert.equal(damageSummary({ TotalDPS: 500, FullDPS: 0 }).total, 500)
  assert.equal(damageSummary({ TotalDPS: 0, TotalDot: 0, TotalDotDPS: 1800 }).total, 1800)
  assert.equal(damageSummary({}).total, undefined)
})

test('socketed quality applies only the owning item, correct gem colour and skill/support type, once', () => {
  const groups = [group('Righteous Fire', 0, { gems: [gem('Righteous Fire'), gem('Fire Trap'), gem('Determination'), support('Combustion Support')] })]
  const equipment = {
    Helmet: { explicitMods: ['+10% to Quality of Socketed Blue Gems', '+4% to Quality of Socketed Green Gems'], craftedMods: ['+2% to Quality of Socketed Gems', '+3% to Quality of Socketed Skill Gems'] },
    Gloves: { explicitMods: ['+100% to Quality of Socketed Gems'] },
  }
  const result = withSocketedQuality(groups, equipment)
  assert.deepEqual(result[0].gems.slice(0, 3).map(gem => [gem.color, gem.quality]), [['B', 35], ['G', 29], ['R', 25]])
  assert.equal(result[0].gems[3].qualityBonus, 12)
  assert.equal(groups[0].gems[0].quality, 20)
  assert.deepEqual(withSocketedQuality(result, equipment), result)
})

test('AoE prioritizes saved metres and estimates RF from level, effective quality and allocated AoE', () => {
  const build = fixture({ equipment: { Helmet: { explicitMods: ['+10% to Quality of Socketed Blue Gems'] }, Gloves: { explicitMods: ['10% increased Area of Effect'] } }, tree: { allocated: [{ stats: ['10% increased Area of Effect', '100% increased Area of Effect while stationary'] }] } })
  const rf = withSocketedQuality(build.skills, build.equipment)[0].gems[0]
  assert.equal(rf.quality, 30)
  assert.deepEqual(skillRadius(build, rf, { AreaOfEffectRadius: 2.7 }), { value: 2.7, estimated: false })
  assert.deepEqual(skillRadius(build, gem('Righteous Fire', { quality: 0 }), {}), { value: 2.5, estimated: true })
  assert.deepEqual(skillRadius(fixture(), gem('Righteous Fire', { quality: 30 }), {}), { value: 2.8, estimated: true })
  assert.equal(skillRadius(build, rf, { AreaOfEffectMod: 1 }).value, 3)
  assert.equal(skillRadius(build, gem('Unknown Skill'), {}), null)
})

test('secondary damage groups qualify by links/supports but never inherit main PlayerStats', () => {
  const build = fixture({ skills: [group('Righteous Fire'), group('Fire Trap', 3), group('Grace'), group('Flame Dash', 1), group('Vortex', 3, { enabled: false }), group('Vortex', 2, { gems: [gem('Vortex', { enabled: false }), support('A'), support('B')] })] })
  const entries = mainSkillEntries(build)
  assert.deepEqual(entries.map(entry => entry.gem.name), ['Righteous Fire', 'Fire Trap'])
  assert.equal(entries[0].damage.dotOnly, true)
  assert.equal(entries[1].hasDps, false)
  assert.deepEqual(entries[1].stats, {})
  assert.equal(entries[1].supports.length, 3)
  assert.ok(mainSkillEntries({ ...build, source: 'ggg' }).every(entry => !entry.hasDps && !Object.keys(entry.stats).length))
  assert.deepEqual(build.stats, { TotalDPS: 0, TotalDot: 185000, Speed: 0, CritChance: 0 })
})

test('selected active skill index is preserved when an earlier gem is disabled', () => {
  const skills = group('Righteous Fire', 0, { mainActiveSkill: 1, gems: [gem('Grace', { enabled: false }), gem('Righteous Fire'), gem('Fire Trap')] })
  assert.equal(selectedActiveGem(skills).name, 'Righteous Fire')
  assert.equal(selectedActiveGem({ ...skills, mainActiveSkill: 50 }).name, 'Righteous Fire')
  const build = fixture({ mainSkill: 1, skills: [group('Fire Trap', 2, { includeInFullDPS: true, stats: { TotalDPS: 5000 } }), skills] })
  const entries = mainSkillEntries(build)
  assert.equal(entries[0].gem.name, 'Righteous Fire')
  assert.equal(entries[1].damage.total, 5000)
})

test('quality sums global equipment, jewel and selected mastery by tag without leaking local or swap mods', () => {
  const jewel = { id: 'jewel', explicitMods: ['+2% to Quality of all Fire Skill Gems'] }
  const equipment = {
    Helmet: { explicitMods: ['+10% to Quality of all Socketed Gems', 'Gems Socketed in Blue Sockets have +5% to Quality'] },
    Amulet: { explicitMods: ['+3% to Quality of all Skill Gems', '+4% to Quality of all Blue Skill Gems', '+6% to Quality of all Spell Skill Gems', '+70% to Quality of all Attack Skill Gems'] },
    Gloves: { explicitMods: ['+100% to Quality of Socketed Gems'] },
    'Weapon 1 Swap': { explicitMods: ['+100% to Quality of all Skill Gems'] },
    'Jewel 1': jewel,
  }
  const build = completePobStats(fixture({
    skills: [group('Righteous Fire', 0, { gems: [gem('Righteous Fire', { quality: 0, qualityId: 'Alternate1' }), support('Elemental Focus Support')] })], equipment, jewels: [jewel],
    tree: { nodes: ['1'], allocated: [] },
  }))
  // RF: local 15 + global 3+4+6+2. Jewel appears in two collections but counts once.
  assert.equal(build.skills[0].gems[0].quality, 30)
  assert.equal(build.skills[0].gems[1].quality, 35) // Local only; global Skill Gem mods exclude supports.
  const hydrated = mergeAllocatedPassives(build, { nodes: [
    { id: '1', name: 'Quality Mastery', kind: 'Mastery', stats: ['+5% to Quality of all Fire Skill Gems'] },
    { id: '2', name: 'Unallocated', stats: ['+100% to Quality of all Skill Gems'] },
  ] })
  assert.equal(hydrated.skills[0].gems[0].quality, 35)
  assert.ok(hydrated.skills[0].gems[0].qualitySources.some(source => source.label === 'Quality Mastery'))
  assert.equal(completePobStats(hydrated).skills[0].gems[0].quality, 35)
  assert.equal(hydrated.skills[0].gems[0].baseQuality, 0)
  assert.equal(hydrated.stats.TotalDot, 185000)
  assert.equal(build.skills[0].gems[0].quality, 30)
})

test('quality colour codes and all requested global gem tags match independently', () => {
  const groups = [group('Synthetic', 0, { gems: [gem('Synthetic', { color: 1, skillTags: ['Fire', 'Cold', 'Lightning', 'Chaos', 'Physical', 'Spell', 'Attack', 'Minion', 'Aura', 'Curse'] })] })]
  const targets = ['Fire', 'Cold', 'Lightning', 'Chaos', 'Physical', 'Spell', 'Attack', 'Minion', 'Aura', 'Curse', 'Red']
  const equipment = { Helmet: { explicitMods: [...targets.map(target => `+1% to Quality of all ${target} Skill Gems`), 'Gems Socketed in Red Sockets have +3% to Quality', 'Gems Socketed in Blue Sockets have +99% to Quality'] } }
  const result = withSocketedQuality(groups, equipment)
  assert.equal(result[0].gems[0].color, 'R')
  assert.equal(result[0].gems[0].quality, 34)
  for (const [color, name] of [[2, 'Green'], [3, 'Blue']]) {
    const changed = [{ ...groups[0], gems: [gem('Synthetic', { color })] }]
    assert.equal(withSocketedQuality(changed, { Helmet: { implicitMods: [`Gems Socketed in ${name} Sockets have +10% to Quality`] } })[0].gems[0].quality, 30)
  }
})

test('AoE combines gear/jewel/tree increases and independent less multipliers with only linked enabled supports', () => {
  const rf = group('Righteous Fire', 0, { gems: [gem('Righteous Fire'), support('Increased Area of Effect Support'), support('Concentrated Effect Support')] })
  const build = fixture({ skills: [rf], equipment: { Helmet: { explicitMods: ['10% increased Area of Effect'] }, 'Weapon 1 Swap': { explicitMods: ['200% increased Area of Effect'] } },
    jewels: [{ explicitMods: ['4% reduced Area of Effect'] }], tree: { allocated: [] } })
  // (2.3 + 20*0.015) * sqrt((1 + (10-4+49)/100) * 0.7)
  assert.deepEqual(skillRadius(build, rf.gems[0], {}, rf), { value: 2.7, estimated: true })
  const less = { ...build, tree: { allocated: [{ stats: ['10% less Area of Effect', '10% less Area of Effect'] }] } }
  assert.equal(skillRadius(less, rf.gems[0], {}, rf).value, 2.4)
  const unlinked = { ...build, skills: [rf, group('Fire Trap', 0, { gems: [gem('Fire Trap'), support('Concentrated Effect Support')] })] }
  assert.equal(skillRadius(unlinked, rf.gems[0], {}, rf).value, 2.7)
  const disabled = { ...rf, gems: rf.gems.map(gem => gem.name === 'Concentrated Effect Support' ? { ...gem, enabled: false } : gem) }
  assert.equal(skillRadius(build, disabled.gems[0], {}, disabled).value, 3.2)
  // Estimates sum actual mods; only an exported final radius is authoritative.
  assert.equal(skillRadius(build, rf.gems[0], { AreaOfEffectMod: 1 }, rf).value, 2.7)
  assert.deepEqual(skillRadius(build, rf.gems[0], { AreaOfEffectRadius: 2.7 }, rf), { value: 2.7, estimated: false })
  const trap = group('Fire Trap', 0, { gems: [gem('Fire Trap', { level: 21 }), support('Increased Area of Effect Support')] })
  assert.equal(skillRadius(fixture({ equipment: { Helmet: { explicitMods: ['51% increased Area of Effect'] } } }), trap.gems[0], {}, trap).value, 3.4)
})

test('main skill filtering requires inclusion or 4 gems plus two damage supports and always rejects utilities', () => {
  const skills = [group('Righteous Fire'),
    group('Fire Trap', 2), // Three gems do not qualify automatically.
    group('Vortex', 2, { includeInFullDPS: true }),
    group('Fire Trap', 3),
    group('Fire Trap', 0, { gems: [gem('Fire Trap'), support('Increased Duration Support'), support('Second Wind Support'), support('Lifetap Support')] }),
    ...['Frostblink', 'Shield Charge', 'Flame Dash', 'Leap Slam', 'Whirling Blades', 'Dash', 'Smoke Mine', 'Phase Run', 'Withering Step', 'Determination', 'Malevolence', 'Molten Shell', 'Steelskin', 'Immortal Call', 'Flammability'].map(name => group(name, 3, { includeInFullDPS: true })),
  ]
  assert.deepEqual(mainSkillEntries(fixture({ skills })).map(entry => entry.gem.name), ['Righteous Fire', 'Vortex', 'Fire Trap'])
  assert.equal(mainSkillEntries(fixture({ skills: [group('Frostblink', 3)] })).length, 0)
})
