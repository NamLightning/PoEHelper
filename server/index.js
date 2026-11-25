import express from 'express'
import {
  getMarketCategory,
  getMarketRate,
  getMarketSummary,
  getPoeOneLeagues,
} from './poeNinja.js'
import {
  getAccountCharacterItems,
  getAccountCharacterBuild,
  getAccountCharacters,
  getAccountConfigStatus,
  saveAccountConfig,
} from './poeAccount.js'
import { readStashFileCache, syncPoeStash, writeStashFileCache } from './poeStash.js'
import { fetchPobbinBuild, fetchTree } from './buildData.js'
import { resolveWikiIcons } from '../shared/buildIconLookup.js'
import { resolveTreeIcons, fetchTreeIcon } from './buildTreeIcons.js'
import { poeFetch, poeHeaders } from './poeRequest.js'
import { isCharacterRefresh } from './poeCharacterCache.js'

const app = express()
const port = Number(process.env.PORT) || 3001

app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))

function sendAccountError(response, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500
  if (status === 429) response.set('Retry-After', String(error.retryAfter || 60))
  response.status(status).json({
    error: error instanceof Error ? error.message : 'Account request failed.',
    code: error?.code || 'ACCOUNT_REQUEST_FAILED',
    ...(status === 429 ? { retryAfter: error.retryAfter || 60, retryAt: error.retryAt, accountState: error.accountState || '' } : {}),
  })
}

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.get('/api/build/character', async (request, response) => {
  try { response.set('Cache-Control', 'no-store'); response.json(await getAccountCharacterBuild(request.query.character, { force: isCharacterRefresh(request.query.refresh) })) }
  catch (error) { sendAccountError(response, error) }
})

app.get('/api/build/pobbin', async (request, response) => {
  response.set('Cache-Control', 'no-store, max-age=0')
  try { response.json(await fetchPobbinBuild(request.query.url)) }
  catch (error) { response.status(400).json({ error: error.message }) }
})

app.post('/api/build/icons', async (request, response) => {
  const names = request.body?.names
  if (!Array.isArray(names) || names.length > 160 || !names.every((name) => typeof name === 'string' && name.length > 0 && name.length <= 160)) {
    return response.status(400).json({ error: 'Invalid icon names.' })
  }
  const controller = new AbortController()
  const cancel = () => { if (!response.writableEnded) controller.abort() }
  response.once('close', cancel)
  const timeout = setTimeout(() => controller.abort(), 15000)
  try { response.json({ icons: await resolveWikiIcons(names, { signal: controller.signal }) }) }
  catch { if (!response.destroyed) response.status(502).json({ error: 'Icon service unavailable.' }) }
  finally { clearTimeout(timeout); response.off('close', cancel) }
})

app.post('/api/build/tree-nodes', async (request, response) => {
  const { ids, version, masteries, clusterJewels = [], layout = false, jewelData = {} } = request.body || {}
  if (!Array.isArray(ids) || ids.length > 2500 || !ids.every((id) => /^\d+$/.test(String(id)))) {
    return response.status(400).json({ error: 'Invalid allocated node IDs.' })
  }
  if (!Array.isArray(clusterJewels) || clusterJewels.length > 100 || !clusterJewels.every((jewel) => jewel && (/^\d+$/.test(String(jewel.nodeId)) || Number.isInteger(jewel.socketIndex) && jewel.socketIndex >= 0 && jewel.socketIndex < 2500) && typeof jewel.baseType === 'string' && jewel.baseType.length <= 100 && Array.isArray(jewel.mods) && jewel.mods.length <= 200 && jewel.mods.every((line) => typeof line === 'string' && line.length <= 2000))) {
    return response.status(400).json({ error: 'Invalid cluster jewels.' })
  }
  if (typeof layout !== 'boolean' || !jewelData || typeof jewelData !== 'object' || JSON.stringify(jewelData).length > 512 * 1024) return response.status(400).json({ error: 'Invalid expansion graph.' })
  try { response.json(await fetchTree(version, ids, masteries, clusterJewels, { layout, jewelData })) }
  catch (error) { response.status(502).json({ error: error.message }) }
})

app.get('/api/build/tree', async (request, response) => {
  try { response.json(await fetchTree(request.query.version)) }
  catch (error) { response.status(502).json({ error: error.message }) }
})

app.post('/api/build/tree-icons', async (request, response) => {
  const nodes = request.body?.nodes
  if (!Array.isArray(nodes) || nodes.length > 35 || !nodes.every(node => node && /^\d+$/.test(String(node.id)) && typeof node.name === 'string' && node.name.length > 0 && node.name.length <= 150 && (!node.iconKey || typeof node.iconKey === 'string' && node.iconKey.length < 300))) return response.status(400).json({ error: 'Invalid passive icon selection.' })
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000)
  const cancel = () => { if (!response.writableEnded) controller.abort() }
  response.on('close', cancel)
  try {
    const icons = await resolveTreeIcons(nodes, controller.signal)
    response.json({ icons: Object.fromEntries(Object.entries(icons).map(([id, url]) => [id, `/api/build/tree-icon?url=${encodeURIComponent(url)}`])) })
  }
  catch { if (!response.destroyed) response.status(502).json({ error: 'Passive icon service unavailable.' }) }
  finally { clearTimeout(timeout); response.off('close', cancel) }
})

app.get('/api/build/tree-icon', async (request, response) => {
  const value = request.query.url
  if (typeof value !== 'string' || value.length > 1500 || !/^https:\/\/www\.poewiki\.net\/images\/[\w%/().,-]+\.png$/.test(value)) return response.status(400).end()
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000)
  const cancel = () => { if (!response.writableEnded) controller.abort() }
  response.on('close', cancel)
  try {
    const upstream = await fetchTreeIcon(value, controller.signal)
    if (!upstream.ok || !upstream.headers.get('content-type')?.startsWith('image/png') || Number(upstream.headers.get('content-length')) > 256 * 1024) return response.status(502).end()
    const bytes = Buffer.from(await upstream.arrayBuffer())
    if (bytes.length > 256 * 1024) return response.status(502).end()
    response.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(bytes)
  } catch { if (!response.destroyed) response.status(502).end() }
  finally { clearTimeout(timeout); response.off('close', cancel) }
})

app.get('/api/trade/stats', async (_request, response) => {
  try {
    const upstream = await poeFetch('https://www.pathofexile.com/api/trade/data/stats', { headers: poeHeaders() })
    if (!upstream.ok) {
      throw new Error(`Path of Exile Trade returned HTTP ${upstream.status}.`)
    }

    const payload = await upstream.json()
    const statGroups = Array.isArray(payload?.result)
      ? payload.result.filter((group) => {
          const isImbuedGroup = String(group?.label || '').toLowerCase() === 'imbued'
            || group?.id === 'imbued'
            || (Array.isArray(group?.entries) && group.entries.some((entry) => (
              typeof entry?.id === 'string' && entry.id.startsWith('imbued.stat_')
            )))
          return ['explicit', 'implicit', 'enchant', 'pseudo'].includes(group?.id) || isImbuedGroup
        })
      : []
    if (!statGroups.some((group) => Array.isArray(group.entries))) {
      throw new Error('Path of Exile Trade response did not contain stat entries.')
    }

    response.json({
      result: statGroups.map((group) => ({
        ...group,
        entries: Array.isArray(group.entries)
          ? group.entries.filter((entry) => (
            typeof entry?.id === 'string'
              && (entry.id.startsWith(`${group.id}.`) || entry.id.startsWith('imbued.stat_'))
            && typeof entry.text === 'string'
          ))
          : [],
      })),
    })
  } catch (error) {
    if (error?.status === 429) return sendAccountError(response, error)
    console.error('PoE Trade stats request failed:', error)
    response.status(502).json({
      error: 'Could not load explicit stat filters from Path of Exile Trade.',
      code: 'POE_TRADE_STATS_REQUEST_FAILED',
    })
  }
})


app.get('/api/account/config', async (_request, response) => {
  try {
    response.json(await getAccountConfigStatus())
  } catch (error) {
    console.error('Account config status failed:', error)
    sendAccountError(response, error)
  }
})

app.post('/api/account/config', async (request, response) => {
  try {
    response.json(await saveAccountConfig(request.body || {}))
  } catch (error) {
    if (error?.status >= 500) console.error('Saving account config failed:', error)
    sendAccountError(response, error)
  }
})

app.get('/api/account/characters', async (request, response) => {
  try {
    response.json(await getAccountCharacters({ force: isCharacterRefresh(request.query.refresh) }))
  } catch (error) {
    if (error?.status >= 500) console.error('Loading PoE account characters failed:', error)
    sendAccountError(response, error)
  }
})

app.get('/api/account/character-items', async (request, response) => {
  try {
    response.json(await getAccountCharacterItems(request.query.character, { force: isCharacterRefresh(request.query.refresh) }))
  } catch (error) {
    if (error?.status >= 500) console.error('Loading PoE character items failed:', error)
    sendAccountError(response, error)
  }
})

async function syncStashHandler(request, response) {
  const requestedLeague = request.method === 'POST' ? request.body?.league : request.query.league
  const league = typeof requestedLeague === 'string' ? requestedLeague.trim() : 'Standard'
  try {
    response.json(await syncPoeStash(league))
  } catch (error) {
    if (error?.status === 429) return sendAccountError(response, error)
    console.error('Direct PoE stash sync failed:', error)
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
      ? error.status
      : 502
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Could not sync PoE stash.',
      code: error?.code || 'STASH_SYNC_FAILED',
    })
  }
}

app.get('/api/stash/sync', syncStashHandler)
app.post('/api/stash/sync', syncStashHandler)

app.get('/api/stash/cache', async (_request, response) => {
  try {
    response.json(await readStashFileCache())
  } catch (error) {
    console.error('Reading persisted PoE stash cache failed:', error)
    response.status(500).json({
      error: 'Could not read the persisted stash cache.',
      code: 'STASH_CACHE_READ_FAILED',
    })
  }
})

app.post('/api/stash/snapshots', async (request, response) => {
  try {
    const snapshots = Array.isArray(request.body?.snapshots) ? request.body.snapshots.slice(0, 30) : []
    const cache = await readStashFileCache()
    await writeStashFileCache({ ...cache, snapshots })
    response.json({ ok: true, snapshots })
  } catch (error) {
    console.error('Persisting PoE stash snapshots failed:', error)
    response.status(500).json({ error: 'Could not persist stash snapshots.', code: 'STASH_SNAPSHOT_WRITE_FAILED' })
  }
})

app.get('/api/market/leagues', async (_request, response) => {
  try {
    response.json(await getPoeOneLeagues())
  } catch (error) {
    console.error('PoE 1 leagues request failed:', error)
    response.status(502).json({
      error: 'Could not load PoE 1 leagues from poe.ninja.',
      details: error instanceof Error ? error.message : 'Unknown upstream error.',
    })
  }
})

app.get('/api/market/rate', async (request, response) => {
  const league = typeof request.query.league === 'string' ? request.query.league.trim() : ''
  if (!league || league.length > 64 || /[\u0000-\u001f\u007f]/.test(league)) {
    return response.status(400).json({
      error: 'Provide a league name between 1 and 64 characters.',
    })
  }

  try {
    response.json(await getMarketRate(league))
  } catch (error) {
    console.error(`Market rate failed for "${league}":`, error)
    response.status(502).json({
      error: 'Could not load market rate from poe.ninja.',
      details: error instanceof Error ? error.message : 'Unknown upstream error.',
    })
  }
})

app.get('/api/market/category', async (request, response) => {
  const league = typeof request.query.league === 'string' ? request.query.league.trim() : ''
  const category = typeof request.query.category === 'string' ? request.query.category.trim() : ''
  if (!league || league.length > 64 || /[\u0000-\u001f\u007f]/.test(league)) {
    return response.status(400).json({
      error: 'Provide a league name between 1 and 64 characters.',
    })
  }
  if (!category || category.length > 64 || !/^[a-z0-9-]+$/.test(category)) {
    return response.status(400).json({
      error: 'Provide a valid market category.',
    })
  }

  try {
    const result = await getMarketCategory(league, category, {
      refresh: request.query.refresh === '1' || request.query.refresh === 'true',
    })
    if (!result) {
      return response.status(404).json({
        error: `Unknown market category "${category}".`,
        code: 'UNKNOWN_MARKET_CATEGORY',
      })
    }
    response.json(result)
  } catch (error) {
    console.error(`Market category "${category}" failed for "${league}":`, error)
    response.status(502).json({
      error: `Could not load ${category} market data from poe.ninja.`,
      details: error instanceof Error ? error.message : 'Unknown upstream error.',
    })
  }
})

app.get('/api/market/summary', async (request, response) => {
  const league = typeof request.query.league === 'string' ? request.query.league.trim() : ''
  if (!league || league.length > 64 || /[\u0000-\u001f\u007f]/.test(league)) {
    return response.status(400).json({
      error: 'Provide a league name between 1 and 64 characters.',
    })
  }

  try {
    response.json(await getMarketSummary(league, {
      refresh: request.query.refresh === '1' || request.query.refresh === 'true',
    }))
  } catch (error) {
    console.error(`Market summary failed for "${league}":`, error)
    response.status(502).json({
      error: 'Could not load market data from poe.ninja.',
      details: error instanceof Error ? error.message : 'Unknown upstream error.',
    })
  }
})

app.use('/api', (_request, response) => {
  response.status(404).json({
    error: 'API route not found.',
    code: 'API_NOT_FOUND',
  })
})

app.listen(port, '127.0.0.1')
