function parseNumber(value) {
  const match = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function parseChaosValue(value, divineRate) {
  const raw = String(value || '').trim().replace(/,/g, '')
  const number = parseNumber(raw)
  return /d(?:ivine)?\s*$/i.test(raw) ? number * divineRate : number
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
function waitForRender(ms = 40) {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      channel.port2.close()
      setTimeout(resolve, ms)
    }
    channel.port2.postMessage('render-tick')
  })
}

function findSyncButton() {
  return [...document.querySelectorAll('button')].find((button) => /sync|refresh/i.test(`${button.textContent} ${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`))
}

async function waitForStashReady(timeoutMs = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const bodyText = document.body?.innerText || ''
    if (/login|sign in/i.test(bodyText) && !document.querySelector('table')) return false
    const rows = [...document.querySelectorAll('table tbody tr')].filter((row) => {
      const text = row.innerText.trim()
      return text && !/skeleton|loading/i.test(text) && text.split(/\s+/).length >= 2
    })
    if (rows.length > 0 || /stash is empty|no items|empty stash/i.test(bodyText)) return true
    await wait(500)
  }
  return false
}

function parseCsvLine(line) {
  const fields = []; let field = ''; let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"' && line[i + 1] === '"') { field += '"'; i += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) { fields.push(field.trim()); field = '' }
    else field += char
  }
  fields.push(field.trim())
  return fields
}

function parseCsv(csv) {
  const lines = String(csv || '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return { items: [], tabs: [] }
  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const index = (...names) => headers.findIndex((header) => names.includes(header))
  const nameIndex = index('name', 'item', 'itemname')
  const tabIndex = index('tab', 'stash', 'stashname')
  const quantityIndex = index('quantity', 'qty', 'stacksize', 'count')
  const priceIndex = index('pricechaos', 'price', 'chaos', 'unitprice')
  const totalIndex = index('totalchaos', 'total', 'value')
  const categoryIndex = index('category', 'type')
  const iconIndex = index('icon', 'image', 'iconurl')
  const items = lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    const quantity = parseNumber(values[quantityIndex]) || 1
    return { name: values[nameIndex] || values[0], tab: values[tabIndex] || 'Unknown', quantity, priceText: values[priceIndex], icon: iconIndex >= 0 ? values[iconIndex] : '', category: values[categoryIndex] || 'stash' }
  }).filter((item) => item.name)
  const divineRow = items.find((item) => /divine orb/i.test(item.name))
  const divineRate = divineRow ? parseChaosValue(divineRow.priceText, 225) : 225
  const normalizedItems = items.map((item) => {
    const priceChaos = parseChaosValue(item.priceText, divineRate)
    return { name: item.name, tab: item.tab, quantity: item.quantity, priceChaos, totalChaos: Math.round(item.quantity * priceChaos * 100) / 100, icon: item.icon || '', category: item.category }
  })
  return { items: normalizedItems, tabs: [...new Set(normalizedItems.map((item) => item.tab))].map((name, index) => ({ id: `wealthy-${index}`, index, label: name, name, kind: 'Wealthy Exile', color: '#8b7355' })) }
}

function findScrollContainer(table) {
  let element = table
  while (element && element !== document.body) {
    if (element.scrollHeight > element.clientHeight + 50) return element
    element = element.parentElement
  }
  return document.scrollingElement || document.documentElement
}

async function readDomData() {
  const table = document.querySelector('table')
  const headers = [...(table?.querySelectorAll('thead th') || [])].map((header) => header.innerText.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
  const headerIndex = (...names) => headers.findIndex((header) => names.includes(header))
  const nameIndex = headerIndex('name', 'item', 'itemname') >= 0 ? headerIndex('name', 'item', 'itemname') : 1
  const tabIndex = headerIndex('tab', 'stash', 'stashname') >= 0 ? headerIndex('tab', 'stash', 'stashname') : 2
  const quantityIndex = headerIndex('quantity', 'qty', 'stacksize', 'count') >= 0 ? headerIndex('quantity', 'qty', 'stacksize', 'count') : 3
  const priceIndex = headerIndex('price', 'pricechaos', 'chaos', 'unitprice') >= 0 ? headerIndex('price', 'pricechaos', 'chaos', 'unitprice') : 4
  const totalIndex = headerIndex('total', 'totalchaos', 'value') >= 0 ? headerIndex('total', 'totalchaos', 'value') : 5
  const rowSnapshots = new Map()
  const scanRows = () => [...(table?.querySelectorAll('tbody tr') || [])].forEach((row) => {
    const cells = [...row.querySelectorAll('td')].map((cell) => cell.innerText.trim())
    if (cells.length <= nameIndex) return
    const rawNameText = cells[nameIndex] || ''
    const rawTabText = cells[tabIndex] || ''
    const name = rawNameText.trim()
    const tab = rawTabText.trim() || 'Unknown'
    const image = row.querySelector('img')
    let icon = image?.getAttribute('src') || ''
    try { if (icon) icon = new URL(icon, location.origin).href } catch { icon = '' }
    if (name) rowSnapshots.set(`${name}__${tab}`, {
      name,
      tab,
      quantity: parseNumber(cells[quantityIndex]) || 1,
      priceText: cells[priceIndex],
      totalText: cells[totalIndex],
      icon,
      category: 'stash',
    })
  })

  const container = findScrollContainer(table)
  const emitScroll = () => container.dispatchEvent(new Event('scroll', { bubbles: true }))
  const stepSize = () => Math.max(180, Math.floor(container.clientHeight * 0.4))
  container.scrollTop = 0
  emitScroll()
  await waitForRender(60)
  let stableAtBottom = 0
  let steps = 0
  while (steps < 1000) {
    const sizeBeforeScan = rowSnapshots.size
    scanRows()
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 2
    if (atBottom) {
      stableAtBottom = rowSnapshots.size === sizeBeforeScan ? stableAtBottom + 1 : 0
      if (stableAtBottom >= 5) break
    } else {
      stableAtBottom = 0
      container.scrollTop += stepSize()
      emitScroll()
    }
    await waitForRender(atBottom ? 100 : 60)
    steps += 1
  }
  container.scrollTop = 0
  emitScroll()
  const items = [...rowSnapshots.values()]
  const divineRow = items.find((item) => /divine orb/i.test(item.name))
  const divineRate = divineRow ? parseChaosValue(divineRow.priceText, 225) : 225
  const normalizedItems = items.map((item) => {
    const priceChaos = parseChaosValue(item.priceText, divineRate)
    return { name: item.name, tab: item.tab, quantity: item.quantity, priceChaos, totalChaos: Math.round(item.quantity * priceChaos * 100) / 100, icon: item.icon || '', category: item.category }
  })
  const sidebarTabs = new Map([...document.querySelectorAll('aside button, nav button, [role="tab"]')].map((element) => [element.innerText.trim(), getComputedStyle(element).color]))
  const tabs = [...new Set(normalizedItems.map((item) => item.tab))].map((name, index) => ({ id: `wealthy-${index}`, index, label: name, name, kind: 'Wealthy Exile', color: sidebarTabs.get(name) || '#8b7355' }))
  return { items: normalizedItems, tabs }
}

async function readStash() {
  if (!(await waitForStashReady())) return { error: 'Chưa đăng nhập Wealthy Exile hoặc không tải được bảng Stash' }
  const syncButton = findSyncButton()
  if (syncButton && !syncButton.disabled) { syncButton.click(); await waitForRender(300) }
  const csvPromise = new Promise((resolve) => {
    let settled = false
    const finish = (csv) => { if (settled) return; settled = true; window.removeEventListener('message', onMessage); resolve(csv) }
    const onMessage = (event) => { if (event.source === window && event.data?.type === 'WE_CSV_CAPTURED') finish(event.data.csvText) }
    window.addEventListener('message', onMessage)
    chrome.runtime.sendMessage({ action: 'CAPTURE_WEALTHY_EXILE_CSV' }, (response) => {
      if (response?.success) finish(response.csv)
      else finish(null)
    })
  })
  const captured = await Promise.race([csvPromise, wait(1500).then(() => null)])
  const parsed = captured ? parseCsv(captured) : await readDomData()
  const bodyText = document.body?.innerText || ''
  if (!parsed.items.length && !/stash is empty|no items|empty stash/i.test(bodyText)) return { error: 'Chưa đăng nhập Wealthy Exile hoặc không tải được bảng Stash' }
  return { ...parsed, source: 'wealthy-exile' }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action !== 'READ_WEALTHY_EXILE_STASH') return undefined
  readStash().then((data) => sendResponse(data.error ? { success: false, error: data.error } : { success: true, data })).catch((error) => sendResponse({ success: false, error: error.message }))
  return true
})
