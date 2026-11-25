import test from 'node:test'
import assert from 'node:assert/strict'
import { treeGeometry, nearestTreeNode, passiveTreeUrl } from './buildTreeCanvas.js'
import { decodeTreeUrl } from './buildCodec.js'
import { connectionArc, traceTreeEdge } from '../../shared/passiveGeometry.js'

test('canvas geometry deduplicates edges and keeps selected mastery text and icons', () => {
  const data = { nodes: [
    { id: '1', x: 0, y: 0, name: 'Start', stats: [], out: ['2'] },
    { id: '2', x: 300, y: 0, name: 'Life Mastery', kind: 'Mastery', icon: 'mastery.png', stats: [], out: ['1'] },
    { id: '3', x: 5000, y: 5000, name: 'Ascendancy', kind: 'Ascendancy', notable: true, stats: [], out: [] },
  ] }
  const graph = treeGeometry(data, { nodes: ['1', '2', '3'], allocated: [{ id: '2', kind: 'Mastery', stats: ['+50 to maximum Life'] }] })
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].active, true)
  assert.equal(graph.main.length, 3)
  assert.equal(graph.ascendancy.length, 1)
  assert.equal(graph.nodes[1].icon, 'mastery.png')
  assert.deepEqual(nearestTreeNode(graph, 302, 0, .2).stats, ['+50 to maximum Life'])
  assert.equal(nearestTreeNode(graph, 5000, 5000, .2).id, '3')
  assert.equal(nearestTreeNode(graph, 5000, 5000, .2, true).id, '3')
  assert.equal(nearestTreeNode(graph, -3000, -3000, 1), null)
})

test('canvas icon budget excludes unallocated and small passives', () => {
  const nodes = Array.from({ length: 100 }, (_, i) => ({ id: String(i), x: i * 100, y: 0, stats: [], notable: i >= 5, icon: 'icon.png', out: [] }))
  const graph = treeGeometry({ nodes }, { nodes: nodes.slice(0, 70).map(n => n.id) })
  assert.equal(graph.icons.length, 35)
  assert.ok(graph.icons.every(n => n.active && n.notable))
})

test('Open tree link round-trips regular nodes, cluster IDs and selected masteries', () => {
  const tree = { nodes: ['10', '20', '65540'], classId: 1, ascendClassId: 2, masteries: { 20: 123 } }
  const url = passiveTreeUrl(tree)
  assert.deepEqual(decodeTreeUrl(url), { nodes: tree.nodes, masteries: { 20: 123 } })
  const bytes = Uint8Array.from(atob(url.split('/').at(-1).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
  assert.equal(bytes[4], 1)
  assert.equal(bytes[5], 2)
  assert.equal(passiveTreeUrl({ url, nodes: [] }), url)
})

test('same-orbit edges use the shortest arc across the angle seam; forced lines and different orbits stay straight', () => {
  const node = (id, angle) => ({ id, group: '1', orbit: 1, groupX: 0, groupY: 0, orbitRadius: 100, x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 })
  const from = node('1', 170 * Math.PI / 180), to = node('2', -170 * Math.PI / 180)
  const arc = connectionArc(from, to)
  assert.ok(Math.abs(arc.end - arc.start - Math.PI / 9) < 1e-10)
  assert.equal(arc.anticlockwise, false)
  assert.equal(connectionArc(to, from).anticlockwise, true)
  assert.equal(connectionArc(from, { ...to, group: '2' }), null)
  assert.equal(connectionArc(from, { ...to, orbit: 2 }), null)
  assert.equal(connectionArc(from, to, {}, true), null)
  assert.equal(connectionArc({ ...from, straightOut: ['2'] }, to), null)
  const commands = []
  traceTreeEdge({ moveTo: (...args) => commands.push(['move', ...args]), lineTo: () => commands.push(['line']), arc: (...args) => commands.push(['arc', ...args]) }, { from, to, arc })
  assert.equal(commands[1][0], 'arc')
  assert.equal(commands[1][3], 100)
  assert.ok(!commands.some(command => command[0] === 'line'))
  const graph = treeGeometry({ nodes: [{ ...from, stats: [], out: ['2'] }, { ...to, stats: [], out: [{ id: '1', isStraight: true }] }] }, { nodes: [] })
  assert.equal(graph.edges[0].arc, null)
})

test('proxy groups, hidden nodes and inactive expansions cannot affect drawing, bounds or hover', () => {
  const data = { groups: { ghost: { isProxy: true } }, nodes: [
    { id: '1', name: 'Visible', stats: [], x: 0, y: 0, out: ['2', '3', '4'] },
    { id: '2', group: 'ghost', stats: [], x: 50000, y: 50000 },
    { id: '3', isProxy: true, stats: [], x: 60000, y: 60000 },
    { id: '4', expansionSubgraph: true, expansionActive: false, stats: [], x: 70000, y: 70000 },
  ] }
  const graph = treeGeometry(data, { nodes: ['1', '2', '3', '4'] })
  assert.deepEqual(graph.nodes.map(node => node.id), ['1'])
  assert.equal(graph.edges.length, 0)
  assert.equal(graph.bounds.width, 440)
  assert.equal(nearestTreeNode(graph, 50000, 50000, 1), null)
})

test('selected ascendancy retains start, unallocated small/notable nodes and all connectors on main tree and mini-circle', () => {
  const nodes = [
    {id:'1',x:0,y:0,stats:[],out:[]},
    {id:'10',x:1000,y:1000,kind:'Ascendancy',ascendancy:'Juggernaut',isAscendancyStart:true,stats:[],out:['11']},
    {id:'11',x:1100,y:1000,kind:'Ascendancy',ascendancy:'Juggernaut',stats:[],out:['12','13']},
    {id:'12',x:1200,y:1000,kind:'Ascendancy',ascendancy:'Juggernaut',notable:true,stats:[],out:[]},
    {id:'13',x:1100,y:1200,kind:'Ascendancy',ascendancy:'Juggernaut',stats:[],out:[]},
    {id:'20',x:-1000,y:-1000,kind:'Ascendancy',ascendancy:'Chieftain',stats:[],out:[]},
  ]
  const graph = treeGeometry({nodes}, {nodes:['1','11','12']}, 'Juggernaut')
  assert.deepEqual(graph.ascendancy.map(n=>n.id), ['10','11','12','13'])
  assert.equal(graph.ascendancy.find(n=>n.id==='10').active, true)
  assert.equal(graph.ascendancy.find(n=>n.id==='13').active, false)
  assert.equal(graph.ascendancyEdges.length, 3)
  assert.equal(graph.ascendancyEdges.filter(e=>e.active).length, 2)
  assert.equal(graph.edges.length,3)
  assert.equal(graph.nodes.some(n=>n.id==='20'),false)
  assert.equal(nearestTreeNode(graph,1100,1200,1,true).id,'13')
})
