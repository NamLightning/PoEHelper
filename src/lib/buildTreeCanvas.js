import { applyOverrides, jewelRadiusRings } from './buildTreeInteractions.js'
import { connectionArc, visibleTreeNode } from '../../shared/passiveGeometry.js'

export const isLargeNode = node => node.notable || ['Keystone', 'Mastery'].includes(node.kind)
export const nodeRadius = node => node.kind === 'Keystone' ? 62 : isLargeNode(node) ? 43 : 22

export function treeGeometry(data, tree, selectedAscendancy) {
  const active = new Set((tree.nodes || []).map(String))
  const allocated = new Map((tree.allocated || []).map(node => [String(node.id), node]))
  const ascendancyName = (data.nodes.some(node => node.ascendancy === selectedAscendancy) ? selectedAscendancy : '') || tree.ascendancy ||
    data.classes?.[tree.classId]?.ascendancies?.[tree.ascendClassId - 1] ||
    data.nodes.find(node => active.has(String(node.id)) && node.ascendancy)?.ascendancy
  const nodes = applyOverrides(data.nodes.filter(node => node.kind === 'Ascendancy'
    ? (!ascendancyName || node.ascendancy === ascendancyName)
    : visibleTreeNode(node, data)).map(node => {
    const saved = allocated.get(String(node.id)) || node.aliases?.map(id => allocated.get(String(id))).find(Boolean)
    return { ...node, ...(saved ? { ...saved, group: node.group, orbit: node.orbit, orbitIndex: node.orbitIndex, groupX: node.groupX, groupY: node.groupY, orbitRadius: node.orbitRadius, x: node.x, y: node.y, out: node.out, icon: saved.icon || node.icon, notable: saved.notable ?? node.notable } : {}), id: String(node.id), active: Boolean(node.isAscendancyStart) || active.has(String(node.id)) || Boolean(node.aliases?.some(id => active.has(String(id)))) }
  }), tree.overrides)
  const byId = new Map(nodes.map(node => [node.id, node]))
  const edges = [], ascendancyEdges = [], seen = new Set(), spatial = new Map()
  const straightEdges = new Set()
  for (const node of nodes) for (const connection of node.out || []) if (connection && typeof connection === 'object' && (connection.isStraight || connection.straight)) straightEdges.add([node.id, String(connection.id)].sort().join(':'))
  const main = nodes
  for (const node of nodes) {
    const cell = `${Math.floor(node.x / 260)},${Math.floor(node.y / 260)}`
    if (!spatial.has(cell)) spatial.set(cell, [])
    spatial.get(cell).push(node)
    for (const connection of node.out || []) {
      if (connection == null) continue
      const id = typeof connection === 'object' ? connection.id : connection
      const target = byId.get(String(id)), key = [node.id, String(id)].sort().join(':')
      if (!target || seen.has(key)) continue
      seen.add(key)
      const edge = { from: node, to: target, active: node.active && target.active, arc: connectionArc(node, target, data, straightEdges.has(key)) }
      if (node.kind === 'Ascendancy' && target.kind === 'Ascendancy') { ascendancyEdges.push(edge); edges.push(edge) }
      else if (node.kind !== 'Ascendancy' && target.kind !== 'Ascendancy') edges.push(edge)
    }
  }
  const bounds = list => {
    if (!list.length) return { x: -500, y: -500, width: 1000, height: 1000 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of list) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y) }
    return { x: minX - 220, y: minY - 220, width: maxX - minX + 440, height: maxY - minY + 440 }
  }
  const ascendancy = nodes.filter(node => node.kind === 'Ascendancy')
  const icons = nodes.filter(node => (node.active || node.clusterGenerated) && isLargeNode(node) && (node.icon || node.iconKey)).sort((a, b) => Number(b.active) - Number(a.active) || ({ Ascendancy: 0, Keystone: 1, Mastery: 2 }[a.kind] ?? 3) - ({ Ascendancy: 0, Keystone: 1, Mastery: 2 }[b.kind] ?? 3)).slice(0, 35)
  return { nodes, rings: jewelRadiusRings(nodes, tree.socketedJewels, data.constants), main, edges, ascendancyEdges, spatial, bounds: bounds(main), ascendancy, ascendancyBounds: bounds(ascendancy), icons }
}

export function nearestTreeNode(geometry, x, y, scale, ascendancyOnly = false) {
  let found = null, distance = Infinity
  const tolerance = Math.max(65, 9 / scale), span = Math.ceil(tolerance / 260)
  const cx = Math.floor(x / 260), cy = Math.floor(y / 260)
  for (let dx = -span; dx <= span; dx++) for (let dy = -span; dy <= span; dy++) {
    for (const node of geometry.spatial.get(`${cx + dx},${cy + dy}`) || []) {
      if (ascendancyOnly && node.kind !== 'Ascendancy') continue
      const d = Math.hypot(node.x - x, node.y - y)
      if (d < Math.max(nodeRadius(node), 9 / scale) && d < distance) { found = node; distance = d }
    }
  }
  return found
}

export function passiveTreeUrl(tree) {
  if (/^https:\/\/(?:www\.)?pathofexile\.com\/passive-skill-tree\//.test(tree.url || '')) return tree.url
  const ids = [...new Set((tree.nodes || []).map(Number))].filter(id => Number.isInteger(id) && id >= 0 && id < 131072)
  const regular = ids.filter(id => id < 65536).slice(0, 255), clusters = ids.filter(id => id >= 65536).slice(0, 255)
  const masteries = Object.entries(tree.masteries || {}).filter(([id, effect]) => +id <= 65535 && +effect <= 65535).slice(0, 255)
  const bytes = new Uint8Array(9 + regular.length * 2 + clusters.length * 2 + masteries.length * 4)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 6); bytes[4] = tree.classId || 0; bytes[5] = tree.ascendClassId || 0; bytes[6] = regular.length
  let offset = 7
  for (const id of regular) { view.setUint16(offset, id); offset += 2 }
  bytes[offset++] = clusters.length
  for (const id of clusters) { view.setUint16(offset, id - 65536); offset += 2 }
  bytes[offset++] = masteries.length
  for (const [id, effect] of masteries) { view.setUint16(offset, +effect); view.setUint16(offset + 2, +id); offset += 4 }
  return `https://www.pathofexile.com/passive-skill-tree/${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

