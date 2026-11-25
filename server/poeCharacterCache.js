import { createHash } from 'node:crypto'

export const CHARACTER_CACHE_TTL = 5 * 60_000

export const isCharacterRefresh = value => value === 'true' || value === '1'

export function characterCacheKey(url, sessionId) {
  const target = new URL(url)
  const endpoint = target.pathname.split('/').pop()
  const account = encodeURIComponent(target.searchParams.get('accountName') || '')
  const character = encodeURIComponent(target.searchParams.get('character') || '')
  // Keep the requested endpoint:account:character layout, with realm and a hashed
  // credential scope so cookie rotations/public mode never reuse private data.
  const credentialScope = createHash('sha256').update(sessionId || '').digest('hex')
  return `${endpoint}:${account}:${character}:${target.searchParams.get('realm') || 'pc'}:${credentialScope}`
}

export function createCharacterCache({ ttl = CHARACTER_CACHE_TTL, maxEntries = 32, maxBytes = 8 * 1024 * 1024, now = Date.now } = {}) {
  const entries = new Map(), pending = new Map()
  let bytes = 0, generation = 0
  function remove(key) {
    const entry = entries.get(key)
    if (entry) { bytes -= entry.size; entries.delete(key) }
  }
  return {
    clear() { generation++; entries.clear(); pending.clear(); bytes = 0 },
    async get(key, load, { force = false } = {}) {
      for (const [key, entry] of entries) if (entry.expiresAt <= now()) remove(key)
      if (pending.has(key)) return pending.get(key)
      const hit = entries.get(key)
      if (!force && hit) { entries.delete(key); entries.set(key, hit); return hit.value }
      // A failed explicit reload should not resurrect an older snapshot.
      if (force) remove(key)
      const epoch = generation
      const request = Promise.resolve().then(load).then(value => {
        const size = Buffer.byteLength(JSON.stringify(value))
        if (epoch === generation && size <= maxBytes) {
          remove(key)
          while (entries.size >= maxEntries || bytes + size > maxBytes) remove(entries.keys().next().value)
          entries.set(key, { value, size, expiresAt: now() + ttl }); bytes += size
        }
        return value
      }).finally(() => { if (pending.get(key) === request) pending.delete(key) })
      pending.set(key, request)
      return request
    },
  }
}
