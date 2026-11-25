import test from 'node:test'
import assert from 'node:assert/strict'
import { basicStats, BUILD_CACHE_KEY, buildLabel, cacheBuild, cachedCodes, recentBuilds, decodePob, decodeTreeUrl, displayedStats, encodePob, fromGgg, gggSkills, itemText, modLines, parseItemText } from './buildCodec.js'
import { compactTree, fetchPobbin, fetchPobbinBuild, parsePobbinRecovery, pobbinId, treeTag } from '../../server/buildData.js'
import { normalizePobbinUrl } from '../../shared/buildInput.js'

test('PoB roundtrip preserves UTF-8 and URL-safe base64', () => {
  const xml = '<PathOfBuilding><Build name="Nhân vật 火"/></PathOfBuilding>'
  const code = encodePob(xml)
  assert.equal(decodePob(code), xml)
  assert.equal(decodePob(` \n${code.replace(/-/g, '+').replace(/_/g, '/')}\n`), xml)
})

test('invalid streams and expansion bombs are rejected', () => {
  assert.throws(() => decodePob('not a PoB code!'))
  assert.throws(() => decodePob('a'.repeat(524289)))
  assert.throws(() => decodePob(encodePob('x'.repeat(8 * 1024 * 1024 + 1))), /8 MB/)
})

test('cache stores only the five most recent compressed strings and survives storage errors', () => {
  const map = new Map()
  const storage = { getItem: (key) => map.get(key), setItem: (key, value) => map.set(key, value) }
  for (let i = 0; i < 7; i++) cacheBuild(`code-${i}`, storage)
  cacheBuild('code-4', storage)
  assert.deepEqual(cachedCodes(storage), ['code-4', 'code-6', 'code-5', 'code-3', 'code-2'])
  storage.setItem(BUILD_CACHE_KEY, '{}')
  assert.deepEqual(cachedCodes(storage), [])
  assert.equal(cacheBuild('new', { getItem: () => { throw new Error('denied') } }), false)
})

test('named recent builds migrate legacy codes, preserve exact compressed content, deduplicate and cap at five', () => {
  const values = new Map([[BUILD_CACHE_KEY, JSON.stringify(['legacy-code', null, { code: 'invalid', label: null }, 'legacy-code'])]])
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) }
  assert.equal(recentBuilds(storage).length, 2)
  const original = encodePob('<PathOfBuilding><Build level="94"/></PathOfBuilding>')
  cacheBuild(original, storage, 'Chieftain · Lv 94 · Righteous Fire')
  assert.deepEqual(recentBuilds(storage)[0], { code: original, label: 'Chieftain · Lv 94 · Righteous Fire' })
  for (let i = 0; i < 6; i++) cacheBuild(`new-${i}`, storage, `Build ${i}`)
  cacheBuild('new-3', storage)
  assert.deepEqual(recentBuilds(storage).map((entry) => entry.label), ['Build 3', 'Build 5', 'Build 4', 'Build 2', 'Build 1'])
  assert.equal(recentBuilds(storage).length, 5)
  assert.ok(JSON.parse(storage.getItem(BUILD_CACHE_KEY)).every((entry) => Object.keys(entry).sort().join(',') === 'code,label'))
})

test('recent build labels use character or class, level and selected main skill', () => {
  const build = { character: { name: 'Imported build', class: 'Chieftain', level: 84 }, mainSkill: 0, skills: [{ mainActiveSkill: 1, gems: [{ name: 'Support', support: true, enabled: true }, { name: 'Fire Trap', enabled: true }, { name: 'Righteous Fire', enabled: true }] }] }
  assert.equal(buildLabel(build), 'Chieftain · Lv 84 · Righteous Fire')
  assert.equal(buildLabel({ ...build, character: { ...build.character, name: 'NamLightning' } }), 'NamLightning · Chieftain · Lv 84 · Righteous Fire')
})

test('pobb.in inputs normalize bare links and raw endpoints without treating base64 as a URL', () => {
  for (const input of ['pobb.in/abcXYZ', ' https://pobb.in/abcXYZ ', 'https://pobb.in/abcXYZ/raw', 'https://pobb.in/abcXYZ/raw/', 'https://pobb.in/abcXYZ?utm_source=test#build']) {
    assert.equal(normalizePobbinUrl(input), 'https://pobb.in/abcXYZ')
    assert.equal(pobbinId(input), 'abcXYZ')
  }
  assert.equal(normalizePobbinUrl(encodePob('<PathOfBuilding/>')), null)
  for (const input of ['pobb.in/', 'pobb.in/a/b', 'https://pobb.in.evil.test/abc', 'https://evil@pobb.in/abc', 'https://pobb.in:123/abc']) assert.throws(() => normalizePobbinUrl(input))
})

test('pobb.in proxy fetches the canonical raw endpoint and reports upstream failures', async (t) => {
  const urls = []
  const code = encodePob('<PathOfBuilding><Build level="84"/></PathOfBuilding>')
  const mocked = t.mock.method(globalThis, 'fetch', async (url) => { urls.push(url); return new Response(code) })
  for (const input of ['pobb.in/abcXYZ', 'https://pobb.in/abcXYZ', 'https://pobb.in/abcXYZ/raw']) assert.equal(await fetchPobbin(input), code)
  assert.deepEqual(urls, Array(3).fill('https://pobb.in/abcXYZ/raw'))
  mocked.mock.mockImplementation(async () => { throw new TypeError('fetch failed') })
  await assert.rejects(fetchPobbin('pobb.in/abcXYZ'), /pobb.in.*15/)
  mocked.mock.mockImplementation(async () => new Response('not found', { status: 404 }))
  await assert.rejects(fetchPobbin('pobb.in/abcXYZ'), /HTTP 404/)
})

test('rendered pobb.in recovery reads numeric rates, nested markup, grouping and zero without reading mods or scripts', () => {
  const html = '<section><h2>RECOVERY</h2><dl><dt>Life regen</dt><dd><b>1,198</b>/s</dd><dt>Mana regen</dt><dd>15/s</dd><dt>Energy shield recharge</dt><dd>67/s</dd><dt>Life recoup</dt><dd>209/s</dd></dl></section>'
  assert.deepEqual(parsePobbinRecovery(html), { NetLifeRegen: 1198, ManaRegenRecovery: 15, EnergyShieldRecharge: 67, LifeRecoupRecovery: 209 })
  assert.deepEqual(parsePobbinRecovery('<div>Life regen: &minus;1&#x202f;198.62/s</div><div>ES Recharge: 0/s</div><div>Life recoup: 25%</div><script>Mana regen: 999/s</script>'), { NetLifeRegen: -1198.62, EnergyShieldRecharge: 0 })
  assert.deepEqual(parsePobbinRecovery('<div>25% increased Energy Shield Recharge Rate</div><div>Regenerate 500 Life per second</div>'), {})
})

test('pobb.in recovery parses flat inline/sibling content and structured JSON without treating percentages as rates', () => {
  const inline = '<div>Recovery <span>Life regen</span> <span>1,198/s</span> Mana regen <b>15/s</b> <span>Energy <em>shield</em> recharge</span><span>67 /s</span> Life recoup 209/s</div>'
  assert.deepEqual(parsePobbinRecovery(inline), { NetLifeRegen: 1198, ManaRegenRecovery: 15, EnergyShieldRecharge: 67, LifeRecoupRecovery: 209 })
  assert.deepEqual(parsePobbinRecovery('<script type="application/json">{"build":{"NetLifeRegen":1198.62,"NetManaRegen":15.1,"ESRecharge":"67/s","LifeRecoupRecoveryMax":209,"LifeRecoup":25}}</script>'), { NetLifeRegen: 1198.62, ManaRegenRecovery: 15.1, EnergyShieldRecharge: 67, LifeRecoupRecovery: 209 })
})

test('pobb.in backup is attempted for missing fields, preserves direct values and requests uncached data', async (t) => {
  const urls = [], code = encodePob('<PathOfBuilding><Build/></PathOfBuilding>')
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    urls.push(url)
    assert.equal(options.cache, 'no-store')
    if (url.endsWith('/raw')) return new Response(code)
    if (url.startsWith('https://pobb.in/')) return new Response('Recovery Life regen 1,198/s Mana regen 15/s')
    assert.equal(url, 'https://api.allorigins.win/raw?url=https%3A%2F%2Fpobb.in%2FbackupCase')
    return new Response('<div>Life regen 999/s Energy shield recharge 67/s Life recoup 209/s</div>')
  })
  const result = await fetchPobbinBuild('pobb.in/backupCase')
  assert.equal(urls.length, 3)
  assert.deepEqual(result.recovery, { NetLifeRegen: 1198, ManaRegenRecovery: 15, EnergyShieldRecharge: 67, LifeRecoupRecovery: 209 })
  assert.equal(result.recoveryWarning, '')
})

test('recent URL builds replace old compressed snapshots by URL and keep only fresh data', () => {
  let value = '[]'
  const storage = { getItem: () => value, setItem: (_, next) => { value = next } }
  cacheBuild('old-code', storage, 'Old', 'https://pobb.in/refreshCase')
  cacheBuild('other-code', storage, 'Other')
  cacheBuild('fresh-code', storage, 'Fresh', 'https://pobb.in/refreshCase')
  assert.deepEqual(recentBuilds(storage), [{ code: 'fresh-code', label: 'Fresh', sourceUrl: 'https://pobb.in/refreshCase' }, { code: 'other-code', label: 'Other' }])
})

test('pobb.in build proxy fetches raw and canonical HTML and returns partial/failure warnings', async (t) => {
  const urls = []
  const code = encodePob('<PathOfBuilding><Build level="84"/></PathOfBuilding>')
  const mocked = t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url)
    return new Response(url.endsWith('/raw') ? code : '<div>Life regen: 1,198/s</div><div>Mana regen: 15/s</div><div>Energy shield recharge: 67/s</div><div>Life recoup: 209/s</div>')
  })
  const result = await fetchPobbinBuild('https://pobb.in/abcXYZ/raw')
  assert.deepEqual(urls.sort(), ['https://pobb.in/abcXYZ', 'https://pobb.in/abcXYZ/raw'])
  assert.equal(result.code, code)
  assert.equal(result.recovery.LifeRecoupRecovery, 209)
  assert.equal(result.recoveryWarning, '')
  mocked.mock.mockImplementation(async (url) => url.endsWith('/raw') ? new Response(code) : new Response('Cloudflare', { status: 403 }))
  const failedHtml = await fetchPobbinBuild('pobb.in/abcXYZ')
  assert.equal(failedHtml.code, code)
  assert.deepEqual(failedHtml.recovery, {})
  assert.match(failedHtml.recoveryWarning, /0\/4/)
  mocked.mock.mockImplementation(async (url) => new Response(url.endsWith('/raw') ? code : '<div>Mana regen: 0/s</div>'))
  assert.match((await fetchPobbinBuild('pobb.in/abcXYZ')).recoveryWarning, /1\/4/)
})

test('basic stats include campaign penalty, combined mods and allocated passives, excluding conditions', () => {
  const stats = basicStats([{ implicitMods: ['+12% to all Elemental Resistances'], explicitMods: ['+40% to Fire and Cold Resistances', '+30% to Chaos Resistance', '+25 to all Attributes', '+10 to Strength and Dexterity', '+100% to Fire Resistance while on Low Life', '50% increased Energy Shield', '10% increased maximum Life'] }], [{ stats: ['+10 to Intelligence', '20% increased maximum Energy Shield', '+8% to Lightning Resistance'] }], { base_str: 32, base_dex: 14, base_int: 14 })
  assert.deepEqual(stats, { FireResist: -8, ColdResist: -8, LightningResist: -40, ChaosResist: -30, Str: 67, Dex: 49, Int: 49, LifeInc: 10, EnergyShieldInc: 20 })
})

test('GGG object modifiers are extracted while unknown objects and primitives are skipped', () => {
  assert.deepEqual(modLines([null, 123, false, [], {}, { description: 12 }, { description: '+34 to maximum Life' }, { text: '+25 to Strength' }, { name: '+10 to Dexterity' }, '+12% to Fire Resistance']), ['+34 to maximum Life', '+25 to Strength', '+10 to Dexterity', '+12% to Fire Resistance'])
  const stats = basicStats([{ implicitMods: [{ description: '+12% to all Elemental Resistances' }], explicitMods: [null, 5, {}, { description: '-21% to all Elemental Resistances' }, { text: '+25 to Strength' }] }], [{ stats: [null, { name: '10% increased maximum Life' }, { description: '+10 to Intelligence' }, false] }])
  assert.equal(stats.FireResist, -69)
  assert.equal(stats.ColdResist, -69)
  assert.equal(stats.Str, 25)
  assert.equal(stats.Int, 10)
  assert.equal(stats.LifeInc, 10)
})

test('GGG properties support numeric/text values and ignore malformed entries before matching', () => {
  const gem = { frameType: 4, typeLine: 'Fireball', socket: 0, properties: [null, { name: 'Level', values: [[20, 0]] }, { name: 'Quality', values: [[{ description: '+23%' }, 0]] }] }
  const skills = gggSkills([{ inventoryId: 'Helm', socketedItems: [gem] }])
  assert.equal(skills[0].gems[0].level, 20)
  assert.equal(skills[0].gems[0].quality, 23)
  const badGem = { ...gem, properties: [{ name: 'Level', values: [[{}, 0]] }, null] }
  assert.equal(gggSkills([{ inventoryId: 'Helm', socketedItems: [badGem] }])[0].gems[0].level, 1)
  assert.match(itemText({ frameType: 0, baseType: 'Robe', properties: [null, { name: 'Energy Shield', values: [[53, 0], null, [{ text: '10' }, 0]] }] }), /Energy Shield: 53, 10/)
  assert.throws(() => parseItemText({}, 'bad'), /must be a string/)
})

test('GGG character import normalizes objects for stats, tooltips, jewels and PoB export', () => {
  const payload = { items: [{ inventoryId: 'Helm', frameType: 2, name: 'Test Helm', baseType: 'Helmet', implicitMods: [{ description: '+34 to maximum Life' }], explicitMods: [{ description: '-21% to all Elemental Resistances' }, null, 4, {}], craftedMods: [{ text: '+25 to Strength' }], properties: [null, { name: 'Armour', values: [[418, 1]] }], socketedItems: [{ frameType: 4, socket: 0, baseType: 'Righteous Fire', properties: [{ name: 'Level', values: [['20 (Max)', 0]] }] }] }], passives: { character: 1, hashes: [444], items: [{ id: 'jewel', inventoryId: 'PassiveJewels', baseType: 'Cobalt Jewel', explicitMods: [{ description: '+12% to Fire Resistance' }] }] } }
  const original = JSON.stringify(payload)
  const build = fromGgg({ name: 'NamLightning', class: 'Chieftain', level: 84 }, payload, { nodes: [{ id: '444', name: 'Life', stats: [{ description: '10% increased maximum Life' }] }] })
  assert.equal(build.stats.FireResist, -69)
  assert.equal(build.stats.Str, 57)
  assert.equal(build.skills[0].gems[0].level, 20)
  assert.deepEqual(build.equipment.Helmet.explicitMods, ['-21% to all Elemental Resistances'])
  assert.deepEqual(build.jewels[0].explicitMods, ['+12% to Fire Resistance'])
  assert.deepEqual(build.tree.allocated[0].stats, ['10% increased maximum Life'])
  assert.equal(JSON.stringify(payload), original)
  const xml = decodePob(build.code)
  assert.match(xml, /\+34 to maximum Life/)
  assert.match(xml, /\+25 to Strength \{crafted\}/)
  assert.doesNotMatch(xml, /\[object Object\]/)
})

test('GGG export keeps links, equipped jewels, skills and selected mastery effects', () => {
  const metadata = { nodes: [], jewelSlots: [123], classes: [{ name: 'Scion', base_str: 20, base_dex: 20, base_int: 20 }], version: '3.27' }
  const payload = { items: [{ id: 'body', inventoryId: 'BodyArmour', name: 'Test', baseType: 'Robe', frameType: 2, sockets: [{ group: 0, attr: 'I' }, { group: 0, attr: 'S' }], explicitMods: ['+40% to Fire Resistance'], socketedItems: [{ frameType: 4, typeLine: 'Fireball', socket: 0 }, { frameType: 4, typeLine: 'Empower Support', socket: 1 }] }, { id: 'swap', inventoryId: 'Weapon2', baseType: 'Wand', explicitMods: ['+70% to Fire Resistance'] }], passives: { character: 0, hashes: [123], mastery_effects: { 123: 456 }, items: [{ id: 'jewel', inventoryId: 'PassiveJewels', x: 0, baseType: 'Cobalt Jewel', explicitMods: ['+10% to Fire Resistance'] }] } }
  const build = fromGgg({ name: 'Test', class: 'Scion', level: 90 }, payload, metadata)
  const xml = decodePob(build.code)
  assert.match(xml, /Sockets: B-R/)
  assert.match(xml, /<Socket nodeId="123" itemId="3"/)
  assert.match(xml, /masteryEffects="\{123,456\}"/)
  assert.match(xml, /targetVersion="3_0"/)
  assert.match(xml, /treeVersion="3_27"/)
  assert.match(xml, /nameSpec="Fireball"/)
  assert.equal(build.jewels.length, 1)
  assert.equal(build.stats.FireResist, -10)
  assert.equal(displayedStats(build, 2).FireResist, 60)
  assert.equal(displayedStats(build, 2).Str, 20)
})

test('PoB item parsing retains rarity, socket links and separate modifier types', () => {
  const item = parseItemText('Rarity: RARE\nDoom Shell\nVaal Regalia\nEnergy Shield: 400\nSockets: B-B R-G\nImplicits: 1\n+10 to Intelligence\n+40 to Strength {fractured}\n+50 to maximum Life\n+30% to Fire Resistance {crafted}\nCorrupted', '1')
  assert.equal(item.frameType, 2)
  assert.deepEqual(item.sockets.map((s) => s.group), [0, 0, 1, 1])
  assert.deepEqual(item.implicitMods, ['+10 to Intelligence'])
  assert.deepEqual(item.fracturedMods, ['+40 to Strength'])
  assert.deepEqual(item.craftedMods, ['+30% to Fire Resistance'])
  assert.equal(item.corrupted, true)
})

test('pobb.in proxy prevents other hosts, redirects and credential injection', () => {
  assert.equal(pobbinId('https://pobb.in/abc-123/raw'), 'abc-123')
  for (const url of ['http://pobb.in/test', 'https://pobb.in.evil.com/test', 'https://evil@pobb.in/test', 'https://pobb.in:4000/test', 'https://pobb.in/a/b', 'file:///test']) assert.throws(() => pobbinId(url))
  assert.equal(treeTag('3.27'), '3.27.0')
  assert.equal(treeTag('3_27'), '3.27.0')
  assert.throws(() => treeTag('../../etc'))
})

test('compact tree resolves selected mastery only and excludes unallocated nodes', () => {
  const data = { nodes: { 1: { name: 'Life Mastery', isMastery: true, group: 1, orbit: 0, masteryEffects: [{ effect: 8, stats: ['+50 to maximum Life'] }] }, 2: { name: 'Strength', group: 1, stats: ['+10 to Strength'] } }, groups: { 1: { x: 0, y: 0 } }, constants: { skillsPerOrbit: [1], orbitRadii: [0] } }
  const result = compactTree(data, [1], { 1: 8 })
  assert.equal(result.nodes.length, 1)
  assert.deepEqual(result.nodes[0].stats, ['+50 to maximum Life'])
  assert.equal(result.nodes[0].out, undefined)
})

test('legacy and current official tree URLs preserve allocated nodes and mastery selections', () => {
  const encode = (bytes) => `https://www.pathofexile.com/passive-skill-tree/${Buffer.from(bytes).toString('base64url')}`
  assert.deepEqual(decodeTreeUrl(encode([0, 0, 0, 4, 3, 1, 0, 1, 188, 239, 122])), { nodes: ['444', '61306'], masteries: {} })
  // v6: two normal nodes, one cluster node, one mastery [effectId, nodeId].
  assert.deepEqual(decodeTreeUrl(encode([0, 0, 0, 6, 3, 1, 2, 1, 188, 239, 122, 1, 0, 10, 1, 0, 8, 1, 188])), { nodes: ['444', '61306', '65546'], masteries: { 444: 8 } })
  assert.deepEqual(decodeTreeUrl(encode([0, 0, 0, 7, 3, 1, 2, 1, 188, 239, 122, 1, 0, 10, 1, 0, 8, 1, 188])), { nodes: ['444', '61306', '65546'], masteries: { 444: 8 } })
})
