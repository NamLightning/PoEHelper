import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Impit } from 'impit'

const STASH_SYNC_CACHE_PATH = path.resolve(process.cwd(), 'stash.local.json')
let stashSyncState = { items: [], tabs: [], lastSyncedAt: null }
if (existsSync(STASH_SYNC_CACHE_PATH)) {
  try { stashSyncState = { ...stashSyncState, ...JSON.parse(readFileSync(STASH_SYNC_CACHE_PATH, 'utf8')) } } catch { /* start empty */ }
}

function stashSyncCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

function stashSyncMiddleware() {
  return {
    name: 'stash-sync-api',
    configureServer(server) {
      server.middlewares.use('/api/stash-sync', async (req, res, next) => {
        stashSyncCors(res)
        if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
        if (req.method !== 'GET' && req.method !== 'POST') return next()
        try {
          if (req.method === 'POST') {
            const payload = await readRequestBody(req)
            stashSyncState = {
              items: Array.isArray(payload.items) ? payload.items : [],
              tabs: Array.isArray(payload.tabs) ? payload.tabs : [],
              lastSyncedAt: new Date().toISOString(),
            }
            writeFileSync(STASH_SYNC_CACHE_PATH, `${JSON.stringify(stashSyncState, null, 2)}\n`, 'utf8')
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(stashSyncState))
        } catch (error) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: { message: error.message || 'Invalid stash sync payload.' } }))
        }
      })
    },
  }
}

function readLocalConfig() {
  const configPath = path.resolve(process.cwd(), 'config.local.json')
  if (!existsSync(configPath)) return {}
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) || {}
  } catch { return {} }
}

function readPoeSessionId(env) {
  const config = readLocalConfig()
  const value = config.POESESSID || config.poesessid || env.VITE_POESESSID || ''
  return typeof value === 'string' ? value.trim().replace(/^POESESSID=/i, '').trim() : ''
}

function readPoeAccountName() {
  const config = readLocalConfig()
  return String(config.POE_ACCOUNT_NAME || config.accountName || '').split('#')[0].trim()
}

function logPoeSessionDebug(env) {
  const config = readLocalConfig()
  const sessionId = readPoeSessionId(env)
  const preview = sessionId.length >= 8 ? `${sessionId.slice(0, 4)}...${sessionId.slice(-4)}` : '(empty/too short)'
  console.log('[poe-stash] config keys:', Object.keys(config))
  console.log('[poe-stash] POESESSID length:', sessionId.length, `(${preview})`)
  if (sessionId.length !== 32) console.error('\x1b[31m[poe-stash] WARNING: POESESSID length is not 32. It may be empty, malformed, or expired.\x1b[0m')
}

function poeStashMiddleware(env) {
  const impit = new Impit({ browser: 'chrome' })
  return {
    name: 'poe-stash-impit-middleware',
    configureServer(server) {
      server.middlewares.use('/poe-stash', async (req, res, next) => {
        if (req.method !== 'GET') return next()
        try {
          logPoeSessionDebug(env)
          const sessionId = readPoeSessionId(env)
          if (!sessionId) {
            res.statusCode = 403
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: { message: 'POESESSID is not configured.' } }))
            return
          }
          const requestPath = req.url || '/get-stash-items'
          const suffix = requestPath.startsWith('/poe-stash') ? requestPath.slice('/poe-stash'.length) : requestPath
          const requestUrl = new URL(suffix, 'http://localhost')
          const tabIndex = requestUrl.searchParams.get('tabIndex')
          if (tabIndex === null || tabIndex === '' || tabIndex === 'null' || tabIndex === 'undefined' || !Number.isInteger(Number(tabIndex))) {
            requestUrl.searchParams.delete('tabIndex')
          } else {
            requestUrl.searchParams.set('tabIndex', String(Number(tabIndex)))
          }
          if (!requestUrl.searchParams.get('accountName')) {
            const accountName = readPoeAccountName()
            if (accountName) requestUrl.searchParams.set('accountName', accountName)
          }
          if (!requestUrl.searchParams.get('realm')) requestUrl.searchParams.set('realm', 'pc')
          const targetUrl = `https://www.pathofexile.com/character-window${requestUrl.pathname}${requestUrl.search}`
          console.log('[poe-stash] targetUrl:', targetUrl)
          console.log('[poe-stash] POESESSID length:', sessionId.length)
          console.log(`[poe-stash] Using POESESSID: ${sessionId.slice(0, 4)}...${sessionId.slice(-4)}`)
          const upstream = await impit.fetch(targetUrl, {
            headers: {
              Cookie: `POESESSID=${sessionId}`,
              Accept: 'application/json, text/plain, */*',
              Referer: 'https://www.pathofexile.com/my-account',
              'X-Requested-With': 'XMLHttpRequest',
            },
          })
          const body = await upstream.text()
          if (upstream.status !== 200 || body.includes('"error"') || body.includes('Forbidden')) {
            console.error('[poe-stash] upstream response:', body)
          }
          res.statusCode = upstream.status
          res.setHeader('Content-Type', 'application/json')
          try { res.end(JSON.stringify(JSON.parse(body))) } catch { res.end(JSON.stringify({ error: { message: body || `GGG returned HTTP ${upstream.status}.` } })) }
        } catch (error) {
          console.error('PoE stash middleware failed:', error)
          res.statusCode = error?.status || 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: { message: error?.message || 'Could not reach the PoE stash API.' } }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  console.log('POESESSID loaded:', Boolean(readPoeSessionId(env)))
  return {
  plugins: [react(), stashSyncMiddleware(), poeStashMiddleware(env)],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/poe-trade-stats': {
        target: 'https://www.pathofexile.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/poe-trade-stats/, ''),
        headers: {
          Accept: 'application/json',
          'User-Agent': 'PoEHelper/0.1.0 local market client',
        },
      },
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
    },
  }
})
