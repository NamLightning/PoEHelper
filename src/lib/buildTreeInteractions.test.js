import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOverrides, applyOverrides, groupedNodes, jewelRadiusRings, focusPan } from './buildTreeInteractions.js'
import { fromGgg, mergeAllocatedPassives } from './buildCodec.js'
import { treeGeometry, nearestTreeNode } from './buildTreeCanvas.js'

test('Tattoo mappings replace original stats for estimates, canvas and grouped summary', () => {
  const overrides = normalizeOverrides({ 1: { dn: 'Tattoo of the Kitava Shaman', sd: ['Attacks have 5% chance to cause Bleeding'] } }, [{ nodeId: 2, name: 'Tattoo of the Kitava Shaman', stats: ['Attacks have 5% chance to cause Bleeding'] }])
  const nodes = [{ id:'1', name:'Strength', stats:['+10 to Strength'], x:0, y:0, out:[] }, { id:'2', name:'Strength', stats:['+10 to Strength'], x:200, y:0, out:[] }]
  const result = applyOverrides(nodes, overrides)
  assert.equal(result[0].kind, 'Tattoo')
  assert.ok(!result[0].stats.includes('+10 to Strength'))
  assert.deepEqual(groupedNodes(result)[0].nodeIds, ['1','2'])
  const graph = treeGeometry({ nodes }, { nodes:['1','2'], overrides })
  assert.equal(nearestTreeNode(graph, 0,0,1).name, 'Tattoo of the Kitava Shaman')
  const ggg = fromGgg({level:1}, {items:[],passives:{hashes:[1,2],passive_overrides:overrides}}, {nodes})
  assert.equal(ggg.tree.allocated[0].kind, 'Tattoo')
  assert.equal(ggg.stats.Str, fromGgg({level:1}, {items:[],passives:{hashes:[]}}, {nodes:[]}).stats.Str)
  const pob = mergeAllocatedPassives({source:'pob', stats:{}, equipment:{}, jewels:[], skills:[], tree:{nodes:['1'],overrides}}, {nodes})
  assert.deepEqual(pob.tree.allocated[0].stats, overrides['1'].stats)
})

test('jewel circles use actual socket coordinates, native radii and Thread of Hope annulus', () => {
  const nodes = [{id:'1',x:100,y:200},{id:'2',x:500,y:600,kind:'Keystone',name:'Iron Reflexes'}]
  const rings = jewelRadiusRings(nodes, [
    {nodeId:'1',item:{name:'Thread of Hope',rawText:'Radius: Variable\nOnly affects Passives in Large Ring'}},
    {nodeId:'1',item:{name:'The Light of Meaning',properties:[{name:'Radius',values:[['Large',0]]}]}},
    {nodeId:'1',item:{name:'Impossible Escape',rawText:'Radius: Small\nPassives in Radius of Iron Reflexes can be Allocated without being connected to your tree'}},
    {nodeId:'1',item:{name:'Ordinary Jewel'}},
  ], {jewelRadii:{Large:1900}})
  assert.deepEqual(rings.map(r=>r.radius), [1680,2040,1900,960])
  assert.deepEqual([rings[3].x,rings[3].y], [500,600])
  assert.equal(jewelRadiusRings(nodes,[{nodeId:'999',item:{rawText:'Radius: Large'}}]).length,0)
})

test('focus keeps visible nodes in place, centers hidden groups, and leaves ascendancy in mini-circle', () => {
  const t={scale:1,x:0,y:0}, pan={x:0,y:0}
  assert.equal(focusPan([{x:50,y:50}],t,500,500,pan),pan)
  assert.deepEqual(focusPan([{x:900,y:800},{x:1100,y:1000}],t,500,500,pan),{x:-750,y:-650})
  assert.equal(focusPan([{x:900,y:800,kind:'Ascendancy'}],t,500,500,pan),pan)
})

