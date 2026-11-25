import test from 'node:test'
import assert from 'node:assert/strict'
import { allocatedClusterNodes, buildClusterGraphs, clusterOrbitOffsets } from './buildClusters.js'
import { parseItemText, modsOf, gggClusterJewels, gggJewelData, mergeAllocatedPassives } from '../src/lib/buildCodec.js'
import { compactTree } from './buildData.js'
import { treeGeometry, nearestTreeNode } from '../src/lib/buildTreeCanvas.js'

const layoutData = () => ({ constants: { skillsPerOrbit: [1, 6, 16, 16], orbitRadii: [0, 82, 162, 335] },
  nodes: {
    1: { name: 'Large Jewel Socket', group: 1, orbit: 0, stats: [], expansionJewel: { size: 2, index: 0, proxy: 100 }, out: ['100'] },
    100: { name: 'Position Proxy', isProxy: true, group: 2, orbit: 3, orbitIndex: 0 },
    2: { name: 'Unexpanded Medium Socket', group: 2, orbit: 3, orbitIndex: 8, expansionJewel: { size: 1, index: 1, proxy: 200 } },
    200: { name: 'Position Proxy', isProxy: true, group: 3, orbit: 2, orbitIndex: 0 },
    77: { name: 'Alpha', isNotable: true, stats: ['12% increased Area of Effect'], icon: 'Art/Alpha.png' },
  }, groups: { 1: { x: 0, y: 0 }, 2: { x: 0, y: 500, isProxy: true, nodes: [2] }, 3: { x: 0, y: 1000, isProxy: true } },
})

test('full cluster graph has distinct orbit positions, unallocated notables and nested socket connectors', () => {
  const data = layoutData()
  const jewels = [{ nodeId: '1', baseType: 'Large Cluster Jewel', mods: ['Adds 8 Passive Skills', '1 Added Passive Skill is a Jewel Socket', '1 Added Passive Skill is Alpha', 'Added Small Passive Skills grant: 10% increased Damage'] }, { nodeId: '65574', baseType: 'Medium Cluster Jewel', mods: ['Adds 4 Passive Skills', 'Added Small Passive Skills grant: 9% increased Area of Effect'] }]
  const ids = ['1', '65568', '65574', '66064']
  const all = buildClusterGraphs(data, ids, jewels, { Alpha: 1 })
  assert.equal(all.length, 12)
  assert.equal(new Set(all.map(node => `${node.x}:${node.y}`)).size, 12)
  assert.ok(all.find(node => node.id === '65572').notable)
  assert.deepEqual(all.find(node => node.id === '65572').stats, ['12% increased Area of Effect'])
  assert.ok(all.find(node => node.id === '65568').out.includes('1'))
  assert.ok(all.find(node => node.id === '66064').out.includes('65574'))
  for (const node of all) assert.ok(Math.abs(Math.hypot(node.x - node.groupX, node.y - node.groupY) - data.constants.orbitRadii[node.orbit]) < 1e-8)
  const compact = compactTree(data)
  assert.deepEqual(compact.nodes.map(node => node.id), ['1'])
  const graph = treeGeometry({ ...compact, nodes: [...compact.nodes, ...all] }, { nodes: ids })
  const notable = graph.nodes.find(node => node.id === '65572')
  assert.equal(notable.active, false)
  assert.ok(graph.icons.some(node => node.id === notable.id))
  assert.equal(nearestTreeNode(graph, notable.x, notable.y, 1).name, 'Alpha')
  assert.ok(graph.edges.some(edge => edge.arc && edge.from.clusterGenerated))
  assert.ok(graph.edges.some(edge => edge.to.id === '1' || edge.from.id === '1'))
  assert.equal(allocatedClusterNodes(data, ids, jewels, { Alpha: 1 }).length, 3)
  assert.equal(buildClusterGraphs(data, ids, [], {}).length, 0)
})

test('GGG subgraph hashes and actual orbit indices map to synthetic cluster slots without guessing IDs', () => {
  const data = layoutData()
  const jewels = [{ nodeId: '1', baseType: 'Large Cluster Jewel', mods: ['Adds 2 Passive Skills', '1 Added Passive Skill is a Jewel Socket'] }, { nodeId: '90000', baseType: 'Medium Cluster Jewel', mods: ['Adds 4 Passive Skills', 'Added Small Passive Skills grant: 9% increased Area of Effect'] }]
  const jewelData = { 1: { subgraph: { groups: { g: { proxy: 100 }, m: { proxy: 200 } }, nodes: { 90000: { group: 'g', orbitIndex: 8 }, 91000: { group: 'm', orbitIndex: 0 } } } } }
  const graph = buildClusterGraphs(data, ['1', '90000', '91000'], jewels, {}, {}, jewelData)
  assert.ok(graph.find(node => node.id === '90000').aliases.includes('65574'))
  assert.ok(graph.find(node => node.id === '91000').out.includes('90000'))
  assert.ok(graph.find(node => node.id === '91000').stats.includes('9% increased Area of Effect'))
})

test('GGG cluster request preserves equipped socket indices and native subgraphs; backpack jewels are excluded', () => {
  const jewelData = { 1: { subgraph: { nodes: {}, groups: {} } } }
  const payload = { items: [{ inventoryId: 'MainInventory', x: 5, baseType: 'Large Cluster Jewel' }], passives: { jewel_slots: [1, 90000], jewel_data: jewelData, items: [{ inventoryId: 'PassiveJewels', id: 'a', x: 0, baseType: 'Large Cluster Jewel', enchantMods: ['Adds 8 Passive Skills'] }, { inventoryId: 'PassiveJewels', id: 'b', x: 1, baseType: 'Medium Cluster Jewel', enchantMods: ['Adds 4 Passive Skills'] }] } }
  assert.deepEqual(gggClusterJewels(payload).map(jewel => jewel.nodeId), ['1', '90000'])
  assert.deepEqual(gggJewelData(payload), jewelData)
  assert.equal(clusterOrbitOffsets('orbitOffsets = { [123] = { [0] = 3, [1] = 5, [2] = 5, }, },')[123][1], 5)
})

test('unique clusters can provide a single Keystone or socket-and-Nothingness layout', () => {
  const data = layoutData()
  data.nodes[88] = { name: 'Example Keystone', isKeystone: true, icon: 'Art/Keystone.png', stats: ['A keystone effect'] }
  const one = buildClusterGraphs(data, ['1', '65536'], [{ nodeId: '1', baseType: 'Small Cluster Jewel', mods: ['Adds Example Keystone'] }])
  assert.equal(one.length, 1)
  assert.equal(one[0].kind, 'Keystone')
  assert.equal(one[0].x, data.groups[2].x)
  assert.equal(one[0].y, data.groups[2].y)
  const sockets = buildClusterGraphs(data, ['1'], [{ nodeId: '1', baseType: 'Large Cluster Jewel', mods: ['Adds 3 Jewel Socket Passive Skills', 'Adds 1 Small Passive Skill which grants nothing'] }])
  assert.equal(sockets.length, 4)
  assert.equal(sockets.filter(node => node.kind === 'Socket').length, 3)
  assert.ok(sockets.find(node => node.id === '65568').out.includes('1'))
})

test('nested cluster proxy need not appear in selected IDs; only allocated small passives contribute', () => {
  const data = { nodes: {
    1: { group: 1, expansionJewel: { size: 2, index: 0, proxy: 100 } },
    100: { group: 2 },
    2: { group: 2, expansionJewel: { size: 1, index: 1, proxy: 200 } },
    200: { group: 3 },
  }, groups: { 1: {}, 2: { isProxy: true, nodes: [2] }, 3: { isProxy: true } } }
  const ids = ['1', '66064', '66070', '66073', '66067']
  const jewels = [
    { nodeId: '1', baseType: 'Large Cluster Jewel', mods: ['Adds 2 Passive Skills', '1 Added Passive Skill is a Jewel Socket'] },
    { nodeId: '2', baseType: 'Medium Cluster Jewel', mods: modsOf(parseItemText('Rarity: RARE\nAny Cluster\nMedium Cluster Jewel\nAdds 4 Passive Skills\n{tags:area}Added Small Passive Skills grant: 9% increased Area of Effect', 'child')) },
  ]
  const nodes = allocatedClusterNodes(data, ids, jewels, {})
  assert.equal(nodes.length, 4)
  assert.ok(nodes.every(node => ids.includes(node.id)))
  assert.ok(nodes.every(node => node.stats.includes('9% increased Area of Effect')))
  assert.equal(nodes.reduce((sum, node) => sum + Number(node.stats[0].match(/\d+/)[0]), 0), 36)
  assert.equal(allocatedClusterNodes(data, ['1', '66064'], jewels, {}).length, 1)
})

test('missing notable order preserves known small-node stats and never guesses notable stats', () => {
  const data = { nodes: { 1: { group: 1, expansionJewel: { size: 0, index: 0, proxy: 100 } }, 100: { group: 2 } }, groups: { 1: {}, 2: { isProxy: true } } }
  const jewels = [{ nodeId: '1', baseType: 'Small Cluster Jewel', mods: [
    'Adds 2 Passive Skills', '1 Added Passive Skill is Unknown Notable',
    'Added Small Passive Skills grant: 8% increased Area of Effect\n+2 to maximum Life',
    'Added Small Passive Skills have 25% increased Effect',
  ] }]
  const nodes = allocatedClusterNodes(data, ['1', '65536', '65540'], jewels, {})
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].id, '65536')
  assert.deepEqual(nodes[0].stats, ['10% increased Area of Effect', '+2 to maximum Life'])
})

test('modern PoB nested jewels use generated socket IDs while layouts use GGG proxy IDs', () => {
  const data = { nodes: {
    1: { group: 1, expansionJewel: { size: 2, index: 0, proxy: 100 } },
    100: { group: 2 }, 2: { group: 2, expansionJewel: { size: 1, index: 1, proxy: 200 } }, 200: { group: 3 },
  }, groups: { 1: {}, 2: { isProxy: true, nodes: [2] }, 3: { isProxy: true } } }
  const jewels = [
    { nodeId: '1', baseType: 'Large Cluster Jewel', mods: ['Adds 2 Passive Skills', '1 Added Passive Skill is a Jewel Socket'] },
    { nodeId: '65574', baseType: 'Medium Cluster Jewel', mods: ['Adds 4 Passive Skills', 'Added Small Passive Skills grant: 9% increased Area of Effect'] },
  ]
  const ids = ['1', '65574', '66064', '66070', '66073', '66067']
  const nodes = allocatedClusterNodes(data, ids, jewels, {})
  assert.equal(nodes.length, 5)
  assert.equal(nodes.filter(node => node.stats.includes('9% increased Area of Effect')).length, 4)
  assert.deepEqual(nodes.find(node => node.id === '65574').stats, [])
  // The slotted hierarchy remains renderable even when a parent socket was
  // exported under a different ID; only selected child nodes affect estimates.
  assert.equal(allocatedClusterNodes(data, ids.filter(id => id !== '65574'), jewels, {}).length, 4)
})

test('Large -> Medium -> Small supports real proxy sockets and generated IDs without losing allocated aliases', () => {
  const data = layoutData()
  data.nodes[2].expansionJewel.parent = '1'
  data.groups[3].nodes = [3]
  data.nodes[3] = {name:'Small Jewel Socket',group:3,expansionJewel:{size:0,index:0,proxy:300,parent:'2'}}
  data.nodes[300] = {isProxy:true,group:4,orbit:1,orbitIndex:0}
  data.groups[4] = {x:200,y:1600,isProxy:true,nodes:[]}
  const jewels = [
    {nodeId:'1',baseType:'Large Cluster Jewel',mods:['Adds 8 Passive Skills','1 Added Passive Skill is a Jewel Socket']},
    {nodeId:'2',baseType:'Medium Cluster Jewel',mods:['Adds 4 Passive Skills','1 Added Passive Skill is a Jewel Socket']},
    {nodeId:'3',baseType:'Small Cluster Jewel',mods:['Adds 2 Passive Skills','Added Small Passive Skills grant: 4% increased maximum Life']},
  ]
  const ids = ['1','2','3','66048','66052']
  const generated = buildClusterGraphs(data,ids,jewels)
  for (const id of ids.slice(1)) assert.ok(generated.some(n=>n.id===id || n.aliases.includes(id)),id)
  assert.ok(generated.find(n=>n.id==='66048').out.includes('66070'))
  const imported = {source:'pob',stats:{},equipment:{},jewels:[],skills:[],tree:{nodes:ids}}
  const merged = mergeAllocatedPassives(imported,{nodes:[...compactTree(data,ids).nodes,...allocatedClusterNodes(data,ids,jewels)]})
  assert.deepEqual(merged.tree.missingIds,[])
  assert.ok(merged.tree.allocated.some(n=>n.id==='2'))
  assert.ok(merged.tree.allocated.some(n=>n.id==='3'))
  const canonical = buildClusterGraphs(data,ids,[jewels[0],{...jewels[1],nodeId:'65574'},{...jewels[2],nodeId:'66070'}])
  assert.equal(canonical.length,generated.length)
  assert.ok(canonical.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)))
})

test('native GGG subgraphs retain IDs, coordinates and provided connections when item enchants are absent', () => {
  const data = layoutData()
  const jewelData = { subgraph: {groups:{g:{proxy:100}},nodes:{
    90001:{group:'g',orbit:3,orbitIndex:0,name:'Native Small',stats:['12% increased Damage'],out:[90002]},
    90002:{group:'g',orbit:3,orbitIndex:8,name:'Native Notable',isNotable:true,stats:['20% increased Damage'],in:[90001]},
  }}}
  const nodes = allocatedClusterNodes(data,['90001','90002'],[],{}, {},jewelData)
  assert.equal(nodes.length,2)
  assert.ok(nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)&&!n.statsUnavailable))
  assert.equal(nodes[1].notable,true)
  const graph=treeGeometry({nodes}, {nodes:['90001','90002']})
  assert.equal(graph.edges.length,1)
  assert.equal(nearestTreeNode(graph,nodes[1].x,nodes[1].y,1).name,'Native Notable')
})
