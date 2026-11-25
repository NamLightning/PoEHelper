export const SLOT_NAMES = { Weapon: 'Weapon 1', Offhand: 'Weapon 2', Weapon2: 'Weapon 1 Swap', Offhand2: 'Weapon 2 Swap', Helm: 'Helmet', BodyArmour: 'Body Armour', Gloves: 'Gloves', Boots: 'Boots', Belt: 'Belt', Amulet: 'Amulet', Ring: 'Ring 1', Ring2: 'Ring 2', Trinket: 'Trinket' }
const standardSlots = new Set([...Object.values(SLOT_NAMES)])

export const isJewel = item => [item?.baseType, item?.typeLine, item?.itemClass, item?.className].some(value => typeof value === 'string' && /Jewel/i.test(value))

// Include abyssal sockets on gear as well as named slots and passive sockets.
export function equippedJewels(equipment = {}, jewels = []) {
  const result = [], seen = new Set()
  const add = item => {
    if (!item) return
    const key = item.id || item
    if (seen.has(key)) return
    seen.add(key)
    result.push(item)
  }
  jewels.forEach(add)
  for (const [slot, item] of Object.entries(equipment)) {
    if (/Swap/i.test(slot)) continue
    if (isJewel(item)) add(item)
    for (const socketed of item?.socketedItems || []) if (isJewel(socketed)) add(socketed)
  }
  return result
}

// Character-window items are attached to named inventory slots. Preserve unknown
// equipped slots without maintaining an item-name or league-mechanic allowlist.
export const isEquippedInventoryItem = item => typeof item?.inventoryId === 'string' && Boolean(item.inventoryId.trim()) && !/^(?:PassiveJewels|MainInventory|ExpandedMainInventory|Cursor|Stash)$/i.test(item.inventoryId)

export function gggEquipmentEntries(items) {
  const equipped = items.filter(isEquippedInventoryItem), counts = new Map(), seen = new Set()
  for (const item of equipped) counts.set(item.inventoryId, (counts.get(item.inventoryId) || 0) + 1)
  return equipped.map(item => {
    const inventory = item.inventoryId
    let slot = SLOT_NAMES[inventory] || (inventory === 'Flask' ? `Flask ${Number(item.x || 0) + 1}` : inventory)
    if (!SLOT_NAMES[inventory] && inventory !== 'Flask' && counts.get(inventory) > 1) slot += ` ${Number(item.x || 0) + 1}`
    const base = slot
    for (let index = 2; seen.has(slot); index++) slot = `${base} ${index}`
    seen.add(slot)
    return [slot, item]
  })
}

export function specialEquipmentEntries(equipment = {}, jewels = []) {
  const jewelIds = new Set(jewels.filter(item => item?.id).map(item => item.id))
  return Object.entries(equipment).filter(([slot, item]) => item && !isJewel(item) && !standardSlots.has(slot) && !/^Flask [1-5]$/i.test(slot) && !/Swap|^(?:Passive)?Jewels?(?: \d+)?$/i.test(slot) && !jewels.includes(item) && !(item.id && jewelIds.has(item.id)))
}
