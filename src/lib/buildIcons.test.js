import test from 'node:test'
import assert from 'node:assert/strict'
import { applyBuildIcons, iconNames, missingIconNames, resolveBuildIcons, itemIcon, iconFallbackSlot } from './buildIcons.js'
import { resolveWikiIcons } from '../../shared/buildIconLookup.js'

test('icon candidates prefer unique art and normalize magic flask and jewel bases', () => {
  assert.deepEqual(iconNames({ frameType: 3, name: 'Mageblood', baseType: 'Heavy Belt' }), ['Mageblood', 'Heavy Belt'])
  assert.deepEqual(iconNames({ frameType: 1, baseType: "Alchemist's Granite Flask of the Armadillo" }), ["Alchemist's Granite Flask of the Armadillo", 'Granite Flask'])
  assert.deepEqual(iconNames({ frameType: 1, baseType: 'Shimmering Cobalt Jewel' }), ['Shimmering Cobalt Jewel', 'Cobalt Jewel'])
  assert.deepEqual(iconNames({ name: 'Awakened Added Fire Damage Support' }, true), ['Awakened Added Fire Damage Support'])
})

test('icon resolver batches exact names, decodes wiki entities, validates hosts and forwards cancellation', async () => {
  const controller = new AbortController()
  const calls = []
  const fetcher = async (url, options) => {
    const query = new URL(url).searchParams
    calls.push(query)
    assert.strictEqual(options.signal, controller.signal)
    assert.equal(query.get('origin'), '*')
    return new Response(JSON.stringify(query.get('action') === 'cargoquery' ? {
      cargoquery: [{ title: { name: 'Shavronne&#039;s Wrappings', icon: 'File:Shavronne&#039;s Wrappings_inventory_icon.png' } }, { title: { name: 'Bad', icon: 'File:Bad.png' } }],
    } : { query: { pages: { 1: { title: "File:Shavronne's Wrappings inventory icon.png", imageinfo: [{ url: 'https://www.poewiki.net/images/6/62/Shavronne.png' }] }, 2: { title: 'File:Bad.png', imageinfo: [{ url: 'https://evil.example/image.png' }] } } } }))
  }
  const icons = await resolveWikiIcons(["Shavronne's Wrappings", "Shavronne's Wrappings", 'Bad'], { signal: controller.signal, fetcher })
  assert.equal(calls.length, 3) // Includes a verified-file lookup for the missing/unsafe row.
  assert.match(calls[0].get('where'), /Shavronne''s Wrappings/)
  assert.equal(icons["Shavronne's Wrappings"], 'https://www.poewiki.net/images/6/62/Shavronne.png')
  assert.equal(icons.Bad, undefined)
})

test('applying artwork covers gear, flasks, jewels and gems without changing code or saved stats', () => {
  const build = { source: 'pob', code: 'original compressed code', stats: { Life: 12345 }, equipment: { Belt: { frameType: 3, name: 'Mageblood', baseType: 'Heavy Belt' }, 'Flask 1': { baseType: 'Granite Flask' }, Helmet: { baseType: 'Hubris Circlet', icon: 'https://web.poecdn.com/original.png' } }, jewels: [{ baseType: 'Cobalt Jewel' }], skills: [{ gems: [{ name: 'Righteous Fire' }] }] }
  const names = missingIconNames(build)
  assert.ok(!names.includes('Hubris Circlet'))
  const icons = Object.fromEntries(names.map((name) => [name, `https://www.poewiki.net/${name}.png`]))
  const result = applyBuildIcons(build, icons)
  assert.equal(result.equipment.Belt.icon, icons.Mageblood)
  assert.equal(result.equipment['Flask 1'].icon, icons['Granite Flask'])
  assert.equal(result.jewels[0].icon, icons['Cobalt Jewel'])
  assert.equal(result.skills[0].gems[0].icon, icons['Righteous Fire'])
  assert.strictEqual(result.stats, build.stats)
  assert.equal(result.code, build.code)
  assert.equal(build.equipment.Belt.icon, undefined)
})

test('unavailable icon services reject without returning broken image guesses', async () => {
  await assert.rejects(resolveWikiIcons(['Unknown'], { fetcher: async () => new Response('', { status: 503 }) }), /503/)
})

test('special-slot names and tierless bases resolve even for non-unique Wickerman items; API art wins', () => {
  const item = { frameType: 2, name: "Greater Eater of Worlds' Head", baseType: 'Viscera' }
  assert.deepEqual(iconNames(item, false, 'Wickerman Head'), ["Greater Eater of Worlds' Head", "Eater of Worlds' Head", 'Viscera'])
  const build = { equipment: { 'Wickerman Head': item, 'Graft 1': { iconUrl: 'https://web.poecdn.com/original.png', baseType: 'Unknown' } }, jewels: [], skills: [] }
  assert.ok(missingIconNames(build).includes("Eater of Worlds' Head"))
  assert.ok(!missingIconNames(build).includes('Unknown'))
  const resolved = applyBuildIcons(build, { "Eater of Worlds' Head": 'https://web.poecdn.com/head.png' })
  assert.equal(resolved.equipment['Wickerman Head'].icon, 'https://web.poecdn.com/head.png')
  assert.equal(itemIcon(resolved.equipment['Graft 1']), 'https://web.poecdn.com/original.png')
  for (const [name, slot] of [["Greater Eater of Worlds' Head", 'Helmet'], ['Templar Banner', 'Weapon'], ["King Crab's Claw", 'Offhand'], ["Greater Captain's Leg", 'Boots']]) assert.equal(iconFallbackSlot({ baseType: name }, 'Wickerman'), slot)
})

test('missing Cargo rows resolve only verified image files, including when Cargo fails', async () => {
  const icons = await resolveWikiIcons(['Templar Banner'], { fetcher: async url => {
    const params = new URL(url).searchParams
    if (params.get('action') === 'cargoquery') return new Response('', { status: 503 })
    assert.equal(params.get('titles'), 'File:Templar Banner inventory icon.png')
    return new Response(JSON.stringify({ query: { pages: { 1: { title: 'File:Templar Banner inventory icon.png', imageinfo: [{ url: 'https://web.poecdn.com/verified-banner.png' }] } } } }))
  } })
  assert.equal(icons['Templar Banner'], 'https://web.poecdn.com/verified-banner.png')
})

test('browser icon lookup uses the local proxy and forwards its abort signal', async () => {
  const controller = new AbortController()
  const result = await resolveBuildIcons(['Mageblood'], { signal: controller.signal, fetcher: async (url, options) => {
    assert.equal(url, '/api/build/icons')
    assert.equal(options.method, 'POST')
    assert.deepEqual(JSON.parse(options.body), { names: ['Mageblood'] })
    assert.strictEqual(options.signal, controller.signal)
    return new Response(JSON.stringify({ icons: { Mageblood: 'https://www.poewiki.net/Mageblood.png' } }))
  } })
  assert.equal(result.Mageblood, 'https://www.poewiki.net/Mageblood.png')
})
