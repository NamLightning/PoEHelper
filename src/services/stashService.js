const CACHE_KEY = 'poe.stash.cache.v1'

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

async function get(path) {
  const response = await fetch(`/poe-stash${path}`)
  const result = await response.json().catch(() => ({}))
  if (result?.error) {
    const message = typeof result.error === 'string' ? result.error : result.error.message
    const error = new Error(message || `Stash API returned an error (code ${result.error.code ?? 'unknown'}).`)
    error.status = response.status
    error.response = result
    throw error
  }
  if (!response.ok) {
    const error = new Error(result?.message || `Stash API returned HTTP ${response.status}.`)
    error.status = response.status
    error.response = result
    throw error
  }
  return result
}

export async function fetchStashTabs(accountName, league) {
  const normalizedAccountName = String(accountName || '').split('#')[0].trim()
  if (!normalizedAccountName) throw new Error('Enter your PoE account name before syncing.')
  const normalizedLeague = String(league || 'Standard').trim()
  const query = new URLSearchParams({ accountName: normalizedAccountName, realm: 'pc', league: normalizedLeague, tabs: '1' })
  const result = await get(`/get-stash-items?${query.toString()}`)
  const tabs = (result.tabs || []).map((tab, index) => ({ ...tab, index, id: String(index), label: tab.n || tab.name || `Tab ${index + 1}`, kind: tab.type || 'Normal', color: tab.colour || tab.color || '#8b7355' }))
  const cached = readStashCache()
  writeStashCache({ ...cached, accountName: normalizedAccountName, league: normalizedLeague, tabs })
  return tabs
}

export async function syncTabs(accountName, league, selectedTabIndices, onProgress = () => {}) {
  const normalizedAccountName = String(accountName || '').split('#')[0].trim()
  if (!normalizedAccountName) throw new Error('Enter your PoE account name before syncing.')
  const normalizedLeague = String(league || 'Standard').trim()
  const items = []
  for (let i = 0; i < selectedTabIndices.length; i += 1) {
    const tabIndex = selectedTabIndices[i]
    onProgress(`Syncing tab ${i + 1}/${selectedTabIndices.length}...`)
    const query = new URLSearchParams({ accountName: normalizedAccountName, realm: 'pc', league: normalizedLeague, tabs: '1' })
    if (tabIndex !== null && tabIndex !== undefined && Number.isInteger(Number(tabIndex))) {
      query.set('tabIndex', String(Number(tabIndex)))
    }
    const result = await get(`/get-stash-items?${query.toString()}`)
    ;(result.items || result.stash || []).forEach((item) => items.push({ ...item, tabIndex, tabName: result.tab?.n || result.tab?.name || `Tab ${Number(tabIndex) + 1}` }))
    if (i < selectedTabIndices.length - 1) await wait(700)
  }
  const cached = readStashCache()
  writeStashCache({ ...cached, accountName: normalizedAccountName, league: normalizedLeague, items, syncedAt: Date.now() })
  return items
}

export function readStashCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') } catch { return {} }
}

export function writeStashCache(value) { localStorage.setItem(CACHE_KEY, JSON.stringify(value)) }
