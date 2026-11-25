import { itemSockets } from './buildGemCalculator.js'

// PoE socket order snakes down the item: 0—1, 3—2, 4—5.
export function equipmentSockets(build, slot) {
  const item = build?.equipment?.[slot]
  const groups = (build?.skills || []).filter(group => group.slot === slot && !group.grantedBy)
  const gems = groups.flatMap(group => group.gems.filter(gem => !gem.isItemSupport && !gem.isGranted).map(gem => ({ gem, group })))
  return itemSockets(item).slice(0, 6).map((socket, index) => {
    const entry = gems.find(entry => entry.gem.socketIndex === index)
    const row = Math.floor(index / 2), col = row % 2 ? 1 - index % 2 : index % 2
    return { ...entry, index, row, col, socket, colour: socket.sColour || ({ S: 'R', D: 'G', I: 'B', G: 'W' })[socket.attr] || 'W' }
  })
}

export function adjacentTooltip(anchor, size, viewport) {
  const gap = 12, right = viewport.width - anchor.right - gap, left = anchor.left - gap
  const width = Math.min(size.width, viewport.width - 16)
  let x = right >= width ? anchor.right + gap : left >= width ? anchor.left - width - gap : right >= left ? anchor.right + gap : 8
  // Prefer the side with enough space; narrow screens use a bounded overlay.
  x = Math.max(8, Math.min(x, viewport.width - width - 8))
  return { left: x, top: Math.max(8, Math.min(anchor.top, viewport.height - size.height - 8)) }
}
