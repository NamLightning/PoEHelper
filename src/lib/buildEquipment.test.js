import test from 'node:test'
import assert from 'node:assert/strict'
import { equippedJewels, gggEquipmentEntries, specialEquipmentEntries } from './buildEquipment.js'
import { fromGgg, decodePob } from './buildCodec.js'
import { applyBuildIcons } from './buildIcons.js'

test('unknown attached slots survive GGG parsing, including repeated inventory IDs; backpack and jewels stay separate', () => {
  const items = [
    { id: 't', inventoryId: 'Trinket' }, { id: 'h', inventoryId: 'Helm' },
    { id: 'a', inventoryId: 'Graft', x: 0 }, { id: 'b', inventoryId: 'Graft', x: 1 },
    { id: 'c', inventoryId: 'Future Mechanic' }, { id: 'j', inventoryId: 'PassiveJewels' },
    { id: 'bag', inventoryId: 'MainInventory' }, { id: 'f', inventoryId: 'Flask', x: 0 },
  ]
  const equipment = Object.fromEntries(gggEquipmentEntries(items))
  assert.deepEqual(Object.keys(equipment), ['Trinket', 'Helmet', 'Graft 1', 'Graft 2', 'Future Mechanic', 'Flask 1'])
  assert.deepEqual(specialEquipmentEntries(equipment).map(([slot]) => slot), ['Graft 1', 'Graft 2', 'Future Mechanic'])
  assert.equal(specialEquipmentEntries({ Helmet: items[1], Trinket: items[0], 'Weapon 1 Swap': items[1], 'Flask 1': items[7] }).length, 0)
})

test('Wickerman and Trinket participate in GGG stats/gem modifiers, icons and raw PoB export', () => {
  const helmet = { id: 'h', inventoryId: 'Helm', baseType: 'Any Helmet', sockets: [{ group: 0, sColour: 'B' }], socketedItems: [{ frameType: 4, typeLine: 'Fireball', socket: 0, properties: [{ name: 'Level', values: [['20', 0]] }, { name: 'Quality', values: [['20%', 0]] }] }] }
  const special = { id: 'w', inventoryId: 'Wickerman', baseType: 'Any Special Item', explicitMods: ['+10% to Quality of all Skill Gems', '+10 to maximum Life', '+12% to Fire Resistance'] }
  const trinket = { id: 't', inventoryId: 'Trinket', baseType: "Thief's Trinket", frameType: 2, explicitMods: ['+7 to maximum Life'] }
  const baseline = fromGgg({ level: 90 }, { items: [helmet], passives: {} })
  const build = fromGgg({ level: 90 }, { items: [helmet, special, trinket], passives: {} })
  assert.equal(build.equipment.Trinket.id, 't')
  assert.equal(build.equipment.Wickerman.id, 'w')
  assert.equal(build.stats.Life - baseline.stats.Life, 17)
  assert.equal(build.stats.FireResist - baseline.stats.FireResist, 12)
  assert.equal(build.skills[0].gems[0].quality, 30)
  const xml = decodePob(build.code)
  assert.match(xml, /Slot name="Trinket"/)
  assert.match(xml, /Slot name="Wickerman"/)
  assert.match(xml, /Any Special Item/)
  const icons = applyBuildIcons(build, { 'Any Special Item': 'https://web.poecdn.com/special.png', "Thief's Trinket": 'https://web.poecdn.com/trinket.png' })
  assert.ok(icons.equipment.Wickerman.icon.endsWith('/special.png'))
  assert.ok(icons.equipment.Trinket.icon.endsWith('/trinket.png'))
})

test('jewel references are not duplicated under Wickerman and arbitrary slot names are accepted', () => {
  const jewel = { id: 'j' }
  assert.deepEqual(specialEquipmentEntries({ 'Jewel 1': jewel, 'Jewels': jewel, Companion: { id: 'c' }, 'Corpse 2': { id: 'd' }, 'Graft 1': { id: 'g' } }, [jewel]).map(([slot]) => slot), ['Companion', 'Corpse 2', 'Graft 1'])
})

test('all jewel classes and abyssal sockets appear once under Jewels, never Wickerman', () => {
  const abyss = ['Ghastly', 'Murderous', 'Searching', 'Hypnotic'].map((name, i) => ({ id: `abyss-${i}`, baseType: `${name} Eye Jewel` }))
  const cluster = { id: 'cluster', itemClass: 'Cluster Jewels' }
  const timeless = { id: 'timeless', baseType: 'Timeless Jewel' }
  const equipment = { Belt: { socketedItems: abyss }, 'Abyssal Socket': abyss[0], Companion: cluster, 'Graft 1': { id: 'graft', baseType: 'Special Head' }, 'Weapon 1 Swap': { socketedItems: [{ id: 'inactive', baseType: 'Cobalt Jewel' }] } }
  const jewels = equippedJewels(equipment, [timeless, abyss[0]])
  assert.equal(jewels.length, 6)
  assert.ok(abyss.every(item => jewels.includes(item)))
  assert.ok(jewels.includes(cluster))
  assert.deepEqual(specialEquipmentEntries(equipment, jewels).map(([slot]) => slot), ['Graft 1'])
})
