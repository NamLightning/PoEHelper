const LOCAL_API = 'http://localhost:5173/api/stash-sync'
let syncInProgress = false

const API_CONFIG_KEY = 'weApiConfig'
const API_HEADER_NAMES = new Set(['authorization', 'cookie', 'accept', 'content-type'])
const pendingApiRequests = new Map()
const validationInFlight = new Set()

const WEALTHY_HEADER_RULE_ID = 1001
function installWealthyHeaderRules() {
  return chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [WEALTHY_HEADER_RULE_ID],
    addRules: [{
      id: WEALTHY_HEADER_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Origin', operation: 'set', value: 'https://wealthyexile.com' },
          { header: 'Referer', operation: 'set', value: 'https://wealthyexile.com/stash' },
        ],
      },
      condition: {
        urlFilter: '||wealthyexile.com/',
        resourceTypes: ['xmlhttprequest'],
      },
    }],
  }).catch((error) => console.warn('Could not install Wealthy Exile header rules:', error))
}

void installWealthyHeaderRules()
chrome.runtime.onInstalled.addListener(() => { void installWealthyHeaderRules() })
chrome.runtime.onStartup.addListener(() => { void installWealthyHeaderRules() })

function looksLikeWealthyApi(url, type) {
  if (!/^https:\/\/([\w-]+\.)?wealthyexile\.com\//i.test(url)) return false
  if (type !== 'xmlhttprequest') return false
  return !/\.(?:js|css|png|jpe?g|gif|svg|webp|ico)(?:[?#]|$)/i.test(url)
    && !/(?:analytics|auth|session)/i.test(url)
    && (/\/api\//i.test(url) || /(?:stash|items?|inventory|tabs)/i.test(new URL(url).pathname))
}

chrome.webRequest.onBeforeSendHeaders.addListener((details) => {
  if (!looksLikeWealthyApi(details.url, details.type) || validationInFlight.has(details.url)) return
  const headers = Object.fromEntries((details.requestHeaders || [])
    .filter((header) => {
      const name = header.name.toLowerCase()
      return (API_HEADER_NAMES.has(name) || name.startsWith('x-')) && header.value
    })
    .map((header) => [header.name, header.value]))
  pendingApiRequests.set(details.requestId, { url: details.url, headers })
}, { urls: ['https://wealthyexile.com/*', 'https://*.wealthyexile.com/*'] }, ['requestHeaders', 'extraHeaders'])

function responseIsJson(response) {
  return response.headers.get('content-type')?.toLowerCase().includes('application/json')
}

function hasStashData(payload) {
  const root = payload?.data && typeof payload.data === 'object' ? payload.data : payload
  return Array.isArray(root?.items) || Array.isArray(root?.stash) || Array.isArray(root?.tabs)
}

chrome.webRequest.onCompleted.addListener((details) => {
  const request = pendingApiRequests.get(details.requestId)
  pendingApiRequests.delete(details.requestId)
  if (details.type !== 'xmlhttprequest' || details.statusCode !== 200 || !request || !details.responseHeaders?.some((header) => (
    header.name.toLowerCase() === 'content-type' && String(header.value || '').toLowerCase().includes('application/json')
  ))) return
  validationInFlight.add(request.url)
  fetch(request.url, { headers: request.headers, credentials: 'include' })
    .then(async (response) => {
      if (!responseIsJson(response)) return null
      const payload = JSON.parse(await response.text())
      if (!response.ok || !hasStashData(payload)) return null
      return { url: request.url, headers: request.headers, capturedAt: Date.now() }
    })
    .then((config) => config && chrome.storage.local.set({ [API_CONFIG_KEY]: config }))
    .catch(() => {})
    .finally(() => validationInFlight.delete(request.url))
}, { urls: ['https://wealthyexile.com/*', 'https://*.wealthyexile.com/*'] }, ['responseHeaders', 'extraHeaders'])

chrome.webRequest.onErrorOccurred.addListener((details) => {
  pendingApiRequests.delete(details.requestId)
}, { urls: ['https://wealthyexile.com/*', 'https://*.wealthyexile.com/*'] })

async function getApiConfig() {
  const result = await chrome.storage.local.get(API_CONFIG_KEY)
  const config = result[API_CONFIG_KEY]
  return config?.url ? config : null
}

function normalizeWealthyPayload(payload) {
  const root = payload?.data && typeof payload.data === 'object' ? payload.data : payload
  const rawItems = Array.isArray(root?.items) ? root.items : Array.isArray(root?.stash) ? root.stash : []
  const rawTabs = Array.isArray(root?.tabs) ? root.tabs : []
  const items = rawItems.map((item) => {
    const name = item.name || item.baseType || item.itemName || 'Unknown item'
    const tab = item.tab || item.tabName || item.stashTab || item.tab_name || 'Unknown'
    const quantity = Number(item.quantity ?? item.stackSize ?? item.stacksize ?? 1) || 1
    const priceChaos = Number(item.priceChaos ?? item.price ?? item.chaosValue ?? 0) || 0
    const totalChaos = Number(item.totalChaos ?? item.total ?? quantity * priceChaos) || quantity * priceChaos
    let icon = item.icon || item.iconUrl || item.image || ''
    try { if (icon) icon = new URL(icon, 'https://wealthyexile.com/').href } catch { icon = '' }
    return {
      ...item,
      name,
      tab,
      quantity,
      priceChaos,
      totalChaos,
      icon,
      category: item.category || item.type || 'stash',
    }
  })
  const tabs = (rawTabs.length ? rawTabs : [...new Set(items.map((item) => item.tab))].map((name) => ({ name })))
    .map((tab, index) => ({
      ...tab,
      id: String(tab.id || tab.name || tab.label || index),
      index,
      name: tab.name || tab.label || `Tab ${index + 1}`,
      label: tab.label || tab.name || `Tab ${index + 1}`,
      color: tab.color || tab.colour || '#8b7355',
      kind: tab.kind || tab.type || 'Wealthy Exile',
    }))
  return { items, tabs, source: 'wealthy-exile-api' }
}

async function syncFromApi(config) {
  const response = await fetch(config.url, {
    headers: config.headers || {},
    credentials: 'include',
  })
  const rawText = await response.text()
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await chrome.storage.local.remove(API_CONFIG_KEY)
    throw new Error('Saved Wealthy Exile endpoint returned HTML or a non-JSON response.')
  }
  let payload
  try { payload = JSON.parse(rawText) } catch {
    await chrome.storage.local.remove(API_CONFIG_KEY)
    throw new Error(`Wealthy Exile API returned invalid JSON (HTTP ${response.status}).`)
  }
  if (!response.ok || payload?.error) {
    await chrome.storage.local.remove(API_CONFIG_KEY)
    throw new Error(payload?.error?.message || `Wealthy Exile API returned HTTP ${response.status}.`)
  }
  const normalized = normalizeWealthyPayload(payload)
  if (!normalized.items.length && !normalized.tabs.length) {
    await chrome.storage.local.remove(API_CONFIG_KEY)
    throw new Error('Saved Wealthy Exile endpoint returned no stash data.')
  }
  return postStashData(normalized)
}

chrome.downloads.onCreated.addListener(async (downloadItem) => {
  if (!syncInProgress) return
  const downloadUrl = downloadItem.finalUrl || downloadItem.url || ''
  if (!/wealthyexile\.com/i.test(downloadUrl) && !/\.csv(?:[?#]|$)/i.test(downloadUrl)) return
  try {
    const response = await fetch(downloadUrl)
    const csvText = await response.text()
    if (globalThis.downloadCsvResolver) globalThis.downloadCsvResolver(csvText)
  } catch (error) {
    console.warn('Could not read Wealthy Exile CSV download:', error)
  } finally {
    chrome.downloads.cancel(downloadItem.id).catch(() => {})
    chrome.downloads.erase({ id: downloadItem.id }).catch(() => {})
  }
})

async function postStashData(payload) {
  const response = await fetch(LOCAL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error?.message || `Local sync API returned HTTP ${response.status}.`)
  console.log('[WE Sync] Gửi về localhost thành công')
  return result
}

function waitForTab(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('Timed out loading Wealthy Exile.'))
    }, 30000)
    function listener(updatedTabId, changeInfo, tab) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout)
        chrome.tabs.onUpdated.removeListener(listener)
        resolve(tab)
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function createBackgroundTab() {
  const tab = await chrome.tabs.create({ url: 'https://wealthyexile.com/stash', active: false })
  if (tab.id != null) await chrome.tabs.update(tab.id, { autoDiscardable: false })
  return tab
}

async function startTabSync() {
  syncInProgress = true
  console.log('[WE Sync] Đang mở/tìm tab nền...')
  const openTabs = await chrome.tabs.query({ url: ['*://wealthyexile.com/stash*'] })
  const existingTab = openTabs.find((candidate) => candidate.status === 'complete' && candidate.id != null)
  const tab = existingTab || await createBackgroundTab()
  const ownsTab = !existingTab
  try {
    if (ownsTab) {
      await waitForTab(tab.id)
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    }
    let response
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'READ_WEALTHY_EXILE_STASH' })
    } catch (error) {
      if (!existingTab) throw error
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
      response = await chrome.tabs.sendMessage(tab.id, { action: 'READ_WEALTHY_EXILE_STASH' })
    }
    if (!response?.success) throw new Error(response?.error || 'Could not read Wealthy Exile stash data.')
    console.log(`[WE Sync] Đã trích xuất ${response.data?.items?.length || 0} items`)
    return await postStashData(response.data)
  } finally {
    if (ownsTab && tab.id != null) await chrome.tabs.remove(tab.id).catch(() => {})
    syncInProgress = false
  }
}

async function primeApiConfig() {
  const tab = await createBackgroundTab()
  try {
    await waitForTab(tab.id)
    const started = Date.now()
    while (Date.now() - started < 8000) {
      if (await getApiConfig()) return true
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return Boolean(await getApiConfig())
  } finally {
    if (tab.id != null) await chrome.tabs.remove(tab.id).catch(() => {})
  }
}

async function startSync() {
  syncInProgress = true
  try {
    let config = await getApiConfig()
    if (!config) {
      await primeApiConfig().catch(() => false)
      config = await getApiConfig()
    }
    if (config) {
      console.log('[WE Sync] Dùng endpoint API đã lưu, không mở tab')
      try {
        const result = await syncFromApi(config)
        console.log('[WE Sync] API đã trích xuất dữ liệu thành công')
        return result
      } catch (error) {
        await chrome.storage.local.remove(API_CONFIG_KEY).catch(() => {})
        return await startTabSync()
      }
    }
    return await startTabSync()
  } finally {
    syncInProgress = false
  }
}

async function captureExportCsv(tabId) {
  const downloadCsv = new Promise((resolve) => { globalThis.downloadCsvResolver = resolve })
  const scriptCsv = chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: async () => {
    const originalCreateObjectURL = URL.createObjectURL.bind(URL)
    const originalClick = HTMLAnchorElement.prototype.click
    const blobs = new Map()
    let settled = false
    let timeoutId
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      URL.createObjectURL = originalCreateObjectURL
      HTMLAnchorElement.prototype.click = originalClick
      return value
    }
    return await new Promise((resolve) => {
      URL.createObjectURL = (blob) => { const url = originalCreateObjectURL(blob); blobs.set(url, blob); return url }
      HTMLAnchorElement.prototype.click = function interceptedClick() {
        const blob = blobs.get(this.href)
        if (blob) {
          blob.text().then((csv) => {
            window.postMessage({ type: 'WE_CSV_CAPTURED', csvText: csv }, '*')
            resolve(finish({ csv }))
          }).catch(() => resolve(finish(null)))
          return
        }
        return originalClick.call(this)
      }
      const dispatchFullClick = (element) => {
        element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        element.click()
      }
      const sellButton = [...document.querySelectorAll('button')].find((button) => /sell/i.test(button.textContent || ''))
      const sellContainer = sellButton?.parentElement
      const menuButton = sellButton?.nextElementSibling?.matches('button')
        ? sellButton.nextElementSibling
        : [...(sellContainer?.querySelectorAll('button') || [])].find((button) => button !== sellButton)
      if (menuButton) dispatchFullClick(menuButton)
      setTimeout(() => {
        const exportButton = [...document.querySelectorAll('button, [role="menuitem"], a')].find((element) => /export\s+csv/i.test(element.textContent || ''))
        if (exportButton) dispatchFullClick(exportButton)
      }, 400)
      timeoutId = setTimeout(() => resolve(finish(null)), 5000)
    })
  } }).then((results) => results?.[0]?.result?.csv || null)
  const csv = await Promise.race([scriptCsv, downloadCsv])
  globalThis.downloadCsvResolver = null
  return csv || null
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.action !== 'START_WEALTHY_EXILE_SYNC') return undefined
  startSync().then(() => sendResponse({ success: true })).catch((error) => sendResponse({ success: false, error: error.message }))
  return true
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[WE Sync] Nhận lệnh:', message)
  const isSyncRequest = message?.action === 'CAPTURE_WEALTHY_EXILE_CSV'
    || message?.type === 'SYNC_STASH'
    || message?.type === 'WE_SYNC_REQUEST'
  if (isSyncRequest) {
    if (message?.action === 'CAPTURE_WEALTHY_EXILE_CSV' && sender.tab?.id != null) {
      console.log('[WE Sync] Đang trích xuất CSV từ tab Wealthy Exile...')
      captureExportCsv(sender.tab.id).then((csv) => sendResponse({ success: Boolean(csv), csv })).catch((error) => sendResponse({ success: false, error: error.message }))
      return true
    }
    console.log('[WE Sync] Bắt đầu Sync từ bridge:', sender.tab?.url || sender.origin || 'unknown sender')
    startSync()
      .then((data) => {
        console.log('[WE Sync] Sync hoàn tất')
        sendResponse({ success: true, data })
      })
      .catch((error) => {
        console.error('[WE Sync] Sync lỗi:', error)
        sendResponse({ success: false, error: error.message })
      })
    return true
  }
  if (message?.action !== 'WEALTHY_EXILE_STASH_DATA') return undefined
  postStashData(message.data).then((data) => sendResponse({ success: true, data })).catch((error) => sendResponse({ success: false, error: error.message }))
  return true
})
