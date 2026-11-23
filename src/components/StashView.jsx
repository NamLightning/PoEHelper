import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Filter,
  Gem,
  Layers3,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { LineChart, Line, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchStashTabs, readStashCache, syncTabs, writeStashCache } from '../services/stashService'
import { priceStashItems } from '../utils/stashPricer'

const STASH_TABS = [
  { id: 'tab-1', label: '1', kind: 'premium' },
  { id: 'tab-2', label: '2', kind: 'premium' },
  { id: 'tab-3', label: '3', kind: 'premium' },
  { id: 'priced', label: '~price 1 chaos', kind: 'priced' },
  { id: 'tab-5', label: '5', kind: 'currency' },
]

const STASH_ITEMS = [
  { id: 'divine-orb', name: 'Divine Orb', tabId: 'tab-5', quantity: 5, price: 225 },
  { id: 'stacked-deck', name: 'Stacked Deck', tabId: 'tab-5', quantity: 24, price: 3.6 },
  { id: 'orb-of-alteration', name: 'Orb of Alteration', tabId: 'tab-5', quantity: 323, price: 0.23 },
  { id: 'orb-of-scouring', name: 'Orb of Scouring', tabId: 'tab-5', quantity: 54, price: 0.8 },
  { id: 'gemcutters-prism', name: "Gemcutter's Prism", tabId: 'tab-5', quantity: 10, price: 3.5 },
  { id: 'chaos-orb', name: 'Chaos Orb', tabId: 'tab-5', quantity: 34, price: 1 },
  { id: 'orb-of-augmentation', name: 'Orb of Augmentation', tabId: 'tab-5', quantity: 182, price: 0.16 },
  { id: 'nebulis', name: 'Nebulis', tabId: 'tab-1', quantity: 1, price: 26 },
  { id: 'chromatic-orb', name: 'Chromatic Orb', tabId: 'tab-5', quantity: 16, price: 1.5 },
  { id: 'map-tier-1', name: 'Map (Tier 1)', tabId: 'tab-1', quantity: 23, price: 1 },
  { id: 'rogues-marker', name: "Rogue's Marker", tabId: 'tab-5', quantity: 7554, price: 0.0029 },
  { id: 'arrogance-support', name: 'Arrogance Support - 1/20', tabId: 'tab-3', quantity: 1, price: 20 },
  { id: 'glassblowers-bauble', name: "Glassblower's Bauble", tabId: 'tab-5', quantity: 12, price: 1.6 },
  { id: 'orb-of-fusing', name: 'Orb of Fusing', tabId: 'tab-5', quantity: 106, price: 0.17 },
  { id: 'ancient-orb', name: 'Ancient Orb', tabId: 'tab-2', quantity: 8, price: 7.5 },
  { id: 'essence-of-loathing', name: 'Essence of Loathing', tabId: 'tab-2', quantity: 15, price: 2.2 },
  { id: 'vaal-orb', name: 'Vaal Orb', tabId: 'priced', quantity: 42, price: 0.7 },
]

const SNAPSHOTS = [
  { id: 'snapshot-now', label: 'Current stash', time: 'Just now', items: STASH_ITEMS },
  { id: 'snapshot-1', label: 'Before mapping', time: '3 minutes ago', items: STASH_ITEMS.slice(0, 14) },
  { id: 'snapshot-2', label: 'After trade session', time: 'Yesterday', items: STASH_ITEMS.slice(2, 15) },
]
const SNAPSHOT_KEY = 'poe.stash.snapshots'

const quantityFormat = new Intl.NumberFormat('en-US')
const chaosFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })

function getErrorMessage(error) {
  if (typeof error === 'string') return error
  return error?.error?.message || error?.message || (error ? JSON.stringify(error) : 'Unknown stash sync error.')
}

function StashTabIcon({ kind }) {
  if (kind === 'premium') return <Gem size={15} className="shrink-0 text-[#9cc8d8]" />
  if (kind === 'currency') return <CircleDollarSign size={15} className="shrink-0 text-[#dfbf71]" />
  return <Sparkles size={15} className="shrink-0 text-[#dfbf71]" />
}

function StashItemIcon({ item, icon }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [icon])
  if (icon && !failed) {
    return (
      <img
        src={icon}
        alt=""
        loading="lazy"
        className="h-7 w-7 shrink-0 object-contain"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-[#303235] text-xs font-semibold text-[#c8d0d5]">
      {item.name.slice(0, 1)}
    </span>
  )
}

function formatPrice(value) {
  return `${chaosFormat.format(value)}c`
}

function formatTotal(value, divineToChaos) {
  if (divineToChaos > 0 && value >= divineToChaos) {
    return `${chaosFormat.format(value / divineToChaos)}d`
  }
  return `${Math.round(value)}c`
}

function sortableValue(item, key, tabs) {
  if (key === 'total') return item.quantity * item.price
  if (key === 'tab') return tabs.find((tab) => tab.id === item.tabId)?.label || item.tab || ''
  return item[key]
}

function itemTabName(item, tabs = []) {
  const directName = String(item?.tab || '').trim()
  if (directName) return directName
  return String(tabs.find((tab) => tab.id === item?.tabId)?.label || tabs.find((tab) => tab.id === item?.tabId)?.name || 'Unknown').trim()
}

function iconNameForItem(item) {
  if (item.id === 'map-tier-1') return 'Lighthouse Map'
  if (item.id === 'arrogance-support') return 'Arrogance Support'
  return item.name
}

export default function StashView({ query = '', league = 'Standard', divineToChaos = 225, accountName = '' }) {
  const [mode, setMode] = useState('tabs')
  const [selectedTab, setSelectedTab] = useState('all')
  const [selectedSnapshot, setSelectedSnapshot] = useState(SNAPSHOTS[0].id)
  const [snapshots, setSnapshots] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null') || SNAPSHOTS } catch { return SNAPSHOTS }
  })
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [minimumPrice, setMinimumPrice] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [sort, setSort] = useState({ key: 'total', direction: 'desc' })
  const [syncedAt, setSyncedAt] = useState(() => Date.now() - 3 * 60 * 1000)
  const [now, setNow] = useState(() => Date.now())
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [iconMap, setIconMap] = useState({})
  const [stashTabs, setStashTabs] = useState(() => readStashCache().tabs || STASH_TABS)
  const [stashItems, setStashItems] = useState(() => readStashCache().pricedItems || STASH_ITEMS)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState('')
  const [syncedTabIndices, setSyncedTabIndices] = useState(() => {
    try { return JSON.parse(localStorage.getItem('poe.syncedTabIndices') || '[]') } catch { return [] }
  })
  const [tabEditorOpen, setTabEditorOpen] = useState(false)
  const [extensionId] = useState(() => localStorage.getItem('poehelper.extensionId') || '')
  const [sellOpen, setSellOpen] = useState(false)
  const [sellMultiplier, setSellMultiplier] = useState(95)

  useEffect(() => {
    const controller = new AbortController()
    const categories = ['currency', 'unique-weapons', 'skill-gems', 'maps']
    Promise.allSettled(categories.map(async (category) => {
      const response = await fetch(
        `/api/market/category?league=${encodeURIComponent(league || 'Standard')}&category=${category}`,
        { signal: controller.signal },
      )
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.details || result.error || `Market API returned HTTP ${response.status}.`)
      }
      if (!Array.isArray(result.items)) {
        throw new Error(`Market API returned invalid ${category} data.`)
      }
      return result.items
    })).then((results) => {
      if (controller.signal.aborted) return
      const entries = results.flatMap((result) => (
        result.status === 'fulfilled' ? result.value : []
      ))
      const nextIcons = Object.create(null)
      for (const item of STASH_ITEMS) {
        const soughtName = iconNameForItem(item).toLowerCase()
        const match = entries.find((entry) => entry.name?.toLowerCase() === soughtName)
          || entries.find((entry) => entry.name?.toLowerCase().startsWith(soughtName))
        if (typeof match?.icon === 'string' && match.icon) {
          nextIcons[item.id] = match.icon
        }
      }
      setIconMap(nextIcons)
      const errors = results
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason)
      if (errors.length) {
        console.warn('Some Stash item icons could not be loaded from poe.ninja:', errors)
      }
    })
    return () => controller.abort()
  }, [league])

  useEffect(() => {
    if (!accountName) return
    fetchStashTabs(accountName, league).then(setStashTabs).catch((error) => {
      console.error('Could not fetch PoE stash tabs:', error?.response || error)
      setNotice(getErrorMessage(error))
    })
  }, [accountName, league])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots)) }, [snapshots])

  const snapshot = snapshots.find((entry) => entry.id === selectedSnapshot) || snapshots[0] || SNAPSHOTS[0]
  const sourceItems = mode === 'snapshots' ? snapshot.items : stashItems
  const displayTabs = useMemo(() => {
    const grouped = new Map()
    stashItems.forEach((item) => {
      const name = itemTabName(item, stashTabs) || 'Unknown'
      const key = name.toLowerCase()
      const existing = grouped.get(key)
      const totalChaos = Number(item.totalChaos) || Number(item.quantity || 0) * Number(item.price || item.priceChaos || 0)
      if (existing) {
        existing.totalChaos += totalChaos
        existing.quantity += Number(item.quantity) || 0
      } else {
        const sourceTab = stashTabs.find((tab) => String(tab.label || tab.name || '').trim().toLowerCase() === key)
        grouped.set(key, {
          ...(sourceTab || {}),
          id: name,
          label: name,
          name,
          kind: sourceTab?.kind || 'Wealthy Exile',
          color: sourceTab?.color || '#8b7355',
          totalChaos,
          quantity: Number(item.quantity) || 0,
        })
      }
    })
    return [...grouped.values()]
  }, [stashItems, stashTabs])
  const tabById = useMemo(() => new Map(displayTabs.map((tab) => [tab.id, tab])), [displayTabs])
  const rows = useMemo(() => {
    const localNeedle = search.trim().toLowerCase()
    const globalNeedle = query.trim().toLowerCase()
    const minimum = Number(minimumPrice)
    const selectedTabKey = selectedTab.trim().toLowerCase()
    return sourceItems
      .filter((item) => mode === 'snapshots' || selectedTabKey === 'all' || itemTabName(item, stashTabs).toLowerCase() === selectedTabKey)
      .filter((item) => !globalNeedle || item.name.toLowerCase().includes(globalNeedle))
      .filter((item) => !localNeedle || item.name.toLowerCase().includes(localNeedle))
      .filter((item) => !Number.isFinite(minimum) || minimum <= 0 || item.price >= minimum)
      .sort((left, right) => {
        const direction = sort.direction === 'asc' ? 1 : -1
        const tabs = displayTabs
        const a = sortableValue(left, sort.key, tabs)
        const b = sortableValue(right, sort.key, tabs)
        return (typeof a === 'string' ? a.localeCompare(b) : a - b) * direction
      })
  }, [displayTabs, minimumPrice, mode, query, search, selectedTab, sort, sourceItems, stashTabs])
  const filteredTotalChaos = useMemo(() => rows.reduce((sum, item) => sum + (Number(item.totalChaos) || Number(item.quantity || 0) * Number(item.price || item.priceChaos || 0)), 0), [rows])

  const allVisibleSelected = rows.length > 0 && rows.every((item) => selectedIds.includes(item.id))
  const selectedCount = selectedIds.length
  const selectedRows = stashItems.filter((item) => selectedIds.includes(item.id))
  const sellText = selectedRows.map((item) => {
    const price = Math.max(0.01, (Number(item.price) || 0) * sellMultiplier / 100)
    return `${item.quantity}x ${item.name} for ${price.toFixed(2)} chaos each`
  }).join('\n')

  function addSnapshot(nextItems) {
    const totalChaos = nextItems.reduce((sum, item) => sum + (Number(item.totalChaos) || Number(item.quantity || 0) * Number(item.price || item.priceChaos || 0)), 0)
    const snapshotEntry = { id: `snapshot-${Date.now()}`, label: 'Sync snapshot', timestamp: Date.now(), time: new Date().toLocaleString(), totalChaos, totalDivine: totalChaos / (divineToChaos || 225), items: nextItems }
    setSnapshots((current) => [snapshotEntry, ...current].slice(0, 30))
    setSelectedSnapshot(snapshotEntry.id)
  }

  function toggleSort(key) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }))
  }

  function toggleItem(id) {
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    ))
  }

  function toggleVisible() {
    setSelectedIds((current) => (
      allVisibleSelected
        ? current.filter((id) => !rows.some((item) => item.id === id))
        : [...new Set([...current, ...rows.map((item) => item.id)])]
    ))
  }

  async function syncNow() {
    if (syncing) return
    if (!accountName) { setNotice('Set an account name before syncing stash.'); return }
    if (!syncedTabIndices.length) { setNotice('Click Edit synced tabs first.'); return }
    setSyncing(true)
    try {
      const bridgeReady = document.documentElement.dataset.weExtensionReady === 'true'
      if (bridgeReady || extensionId) {
        setSyncProgress('Syncing via Wealthy Exile...')
        const extensionResult = bridgeReady
          ? await new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => {
              window.removeEventListener('message', onResponse)
              reject(new Error('Extension bridge timed out. Reload the extension and localhost page.'))
            }, 30000)
            function onResponse(event) {
              if (event.source !== window || event.data?.type !== 'WE_SYNC_RESPONSE') return
              window.clearTimeout(timeout)
              window.removeEventListener('message', onResponse)
              const result = event.data.payload
              if (!result?.success) reject(new Error(result?.error || 'Wealthy Exile sync failed.'))
              else resolve(result)
            }
            window.addEventListener('message', onResponse)
            window.postMessage({ type: 'WE_SYNC_REQUEST' }, '*')
          })
          : await new Promise((resolve, reject) => {
            if (!globalThis.chrome?.runtime?.sendMessage) {
              reject(new Error('Chrome Extension API is unavailable. Check the Extension ID and reload the page.'))
              return
            }
            globalThis.chrome.runtime.sendMessage(extensionId, { action: 'START_WEALTHY_EXILE_SYNC' }, (result) => {
              const runtimeError = globalThis.chrome.runtime.lastError
              if (runtimeError) reject(new Error(runtimeError.message))
              else if (!result?.success) reject(new Error(result?.error || 'Wealthy Exile sync failed.'))
              else resolve(result)
            })
          })
        const response = await fetch('/api/stash-sync')
        const synced = await response.json()
        if (!response.ok || synced.error) throw new Error(synced.error?.message || 'Could not load extension stash data.')
        const imported = (synced.items || []).map((item, index) => ({
          ...item,
          id: item.id || `wealthy-exile-${index}`,
          name: item.name || 'Unknown item',
          tab: String(item.tab || '').trim() || 'Unknown',
          tabId: String(item.tab || '').trim() || 'Unknown',
          tabName: String(item.tab || '').trim() || 'Unknown',
          quantity: Number(item.quantity) || 1,
          price: Number(item.priceChaos) || 0,
          totalChaos: Number(item.totalChaos) || 0,
        }))
        const importedTabs = (synced.tabs || []).map((tab, index) => ({
          ...tab,
          id: tab.label || tab.name || tab.id || `wealthy-${index}`,
          index: Number.isInteger(tab.index) ? tab.index : index,
          label: tab.label || tab.name || `Tab ${index + 1}`,
          name: tab.name || tab.label || `Tab ${index + 1}`,
          kind: tab.kind || 'Wealthy Exile',
          color: tab.color || '#8b7355',
        }))
        if (importedTabs.length) setStashTabs(importedTabs)
        setSelectedTab('all')
        setStashItems(imported)
        writeStashCache({ ...readStashCache(), pricedItems: imported, tabs: importedTabs, syncedAt: Date.now() })
        addSnapshot(imported)
        setSyncedAt(Date.now())
        setNow(Date.now())
        setNotice(`Synced ${imported.length} items via Wealthy Exile.`)
        void extensionResult
        return
      }
      const rawItems = await syncTabs(accountName, league, syncedTabIndices, setSyncProgress)
      const categories = ['currency', 'fragments', 'divination-cards', 'skill-gems', 'imbued-gems', 'unique-weapons', 'unique-armours', 'cluster-jewels', 'maps', 'scarabs', 'essences', 'fossils']
      const marketResults = await Promise.all(categories.map((category) => fetch(`/api/market/category?league=${encodeURIComponent(league)}&category=${category}`).then((response) => response.ok ? response.json() : {}).catch(() => ({}))))
      const marketItems = marketResults.flatMap((market) => market.items || [])
      const priced = priceStashItems(rawItems, marketItems, divineToChaos)
      setStashItems(priced)
      addSnapshot(priced)
      const cache = readStashCache()
      localStorage.setItem('poe.stash.cache.v1', JSON.stringify({ ...cache, pricedItems: priced }))
      setSyncedAt(Date.now())
      setNow(Date.now())
      setNotice(`Synced ${priced.length} stash items.`)
    } catch (error) {
      console.error('Could not sync PoE stash:', error?.response || error)
      setNotice(getErrorMessage(error))
    }
    finally { setSyncing(false); setSyncProgress('') }
  }

  const syncedMinutes = Math.max(0, Math.floor((now - syncedAt) / 60000))
  const syncedLabel = syncedMinutes === 0 ? 'just now' : `${syncedMinutes} minute${syncedMinutes === 1 ? '' : 's'} ago`

  return (
    <section className="-mx-3 -mt-2 min-h-[calc(100vh-7rem)] overflow-hidden border border-[#373737] bg-[#222222] text-[#d8dadd]">
      <div className="grid min-h-[calc(100vh-7rem)] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-b border-[#393939] bg-[#202020] lg:border-b-0 lg:border-r">
          <div className="p-3">
            <div className="grid grid-cols-2 rounded bg-[#191919] p-1">
              <button
                type="button"
                onClick={() => setMode('tabs')}
                className={`h-8 text-sm font-semibold transition ${mode === 'tabs' ? 'bg-[#3a3a3a] text-white' : 'text-[#929292] hover:text-white'}`}
                aria-pressed={mode === 'tabs'}
              >
                Tabs
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('snapshots')
                  setSelectedTab('all')
                }}
                className={`h-8 text-sm font-semibold transition ${mode === 'snapshots' ? 'bg-[#3a3a3a] text-white' : 'text-[#929292] hover:text-white'}`}
                aria-pressed={mode === 'snapshots'}
              >
                Snapshots
              </button>
            </div>
          </div>

          {mode === 'tabs' ? (
            <>
              <nav aria-label="Stash tabs" className="mx-1 overflow-hidden rounded border border-[#bd713b]">
                <button
                  type="button"
                  onClick={() => setSelectedTab('all')}
                  className={`flex h-8 w-full items-center gap-2 px-2 text-left text-sm ${selectedTab === 'all' ? 'bg-[#584335] text-[#f4d0a6]' : 'bg-[#4b3b30] text-[#dcb98e] hover:bg-[#584335]'}`}
                >
                  <Layers3 size={15} />
                  <span>All Stashes</span>
                </button>
                {displayTabs.map((tab) => (
                  <button
                    type="button"
                    key={tab.id}
                    onClick={() => setSelectedTab(tab.id)}
                    aria-current={selectedTab === tab.id ? 'page' : undefined}
                    className={`flex h-8 w-full items-center gap-2 px-2 text-left transition ${
                      selectedTab === tab.id
                        ? 'bg-[#62503f] text-[#f5d2a4]'
                        : tab.kind === 'currency'
                          ? 'bg-[#4c5a19] text-[#e2d090] hover:bg-[#566520]'
                          : tab.kind === 'priced'
                            ? 'bg-[#554232] text-[#e2b56c] hover:bg-[#604b38]'
                            : 'bg-[#4b3b30] text-[#dcb98e] hover:bg-[#584335]'
                    }`}
                  >
                    <StashTabIcon kind={tab.kind} />
                    <span className="truncate">{tab.label || tab.name}</span>
                  </button>
                ))}
              </nav>
              <button
                type="button"
                onClick={() => setTabEditorOpen(true)}
                className="mt-4 flex items-center gap-2 px-2 text-sm font-medium text-[#50b7f4] hover:text-[#83d0ff]"
              >
                <Pencil size={15} />
                Edit synced tabs
              </button>
            </>
          ) : (<>
            <div aria-label="Saved stash snapshots" className="space-y-1 px-2">
              {snapshots.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  onClick={() => setSelectedSnapshot(entry.id)}
                  aria-current={selectedSnapshot === entry.id ? 'page' : undefined}
                  className={`w-full rounded px-2 py-2 text-left transition ${selectedSnapshot === entry.id ? 'bg-[#383838] text-white' : 'text-[#a9a9a9] hover:bg-[#2d2d2d] hover:text-white'}`}
                >
                  <span className="block truncate text-sm">{entry.label || 'Sync snapshot'}</span>
                  <span className="mt-1 flex items-center gap-1 text-[11px] text-[#858585]">
                    <Clock3 size={11} /> {entry.time || new Date(entry.timestamp).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
            {snapshots.length > 1 ? (
              <div className="mt-4 h-36 px-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={[...snapshots].reverse()}>
                    <CartesianGrid stroke="#383838" strokeDasharray="3 3" />
                    <XAxis dataKey="timestamp" hide />
                    <YAxis hide />
                    <Tooltip contentStyle={{ background: '#292929', border: '1px solid #555' }} formatter={(value) => [`${Number(value).toFixed(2)}d`, 'Value']} />
                    <Line type="monotone" dataKey="totalDivine" stroke="#d4b36a" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : null}</>
          )}
        </aside>

        <div className="min-w-0">
          <div className="flex min-h-[54px] flex-wrap items-center justify-between gap-3 border-b border-[#393939] px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative block">
                <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#858585]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search"
                  aria-label="Search stash items"
                  className="h-9 w-52 border border-[#414141] bg-[#292929] pl-8 pr-3 text-sm text-[#e1e1e1] outline-none placeholder:text-[#858585] focus:border-[#777]"
                />
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setFiltersOpen((open) => !open)}
                  aria-expanded={filtersOpen}
                  className={`inline-flex h-9 items-center gap-2 border px-3 text-sm transition ${filtersOpen ? 'border-[#666] bg-[#373737] text-white' : 'border-[#414141] bg-[#292929] text-[#c7c7c7] hover:bg-[#353535]'}`}
                >
                  <Filter size={14} /> Filters
                </button>
                {filtersOpen ? (
                  <div className="absolute left-0 top-10 z-20 w-56 border border-[#454545] bg-[#292929] p-3 shadow-xl">
                    <label className="block text-xs text-[#a0a0a0]">
                      Minimum unit price (chaos)
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={minimumPrice}
                        onChange={(event) => setMinimumPrice(event.target.value)}
                        className="mt-2 h-8 w-full border border-[#444] bg-[#202020] px-2 text-sm text-white outline-none focus:border-[#777]"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setMinimumPrice('')
                        setFiltersOpen(false)
                      }}
                      className="mt-3 text-xs text-[#69bdf0] hover:text-[#a3ddff]"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden text-sm text-[#939393] sm:inline">{syncing ? syncProgress : `Synced ${syncedLabel}`}</span>
              <button
                type="button"
                onClick={syncNow}
                disabled={syncing}
                aria-label="Refresh stash"
                title="Refresh stash"
                className="grid h-9 w-9 place-items-center border border-[#414141] bg-[#292929] text-[#c5c5c5] hover:bg-[#383838] hover:text-white"
              >
                <RefreshCw size={17} className={syncing ? 'animate-spin' : ''} />
              </button>
              <button
                type="button"
                disabled={!selectedCount}
                onClick={() => setSellOpen(true)}
                className="inline-flex h-9 items-center gap-2 border border-[#414141] bg-[#292929] px-3 text-sm font-medium text-[#d0d0d0] transition enabled:hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="text-[#aaa]">$</span> Sell
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-label="Stash actions"
                  aria-expanded={menuOpen}
                  className="grid h-9 w-9 place-items-center border border-[#414141] bg-[#292929] text-[#c5c5c5] hover:bg-[#383838] hover:text-white"
                >
                  <MoreHorizontal size={19} />
                </button>
                {menuOpen ? (
                  <div className="absolute right-0 top-10 z-20 w-40 border border-[#454545] bg-[#292929] py-1 shadow-xl">
                    <button type="button" onClick={() => { toggleVisible(); setMenuOpen(false) }} className="w-full px-3 py-2 text-left text-xs text-[#d5d5d5] hover:bg-[#3a3a3a]">
                      {allVisibleSelected ? 'Deselect visible' : 'Select visible'}
                    </button>
                    <button type="button" onClick={() => { setSelectedIds([]); setMenuOpen(false) }} className="w-full px-3 py-2 text-left text-xs text-[#d5d5d5] hover:bg-[#3a3a3a]">
                      Clear selection
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {notice ? (
            <p role="status" className="border-b border-[#393939] bg-[#292929] px-4 py-2 text-xs text-[#9dc8d9]">
              {notice}
            </p>
          ) : null}

          <div className="overflow-x-auto">
            <div className="min-w-[850px]">
              <div className="grid grid-cols-[42px_minmax(250px,1.8fr)_minmax(130px,.8fr)_minmax(110px,.65fr)_minmax(110px,.65fr)_minmax(110px,.65fr)] border-b border-[#3b3b3b] bg-[#252525]">
                <div className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleVisible}
                    aria-label="Select all visible stash items"
                    className="h-4 w-4 accent-[#55a9da]"
                  />
                </div>
                {[
                  ['name', 'Name'],
                  ['tab', 'Tab'],
                  ['quantity', 'Quantity'],
                  ['price', 'Price'],
                  ['total', 'Total'],
                ].map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => toggleSort(key)}
                    aria-sort={sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className="flex h-11 items-center justify-between gap-2 border-l border-[#383838] px-3 text-left text-sm font-semibold text-[#bcbcbc] hover:bg-[#2d2d2d] hover:text-white"
                  >
                    {label}
                    <ChevronDown size={13} className={`text-[#777] ${sort.key === key && sort.direction === 'asc' ? 'rotate-180' : ''}`} />
                  </button>
                ))}
              </div>

              {rows.map((item) => {
                const checked = selectedIds.includes(item.id)
                return (
                  <div
                    key={item.id}
                    className={`grid min-h-12 grid-cols-[42px_minmax(250px,1.8fr)_minmax(130px,.8fr)_minmax(110px,.65fr)_minmax(110px,.65fr)_minmax(110px,.65fr)] border-b border-[#3a3a3a] transition-colors hover:bg-[#2b2b2b] ${checked ? 'bg-[#2d3438]' : ''}`}
                    style={{ contentVisibility: 'auto', containIntrinsicSize: '44px' }}
                  >
                    <div className="flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleItem(item.id)}
                        aria-label={`Select ${item.name}`}
                        className="h-4 w-4 accent-[#55a9da]"
                      />
                    </div>
                    <div className="flex min-w-0 items-center gap-3 border-l border-[#383838] px-3">
                      <StashItemIcon item={item} icon={item.icon || iconMap[item.id]} />
                      <span className="truncate text-sm text-[#d5dce0]">{item.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setMode('tabs'); setSelectedTab(itemTabName(item, stashTabs)) }}
                      className="flex items-center gap-2 border-l border-[#383838] px-3 text-left text-sm text-[#d5dce0] hover:bg-[#333]"
                    >
                      <StashTabIcon kind={tabById.get(itemTabName(item, stashTabs))?.kind} />
                      {itemTabName(item, stashTabs) || '—'}
                    </button>
                    <span className="flex items-center border-l border-[#383838] px-3 font-mono text-sm tabular-nums text-[#d5dce0]">
                      {quantityFormat.format(item.quantity)}
                    </span>
                    <span className="flex items-center border-l border-[#383838] px-3 font-mono text-sm tabular-nums text-[#d5dce0]">
                      {formatPrice(item.price)}
                    </span>
                    <span className="flex items-center border-l border-[#383838] px-3 font-mono text-sm font-medium tabular-nums text-[#e0e0e0]">
                      {formatTotal(item.quantity * item.price, divineToChaos)}
                    </span>
                  </div>
                )
              })}

              {rows.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-[#888]">No stash items match these filters.</p>
              ) : null}
            </div>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#3b3b3b] px-4 py-3 text-xs text-[#858585]">
            <span>
              {rows.length} item{rows.length === 1 ? '' : 's'} · {selectedCount} selected · {chaosFormat.format(filteredTotalChaos)}c ({chaosFormat.format(filteredTotalChaos / (divineToChaos || 225))}d)
              {mode === 'snapshots' ? ` · ${snapshot.label}` : ''}
            </span>
            <span>Values are estimates in chaos orbs</span>
          </footer>
        </div>
      </div>
      {tabEditorOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-md border border-[#4a4a4a] bg-[#252525] p-5 shadow-2xl">
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Edit synced tabs</h2><button type="button" onClick={() => setTabEditorOpen(false)}>×</button></div>
            <div className="mt-4 max-h-64 space-y-1 overflow-auto">
              {stashTabs.map((tab) => <label key={tab.id} className="flex items-center gap-3 border-b border-[#393939] px-2 py-2 text-sm"><input type="checkbox" checked={syncedTabIndices.includes(tab.index)} onChange={() => setSyncedTabIndices((current) => current.includes(tab.index) ? current.filter((index) => index !== tab.index) : [...current, tab.index])} className="h-4 w-4 accent-[#55a9da]" /><span style={{ color: tab.color }}>{tab.label || tab.name}</span><span className="ml-auto text-xs text-[#888]">{tab.kind}</span></label>)}
            </div>
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setTabEditorOpen(false)} className="px-3 py-2 text-sm text-[#aaa]">Cancel</button><button type="button" onClick={() => { localStorage.setItem('poe.syncedTabIndices', JSON.stringify(syncedTabIndices)); setTabEditorOpen(false); setNotice(`${syncedTabIndices.length} tabs selected for sync.`) }} className="bg-[#4b83a3] px-3 py-2 text-sm text-white">Save tabs</button></div>
          </div>
        </div>
      ) : null}
      {sellOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-lg border border-[#4a4a4a] bg-[#252525] p-5 shadow-2xl">
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Bulk Sell</h2><button type="button" onClick={() => setSellOpen(false)}>×</button></div>
            <p className="mt-1 text-xs text-[#999]">{selectedCount} selected item{selectedCount === 1 ? '' : 's'}</p>
            <div className="mt-4 flex gap-2">{[100, 95, 90].map((value) => <button key={value} type="button" onClick={() => setSellMultiplier(value)} className={`px-3 py-2 text-sm ${sellMultiplier === value ? 'bg-[#4b83a3] text-white' : 'bg-[#333] text-[#bbb]'}`}>{value}% Market</button>)}</div>
            <textarea readOnly value={sellText} className="mt-4 h-44 w-full resize-none border border-[#444] bg-[#191919] p-3 font-mono text-xs text-[#ddd]" />
            <button type="button" onClick={() => { navigator.clipboard?.writeText(sellText); setNotice('Bulk Sell message copied.'); setSellOpen(false) }} className="mt-3 rounded bg-[#d4b36a] px-3 py-2 text-sm text-[#1a140c]">Copy</button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
