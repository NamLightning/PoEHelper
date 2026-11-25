import test from 'node:test'
import assert from 'node:assert/strict'
import { createCharacterCache, characterCacheKey, CHARACTER_CACHE_TTL, isCharacterRefresh } from './poeCharacterCache.js'
import { poeFetch, rateLimitDeadline, POE_USER_AGENT } from './poeRequest.js'

test('character cache expires after five minutes, deduplicates requests, and forces fresh snapshots', async () => {
  let now = 0, calls = 0
  const cache = createCharacterCache({ now: () => now })
  const load = async () => ({ count: ++calls })
  const [first, concurrent] = await Promise.all([cache.get('account/char', load), cache.get('account/char', load, { force: true })])
  assert.deepEqual(first, concurrent)
  assert.equal(calls, 1)
  now = CHARACTER_CACHE_TTL - 1
  assert.equal((await cache.get('account/char', load)).count, 1)
  now++
  assert.equal((await cache.get('account/char', load)).count, 2)
  assert.equal((await cache.get('account/char', load, { force: true })).count, 3)
  await cache.get('account/other', load)
  assert.equal(calls, 4)
})

test('cache isolates accounts, endpoint, character and cookie rotation without embedding secrets in keys', () => {
  const url = 'https://www.pathofexile.com/character-window/get-items?accountName=Test%231&character=A'
  const keys = [characterCacheKey(url, ''), characterCacheKey(url, 'fake-session'), characterCacheKey(url.replace('Test%231', 'Other%232'), ''), characterCacheKey(url.replace('character=A', 'character=B'), ''), characterCacheKey(url.replace('get-items', 'get-passive-skills'), '')]
  assert.equal(new Set(keys).size, 5)
  assert.ok(keys.every(key => !key.includes('fake-session') && /:[a-f0-9]{64}$/.test(key)))
  assert.match(keys[0], /^get-items:Test%231:A:pc:/)
  assert.equal(characterCacheKey(url + '&refresh=true', ''), keys[0])
})

test('only explicit refresh=true (and legacy refresh=1) bypass the cache', () => {
  assert.equal(isCharacterRefresh('true'), true)
  assert.equal(isCharacterRefresh('1'), true)
  for (const value of [undefined, '', 'false', '0', ['true'], true]) assert.equal(isCharacterRefresh(value), false)
})

test('cache bounds memory, evicts LRU entries, and never caches failed responses', async () => {
  const cache = createCharacterCache({ maxEntries: 2, maxBytes: 100 })
  await cache.get('a', async () => 'a')
  await cache.get('b', async () => 'b')
  await cache.get('a', async () => assert.fail('a should be cached'))
  await cache.get('c', async () => 'c')
  assert.equal(await cache.get('b', async () => 'b reloaded'), 'b reloaded')
  for (let i = 0; i < 2; i++) await assert.rejects(cache.get('failed', async () => { throw new Error('upstream failed') }))
  await cache.get('oversize', async () => 'x'.repeat(101))
  assert.equal(await cache.get('oversize', async () => 'fresh'), 'fresh')
})

test('clearing credentials prevents in-flight old data from repopulating the cache', async () => {
  const cache = createCharacterCache()
  let resolve
  const old = cache.get('key', () => new Promise(done => { resolve = done }))
  await Promise.resolve()
  cache.clear()
  await cache.get('key', async () => 'new')
  resolve('old')
  await old
  assert.equal(await cache.get('key', async () => assert.fail('new entry should be cached')), 'new')
})

test('429 honors Retry-After and account state, blocks all endpoints without retrying, then allows requests', async t => {
  let now = 2_000_000_000_000, calls = 0
  t.mock.method(Date, 'now', () => now)
  t.mock.method(console, 'warn', () => {})
  const url = 'https://www.pathofexile.com/character-window/get-items'
  const limited = async (_url, options) => {
    calls++
    assert.equal(options.headers['User-Agent'], POE_USER_AGENT)
    return new Response('not JSON', { status: 429, headers: { 'Retry-After': '12', 'X-Rate-Limit-Account-State': '10:10:12' } })
  }
  await assert.rejects(poeFetch(url, {}, limited), { status: 429, code: 'POE_RATE_LIMITED', retryAfter: 12, accountState: '10:10:12' })
  now += 5000
  await assert.rejects(poeFetch(url.replace('get-items', 'get-passive-skills'), {}, limited), { retryAfter: 7 })
  assert.equal(calls, 1)
  now += 7000
  await poeFetch(url, {}, async () => Response.json({ items: [] }))
  await assert.rejects(poeFetch(url, {}, async () => new Response('', { status: 429 })), { retryAfter: 60 })
  assert.equal(rateLimitDeadline('not-a-date', now), now + 60_000)
  assert.equal(rateLimitDeadline(new Date(now + 30_000).toUTCString(), now), now + 30_000)
})
