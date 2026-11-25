const angles16 = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330]
const angles40 = [0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 130, 135, 140, 150, 160, 170, 180, 190, 200, 210, 220, 225, 230, 240, 250, 260, 270, 280, 290, 300, 310, 315, 320, 330, 340, 350]

export function orbitAngle(index, count) {
  return (count === 16 ? angles16[index] : count === 40 ? angles40[index] : 360 * index / Math.max(1, count)) * Math.PI / 180
}

export function orbitPosition(group = {}, orbit = 0, orbitIndex = 0, constants = {}) {
  const radius = constants.orbitRadii?.[orbit] || 0
  const angle = orbitAngle(orbitIndex, constants.skillsPerOrbit?.[orbit] || 1)
  const groupX = Number(group.x) || 0, groupY = Number(group.y) || 0
  return { x: groupX + Math.sin(angle) * radius, y: groupY - Math.cos(angle) * radius, groupX, groupY, orbitRadius: radius }
}

export function visibleTreeNode(node, data = {}) {
  const group = typeof node.group === 'object' ? node.group : data.groups?.[node.group]
  if (node.isProxy) return false
  if ((node.groupIsProxy || group?.isProxy) && !node.clusterGenerated) return false
  if (node.expansionSubgraph && !node.expansionActive) return false
  return true
}

export function connectionArc(from, to, data = {}, straight = false) {
  if (straight || from.group == null || to.group == null || from.group !== to.group || from.orbit == null || from.orbit !== to.orbit) return null
  if (from.straightOut?.includes(String(to.id)) || to.straightOut?.includes(String(from.id))) return null
  const group = typeof from.group === 'object' ? from.group : data.groups?.[from.group]
  const x = from.groupX ?? group?.x, y = from.groupY ?? group?.y
  const radius = from.orbitRadius ?? data.constants?.orbitRadii?.[from.orbit]
  if (![x, y, radius].every(Number.isFinite) || radius <= 0) return null
  const start = Math.atan2(from.y - y, from.x - x), end = Math.atan2(to.y - y, to.x - x)
  const delta = ((end - start + Math.PI * 3) % (Math.PI * 2)) - Math.PI
  return { x, y, radius, start, end: start + delta, anticlockwise: delta < 0 }
}

export function traceTreeEdge(ctx, edge) {
  ctx.moveTo(edge.from.x, edge.from.y)
  if (edge.arc) { const a = edge.arc; ctx.arc(a.x, a.y, a.radius, a.start, a.end, a.anticlockwise) }
  else ctx.lineTo(edge.to.x, edge.to.y)
}
