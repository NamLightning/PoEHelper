import test from 'node:test'
import assert from 'node:assert/strict'
import { gggSkills, activeSkills, auraBonuses, fromGgg, completePobStats, decodePob } from './buildCodec.js'
import { ASPECT_DATA, auraStats } from './buildAuraData.js'

const support = (name, level, socket, enabled = true) => ({ frameType: 4, typeLine: name, socket, enabled, properties: [{ name: 'Level', values: [[String(level), 0]] }] })
const item = (mods, gems = []) => ({ inventoryId: 'BodyArmour', name: 'Granted armour', scourgeMods: mods, sockets: gems.map((_, index) => ({ group: index })), socketedItems: gems })

test('Scourge granted skills accept linked text and both suffix variants; trigger and conditional grants stay excluded', () => {
  const gear = item(['Grants Level 10 [PurityOfElements::10|Purity of Elements]', 'Grants Level 20 Aspect of the Cat Skill', 'Grants Level 30 Aspect of the Spider', 'Trigger Level 20 Wrath when you Hit', 'Trigger Grants Level 20 Hatred Skill', 'Grants Level 20 Grace Skill while on Low Life'])
  const skills = activeSkills(gggSkills([gear, { ...gear, inventoryId: 'Weapon2' }, { ...gear, inventoryId: 'Offhand2' }]))
  assert.deepEqual(skills.map(gem => gem.name), ['Purity of Elements', 'Aspect of the Cat', 'Aspect of the Spider'])
  assert.ok(skills.every(gem => gem.isGranted && gem.sourceItemName === 'Granted armour'))
})

test('unlinked Generosity supports compatible item-granted auras but not Aspects, and blocked effects stay visible', () => {
  for (const name of ['Generosity Support', 'Awakened Generosity Support']) {
    const gear = item(['Grants Level 10 Purity of Elements Skill', 'Grants Level 20 Aspect of the Cat Skill'], [support(name, 20, 0)])
    const build = fromGgg({ name: 'Support test', level: 80 }, { items: [gear], passives: {} }, { nodes: [] })
    const purity = build.auraEffects.find(effect => effect.name === 'Purity of Elements')
    assert.equal(purity.appliesToSelf, false)
    assert.ok(purity.supportNotes.some(note => note.includes('does not affect you')))
    assert.equal(build.stats.FireResist, -60)
    assert.ok(!build.breakdown.FireResist.some(row => row.category === 'SKILL'))
    const cat = build.auraEffects.find(effect => effect.name === 'Aspect of the Cat')
    assert.equal(cat.appliesToSelf, true)
    assert.equal(cat.isAspect, true)
    const disabled = item(['Grants Level 10 Purity of Elements Skill'], [support(name, 20, 0, false)])
    assert.equal(auraBonuses([disabled], []).ElementalResist, 26)
  }
})

test('Empower is restricted to linked skill gems; granted levels remain fixed even with multiple Empower gems', () => {
  for (const name of ['Empower Support', 'Awakened Empower Support']) {
    const gems = [support('Purity of Fire', 19, 0), support(name, 4, 1)]
    const gear = item(['Grants Level 10 Purity of Elements Skill'], gems)
    let skills = activeSkills(gggSkills([gear]))
    assert.equal(skills.find(gem => gem.name === 'Purity of Elements').level, 10)
    assert.ok(skills.find(gem => gem.name === 'Purity of Elements').supportNotes.some(note => note.includes('level is unchanged')))
    assert.equal(skills.find(gem => gem.name === 'Purity of Fire').level, 19)
    gear.sockets[1].group = 0
    skills = activeSkills(gggSkills([gear]))
    assert.equal(skills.find(gem => gem.name === 'Purity of Fire').level, 22)
    assert.equal(skills.find(gem => gem.name === 'Purity of Fire').baseLevel, 19)
    const build = fromGgg({ level: 80 }, { items: [gear], passives: {} }, { nodes: [] })
    assert.match(decodePob(build.code), /nameSpec="Purity of Fire" level="19"/)
    assert.doesNotMatch(decodePob(build.code), /nameSpec="Purity of Fire" level="22"/)
  }
})

test('Aspects use only actual item tiers, preserve conditional phases, and never scale with aura effect', () => {
  for (const name of Object.keys(ASPECT_DATA)) for (const level of [20, 30]) {
    const gear = item([`Grants Level ${level} ${name} Skill`])
    const aura = auraBonuses([gear], [{ stats: ['100% increased effect of Non-Curse Auras from your Skills', '100% increased Effect of Auras on you'] }])
    const effect = aura.effects[0]
    assert.equal(effect.increasedAuraEffect, 0)
    assert.deepEqual(effect.stats, auraStats(name, level))
    assert.ok(effect.note)
    assert.equal(aura.ArmourFlat, undefined)
  }
  assert.equal(auraStats('Aspect of the Cat', 10), null)
  const unknown = auraBonuses([item(['Grants Level 10 Aspect of the Cat Skill'])], []).effects[0]
  assert.equal(unknown.unsupported, true)
  assert.deepEqual(unknown.stats, {})
})

test('unblocked lower-level copy wins over an unusable higher-level aura without duplicate contributions', () => {
  const blocked = item(['Grants Level 20 Purity of Elements Skill'], [support('Generosity Support', 20, 0)])
  const usable = { ...item(['Grants Level 10 Purity of Elements Skill']), inventoryId: 'Amulet' }
  const skills = activeSkills(gggSkills([blocked, usable]))
  assert.equal(skills.length, 1)
  assert.equal(skills[0].level, 10)
  assert.equal(auraBonuses([blocked, usable], []).ElementalResist, 26)
})

test('PoB saved stats never change due to Scourge skills, support gems or Aspect buffs', () => {
  const original = { FireResist: 85, Life: 3344, Armour: 100, EnergyShield: 161, SpellBlockChance: 0 }
  const build = completePobStats({ source: 'pob', stats: original, equipment: { BodyArmour: item(['Grants Level 30 Purity of Elements Skill', 'Grants Level 30 Determination Skill', 'Grants Level 30 Aspect of the Crab Skill'], [support('Empower Support', 4, 0)]) } })
  for (const [key, value] of Object.entries(original)) assert.equal(build.stats[key], value)
  assert.equal(build.breakdown.FireResist[0].category, 'POB_XML')
})
