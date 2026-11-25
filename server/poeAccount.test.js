import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { configuredSessionId, poeHeaders, POE_USER_AGENT, logPoeForbidden } from './poeRequest.js'

test('GGG headers use the requested User-Agent and omit Cookie in public mode', () => {
  assert.equal(POE_USER_AGENT, 'OAuth poestash-viewer/1.0 (contact: dev@poestash.local)')
  assert.deepEqual(poeHeaders(''), { Accept: 'application/json', 'User-Agent': POE_USER_AGENT })
  assert.equal(poeHeaders(' POESESSID=fake-session ').Cookie, 'POESESSID=fake-session')
  assert.equal(configuredSessionId({ POESESSID: '', poesessid: 'old-session' }, { POESESSID: 'env-session', VITE_POESESSID: 'vite-session' }), '')
  assert.equal(configuredSessionId({}, { POESESSID: 'env-session' }), 'env-session')
})

test('Forbidden logging identifies endpoint and query without exposing credentials', (t) => {
  const warning = t.mock.method(console, 'warn', () => {})
  logPoeForbidden('https://www.pathofexile.com/character-window/get-characters?accountName=Test%231234&realm=pc&POESESSID=secret&token=private', 200, { error: { code: 6 } })
  const [label, detail] = warning.mock.calls[0].arguments
  assert.equal(label, '[GGG Forbidden]')
  assert.equal(detail.endpoint, 'https://www.pathofexile.com/character-window/get-characters')
  assert.deepEqual(detail.query, { accountName: 'Test#1234', realm: 'pc', POESESSID: '[redacted]', token: '[redacted]' })
  assert.equal(detail.code, 6)
  logPoeForbidden('https://www.pathofexile.com/character-window/get-items', 403)
  assert.equal(warning.mock.calls.length, 2)
  logPoeForbidden('https://www.pathofexile.com/character-window/get-items', 200, { items: [] })
  assert.equal(warning.mock.calls.length, 2)
})

test('saving an empty cookie removes old credentials and public character requests still work', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'poestash-account-test-'))
  const configPath = path.join(directory, 'config.local.json')
  const envKeys = ['POESTASH_CONFIG_PATH', 'POESESSID', 'POE_ACCOUNT_NAME']
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
  process.env.POESTASH_CONFIG_PATH = configPath
  process.env.POESESSID = 'environment-test-session'
  delete process.env.POE_ACCOUNT_NAME
  try {
    await writeFile(configPath, JSON.stringify({ POE_ACCOUNT_NAME: 'Test#1234', POESESSID: 'old-test-session', poesessid: 'legacy-test-session', poeSessId: 'other-old-session', unrelated: true }))
    const api = await import(`./poeAccount.js?test=${Date.now()}`)
    const status = await api.saveAccountConfig({ accountName: 'Test#1234', poeSessId: '  ' })
    assert.equal(status.cookieConfigured, false)
    assert.equal(status.configured, true)
    assert.equal(status.mode, 'public')
    assert.equal(status.source, 'local')
    assert.ok(!Object.hasOwn(status, 'sessionId'))
    const stored = JSON.parse(await readFile(configPath, 'utf8'))
    assert.equal(stored.POESESSID, '')
    assert.equal(stored.unrelated, true)
    assert.ok(!Object.hasOwn(stored, 'poesessid'))
    assert.ok(!Object.hasOwn(stored, 'poeSessId'))
    const calls = []
    const mocked = t.mock.method(globalThis, 'fetch', async (url, options) => {
      calls.push({ url, headers: options.headers })
      if (url.includes('/get-characters')) return Response.json([{ name: 'TestChar', class: 'Witch', level: 80, league: 'Standard' }])
      if (url.includes('/get-items')) return Response.json({ items: [] })
      if (url.includes('/get-passive-skills')) return Response.json({ hashes: [] })
      throw new Error('Unexpected request')
    })
    await api.getAccountCharacterBuild('TestChar')
    assert.equal(calls.length, 3)
    assert.ok(calls[0].url.endsWith('get-characters?accountName=Test%231234&realm=pc'))
    assert.equal(new URL(calls[0].url).hash, '')
    for (const call of calls) {
      assert.equal(call.headers['User-Agent'], POE_USER_AGENT)
      assert.ok(!Object.hasOwn(call.headers, 'Cookie'))
    }
    await api.getAccountCharacterBuild('TestChar')
    assert.equal(calls.length, 3, 'switching back uses cached characters, items and passives')
    await api.getAccountCharacterItems('TestChar')
    assert.equal(calls.length, 3, 'Stash and Build share the same items cache')
    await api.getAccountCharacterBuild('TestChar', { force: true })
    assert.equal(calls.length, 5, 'explicit Reload refreshes items and passives, keeping the cached ownership list')
    await assert.rejects(api.getStashCredentials(), { code: 'STASH_SESSION_REQUIRED' })
    await api.saveAccountConfig({ accountName: 'Test#1234', poeSessId: 'new-test-session' })
    await api.saveAccountConfig({ accountName: 'Test#1234' })
    calls.length = 0
    await api.getAccountCharacterBuild('TestChar')
    for (const call of calls) assert.equal(call.headers.Cookie, 'POESESSID=new-test-session')
    assert.ok(calls.every((call) => !call.url.includes('get-stash-items')))
    await assert.rejects(api.saveAccountConfig({ accountName: 'Test#1234', poeSessId: 'bad' }), { code: 'INVALID_SESSION_ID' })
    await api.saveAccountConfig({ accountName: 'Test#1234', poeSessId: '' })
    const warning = t.mock.method(console, 'warn', () => {})
    mocked.mock.mockImplementation(async () => Response.json({ error: { code: 6, message: 'Forbidden' } }))
    await assert.rejects(api.getAccountCharacters(), { code: 'PROFILE_FORBIDDEN', status: 403 })
    assert.deepEqual(warning.mock.calls[0].arguments[1], {
      endpoint: 'https://www.pathofexile.com/character-window/get-characters',
      query: { accountName: 'Test#1234', realm: 'pc' }, status: 200, code: 6,
    })
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    await unlink(configPath).catch((error) => { if (error.code !== 'ENOENT') throw error })
    await rmdir(directory)
  }
})
