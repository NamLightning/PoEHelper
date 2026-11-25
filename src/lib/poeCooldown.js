const STORAGE_KEY = 'poestash.ggg.retryAt'
const EVENT = 'poestash-ggg-cooldown'
let retryAt = 0

export function currentPoeDeadline() {
  try { retryAt = Math.max(retryAt, Number(sessionStorage.getItem(STORAGE_KEY)) || 0) } catch { /* Storage is optional. */ }
  return retryAt
}

export function recordPoeCooldown(response, payload) {
  if (response.status !== 429) return
  const seconds = Number(response.headers.get('Retry-After') || payload?.retryAfter) || 60
  const deadline = Number(payload?.retryAt) || Date.now() + Math.max(1, seconds) * 1000
  retryAt = Math.max(currentPoeDeadline(), deadline)
  try { sessionStorage.setItem(STORAGE_KEY, String(retryAt)) } catch { /* Keep the in-memory deadline. */ }
  window.dispatchEvent(new Event(EVENT))
}

export function subscribePoeCooldown(listener) {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
