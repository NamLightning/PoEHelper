// Layout/index rules from PoB PassiveSpec.lua and ItemTools.getClusterJewelNotableIndices.
import { orbitAngle, orbitPosition } from '../shared/passiveGeometry.js'
const layouts = {
  Small: { size: 0, small: [0, 4, 2], notable: [4], sockets: [4] },
  Medium: { size: 1, small: [0, 6, 8, 4, 10, 2], notable: [6, 10, 2, 0], sockets: [6] },
  Large: { size: 2, small: [0, 4, 6, 8, 10, 2, 7, 5, 9, 3, 11, 1], notable: [6, 4, 8, 10, 2], sockets: [4, 8, 6] },
}

export function clusterSortOrder(text) {
  const section = text.slice(text.indexOf('notableSortOrder ='))
  return Object.fromEntries([...section.matchAll(/\["([^"\n]+)"\]\s*=\s*(\d+)/g)].map((match) => [match[1], Number(match[2])]))
}

export function clusterOrbitOffsets(text) {
  const section = text.slice(text.indexOf('orbitOffsets =')).split('blightcoreNotableIndex')[0]
  return Object.fromEntries([...section.matchAll(/\[(\d+)\]\s*=\s*\{([^}]+)\}/g)].map(match => [match[1], Object.fromEntries([...match[2].matchAll(/\[(\d+)\]\s*=\s*(\d+)/g)].map(value => [value[1], Number(value[2])]))]))
}

function importedSubgraphs(value) {
  const groups = Object.create(null), nodes = Object.create(null)
  const collect = graph => {
    if (!graph || typeof graph !== 'object') return
    if (graph.nodes && graph.groups) { Object.assign(groups, graph.groups); Object.assign(nodes, graph.nodes) }
    if (graph.subgraph) collect(graph.subgraph)
    if (graph.subgraphs) for (const child of Object.values(graph.subgraphs)) collect(child)
  }
  collect(value)
  for (const entry of Object.values(value || {})) collect(entry)
  return { groups, nodes }
}

function translateOrbit(index, total, count) {
  if (total === count) return index
  if (total === 12 && count === 16) return [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15][index]
  if (total === 6 && count === 16) return [0, 3, 5, 8, 11, 13][index]
  return Math.floor(index * count / total)
}

export function buildClusterGraphs(data, ids, jewels, sortOrder = {}, offsets = {}, jewelData = {}) {
  const selected = new Set(ids.map(String)), socketed = new Map(jewels.map((jewel) => [String(jewel.nodeId), jewel]))
  const templates = new Map(Object.values(data.nodes || {}).filter((node) => (node.isNotable || node.isKeystone) && !node.group).map((node) => [node.name, node]))
  const imported = importedSubgraphs(jewelData)
  const result = new Map(), visited = new Set()
  function walk(socketId, context = 65536, depth = 0, equippedSocketId = socketId, parentDrawId = socketId) {
    // Nested sockets use real proxy IDs in <Sockets>, while allocated node IDs
    // are synthetic. The proxy ID itself need not be present in Spec.nodes.
    if (depth > 3 || visited.has(equippedSocketId)) return
    const jewel = socketed.get(equippedSocketId), socket = data.nodes[socketId]
    const sizeName = jewel?.baseType?.match(/^(Small|Medium|Large) Cluster Jewel$/)?.[1]
    if (!jewel || !sizeName || !socket?.expansionJewel) return
    visited.add(equippedSocketId)
    const layout = layouts[sizeName], expansion = socket.expansionJewel
    if (layout.size > expansion.size) return
    const id = context + (expansion.size === 2 ? expansion.index * 64 : expansion.size === 1 ? expansion.index * 512 : 0)
    const base = id + layout.size * 16
    const mods = (jewel.mods || []).filter(line => typeof line === 'string').map(line => line.replace(/\{[^}]*\}/g, '').trim())
    const proxy = data.nodes[expansion.proxy]
    const group = data.groups?.[proxy?.group]
    const importedGroup = Object.entries(imported.groups).find(([, value]) => value && String(value.proxy) === String(expansion.proxy))?.[0]
    const keystoneName = mods.map(line => line.match(/^Adds (.+)$/i)?.[1]).find(name => templates.get(name)?.isKeystone)
    if (keystoneName) {
      const template = templates.get(keystoneName)
      const native = Object.entries(imported.nodes).find(([, value]) => value && String(value.group) === importedGroup && value.isKeystone)
      const nodeId = native?.[0] || String(base)
      result.set(nodeId, { id: nodeId, aliases: nodeId === String(base) ? [] : [String(base)], name: keystoneName, stats: template.stats || [], iconKey: template.icon || '', kind: 'Keystone', clusterGenerated: true, expansionActive: true, group: `cluster:${base}`, orbit: 0, orbitIndex: 0, ...orbitPosition(group, 0, 0, data.constants), out: [String(parentDrawId)] })
      return
    }
    const socketCount = Number(mods.map((line) => (line.match(/^(\d+) Added Passive Skills? (?:is|are) (?:a )?Jewel Sockets?$/i) || line.match(/^Adds (\d+) Jewel Socket Passive Skills?$/i))?.[1]).find(Boolean) || 0)
    const nothingness = Number(mods.map(line => line.match(/^Adds (\d+) Small Passive Skills? which grants? nothing$/i)?.[1]).find(Boolean) || 0)
    const count = Number(mods.map((line) => line.match(/^Adds (\d+) Passive Skills?$/i)?.[1]).find(Boolean) || (nothingness ? nothingness + socketCount : 0))
    const names = mods.map((line) => line.match(/^1 Added Passive Skill is (.+)$/i)?.[1]).filter((name) => name && !/^a Jewel Socket$/i.test(name))
    if (!count || count > 12 || socketCount > layout.sockets.length || count < socketCount + names.length) return
    const knownNotables = names.every(name => templates.has(name) && (names.length === 1 || sortOrder[name] !== undefined))
    if (knownNotables) names.sort((a, b) => sortOrder[a] - sortOrder[b])
    const positions = new Map(), children = []
    const socketPositions = sizeName === 'Large' && socketCount === 1 ? [6] : layout.sockets.slice(0, socketCount)
    socketPositions.forEach((position, index) => {
      positions.set(position, { name: 'Cluster Jewel Socket', stats: [], kind: 'Socket' })
      const jewelIndex = sizeName === 'Large' && socketCount === 1 ? 1 : [0, 2, 1][index]
      const candidates = group?.nodes || Object.keys(data.nodes).filter(id => String(data.nodes[id].group) === String(proxy?.group))
      const childId = candidates.find(child => {
        const expansion = data.nodes[child]?.expansionJewel
        return expansion?.index === jewelIndex && (expansion.parent == null || String(expansion.parent) === String(socketId))
      }) ?? candidates.find(child => data.nodes[child]?.expansionJewel?.index === jewelIndex)
      if (childId !== undefined) {
        // Modern PoB saves the nested jewel against its generated socket ID,
        // not the proxy ID in GGG's static tree. Use the proxy only for layout.
        const generatedSocketId = String(base + position)
        children.push({ position, childId: String(childId), generatedSocketId })
      }
    })
    const notablePositions = layout.notable.map((position) => {
      if (sizeName !== 'Medium') return position
      if (socketCount === 0 && names.length === 2) return position === 6 ? 4 : position === 10 ? 8 : position
      return count === 4 ? position === 10 ? 9 : position === 2 ? 3 : position : position
    }).filter((position) => !positions.has(position)).slice(0, names.length).sort((a, b) => a - b)
    if (notablePositions.length !== names.length) return
    // Unknown notable ordering must not discard resolvable small passives.
    names.forEach((name, index) => positions.set(notablePositions[index], knownNotables ? { name, stats: templates.get(name).stats || [], kind: 'Notable', notable: true, iconKey: templates.get(name).icon || '' } : { name: 'Unresolved Cluster Notable', stats: ['Notable ordering is unavailable for this tree version.'], kind: 'Notable', notable: true, unresolved: true }))
    const baseStats = mods.flatMap((line) => line.match(/^Added Small Passive Skills grant:\s*([\s\S]+)$/i)?.[1]?.split(/\r?\n/) || [])
    const extraStats = mods.flatMap((line) => line.match(/^Added Small Passive Skills also grant:\s*([\s\S]+)$/i)?.[1]?.split(/\r?\n/) || [])
    const effect = mods.reduce((sum, line) => sum + Number(line.match(/^Added Small Passive Skills have (\d+)% increased Effect$/i)?.[1] || 0), 0)
    const smallStats = [...baseStats, ...extraStats].map((line) => line.replace(/-?\d+(?:\.\d+)?/g, (value) => String(Math.floor(Number(value) * (1 + effect / 100) + 1e-8))))
    const smallCount = count - socketCount - names.length
    const smallPositions = layout.small.map((position) => sizeName === 'Medium' ? count === 5 && position === 4 ? 3 : count === 4 ? position === 8 ? 9 : position === 4 ? 3 : position : position : position)
      .filter((position) => !positions.has(position)).slice(0, smallCount)
    for (const position of smallPositions) positions.set(position, { name: 'Cluster Passive', stats: smallStats })
    const orbit = layout.size + 1, total = sizeName === 'Small' ? 6 : 12
    const countPerOrbit = data.constants?.skillsPerOrbit?.[orbit] || total
    const proxyAngle = orbitAngle(proxy?.orbitIndex || 0, data.constants?.skillsPerOrbit?.[proxy?.orbit || 0] || total)
    const start = offsets[expansion.proxy]?.[layout.size] ?? Math.round(proxyAngle / (Math.PI * 2) * total) % total
    const generated = new Map()
    for (const [position, node] of positions) {
      const orbitIndex = translateOrbit((position + start) % total, total, countPerOrbit)
      const native = importedGroup === undefined ? undefined : Object.entries(imported.nodes).find(([, value]) => value && String(value.group) === importedGroup && !value.isMastery && Number(value.orbitIndex) === orbitIndex)
      const nativeTemplate = node.unresolved && templates.get(native?.[1]?.name)
      const resolvedNode = nativeTemplate ? { ...node, name: nativeTemplate.name, stats: nativeTemplate.stats || [], iconKey: nativeTemplate.icon || '', unresolved: false } : node
      const nodeId = native?.[0] || String(base + position)
      const child = children.find(value => value.position === position)
      const aliases = [...new Set([String(base + position), ...(child ? [child.childId] : [])])].filter(value => value !== nodeId)
      generated.set(position, { id: nodeId, ...resolvedNode, aliases, kind: resolvedNode.kind || 'Passive', clusterGenerated: true, expansionActive: true, parentSocket: String(parentDrawId), group: `cluster:${base}`, orbit, orbitIndex, ...orbitPosition(group, orbit, orbitIndex, data.constants), out: [] })
    }
    const ring = [...generated.entries()].sort(([a], [b]) => a - b).map(([, node]) => node)
    const connect = (a, b) => { if (a && b && a !== b) { a.out.push(b.id); b.out.push(a.id) } }
    for (let i = 1; i < ring.length; i++) connect(ring[i - 1], ring[i])
    if (sizeName !== 'Small' && ring.length > 2) connect(ring[0], ring.at(-1))
    generated.get(0)?.out.push(String(parentDrawId))
    for (const node of generated.values()) result.set(node.id, node)
    for (const child of children) {
      const drawnSocket = generated.get(child.position)
      const equippedId = [drawnSocket?.id, child.generatedSocketId, child.childId].find(value => socketed.has(value))
      if (equippedId) walk(child.childId, id, depth + 1, equippedId, drawnSocket.id)
    }
  }
  for (const [id] of socketed) if (data.nodes[id]?.expansionJewel && !data.nodes[id].expansionJewel.parent && !data.groups?.[data.nodes[id]?.group]?.isProxy) walk(id)
  // GGG can include an explicit native subgraph even when the item export
  // lacks the English enchant lines needed to regenerate its layout.
  // Preserve those authoritative IDs/edges instead of inventing node positions.
  const represented = new Set([...result.values()].flatMap(node => [node.id, ...(node.aliases || [])]))
  for (const [nodeId, native] of Object.entries(imported.nodes)) {
    if (represented.has(nodeId) || !native || native.isProxy || native.isMastery) continue
    const nativeGroup = imported.groups[native.group]
    const proxy = data.nodes[nativeGroup?.proxy]
    const group = data.groups?.[proxy?.group] || nativeGroup
    if (!group || !(Number.isFinite(group.x) && Number.isFinite(group.y))) continue
    const template = data.nodes[native.skill] || templates.get(native.name)
    const stats = native.stats || native.sd || template?.stats
    const position = orbitPosition(group, native.orbit || 0, native.orbitIndex || 0, data.constants)
    const connections = [...(native.out || []), ...(native.in || [])]
      .map(value => String(typeof value === 'object' ? value.id : value))
    result.set(nodeId, {
      id: nodeId, aliases: [], name: native.name || native.dn || template?.name || 'Cluster Passive',
      stats: Array.isArray(stats) ? stats : [], statsUnavailable: !Array.isArray(stats),
      kind: native.isKeystone ? 'Keystone' : native.isJewelSocket ? 'Socket' : native.isNotable ? 'Notable' : 'Passive',
      notable: Boolean(native.isNotable), iconKey: native.icon || template?.icon || '',
      group: `native-cluster:${native.group}`, orbit: native.orbit || 0, orbitIndex: native.orbitIndex || 0,
      ...position, out: connections, clusterGenerated: true, expansionActive: true,
    })
  }
  return [...result.values()]
}

export function allocatedClusterNodes(data, ids, jewels, sortOrder, offsets, jewelData) {
  const selected = new Set(ids.map(String))
  return buildClusterGraphs(data, ids, jewels, sortOrder, offsets, jewelData).filter(node => !node.unresolved && (selected.has(node.id) || node.aliases.some(id => selected.has(id))))
}
