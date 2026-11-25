import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveTreeIcons } from './buildTreeIcons.js'

test('passive icons resolve only matching individual images, cache URLs and reject unrelated illustrations', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async url => {
    const query = new URL(url).searchParams
    requests.push(query)
    return { ok: true, json: async () => query.get('prop') === 'images' ? { query: { pages: {
      1: { title: 'Test Keystone', images: [{ title: 'File:Unrelated inventory icon.png' }, { title: 'File:ExactKey passive skill icon.png' }, { title: 'File:OtherNode passive skill icon.png' }] },
      2: { title: 'Test Mastery', images: [{ title: 'File:TestMastery mastery icon.png' }] },
      3: { title: 'Ambiguous Passive', images: [{ title: 'File:WrongA passive skill icon.png' }, { title: 'File:WrongB passive skill icon.png' }] },
    } } } : { query: { pages: {
      1: { title: 'File:ExactKey passive skill icon.png', imageinfo: [{ width: 128, height: 128, url: 'https://www.poewiki.net/images/a/ab/exact.png', thumburl: 'https://www.poewiki.net/images/thumb/a/ab/exact.png' }] },
      2: { title: 'File:TestMastery mastery icon.png', imageinfo: [{ thumburl: 'https://www.poewiki.net/images/thumb/a/ab/mastery.png' }] },
    } } } }
  })
  const nodes = [{ id: '1', name: 'Test Keystone', iconKey: 'Art/ExactKey.png' }, { id: '2', name: 'Test Mastery', iconKey: 'Art/NotInWiki.png' }, { id: '3', name: 'Ambiguous Passive', iconKey: 'Art/Missing.png' }]
  const result = await resolveTreeIcons(nodes, new AbortController().signal)
  assert.deepEqual(Object.keys(result), ['1', '2'])
  assert.equal(result['1'], 'https://www.poewiki.net/images/a/ab/exact.png')
  assert.equal(requests.length, 2)
  assert.equal(requests[1].get('iiurlwidth'), '64')
  assert.ok(!requests[1].get('titles').includes('WrongA'))
  assert.deepEqual(await resolveTreeIcons(nodes, new AbortController().signal), result)
  assert.equal(requests.length, 2)
})
