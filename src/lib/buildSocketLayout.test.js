import test from 'node:test'
import assert from 'node:assert/strict'
import { equipmentSockets, adjacentTooltip } from './buildSocketLayout.js'
import { calculateGemGroups } from './buildGemCalculator.js'

test('six physical sockets snake through two columns, retaining actual groups and occupied gem indices', () => {
  const equipment = { 'Body Armour': { sockets: ['R', 'G', 'B', 'W', 'R', 'B'].map((sColour, index) => ({ sColour, group: index < 4 ? 0 : 1 })) } }
  const skills = calculateGemGroups([{ slot: 'Body Armour', socketGroup: 0, gems: [{ name: 'Fireball', level: 20, quality: 20, socketIndex: 2 }] }, { slot: 'Body Armour', socketGroup: 1, gems: [{ name: 'Arc', level: 20, quality: 20 }, { name: 'Added Cold Damage Support', support: true, isItemSupport: true }] }], equipment)
  const result = equipmentSockets({ equipment, skills }, 'Body Armour')
  assert.deepEqual(result.map(socket => [socket.col, socket.row]), [[0, 0], [1, 0], [1, 1], [0, 1], [0, 2], [1, 2]])
  assert.equal(result[2].gem.name, 'Fireball')
  assert.equal(result[4].gem.name, 'Arc')
  assert.equal(result[0].gem, undefined)
  assert.equal(result[3].colour, 'W')
  assert.deepEqual(result.map(socket => socket.socket.group), [0, 0, 0, 0, 1, 1])
})

test('item tooltip uses the available side without covering the item on desktop, and stays bounded on mobile', () => {
  const size = { width: 330, height: 400 }, viewport = { width: 1440, height: 900 }
  const left = { left: 100, right: 250, top: 100 }
  assert.ok(adjacentTooltip(left, size, viewport).left >= left.right)
  const right = { left: 1200, right: 1350, top: 800 }
  const result = adjacentTooltip(right, size, viewport)
  assert.ok(result.left + size.width <= right.left)
  assert.ok(result.top + size.height <= viewport.height - 8)
  const mobile = adjacentTooltip(left, size, { width: 360, height: 640 })
  assert.ok(mobile.left >= 8 && mobile.left + size.width <= 352)
})
