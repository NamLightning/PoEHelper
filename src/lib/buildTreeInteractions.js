// Radius units match PoB's post-3.16 tree coordinate system.
// https://github.com/PathOfBuildingCommunity/PathOfBuilding/blob/dev/src/Modules/Data.lua
export const JEWEL_RADII = {
  Small: { inner: 0, outer: 960 }, Medium: { inner: 0, outer: 1440 },
  Large: { inner: 0, outer: 1800 }, 'Very Large': { inner: 0, outer: 2400 },
  Massive: { inner: 0, outer: 2880 },
}
const lines = value => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : [])
  .flatMap(v => typeof v === 'string' ? [v.replace(/\{[^}]*\}/g, '').trim()] : []).filter(Boolean)

export function normalizeOverrides(...sources) {
  const result = {}
  for (const source of sources) for (const [key, value] of Object.entries(source || {})) {
    if (!value || typeof value !== 'object') continue
    const id = String(value.nodeId ?? value.node_id ?? value.id ?? key)
    const name = value.name || value.dn || value.displayName
    if (!/^\d+$/.test(id) || typeof name !== 'string') continue
    result[id] = { id, name, stats: lines(value.stats ?? value.sd ?? value.description), icon: value.icon, kind: /Tattoo/i.test(name) ? 'Tattoo' : 'Passive' }
  }
  return result
}
export function applyOverrides(nodes, overrides = {}) {
  return nodes.map(node => overrides[String(node.id)] ? { ...node, ...overrides[String(node.id)], stats: overrides[String(node.id)].stats } : node)
}
export function groupedNodes(nodes) {
  const groups = new Map()
  for (const node of nodes) {
    const key = node.kind + ':' + node.name
    if (!groups.has(key)) groups.set(key, { ...node, key, nodeIds: [], stats: [] })
    const group = groups.get(key)
    group.nodeIds.push(String(node.id))
    group.stats = [...new Set([...group.stats, ...(node.stats || [])])]
  }
  return [...groups.values()]
}
export function jewelRadiusRings(nodes, sockets = [], constants = {}) {
  const byId = new Map(nodes.map(n => [String(n.id), n]))
  const rings = []
  for (const { nodeId, item } of sockets) {
    const socket = byId.get(String(nodeId))
    if (!socket || !item) continue
    const text = [item.rawText, ...(item.properties || []).map(p => p.name + ': ' + (p.values || []).map(v => v[0]).join(' ')), ...(item.explicitMods || []), ...(item.implicitMods || [])].filter(Boolean).join('\n')
    const label = text.match(/Radius:\s*(Very Large|Massive|Large|Medium|Small)/i)?.[1] || text.match(/Only affects Passives in (?:a )?(Very Large|Massive|Large|Medium|Small) Ring/i)?.[1]
    if (!label) continue // No guessed radius for ordinary jewels.
    const name = Object.keys(JEWEL_RADII).find(k => k.toLowerCase() === label.toLowerCase())
    const custom = constants.jewelRadii?.[name]
    let radius = typeof custom === 'number' ? { inner: 0, outer: custom } : custom || JEWEL_RADII[name]
    if (/Thread of Hope/i.test(item.name || text)) {
      const bounds = { Small: [960,1320], Medium: [1320,1680], Large: [1680,2040], 'Very Large': [2040,2400], Massive: [2400,2880] }[name]
      radius = { inner: bounds[0], outer: bounds[1] }
    }
    // Impossible Escape affects a named keystone, rather than its socket.
    const keystone = text.match(/Passives in Radius of (.+?) can be Allocated/i)?.[1]
    const center = keystone ? nodes.find(n => n.kind === 'Keystone' && n.name.toLowerCase() === keystone.toLowerCase()) : socket
    if (!center) continue
    for (const r of [radius.inner, radius.outer]) if (Number.isFinite(r) && r > 0) rings.push({ x: center.x, y: center.y, radius: r, nodeId: String(nodeId) })
  }
  return rings
}
export function focusPan(nodes, transform, width, height, pan) {
  const targets = nodes.filter(n => n.kind !== 'Ascendancy')
  if (!targets.length || targets.every(n => {
    const x = n.x * transform.scale + transform.x, y = n.y * transform.scale + transform.y
    return x >= 35 && y >= 35 && x <= width - 35 && y <= height - 35
  })) return pan
  const x = targets.reduce((sum,n) => sum+n.x,0)/targets.length
  const y = targets.reduce((sum,n) => sum+n.y,0)/targets.length
  return { x: pan.x + width/2 - (x*transform.scale+transform.x), y: pan.y + height/2 - (y*transform.scale+transform.y) }
}
