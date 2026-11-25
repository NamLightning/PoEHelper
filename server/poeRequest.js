export const POE_USER_AGENT = 'OAuth poestash-viewer/1.0 (contact: dev@poestash.local)'

let rateLimitUntil = 0
let accountState = ''

export class PoeRateLimitError extends Error {
  constructor(retryAt, state = '') {
    const retryAfter = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))
    super('GGG API \u0111ang gi\u1edbi h\u1ea1n t\u1ed1c \u0111\u1ed9')
    this.status = 429
    this.code = 'POE_RATE_LIMITED'
    this.retryAfter = retryAfter
    this.retryAt = retryAt
    this.accountState = state
  }
}

export function rateLimitDeadline(value, now = Date.now()) {
  if (value && /^\d+(?:\.\d+)?$/.test(value.trim())) return now + Math.max(1, Math.ceil(Number(value))) * 1000
  const date = value ? Date.parse(value) : NaN
  return Number.isFinite(date) && date > now ? date : now + 60_000
}

// A shared cooldown also protects other GGG endpoints after an account/IP limit.
// Never retry 429 automatically: retries during a penalty can extend the ban.
export async function poeFetch(url, options = {}, transport = globalThis.fetch) {
  if (Date.now() < rateLimitUntil) throw new PoeRateLimitError(rateLimitUntil, accountState)
  const headers = new Headers(options.headers)
  headers.set('User-Agent', POE_USER_AGENT)
  const requestHeaders = Object.fromEntries([...headers].map(([key, value]) => [{ 'user-agent': 'User-Agent', cookie: 'Cookie', accept: 'Accept' }[key] || key, value]))
  const response = await transport(url, { ...options, headers: requestHeaders })
  if (response.status === 429) {
    rateLimitUntil = Math.max(rateLimitUntil, rateLimitDeadline(response.headers.get('Retry-After')))
    accountState = response.headers.get('X-Rate-Limit-Account-State') || ''
    console.warn('[GGG Rate Limit]', { endpoint: new URL(url).pathname, retryAt: rateLimitUntil, accountState })
    try { await response.body?.cancel?.() } catch { /* Upstream body may already be closed. */ }
    throw new PoeRateLimitError(rateLimitUntil, accountState)
  }
  return response
}

export function logPoeForbidden(url, status, payload) {
  const code = payload?.error?.code
  if (Number(code) !== 6 && status !== 403) return
  const target = new URL(url)
  const query = Object.fromEntries([...target.searchParams].map(([key, value]) => [key, /cookie|poesessid|token|authorization|password/i.test(key) ? '[redacted]' : value]))
  console.warn('[GGG Forbidden]', { endpoint: `${target.origin}${target.pathname}`, query, status, code: code ?? 'unknown' })
}

export function poeHeaders(sessionId = '') {
  const cookie = typeof sessionId === 'string' ? sessionId.trim().replace(/^POESESSID=/i, '').trim() : ''
  return {
    Accept: 'application/json',
    'User-Agent': POE_USER_AGENT,
    ...(cookie ? { Cookie: `POESESSID=${cookie}` } : {}),
  }
}

export function configuredSessionId(config, environment = {}) {
  // An explicit local empty value disables environment/legacy cookies for public mode.
  const value = Object.hasOwn(config, 'POESESSID') ? config.POESESSID
    : environment.POESESSID || config.poesessid || config.poeSessId || environment.VITE_POESESSID || ''
  return typeof value === 'string' ? value.trim().replace(/^POESESSID=/i, '').trim() : ''
}
