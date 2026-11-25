import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  Clock3,
  Filter,
  Folder,
  LayoutGrid,
  Layers3,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { LineChart, Line, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { readStashCache, writeStashCache } from '../services/stashService'
import { MARKET_CATEGORIES } from '../data/marketCategories'
import { MARKET_CATEGORY_ICONS } from '../data/marketCategoryIcons'
import { recordPoeCooldown, currentPoeDeadline } from '../lib/poeCooldown.js'
import usePoeCooldown from '../lib/usePoeCooldown.js'

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
const MAX_SNAPSHOTS = 30

const quantityFormat = new Intl.NumberFormat('en-US')
const chaosFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })

function compactSnapshotItem(item) {
  const frameType = Number(item.frameType) || 0
  return {
    id: item.id || `${item.tab || 'stash'}__${item.name || 'Unknown item'}`,
    name: item.name || 'Unknown item',
    typeLine: item.typeLine || '',
    baseType: item.baseType || '',
    tab: item.tab || 'Unknown',
    tabIndex: Number(item.tabIndex) || 0,
    tabType: item.tabType || 'NormalStash',
    tabColour: item.tabColour ?? null,
    tabLocations: Array.isArray(item.tabLocations) ? item.tabLocations : undefined,
    quantity: Number(item.quantity) || 1,
    priceChaos: Number(item.priceChaos ?? item.price) || 0,
    price: Number(item.priceChaos ?? item.price) || 0,
    totalChaos: Number(item.totalChaos) || 0,
    changeChaos: Number(item.changeChaos ?? item.totalChaos) || 0,
    totalDivine: Number(item.totalDivine) || 0,
    icon: item.icon || item.iconUrl || '',
    frameType,
    links: Number(item.links) || 0,
    gemLevel: frameType === 4 ? (Number(item.gemLevel) || 1) : 0,
    gemQuality: Number(item.gemQuality) || 0,
    corrupted: Boolean(item.corrupted),
    mapTier: Number(item.mapTier) || 0,
  }
}

function compactSnapshotTabs(tabs = []) {
  return tabs.map((tab, index) => ({
    index: Number.isInteger(tab.index) ? tab.index : index,
    name: tab.name || tab.label || `Tab ${index + 1}`,
    type: tab.type || tab.kind || 'NormalStash',
    colour: tab.colour ?? tab.tabColour ?? null,
  }))
}

function getTabTotals(items = []) {
  return items.reduce((totals, item) => {
    const tab = String(item.tab || item.tabName || 'Unknown')
    totals[tab] = (totals[tab] || 0) + (Number(item.totalChaos) || Number(item.quantity || 0) * Number(item.priceChaos ?? item.price ?? 0))
    return totals
  }, {})
}

function getItemTabLocation(item, tabs = []) {
  const tabName = itemTabName(item, tabs) || 'Unknown'
  const tabMeta = findTabMeta(tabs, tabName, item.tabIndex)
  const rawIndex = Number(item.tabIndex)
  const metaIndex = Number(tabMeta?.index)
  const nameNumber = Number(tabName)
  const tabNumber = Number.isFinite(rawIndex)
    ? rawIndex + 1
    : Number.isFinite(metaIndex)
      ? metaIndex + 1
      : Number.isFinite(nameNumber)
        ? nameNumber
        : 0
  return {
    tabNumber,
    tabName,
    tabType: tabMeta?.type || item.tabType,
    tabColour: tabMeta?.colour ?? item.tabColour ?? null,
    quantity: Number(item.quantity || 1),
  }
}

function aggregateItemsByName(items, divineRate, tabs = []) {
  const grouped = new Map()
  for (const item of items) {
    const displayName = String(item.name || '').trim()
    const quantity = Number(item.quantity || 1)
    const tabLocation = getItemTabLocation(item, tabs)
    const itemLocations = Array.isArray(item.tabLocations) && item.tabLocations.length
      ? item.tabLocations
      : [tabLocation]
    const existing = grouped.get(displayName)
    if (!existing) {
      const priceChaos = Number(item.priceChaos ?? item.price) || 0
      const totalChaos = quantity * priceChaos
      grouped.set(displayName, {
        ...item,
        name: displayName,
        quantity,
        priceChaos,
        totalChaos,
        totalDivine: divineRate > 0 ? totalChaos / divineRate : 0,
        tabLocations: itemLocations.map((location) => ({
          ...location,
          quantity: Number(location.quantity) || quantity,
        })),
      })
      continue
    }
    if (Number(existing.frameType) === 3 && Number(item.frameType) !== 3 && item.icon) {
      existing.icon = item.icon
    }
    existing.quantity += quantity
    for (const location of itemLocations) {
      const existingLocation = existing.tabLocations.find((entry) => entry.tabNumber === location.tabNumber)
      const locationQuantity = Number(location.quantity) || quantity
      if (existingLocation) existingLocation.quantity += locationQuantity
      else existing.tabLocations.push({ ...location, quantity: locationQuantity })
    }
    existing.totalChaos = existing.quantity * (Number(existing.priceChaos) || 0)
    existing.totalDivine = divineRate > 0 ? existing.totalChaos / divineRate : 0
  }
  return Array.from(grouped.values())
}

function expandItemTabLocations(items, tabs = []) {
  return items.flatMap((item) => {
    const locations = Array.isArray(item.tabLocations) && item.tabLocations.length
      ? item.tabLocations
      : [getItemTabLocation(item, tabs)]
    return locations.map((location) => ({
      ...item,
      id: `${item.id || item.name}__tab-${location.tabNumber || location.tabName}`,
      tab: location.tabName,
      tabIndex: location.tabNumber > 0 ? location.tabNumber - 1 : item.tabIndex,
      tabType: location.tabType || item.tabType,
      tabColour: location.tabColour ?? item.tabColour ?? null,
      quantity: Number(location.quantity) || 1,
      totalChaos: (Number(location.quantity) || 1) * (Number(item.priceChaos ?? item.price) || 0),
    }))
  })
}

function aggregateItemsByNameAndTab(items, divineRate, tabs = []) {
  const grouped = new Map()
  for (const item of items) {
    const name = String(item.name || '').trim()
    const location = getItemTabLocation(item, tabs)
    const key = `${name}|${location.tabNumber || location.tabName}`
    const quantity = Number(item.quantity || 1)
    const existing = grouped.get(key)
    if (!existing) {
      const priceChaos = Number(item.priceChaos ?? item.price) || 0
      const totalChaos = quantity * priceChaos
      grouped.set(key, {
        ...item,
        name,
        quantity,
        priceChaos,
        totalChaos,
        totalDivine: divineRate > 0 ? totalChaos / divineRate : 0,
        tabLocations: [{ ...location, quantity }],
      })
      continue
    }
    existing.quantity += quantity
    existing.tabLocations[0].quantity += quantity
    existing.totalChaos = existing.quantity * (Number(existing.priceChaos) || 0)
    existing.totalDivine = divineRate > 0 ? existing.totalChaos / divineRate : 0
  }
  return Array.from(grouped.values())
}

function compactSnapshots(entries) {
  return (Array.isArray(entries) ? entries : []).slice(0, MAX_SNAPSHOTS).map((entry, index) => {
    const items = Array.isArray(entry.itemsSnapshot) ? entry.itemsSnapshot : (Array.isArray(entry.items) ? entry.items : [])
    const summary = {
      id: entry.id,
      label: entry.label || 'Sync snapshot',
      timestamp: entry.timestamp || Date.now(),
      time: entry.time,
      totalChaos: Number(entry.totalChaos) || 0,
      totalDivine: Number(entry.totalDivine) || 0,
      tabTotals: entry.tabTotals || getTabTotals(items),
      tabs: compactSnapshotTabs(entry.tabs || []),
      previousTimestamp: entry.previousTimestamp || null,
      revenueChaos: Number(entry.revenueChaos) || 0,
      costChaos: Number(entry.costChaos) || 0,
      netChaos: Number(entry.netChaos) || 0,
      ...(Array.isArray(entry.diffItems) ? { diffItems: entry.diffItems.map(compactSnapshotItem) } : {}),
    }
    const compactItems = items.map(compactSnapshotItem)
    // Only the newest snapshot needs the full stash for the next diff. Older
    // entries are represented by their already-computed diff and summary data.
    return index === 0
      ? { ...summary, items: compactItems, itemsSnapshot: compactItems }
      : { ...summary, items: [], itemsSnapshot: [] }
  })
}

function loadSnapshots() {
  try {
    return compactSnapshots(JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null') || SNAPSHOTS)
  } catch {
    return compactSnapshots(SNAPSHOTS)
  }
}

function saveSnapshotsSafely(entries) {
  const compact = compactSnapshots(entries)
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(compact))
    return
  } catch (error) {
    console.warn('Could not save all stash snapshots; reducing local snapshot history.', error)
  }

  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(compact.slice(0, 1)))
    return
  } catch (error) {
    console.warn('Could not save the latest stash snapshot; clearing local snapshot history.', error)
  }

  try {
    localStorage.removeItem(SNAPSHOT_KEY)
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(compact.map(({ items, ...summary }) => summary).slice(0, 1)))
  } catch (error) {
    console.warn('Could not persist stash snapshot summary.', error)
  }
}

function getErrorMessage(error) {
  if (typeof error === 'string') return error
  return error?.error?.message || error?.message || (error ? JSON.stringify(error) : 'Unknown stash sync error.')
}

const STASH_TAB_ICONS = {
  standard: 'https://web.poecdn.com/image/Art/2DItems/Currency/CurrencyAddModToMagic.png',
  currency: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lSZXJvbGxSYXJlIiwidyI6MSwiaCI6MSwic2NhbGUiOjF9XQ/d119a0d734/CurrencyRerollRare.png',
  map: 'https://web.poecdn.com/gen/image/WzI4LDE0LHsiZiI6IjJESXRlbXMvTWFwcy9BdGxhczJNYXBzL05ldy9TdHJhbmQiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MSwibW4iOjE5LCJtdCI6MX1d/95f3451d5b/Strand.png',
  divination: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvRGl2aW5hdGlvbi9JbnZlbnRvcnlJY29uIiwidyI6MSwiaCI6MSwic2NhbGUiOjF9XQ/f34bf8cbb5/InventoryIcon.png',
  essence: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvRXNzZW5jZS9Ib3Jyb3IxIiwidyI6MSwiaCI6MSwic2NhbGUiOjF9XQ/748d594bde/Horror1.png',
  fragment: 'https://web.poecdn.com/gen/image/WzI4LDE0LHsiZiI6IjJESXRlbXMvTWFwcy9WYWFsQ29tcGxldGUiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MX1d/63035d86d7/VaalComplete.png',
  unique: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lVcGdyYWRlVG9VbmlxdWUiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MX1d/235982765c/CurrencyUpgradeToUnique.png',
  gem: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvR2Vtcy9TdXBwb3J0L1N1cHBvcnRQbHVzIiwidyI6MSwiaCI6MSwic2NhbGUiOjF9XQ/4e44b6d8a2/SupportPlus.png',
  flask: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvRmxhc2tzL2xpZmVmbGFzazEiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MX1d/6390293572/lifeflask1.png',
  delve: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvRGVsdmUvRGVsdmVTb2NrZXRhYmxlQ3VycmVuY3kxIiwidyI6MSwiaCI6MSwic2NhbGUiOjF9XQ/4e46e54b18/DelveSocketableCurrency1.png',
  blight: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvT2lscy9Hb2xkZW5PaWwiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MSwic2NhbGUiOjF9XQ/545276d232/GoldenOil.png',
  metamorph: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ2F0YWx5c3RzL0NhdGFseXN0QXR0YWNrIiwidyI6MSwiaCI6MSwic2NhbGUiOjF9XQ/96370f6f51/CatalystAttack.png',
  delirium: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvRGVsaXJpdW0vRGVsaXJpdW1PcmIiLCJ3IjoxLCJoIjoxLCJzY2FsZSI6MSwic2NhbGUiOjF9XQ/0b151e341e/DeliriumOrb.png',
}

function tabIconUrl(tabType, kind) {
  const type = String(tabType || kind || '').toLowerCase()
  if (type === 'quadstash' || type === 'folder' || type.includes('merchant') || type === 'normalstash' || type === 'premiumstash') return null
  if (type.includes('currency')) return STASH_TAB_ICONS.currency
  if (type.includes('map')) return STASH_TAB_ICONS.map
  if (type.includes('divination')) return STASH_TAB_ICONS.divination
  if (type.includes('essence')) return STASH_TAB_ICONS.essence
  if (type.includes('fragment')) return STASH_TAB_ICONS.fragment
  if (type.includes('unique')) return STASH_TAB_ICONS.unique
  if (type.includes('gem')) return STASH_TAB_ICONS.gem
  if (type.includes('flask')) return STASH_TAB_ICONS.flask
  if (type.includes('delve')) return STASH_TAB_ICONS.delve
  if (type.includes('blight')) return STASH_TAB_ICONS.blight
  if (type.includes('metamorph')) return STASH_TAB_ICONS.metamorph
  if (type.includes('delirium')) return STASH_TAB_ICONS.delirium
  return null
}

function StashDiamondIcon() {
  const [imgError, setImgError] = useState(false)
  if (!imgError) {
    return (
      <img
        src="https://web.poecdn.com/protected/image/layout/stash/premium-tab-icon.png?v=1680235310966&key=eFcoMl6FRQpBrNgSIvNgYQ"
        alt="Stash Tab"
        className="h-4 w-4 shrink-0 object-contain object-left"
        loading="lazy"
        decoding="async"
        onError={() => setImgError(true)}
      />
    )
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0">
      <polygon points="8,1 14,5 12,12 8,15 4,12 2,5" fill="#7dd3fc" stroke="#0284c7" strokeWidth="1" />
      <polygon points="8,3 11,5 10,10 8,12 6,10 5,5" fill="#38bdf8" opacity="0.9" />
    </svg>
  )
}

function StashTabIcon({ tabType, kind }) {
  const type = String(tabType || kind || '').toLowerCase()
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [tabType, kind])
  if (type === 'quadstash') {
    return <LayoutGrid size={16} className="shrink-0 text-[#7dd3fc]" />
  }
  if (type === 'folder') {
    return <Folder size={16} className="shrink-0 text-[#fbbf24]" />
  }
  if (type === 'normalstash' || type === 'premiumstash' || type.includes('merchant')) {
    return <StashDiamondIcon />
  }
  const icon = tabIconUrl(tabType, kind)
  if (icon && !failed) {
    return <img src={icon} alt="" loading="lazy" decoding="async" className="h-4 w-4 shrink-0 object-contain" onError={() => setFailed(true)} />
  }
  return <StashDiamondIcon />
}

function stashTabStyle(tab, active = false) {
  const colour = tab?.colour || tab?.tabColour
  if (!colour || typeof colour !== 'object') return undefined
  const r = Number(colour.r)
  const g = Number(colour.g)
  const b = Number(colour.b)
  if (![r, g, b].every(Number.isFinite)) return undefined
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, ${active ? 0.58 : 0.42})`,
  }
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
        decoding="async"
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

function CategoryIcon({ src, label, className = 'h-5 w-5 shrink-0 object-contain' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (src && !failed) {
    return <img src={src} alt="" loading="lazy" decoding="async" className={className} onError={() => setFailed(true)} />
  }
  return <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-[#26383b] text-[10px] text-[#9ec5c8]">{String(label || '?').slice(0, 1)}</span>
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

function formatChartTime(timestamp) {
  return new Date(timestamp).toLocaleString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function WealthTooltip({ active, payload, divineToChaos }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="rounded border border-[#555] bg-[#292929] px-3 py-2 text-xs shadow-xl">
      <p className="text-[#d7d7d7]">{formatChartTime(point.timestamp)}</p>
      <p className="mt-1 font-medium text-[#e7ad68]">Wealth: {formatCardValue(point.totalChaos, divineToChaos)}</p>
    </div>
  )
}

function itemCategory(item) {
  const typeLine = String(item.typeLine || item.name || '').toLowerCase()
  const baseType = String(item.baseType || '').toLowerCase()
  const frameType = Number(item.frameType)
  if (Number(item.mapTier) > 0 || typeLine.includes(' map') || baseType.includes('map')) return 'Maps'
  if (frameType === 4 || typeLine.includes('support')) return 'Gems'
  if (frameType === 6) return 'Divination Cards'
  if (frameType === 3) return 'Unique Equipment'
  if (frameType === 5) {
    if (typeLine.includes('scarab')) return 'Scarabs'
    if (typeLine.includes('essence')) return 'Essences'
    if (typeLine.includes('fossil') || typeLine.includes('resonator')) return 'Fossils'
    if (typeLine.includes('fragment')) return 'Fragments'
    return 'Currency'
  }
  if (typeLine.includes('jewel')) return 'Jewels'
  if (frameType === 1 || frameType === 2) return 'Rare Equipment'
  return 'Other'
}

function marketCategoryForItem(item) {
  const typeLine = String(item.typeLine || item.name || '').toLowerCase()
  const baseType = String(item.baseType || '').toLowerCase()
  const frameType = Number(item.frameType)
  const isMap = Number(item.mapTier) > 0 || typeLine.includes(' map') || baseType.includes('map')
  if (isMap) return frameType === 3 ? 'Unique Maps' : 'Maps'
  if (frameType === 6) return 'Divination Cards'
  if (frameType === 4 || typeLine.includes('support')) return 'Skill Gems'
  if (frameType === 5) {
    if (typeLine.includes('scarab')) return 'Scarabs'
    if (typeLine.includes('essence')) return 'Essences'
    if (typeLine.includes('fossil') || typeLine.includes('resonator')) return typeLine.includes('resonator') ? 'Resonators' : 'Fossils'
    if (typeLine.includes('fragment') || typeLine.includes('splinter') || typeLine.includes('shard')) return 'Fragments'
    if (typeLine.includes('oil')) return 'Oils'
    if (typeLine.includes('delirium orb')) return 'Delirium Orbs'
    return 'Currency'
  }
  if (frameType === 3) {
    if (typeLine.includes('flask')) return 'Unique Flasks'
    if (typeLine.includes('jewel')) return 'Unique Jewels'
    if (/(ring|amulet|belt)/.test(baseType) || /(ring|amulet|belt)/.test(typeLine)) return 'Unique Accessories'
    if (/(bow|wand|staff|sword|axe|mace|dagger|claw|sceptre|quiver)/.test(baseType)) return 'Unique Weapons'
    return 'Unique Armours'
  }
  if (typeLine.includes('cluster jewel')) return 'Cluster Jewels'
  if (typeLine.includes('jewel')) return 'Base Types'
  if (frameType === 1 || frameType === 2) return 'Base Types'
  return 'Currency'
}

function formatCardValue(value, divineToChaos) {
  const chaos = Number(value) || 0
  if (divineToChaos > 0 && chaos >= divineToChaos) {
    return `${(chaos / divineToChaos).toFixed(1).replace(/\.0$/, '')}d`
  }
  return `${(chaos >= 10 ? Math.floor(chaos) : chaos).toFixed(chaos >= 10 ? 0 : 1).replace(/\.0$/, '')}c`
}

function formatCardPercentage(value) {
  const percentage = Number(value) || 0
  return `${(percentage >= 10 ? Math.floor(percentage) : percentage).toFixed(percentage >= 10 ? 0 : 1).replace(/\.0$/, '')}%`
}

function snapshotDeltaItems(current = {}, previous = {}) {
  const currentItems = Array.isArray(current.itemsSnapshot) ? current.itemsSnapshot : (Array.isArray(current.items) ? current.items : [])
  const previousItems = Array.isArray(previous.itemsSnapshot) ? previous.itemsSnapshot : (Array.isArray(previous.items) ? previous.items : [])
  if (!previous || previousItems.length === 0) return []
  const byName = (items) => items.reduce((map, item) => {
    const name = String(item.name || '').trim()
    const category = marketCategoryForItem(item)
    const key = `${name.toLowerCase()}_${category}`
    const entry = map.get(key) || { ...item, name, category, quantity: 0 }
    entry.quantity += Number(item.quantity) || 0
    if (Number(item.priceChaos ?? item.price) > 0) entry.priceChaos = Number(item.priceChaos ?? item.price)
    map.set(key, entry)
    return map
  }, new Map())
  const currentMap = byName(currentItems)
  const previousMap = byName(previousItems)
  return [...new Set([...currentMap.keys(), ...previousMap.keys()])]
    .map((key) => {
      const currentItem = currentMap.get(key) || previousMap.get(key) || { name: key.split('_')[0] }
      const previousItem = previousMap.get(key)
      const quantity = (currentMap.get(key)?.quantity || 0) - (previousItem?.quantity || 0)
      const priceChaos = Number(currentItem.priceChaos ?? currentItem.price ?? previousItem?.priceChaos ?? previousItem?.price) || 0
      return { ...currentItem, name: currentItem.name, quantity, priceChaos, totalChaos: quantity * priceChaos, changeChaos: quantity * priceChaos }
    })
    .filter((item) => item.quantity !== 0)
    .sort((left, right) => Math.abs(right.totalChaos) - Math.abs(left.totalChaos))
}

function formatSnapshotTime(timestamp) {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today at ${time}`
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` at ${time}`
}

function formatSnapshotDuration(milliseconds) {
  const minutes = Math.max(0, Math.round(milliseconds / 60000))
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function formatSnapshotMoney(value, divineToChaos) {
  const chaos = Number(value) || 0
  const sign = chaos > 0 ? '+' : chaos < 0 ? '-' : ''
  const absolute = Math.abs(chaos)
  const divine = divineToChaos > 0 ? Math.floor(absolute / divineToChaos) : 0
  const remainder = divineToChaos > 0 ? absolute - divine * divineToChaos : absolute
  const chaosText = remainder >= 10 ? String(Math.floor(remainder)) : remainder.toFixed(1).replace(/\.0$/, '')
  return `${sign}${divine}d ${chaosText}c`
}

function formatSignedChaos(value, divineToChaos) {
  const chaos = Number(value) || 0
  return `${chaos > 0 ? '+' : chaos < 0 ? '-' : ''}${formatCardValue(Math.abs(chaos), divineToChaos)}`
}

function StashOverviewCards({ wealthHistory, filteredTotalChaos, divineToChaos, breakdown, breakdownMode, setBreakdownMode, snapshotMode, snapshotInfo }) {
  const maxChaos = Math.max(...wealthHistory.map((point) => point.totalChaos), filteredTotalChaos, 0)
  const step = Math.max(divineToChaos * 10, 1)
  const yMax = Math.max(step, Math.ceil(maxChaos / step) * step)
  return (
    <div className="grid w-full grid-cols-1 gap-3 py-3 lg:grid-cols-2">
      <article className="h-[160px] rounded border border-[#26383b] bg-[#1a272a] px-4 py-3">
        {snapshotMode ? (
          <>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-lg text-[#e5e5e5]">Snapshot</h2>
              <span className={`text-lg font-medium ${snapshotInfo?.hourly >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>{formatSignedChaos(snapshotInfo?.hourly || 0, divineToChaos)}/hr</span>
            </div>
            <div className="mt-3 grid grid-cols-2 justify-between gap-8 text-sm text-[#a3b8ba]">
              <div className="min-w-[180px] space-y-1">
                <p className="flex justify-between gap-4">Start: <span className="text-[#e5eeee]">{snapshotInfo?.previous ? new Date(snapshotInfo.previous.timestamp).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '—'}</span></p>
                <p className="mb-2 flex justify-between gap-4 border-b border-[#263a3d] pb-2">End: <span className="text-[#e5eeee]">{snapshotInfo?.current ? new Date(snapshotInfo.current.timestamp).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '—'}</span></p>
                <p className="flex justify-between gap-4">Duration: <span className="text-[#e5eeee]">{formatSnapshotDuration(snapshotInfo?.duration || 0)}</span></p>
              </div>
              <div className="min-w-[180px] space-y-1">
                <p className="flex justify-between gap-4">Revenue: <span className="text-[#e5eeee]">{formatSnapshotMoney(snapshotInfo?.revenue || 0, divineToChaos)}</span></p>
                <p className="mb-2 flex justify-between gap-4 border-b border-[#263a3d] pb-2">Cost: <span className="text-[#e5eeee]">{formatSnapshotMoney(snapshotInfo?.cost || 0, divineToChaos)}</span></p>
                <p className="flex justify-between gap-4">Net: <span className={snapshotInfo?.net >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}>{formatSnapshotMoney(snapshotInfo?.net || 0, divineToChaos)}</span></p>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-lg text-[#f8fafc]">Wealth</h2>
              <span className="text-lg font-medium text-[#f0e1c8]">{formatCardValue(filteredTotalChaos, divineToChaos)}</span>
            </div>
            <div className="mt-2 h-28">
              {wealthHistory.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={wealthHistory} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="timestamp" tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} tick={{ fill: '#f8fafc', fontSize: 11 }} axisLine={{ stroke: '#555' }} tickLine={false} />
                    <YAxis domain={[0, yMax]} ticks={Array.from({ length: Math.round(yMax / step) + 1 }, (_, index) => index * step)} tickFormatter={(value) => value === 0 ? '' : `${Math.round(value / divineToChaos)}d`} tick={{ fill: '#f8fafc', fontSize: 11 }} axisLine={{ stroke: '#555' }} tickLine={false} width={42} />
                    <Tooltip content={<WealthTooltip divineToChaos={divineToChaos} />} cursor={{ stroke: '#aaa', strokeWidth: 1 }} />
                    <Line type="monotone" dataKey="totalChaos" stroke="#e4b76d" strokeWidth={1.5} dot={{ r: 3, fill: '#f8e3bd', stroke: '#e4b76d', strokeWidth: 1 }} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="grid h-full place-items-center text-xs text-[#888]">No sync snapshots yet.</p>}
            </div>
          </>
        )}
      </article>

      <article className="h-[160px] rounded border border-[#26383b] bg-[#1a272a] px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg text-[#f8fafc]">Breakdown</h2>
          <div className="flex overflow-hidden rounded border border-[#26383b] bg-[#0e1517] p-0.5 text-[11px]">
            <button type="button" onClick={() => setBreakdownMode('divines')} className={`rounded px-2 py-1 font-medium transition ${breakdownMode === 'divines' ? 'bg-[#1d2e31] text-[#2dd4bf]' : 'bg-transparent text-[#94a3b8] hover:text-white'}`}>Divines</button>
            <button type="button" onClick={() => setBreakdownMode('percentage')} className={`rounded px-2 py-1 font-medium transition ${breakdownMode === 'percentage' ? 'bg-[#1d2e31] text-[#2dd4bf]' : 'bg-transparent text-[#94a3b8] hover:text-white'}`}>Percentage</button>
          </div>
        </div>
        <div className="mt-3 grid w-fit max-w-full grid-flow-col grid-rows-3 auto-cols-max gap-x-8 gap-y-3.5 text-[13px]">
          {breakdown.map(({ category, totalChaos, icon }) => {
            const value = breakdownMode === 'percentage'
              ? formatCardPercentage(filteredTotalChaos > 0 ? (totalChaos / filteredTotalChaos) * 100 : 0)
              : formatCardValue(totalChaos, divineToChaos)
            return (
              <div key={category} className="flex min-w-0 items-center gap-2 text-xs text-[#f8fafc]" title={`${category}: ${value}`}>
                <CategoryIcon src={icon} label={category} className="h-[22px] w-[22px] shrink-0 object-contain" />
                <span className="truncate">{value}</span>
              </div>
            )
          })}
        </div>
      </article>
    </div>
  )
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

function findTabMeta(tabs = [], tabName = '', tabIndex) {
  const normalizedName = String(tabName || '').trim().toLowerCase()
  return tabs.find((tab) => {
    const sameName = String(tab?.name || tab?.label || '').trim().toLowerCase() === normalizedName
    const sameIndex = tabIndex !== undefined && tabIndex !== null && Number(tab?.index) === Number(tabIndex)
    return sameName || sameIndex
  })
}

function itemHasSelectedTab(item, selectedTabKeys, tabs = []) {
  if (Array.isArray(item.tabLocations) && item.tabLocations.length) {
    return item.tabLocations.some((location) => selectedTabKeys.has(String(location.tabName || '').trim().toLowerCase()))
  }
  return selectedTabKeys.has(itemTabName(item, tabs).trim().toLowerCase())
}

function snapshotTotalForTabs(entry, selectedTabs, tabs = []) {
  if (selectedTabs.length === 0) return Number(entry.totalChaos) || 0
  const selectedKeys = new Set(selectedTabs.map((tab) => String(tab).trim().toLowerCase()))
  return (entry.items || []).reduce((total, item) => {
    const unitPrice = Number(item.priceChaos ?? item.price) || 0
    if (Array.isArray(item.tabLocations) && item.tabLocations.length) {
      return total + item.tabLocations
        .filter((location) => selectedKeys.has(String(location.tabName || '').trim().toLowerCase()))
        .reduce((sum, location) => sum + (Number(location.quantity) || 0) * unitPrice, 0)
    }
    return itemHasSelectedTab(item, selectedKeys, tabs) ? total + (Number(item.totalChaos) || Number(item.quantity || 0) * unitPrice) : total
  }, 0)
}

function iconNameForItem(item) {
  if (item.id === 'map-tier-1') return 'Lighthouse Map'
  if (item.id === 'arrogance-support') return 'Arrogance Support'
  return item.name
}

export default function StashView({
  query = '',
  league = 'Standard',
  divineToChaos = 225,
  accountName = '',
  stashItems: stashItemsProp,
  onStashItems,
  stashTabs: stashTabsProp,
  onStashTabs,
  selectedTabs: selectedTabsProp,
  onSelectedTabs,
  lastSyncedAt: lastSyncedAtProp,
  onLastSyncedAt,
  syncStatusText: syncStatusTextProp,
  onSyncStatusText,
}) {
  const [mode, setMode] = useState('tabs')
  const [localSelectedTabs, setLocalSelectedTabs] = useState([])
  const [foundItemNames, setFoundItemNames] = useState(null)
  const [selectedSnapshot, setSelectedSnapshot] = useState(SNAPSHOTS[0].id)
  const [snapshots, setSnapshots] = useState(loadSnapshots)
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [filterValues, setFilterValues] = useState({ category: '', minQuantity: '', maxQuantity: '', minItemPrice: '', maxItemPrice: '', minTotalPrice: '', maxTotalPrice: '' })
  const [breakdownMode, setBreakdownMode] = useState('divines')
  const filtersRef = useRef(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [sort, setSort] = useState({ key: 'total', direction: 'desc' })
  const [localSyncedAt, setLocalSyncedAt] = useState(() => Date.now() - 3 * 60 * 1000)
  const [now, setNow] = useState(() => Date.now())
  const [menuOpen, setMenuOpen] = useState(false)
  const [visibleItemLimit, setVisibleItemLimit] = useState(100)
  const [localNotice, setLocalNotice] = useState('')
  const [iconMap, setIconMap] = useState({})
  const [localStashTabs, setLocalStashTabs] = useState(() => readStashCache().tabs || STASH_TABS)
  const [localStashItems, setLocalStashItems] = useState(() => readStashCache().pricedItems || STASH_ITEMS)
  const [syncing, setSyncing] = useState(false)
  const retrySeconds = usePoeCooldown()
  const [syncProgress, setSyncProgress] = useState('')
  const [syncedTabIndices, setSyncedTabIndices] = useState(() => {
    try { return JSON.parse(localStorage.getItem('poe.syncedTabIndices') || '[]') } catch { return [] }
  })
  const [tabEditorOpen, setTabEditorOpen] = useState(false)

  const stashItems = stashItemsProp ?? localStashItems
  const stashTabs = stashTabsProp ?? localStashTabs
  const selectedTabs = selectedTabsProp ?? localSelectedTabs
  const syncedAt = lastSyncedAtProp || localSyncedAt
  const updateState = (setter, callback, value) => {
    setter(value)
    callback?.(value)
  }
  const setStashItems = (value) => updateState(setLocalStashItems, onStashItems, value)
  const setStashTabs = (value) => updateState(setLocalStashTabs, onStashTabs, value)
  const setSelectedTabs = (value) => updateState(setLocalSelectedTabs, onSelectedTabs, value)
  const setSyncedAt = (value) => updateState(setLocalSyncedAt, onLastSyncedAt, value)
  const setNotice = (value) => updateState(setLocalNotice, onSyncStatusText, value)

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
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setVisibleItemLimit(100)
  }, [mode, selectedSnapshot, search, query, selectedTabs, filterValues])

  useEffect(() => {
    if (!filtersOpen) return undefined
    const handlePointerDown = (event) => {
        if (!filtersRef.current?.contains(event.target)) {
          setFiltersOpen(false)
          setCategoryOpen(false)
        }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [filtersOpen])

  useEffect(() => {
    saveSnapshotsSafely(snapshots)
    fetch('/api/stash/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshots: compactSnapshots(snapshots) }),
    }).catch(() => {})
  }, [snapshots])

  useEffect(() => {
    let active = true
    fetch('/api/stash/cache')
      .then((response) => response.ok ? response.json() : null)
      .then((cache) => {
        if (active && Array.isArray(cache?.snapshots) && cache.snapshots.length > 0) {
          setSnapshots(compactSnapshots(cache.snapshots))
        }
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  const snapshot = snapshots.find((entry) => entry.id === selectedSnapshot) || snapshots[0] || SNAPSHOTS[0]
  const snapshotIndex = snapshots.findIndex((entry) => entry.id === snapshot.id)
  const previousSnapshot = snapshotIndex >= 0 ? snapshots[snapshotIndex + 1] : null
  const snapshotChanges = useMemo(() => (
    Array.isArray(snapshot.diffItems) ? snapshot.diffItems : snapshotDeltaItems(snapshot, previousSnapshot || {})
  ), [previousSnapshot, snapshot])
  const snapshotInfo = useMemo(() => {
    const duration = previousSnapshot ? Math.max(0, Number(snapshot.timestamp) - Number(previousSnapshot.timestamp)) : 0
    const revenue = snapshotChanges.filter((item) => item.totalChaos > 0).reduce((sum, item) => sum + item.totalChaos, 0)
    const cost = snapshotChanges.filter((item) => item.totalChaos < 0).reduce((sum, item) => sum + Math.abs(item.totalChaos), 0)
    const net = revenue - cost
    return { current: snapshot, previous: previousSnapshot, duration, revenue, cost, net, hourly: duration > 0 ? net / (duration / 3600000) : 0 }
  }, [previousSnapshot, snapshot, snapshotChanges])
  const sourceItems = mode === 'snapshots' ? (snapshot.items || []) : stashItems
  const displayTabs = useMemo(() => {
    const grouped = new Map()
    stashTabs.forEach((tab, index) => {
      const name = String(tab.name || tab.label || `Tab ${index + 1}`).trim()
      const key = name.toLowerCase()
      grouped.set(key, {
        ...tab,
        id: name,
        label: name,
        name,
        type: tab.type || tab.kind || 'NormalStash',
        colour: tab.colour ?? tab.color ?? null,
        kind: tab.kind || tab.type || 'NormalStash',
        color: tab.colour ?? tab.color ?? null,
        totalChaos: 0,
        quantity: 0,
      })
    })
    stashItems.forEach((item) => {
      const name = itemTabName(item, stashTabs) || 'Unknown'
      const key = name.toLowerCase()
      const existing = grouped.get(key)
      const totalChaos = Number(item.totalChaos) || Number(item.quantity || 0) * Number(item.price || item.priceChaos || 0)
      if (existing) {
        existing.totalChaos += totalChaos
        existing.quantity += Number(item.quantity) || 0
      } else {
        const sourceTab = findTabMeta(stashTabs, name, item.tabIndex)
        grouped.set(key, {
          ...(sourceTab || {}),
          id: name,
          label: name,
          name,
          type: sourceTab?.type || item.tabType || 'NormalStash',
          colour: sourceTab?.colour ?? item.tabColour ?? null,
          kind: sourceTab?.kind || sourceTab?.type || item.tabType || 'NormalStash',
          color: sourceTab?.colour ?? item.tabColour ?? null,
          totalChaos,
          quantity: Number(item.quantity) || 0,
        })
      }
    })
    return [...grouped.values()]
  }, [stashItems, stashTabs])
  const tabById = useMemo(() => new Map(displayTabs.map((tab) => [tab.id, tab])), [displayTabs])
  const filterCategories = useMemo(() => {
    const totals = new Map()
    stashItems.forEach((item) => {
      const category = marketCategoryForItem(item)
      const totalChaos = Number(item.totalChaos) || Number(item.quantity || 0) * Number(item.priceChaos ?? item.price ?? 0)
      totals.set(category, (totals.get(category) || 0) + totalChaos)
    })
    const available = MARKET_CATEGORIES
      .map((category) => ({
        ...category,
        icon: category.icon || category.fallbackIcon || MARKET_CATEGORY_ICONS[category.id],
        totalChaos: totals.get(category.label) || 0,
      }))
      .sort((left, right) => right.totalChaos - left.totalChaos || left.label.localeCompare(right.label))
    const totalChaos = [...totals.values()].reduce((sum, value) => sum + value, 0)
    return [{ id: 'all', label: 'All Categories', icon: null, totalChaos }, ...available]
  }, [stashItems])
  const activeFilterGroupsCount = [
    Boolean(filterValues.category && filterValues.category !== 'All Categories'),
    Boolean(filterValues.minQuantity || filterValues.maxQuantity),
    Boolean(filterValues.minItemPrice || filterValues.maxItemPrice),
    Boolean(filterValues.minTotalPrice || filterValues.maxTotalPrice),
  ].filter(Boolean).length
  const rows = useMemo(() => {
    const localNeedle = search.trim().toLowerCase()
    const globalNeedle = query.trim().toLowerCase()
    const selectedTabKeys = new Set(selectedTabs.map((tab) => String(tab).trim().toLowerCase()))
    const foundNames = foundItemNames ? new Set(foundItemNames.map((name) => String(name).trim().toLowerCase())) : null
    const filteredItems = sourceItems
      .filter((item) => selectedTabs.length === 0 || itemHasSelectedTab(item, selectedTabKeys, stashTabs))
      .filter((item) => !foundNames || foundNames.has(String(item.name || '').trim().toLowerCase()))
      .filter((item) => !globalNeedle || item.name.toLowerCase().includes(globalNeedle))
      .filter((item) => !localNeedle || item.name.toLowerCase().includes(localNeedle))
    const itemsForAggregation = selectedTabs.length > 0
      ? expandItemTabLocations(filteredItems, stashTabs)
      : filteredItems
    const aggregated = foundItemNames
      ? aggregateItemsByNameAndTab(expandItemTabLocations(filteredItems, stashTabs), divineToChaos, stashTabs)
      : aggregateItemsByName(itemsForAggregation, divineToChaos, stashTabs)
    return aggregated.filter((item) => {
      const quantity = Number(item.quantity) || 0
      const price = Number(item.priceChaos ?? item.price) || 0
      const total = Number(item.totalChaos) || quantity * price
      const matchesNumber = (value, minimum, maximum) => (
        (minimum === '' || value >= Number(minimum))
        && (maximum === '' || value <= Number(maximum))
      )
      return (!filterValues.category || filterValues.category === 'All Categories' || marketCategoryForItem(item) === filterValues.category)
        && matchesNumber(quantity, filterValues.minQuantity, filterValues.maxQuantity)
        && matchesNumber(price, filterValues.minItemPrice, filterValues.maxItemPrice)
        && matchesNumber(total, filterValues.minTotalPrice, filterValues.maxTotalPrice)
    })
      .sort((left, right) => {
        const direction = sort.direction === 'asc' ? 1 : -1
        const tabs = displayTabs
        const a = sortableValue(left, sort.key, tabs)
        const b = sortableValue(right, sort.key, tabs)
        return (typeof a === 'string' ? a.localeCompare(b) : a - b) * direction
      })
  }, [displayTabs, divineToChaos, filterValues, foundItemNames, query, search, selectedTabs, sort, sourceItems, stashTabs])
  const filteredTotalChaos = useMemo(() => rows.reduce((sum, item) => sum + (Number(item.totalChaos) || Number(item.quantity || 0) * Number(item.price || item.priceChaos || 0)), 0), [rows])
  const wealthHistory = useMemo(() => snapshots
    .slice(0, 13)
    .reverse()
    .map((entry) => ({
      timestamp: entry.timestamp || Date.now(),
      totalChaos: snapshotTotalForTabs(entry, selectedTabs, stashTabs),
    })), [snapshots, selectedTabs, stashTabs])
  const breakdown = useMemo(() => {
    const grouped = new Map()
    rows.forEach((item) => {
      const category = marketCategoryForItem(item)
      const totalChaos = Number(item.totalChaos) || Number(item.quantity || 0) * Number(item.priceChaos ?? item.price ?? 0)
      grouped.set(category, (grouped.get(category) || 0) + totalChaos)
    })
    return [...grouped.entries()]
      .filter(([, totalChaos]) => totalChaos > 0)
      .sort((left, right) => right[1] - left[1])
      .map(([category, totalChaos]) => ({
        category,
        totalChaos,
        icon: filterCategories.find((entry) => entry.label === category)?.icon || '',
      }))
  }, [filterCategories, rows])
  const snapshotBreakdown = useMemo(() => {
    const grouped = new Map()
    snapshotChanges.forEach((item) => {
      const category = marketCategoryForItem(item)
      const totalChaos = Number(item.changeChaos ?? item.totalChaos) || 0
      grouped.set(category, (grouped.get(category) || 0) + totalChaos)
    })
    return [...grouped.entries()]
      .filter(([, totalChaos]) => totalChaos !== 0)
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
      .map(([category, totalChaos]) => ({ category, totalChaos, icon: filterCategories.find((entry) => entry.label === category)?.icon || '' }))
  }, [filterCategories, snapshotChanges])
  const snapshotTotalChaos = snapshotBreakdown.reduce((sum, item) => sum + item.totalChaos, 0)

  const allVisibleSelected = rows.length > 0 && rows.every((item) => selectedIds.includes(item.id))
  const selectedCount = selectedIds.length
  const selectedItemNames = [...new Set(rows.filter((item) => selectedIds.includes(item.id)).map((item) => item.name))]
  const selectedTotalChaos = rows
    .filter((item) => selectedIds.includes(item.id))
    .reduce((sum, item) => sum + (Number(item.totalChaos) || Number(item.quantity || 0) * Number(item.priceChaos ?? item.price ?? 0)), 0)
  const tableItems = mode === 'snapshots' ? snapshotChanges : rows
  const visibleTableItems = tableItems.slice(0, visibleItemLimit)

  function addSnapshot(nextItems, nextTabs = stashTabs) {
    const totalChaos = nextItems.reduce((sum, item) => sum + (Number(item.totalChaos) || Number(item.quantity || 0) * Number(item.price || item.priceChaos || 0)), 0)
    const timestamp = Date.now()
    setSnapshots((current) => {
      const previous = current[0]
      const diffItems = snapshotDeltaItems({ itemsSnapshot: nextItems }, previous || {})
      const revenueChaos = diffItems.filter((item) => item.totalChaos > 0).reduce((sum, item) => sum + item.totalChaos, 0)
      const costChaos = diffItems.filter((item) => item.totalChaos < 0).reduce((sum, item) => sum + item.totalChaos, 0)
      const netChaos = revenueChaos + costChaos
      const snapshotEntry = {
        id: `snapshot-${timestamp}`,
        label: 'Sync snapshot',
        timestamp,
        previousTimestamp: previous?.timestamp || null,
        time: new Date(timestamp).toLocaleString(),
        totalChaos,
        totalDivine: totalChaos / (divineToChaos || 225),
        tabTotals: getTabTotals(nextItems),
        tabs: nextTabs,
        items: nextItems,
        itemsSnapshot: nextItems,
        diffItems,
        revenueChaos,
        costChaos,
        netChaos,
      }
      setSelectedSnapshot(snapshotEntry.id)
      return compactSnapshots([snapshotEntry, ...current])
    })
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

  function toggleStashTab(tabName) {
    setSelectedTabs((current) => {
      if (current.length === 0) return [tabName]
      if (current.includes(tabName)) return current.filter((tab) => tab !== tabName)
      const next = [...current, tabName]
      return next.length === displayTabs.length ? [] : next
    })
  }

  function toggleVisible() {
    setSelectedIds((current) => (
      allVisibleSelected
        ? current.filter((id) => !rows.some((item) => item.id === id))
        : [...new Set([...current, ...rows.map((item) => item.id)])]
    ))
  }

  async function syncNow() {
    if (syncing || currentPoeDeadline() > Date.now()) return
    if (!accountName) { setNotice('Set an account name before syncing stash.'); return }
    setSyncing(true)
    setNotice('')
    try {
      setSyncProgress('Syncing stash from GGG and poe.ninja...')
      const response = await fetch(`/api/stash/sync?league=${encodeURIComponent(league || 'Standard')}`)
      const rawResponse = await response.text()
      let synced = {}
      try { synced = rawResponse ? JSON.parse(rawResponse) : {} } catch {
        throw new Error(`Backend trả về HTTP ${response.status} nhưng không phải JSON: ${rawResponse.slice(0, 300)}`)
      }
      recordPoeCooldown(response, synced)
      if (!response.ok || synced.error) {
        const detail = synced.error?.message || synced.error || synced.details || `Backend trả về HTTP ${response.status}.`
        throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
      }
      const imported = (synced.items || []).map((item, index) => {
        const tab = String(item.tab || '').trim() || 'Unknown'
        return {
          ...item,
          id: item.id || `${tab}__${item.name || 'Unknown'}__${index}`,
          name: item.name || 'Unknown item',
          tab,
          tabId: tab,
          tabName: tab,
          tabType: item.tabType || 'NormalStash',
          tabColour: item.tabColour ?? null,
          quantity: Number(item.quantity) || 1,
          price: Number(item.priceChaos) || 0,
          totalChaos: Number(item.totalChaos) || 0,
        }
      })
      const importedTabs = (synced.tabs || []).map((tab, index) => ({
        ...tab,
        id: String(tab.label || tab.name || tab.id || `Tab ${index + 1}`).trim(),
        index: Number.isInteger(tab.index) ? tab.index : index,
        label: String(tab.label || tab.name || `Tab ${index + 1}`).trim(),
        name: String(tab.name || tab.label || `Tab ${index + 1}`).trim(),
        type: tab.type || tab.kind || 'NormalStash',
        colour: tab.colour ?? tab.color ?? null,
        kind: tab.type || tab.kind || 'NormalStash',
        color: tab.colour ?? tab.color ?? null,
      }))
      if (importedTabs.length) setStashTabs(importedTabs)
      setSelectedTabs([])
      setStashItems(imported)
      writeStashCache({ ...readStashCache(), pricedItems: imported, tabs: importedTabs, syncedAt: Date.now() })
      addSnapshot(imported, importedTabs)
      setSyncedAt(Date.now())
      setNow(Date.now())
      setNotice(`Synced ${imported.length} stash items.`)
    } catch (error) {
      console.error('Could not sync PoE stash:', error?.response || error)
      setNotice(getErrorMessage(error))
    }
    finally { setSyncing(false); setSyncProgress('') }
  }

  const syncedMinutes = Math.max(0, Math.floor((now - syncedAt) / 60000))
  const syncedLabel = syncedMinutes === 0 ? 'just now' : `${syncedMinutes} minute${syncedMinutes === 1 ? '' : 's'} ago`

  return (
    <section className="mx-auto min-h-[calc(100vh-7rem)] w-full max-w-[1320px] overflow-visible border-none bg-transparent px-4 text-[#d8dadd]">
      <StashOverviewCards
        wealthHistory={wealthHistory}
        filteredTotalChaos={mode === 'snapshots' ? snapshotTotalChaos : filteredTotalChaos}
        divineToChaos={divineToChaos}
        breakdown={mode === 'snapshots' ? snapshotBreakdown : breakdown}
        breakdownMode={breakdownMode}
        setBreakdownMode={setBreakdownMode}
        snapshotMode={mode === 'snapshots'}
        snapshotInfo={snapshotInfo}
      />
      <div className="grid min-h-[calc(100vh-7rem)] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="self-start rounded-md border border-[#26383b] bg-[#121b1d] lg:sticky lg:top-16 lg:max-h-[calc(100vh-80px)] lg:overflow-y-auto">
          <div className="p-3">
            <div className="mx-1 mt-1 grid grid-cols-2 rounded border border-[#26383b] bg-[#0e1517] p-0.5">
              <button
                type="button"
                onClick={() => setMode('tabs')}
                className={`h-8 text-sm font-semibold transition ${mode === 'tabs' ? 'bg-[#1d2e31] text-[#2dd4bf]' : 'text-[#8ca3a6] hover:text-white'}`}
                aria-pressed={mode === 'tabs'}
              >
                Tabs
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('snapshots')
                  setSelectedTabs([])
                }}
                className={`h-8 text-sm font-semibold transition ${mode === 'snapshots' ? 'bg-[#1d2e31] text-[#2dd4bf]' : 'text-[#8ca3a6] hover:text-white'}`}
                aria-pressed={mode === 'snapshots'}
              >
                Snapshots
              </button>
            </div>
          </div>

          {mode === 'tabs' ? (
            <>
              <button
                type="button"
                onClick={() => { setSelectedTabs([]); setFoundItemNames(null) }}
                aria-current={selectedTabs.length === 0 ? 'page' : undefined}
                className={`group relative mx-1 mb-2 flex h-8 w-[calc(100%-0.5rem)] items-center gap-2 overflow-hidden rounded-md border px-2 text-left text-sm transition-all duration-150 ${selectedTabs.length === 0 ? 'border-amber-500 bg-[#584335] text-[#f4d0a6]' : 'border-[#393939] bg-[#2b2b2b] text-[#bcbcbc] hover:border-[rgba(234,150,74,0.85)] hover:bg-[#3a3028]'}`}
              >
                <span aria-hidden="true" className={`pointer-events-none absolute inset-0 bg-[rgba(255,225,190,0.22)] transition-opacity ${selectedTabs.length === 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                <Layers3 size={15} className="relative z-10" />
                <span className="relative z-10">All Stashes</span>
              </button>
              <nav aria-label="Stash tabs" className={`mx-1 overflow-hidden rounded-md border ${selectedTabs.length === 0 ? 'border-amber-500' : 'border-[#393939]'}`}>
                {displayTabs.map((tab) => (
                  <button
                    type="button"
                    key={tab.id}
                    onClick={() => { toggleStashTab(tab.name || tab.label || tab.id); setFoundItemNames(null) }}
                    aria-current={selectedTabs.includes(tab.name || tab.label || tab.id) ? 'page' : undefined}
                    className={`group relative flex h-8 w-full items-center gap-2 overflow-hidden border px-2 text-left transition-all duration-150 ${
                      selectedTabs.includes(tab.name || tab.label || tab.id)
                        ? 'border-[rgba(234,150,74,0.85)] bg-[#62503f] text-[#f5d2a4]'
                        : tab.kind === 'currency'
                          ? 'border-transparent bg-[#4c5a19] text-[#e2d090] hover:border-[rgba(234,150,74,0.85)] hover:bg-[#566520]'
                          : tab.kind === 'priced'
                            ? 'border-transparent bg-[#554232] text-[#e2b56c] hover:border-[rgba(234,150,74,0.85)] hover:bg-[#604b38]'
                            : 'border-transparent bg-[#4b3b30] text-[#dcb98e] hover:border-[rgba(234,150,74,0.85)] hover:bg-[#584335]'
                    }`}
                    style={stashTabStyle(tab, selectedTabs.includes(tab.name || tab.label || tab.id))}
                  >
                    <span aria-hidden="true" className={`pointer-events-none absolute inset-0 bg-[rgba(255,225,190,0.22)] transition-opacity ${selectedTabs.includes(tab.name || tab.label || tab.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                    <span className="relative z-10"><StashTabIcon tabType={tab.type} kind={tab.kind} /></span>
                    <span className="relative z-10 truncate">{tab.label || tab.name}</span>
                  </button>
                ))}
              </nav>
            </>
          ) : (<>
            <div aria-label="Saved stash snapshots" className="space-y-1 px-2">
              {snapshots.map((entry, index) => {
                const older = snapshots[index + 1]
                const delta = Number.isFinite(Number(entry.netChaos)) && entry.netChaos !== undefined
                  ? Number(entry.netChaos)
                  : Number(entry.totalChaos || 0) - Number(older?.totalChaos || entry.totalChaos || 0)
                return (
                <button
                  type="button"
                  key={entry.id}
                  onClick={() => setSelectedSnapshot(entry.id)}
                  aria-current={selectedSnapshot === entry.id ? 'page' : undefined}
                  className={`flex w-full items-center gap-2 rounded border px-2 py-2 text-left transition ${selectedSnapshot === entry.id ? 'border-[#2dd4bf] bg-[#1d2e31] text-white' : 'border-transparent text-[#a9a9a9] hover:bg-[#203034] hover:text-white'}`}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px]">{formatSnapshotTime(entry.timestamp)}</span>
                  <span className={`shrink-0 text-[11px] ${delta >= 0 ? 'text-[#4ade80]' : 'text-[#f28b82]'}`}>{formatSignedChaos(delta, divineToChaos)}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Delete snapshot"
                    onClick={(event) => { event.stopPropagation(); setSnapshots((current) => compactSnapshots(current.filter((item) => item.id !== entry.id))); if (selectedSnapshot === entry.id && older) setSelectedSnapshot(older.id) }}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setSnapshots((current) => compactSnapshots(current.filter((item) => item.id !== entry.id))) } }}
                    className="grid h-5 w-5 place-items-center text-[#718b8e] hover:text-[#f28b82]"
                  ><MoreHorizontal size={14} /></span>
                  <span className="sr-only">
                    <Clock3 size={11} /> {entry.time || new Date(entry.timestamp).toLocaleString()}
                  </span>
                </button>
                )
              })}
            </div>
            </>
          )}
        </aside>

        <div className="min-w-0 border border-[#26383b] bg-[#1a272a]">
          <div className="hidden grid grid-cols-1 gap-4 border-b border-[#393939] p-4 lg:grid-cols-2">
            <article className="min-h-[180px] rounded border border-[#3f3f3f] bg-[#292929] p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-lg text-[#d6d0c8]">Wealth</h2>
                <span className="text-2xl font-medium text-[#f0e1c8]">{formatTotal(filteredTotalChaos, divineToChaos)}</span>
              </div>
              <div className="mt-3 h-32">
                {wealthHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={wealthHistory} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#454545" strokeDasharray="2 3" vertical={false} />
                      <XAxis dataKey="timestamp" tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} tick={{ fill: '#8f8f8f', fontSize: 11 }} axisLine={{ stroke: '#555' }} tickLine={false} />
                      <YAxis tickFormatter={(value) => formatTotal(value, divineToChaos)} tick={{ fill: '#8f8f8f', fontSize: 11 }} axisLine={false} tickLine={false} width={42} />
                      <Tooltip content={<WealthTooltip divineToChaos={divineToChaos} />} cursor={{ stroke: '#aaa', strokeWidth: 1 }} />
                      <Line type="monotone" dataKey="totalChaos" stroke="#e4b76d" strokeWidth={1.5} dot={{ r: 3, fill: '#f8e3bd', stroke: '#e4b76d', strokeWidth: 1 }} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <p className="grid h-full place-items-center text-xs text-[#888]">No sync snapshots yet.</p>}
              </div>
            </article>

            <article className="min-h-[180px] rounded border border-[#3f3f3f] bg-[#292929] p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-lg text-[#d6d0c8]">Breakdown</h2>
                <div className="flex overflow-hidden rounded border border-[#444] text-[11px]">
                  <button type="button" onClick={() => setBreakdownMode('divines')} className={`px-2 py-1 ${breakdownMode === 'divines' ? 'bg-[#3d3d3d] font-semibold text-white' : 'text-[#999]'}`}>Divines</button>
                  <button type="button" onClick={() => setBreakdownMode('percentage')} className={`px-2 py-1 ${breakdownMode === 'percentage' ? 'bg-[#3d3d3d] font-semibold text-white' : 'text-[#999]'}`}>Percentage</button>
                </div>
              </div>
              <div className="mt-4 grid w-fit max-w-full grid-flow-col grid-rows-3 auto-cols-max gap-x-8 gap-y-3.5">
                {breakdown.map(({ category, totalChaos, icon }) => {
                  const value = breakdownMode === 'percentage'
                    ? `${filteredTotalChaos > 0 ? ((totalChaos / filteredTotalChaos) * 100).toFixed(1) : '0.0'}%`
                    : formatTotal(totalChaos, divineToChaos)
                  return (
                    <div key={category} className="flex min-w-0 items-center gap-2 text-xs text-[#d2d2d2]" title={`${category}: ${value}`}>
                      <CategoryIcon src={icon} label={category} className="h-[22px] w-[22px] shrink-0 object-contain" />
                      <span className="truncate">{value}</span>
                    </div>
                  )
                })}
              </div>
            </article>
          </div>
          <div className="sticky top-16 z-20 flex h-[54px] flex-nowrap items-center justify-between gap-3 border-b border-[#26383b] bg-[#1a272a] px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative block">
                <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#858585]" />
                <input
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setFoundItemNames(null) }}
                  placeholder="Search"
                  aria-label="Search stash items"
                  className="h-9 w-52 border border-[#26383b] bg-[#131d1f] pl-8 pr-3 text-[15.5px] text-[#e1e1e1] outline-none placeholder:text-[#8ca3a6] focus:border-[#2dd4bf]"
                />
              </label>
              <div ref={filtersRef} className="relative">
                <button
                  type="button"
                  onClick={() => setFiltersOpen((open) => {
                    if (open) setCategoryOpen(false)
                    return !open
                  })}
                  aria-expanded={filtersOpen}
                  className={`inline-flex h-9 items-center gap-2 border px-3 text-[15.5px] transition ${activeFilterGroupsCount > 0 ? 'border-[#2dd4bf] bg-[#14b8a6] text-[#062421] hover:bg-[#2dd4bf]' : filtersOpen ? 'border-[#2dd4bf] bg-[#203235] text-[#2dd4bf]' : 'border-[#26383b] bg-[#131d1f] text-[#c7d7d9] hover:bg-[#203034]'}`}
                >
                  <Filter size={14} /> Filters{activeFilterGroupsCount > 0 ? ` (${activeFilterGroupsCount})` : ''}
                </button>
                {filtersOpen ? (
                  <div className="absolute left-0 top-10 z-30 w-[360px] rounded border border-[#26383b] bg-[#1a272a] p-0 shadow-2xl">
                    <div className="border-b border-[#263a3d] p-4">
                      <h3 className="mb-3 text-sm font-bold text-[#d5d5d5]">Category</h3>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setCategoryOpen((open) => !open)}
                          className={`flex h-9 w-full items-center gap-2 rounded border bg-[#131d1f] px-3 text-left text-sm outline-none transition ${categoryOpen ? 'border-[#2dd4bf]' : 'border-[#26383b]'} ${filterValues.category ? 'text-[#e4e4e4]' : 'text-[#8ca3a6]'}`}
                          aria-haspopup="listbox"
                          aria-expanded={categoryOpen}
                        >
                          {filterValues.category ? (() => {
                            const selected = filterCategories.find((category) => category.label === filterValues.category)
                            return (
                              <>
                                {selected?.icon ? <CategoryIcon src={selected.icon} label={selected.label} /> : null}
                                <span className="truncate">{filterValues.category}</span>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  aria-label="Clear category"
                                  onClick={(event) => { event.stopPropagation(); setFilterValues((current) => ({ ...current, category: '' })); setCategoryOpen(false) }}
                                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setFilterValues((current) => ({ ...current, category: '' })); setCategoryOpen(false) } }}
                                  className="ml-auto px-1 text-base leading-none text-[#999] hover:text-white"
                                >×</span>
                              </>
                            )
                          })() : <span>Filter by category</span>}
                          {!filterValues.category ? <span className="ml-auto w-1" /> : null}
                        </button>
                        {categoryOpen ? (
                          <div className="absolute left-0 top-11 z-40 max-h-64 w-full overflow-y-auto rounded border border-[#26383b] bg-[#131d1f] p-1 shadow-2xl" role="listbox">
                            {filterCategories.map((category) => (
                              <button
                                key={category.id}
                                type="button"
                                role="option"
                                aria-selected={filterValues.category === category.label || (!filterValues.category && category.label === 'All Categories')}
                                onClick={() => {
                                  setFilterValues((current) => ({ ...current, category: category.label === 'All Categories' ? '' : category.label }))
                                  setCategoryOpen(false)
                                }}
                                className={`flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm transition hover:bg-[#203034] ${filterValues.category === category.label ? 'bg-[#203235] text-[#2dd4bf]' : 'text-[#d0d0d0]'}`}
                              >
                                {category.label === 'All Categories' ? null : <CategoryIcon src={category.icon} label={category.label} />}
                                <span className="min-w-0 flex-1 truncate">{category.label}</span>
                                <span className="shrink-0 text-[#c8c8c8]">{formatCardValue(category.totalChaos, divineToChaos)}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {[
                      ['Quantity Range', 'minQuantity', 'maxQuantity', false],
                      ['Item Price Range', 'minItemPrice', 'maxItemPrice', true],
                      ['Total Price Range', 'minTotalPrice', 'maxTotalPrice', true],
                    ].map(([title, minKey, maxKey, decimal]) => (
                      <div key={title} className="border-b border-[#263a3d] p-4 last:border-b-0">
                        <h3 className="mb-3 text-sm font-bold text-[#d5d5d5]">{title}</h3>
                        <div className="grid grid-cols-2 gap-3">
                          {[[minKey, 'Minimum', 'No minimum'], [maxKey, 'Maximum', 'No maximum']].map(([key, label, placeholder]) => (
                            <label key={key} className="text-xs font-semibold text-[#c8c8c8]">
                              {label}
                              <input type="number" min="0" step={decimal ? 'any' : '1'} placeholder={placeholder} value={filterValues[key]} onChange={(event) => setFilterValues((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 h-9 w-full rounded border border-[#26383b] bg-[#131d1f] px-3 text-sm font-normal text-white outline-none placeholder:text-[#8ca3a6] focus:border-[#2dd4bf]" />
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                    {activeFilterGroupsCount > 0 ? (
                      <div className="p-3">
                        <button type="button" onClick={() => setFilterValues({ category: '', minQuantity: '', maxQuantity: '', minItemPrice: '', maxItemPrice: '', minTotalPrice: '', maxTotalPrice: '' })} className="h-9 w-full rounded border border-[#d96b6b] text-sm font-semibold text-[#ff8b8b] transition hover:bg-[#4a2929]">Clear All Filters</button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {selectedItemNames.length > 0 ? (
                <span className="inline-flex h-9 items-center rounded-full border border-[#26383b] bg-[#131d1f] px-4 text-sm font-medium text-[#c7d7d9]">
                  Selected total: {formatCardValue(selectedTotalChaos, divineToChaos)}
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden text-[15.5px] text-[#939393] sm:inline">{retrySeconds > 0 ? `GGG API: thử lại sau ${retrySeconds}s` : syncing ? syncProgress : `Synced ${syncedLabel}`}</span>
              <button
                type="button"
                onClick={syncNow}
                disabled={syncing || retrySeconds > 0}
                aria-label="Refresh stash"
                title="Refresh stash"
                className="grid h-9 w-9 place-items-center border border-[#26383b] bg-[#131d1f] text-[#a9c0c3] hover:border-[#2dd4bf] hover:bg-[#203034] hover:text-white"
              >
                <RefreshCw size={17} className={syncing ? 'animate-spin' : ''} />
              </button>
              {mode !== 'snapshots' ? <div className="group relative">
                <button
                  type="button"
                  disabled={selectedItemNames.length === 0}
                  onClick={() => {
                    if (selectedItemNames.length === 0) return
                    setFoundItemNames(selectedItemNames)
                    setSearch('')
                  }}
                  className="inline-flex h-9 items-center gap-2 border border-[#26383b] bg-[#131d1f] px-3 text-sm font-medium text-[#c7d7d9] transition enabled:border-[#2dd4bf] enabled:text-[#2dd4bf] enabled:hover:bg-[#203034] disabled:cursor-not-allowed disabled:border-[#26383b] disabled:text-[#667b7e]"
                >
                  <Search size={14} /> Find
                </button>
                {selectedItemNames.length === 0 ? (
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-3 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[#f1f1f1] px-3 py-2 text-xs font-medium text-[#1d1d1d] shadow-lg group-hover:block">
                    Select items to enable to find
                    <span className="absolute left-1/2 top-full -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-[#f1f1f1]" />
                  </span>
                ) : null}
              </div> : null}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-label="Stash actions"
                  aria-expanded={menuOpen}
                className="grid h-9 w-9 place-items-center border border-[#26383b] bg-[#131d1f] text-[#a9c0c3] hover:border-[#2dd4bf] hover:bg-[#203034] hover:text-white"
                >
                  <MoreHorizontal size={19} />
                </button>
                {menuOpen ? (
                  <div className="absolute right-0 top-10 z-20 w-40 border border-[#26383b] bg-[#131d1f] py-1 shadow-xl">
                    <button type="button" onClick={() => { toggleVisible(); setMenuOpen(false) }} className="w-full px-3 py-2 text-left text-xs text-[#d5d5d5] hover:bg-[#213437]">
                      {allVisibleSelected ? 'Deselect visible' : 'Select visible'}
                    </button>
                    <button type="button" onClick={() => { setSelectedIds([]); setMenuOpen(false) }} className="w-full px-3 py-2 text-left text-xs text-[#d5d5d5] hover:bg-[#213437]">
                      Clear selection
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {foundItemNames !== null ? (
            <div className="flex items-center justify-between gap-3 border-b border-[#594932] bg-[#30291f] px-4 py-2 text-xs text-[#e6c897]">
              <span>Showing detailed tab locations for {foundItemNames.length} selected item{foundItemNames.length === 1 ? '' : 's'}</span>
              <button type="button" onClick={() => { setFoundItemNames(null); setSelectedIds([]) }} className="rounded border border-[#86683f] px-2 py-1 text-[#f0d8ae] hover:bg-[#4a3b2b]">Exit Find</button>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <div className="min-w-[850px]">
          <div className={`relative grid ${mode === 'snapshots' ? 'grid-cols-[minmax(0,1fr)_18%_18%_18%_100px]' : 'grid-cols-[36px_minmax(0,34fr)_22fr_13fr_13fr_13fr]'} border-b border-[#26383b] bg-[#162225]`}>
                {mode === 'snapshots' ? null : <div className="flex items-center justify-center">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="Select all visible stash items" className="h-4 w-4 accent-[#55a9da]" />
                </div>}
                {(mode === 'snapshots'
                  ? [['name', 'Name'], ['quantity', 'Quantity'], ['price', 'Price'], ['change', 'Change'], ['actions', 'Actions']]
                  : [['name', 'Name'], ['tab', 'Tab'], ['quantity', 'Quantity'], ['price', 'Price'], ['total', 'Total']]
                ).map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => mode === 'snapshots' ? undefined : toggleSort(key)}
                    aria-sort={mode === 'snapshots' ? 'none' : (sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none')}
                    className="flex h-9 items-center justify-between gap-2 border-l border-[#26383b] bg-[#162225] px-3 text-left text-xs font-semibold uppercase tracking-wider text-[#8ba3a7] hover:bg-[#203034] hover:text-white"
                  >
                    {label}
                    <ChevronDown size={13} className={`text-[#777] ${sort.key === key && sort.direction === 'asc' ? 'rotate-180' : ''}`} />
                  </button>
                ))}
              </div>

              {mode === 'snapshots' ? visibleTableItems.map((item) => (
                <div key={item.name} className="grid min-h-9 grid-cols-[minmax(0,1fr)_18%_18%_18%_100px] border-b border-[#243538] bg-[#1a272a] text-[14.5px] transition-colors hover:bg-[#203034]">
                  <div className="flex min-w-0 items-center gap-2 px-3">
                    <StashItemIcon item={item} icon={item.icon} />
                    <span className="truncate text-white">{item.name}</span>
                  </div>
                  <span className={`flex items-center border-l border-[#243538] px-3 tabular-nums ${item.quantity >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>{item.quantity >= 0 ? '+' : ''}{quantityFormat.format(item.quantity)}</span>
                  <span className="flex items-center border-l border-[#243538] px-3 tabular-nums text-white">{formatPrice(item.priceChaos)}</span>
                  <span className={`flex items-center border-l border-[#243538] px-3 tabular-nums ${item.totalChaos >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>{item.totalChaos >= 0 ? '+' : ''}{formatPrice(Math.abs(item.totalChaos))}</span>
                  <span className="flex items-center justify-end gap-1 border-l border-[#243538] px-2 text-[#8ca3a6]">
                    <button type="button" aria-label={`Edit ${item.name}`} className="p-1 hover:text-[#2dd4bf]"><Pencil size={13} /></button>
                    <button type="button" aria-label={`Delete ${item.name}`} className="p-1 hover:text-[#f28b82]"><Trash2 size={13} /></button>
                  </span>
                </div>
              )) : visibleTableItems.map((item) => {
                const checked = selectedIds.includes(item.id)
                const primaryLocation = item.tabLocations?.[0]
                const rowTab = findTabMeta(stashTabs, primaryLocation?.tabName || itemTabName(item, stashTabs), item.tabIndex) || tabById.get(primaryLocation?.tabName || itemTabName(item, stashTabs))
                const tabLocations = item.tabLocations || [{ tabNumber: Number(item.tabIndex) + 1, tabName: itemTabName(item, stashTabs), quantity: item.quantity }]
                const hasMultipleTabLocations = tabLocations.length >= 2
                const singleTabLocation = tabLocations[0]
                const tabLabel = tabLocations.map((location) => location.tabNumber > 0 ? location.tabNumber : location.tabName).join(', ')
                const tabCellStyle = hasMultipleTabLocations
                  ? { backgroundColor: 'transparent' }
                  : stashTabStyle({ colour: singleTabLocation?.tabColour ?? rowTab?.colour }, false)
                return (
                  <div
                    key={item.id}
                    className={`grid min-h-9 grid-cols-[36px_minmax(0,34fr)_22fr_13fr_13fr_13fr] border-b border-[#243538] bg-[#1a272a] transition-colors hover:bg-[#203034] ${checked ? 'bg-[#203235]' : ''}`}
                    style={{ contentVisibility: 'auto', containIntrinsicSize: '36px' }}
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
                    <div className="flex min-w-0 items-center gap-2 border-l border-[#243538] px-3 text-[13px]">
                      <StashItemIcon item={item} icon={item.icon || iconMap[item.id]} />
                      <span className="truncate text-[14.5px] text-white">{item.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setMode('tabs'); setSelectedTabs(tabLocations.map((location) => location.tabName)) }}
                      className="flex items-center gap-2 border-l border-[#243538] px-3 text-left text-[14.5px] text-white hover:bg-[#203034]"
                      style={tabCellStyle}
                    >
                      {!hasMultipleTabLocations ? <StashTabIcon tabType={singleTabLocation?.tabType || rowTab?.type || item.tabType} kind={rowTab?.kind} /> : null}
                      {hasMultipleTabLocations ? tabLabel : (singleTabLocation?.tabName || itemTabName(item, stashTabs) || '—')}
                    </button>
                    <span className="flex items-center border-l border-[#243538] px-3 text-[14.5px] tabular-nums text-white">
                      {quantityFormat.format(item.quantity)}
                    </span>
                    <span className="flex items-center border-l border-[#243538] px-3 text-[14.5px] tabular-nums text-white">
                      {formatPrice(item.price)}
                    </span>
                    <span className="flex items-center border-l border-[#243538] px-3 text-[14.5px] font-medium tabular-nums text-white">
                      {formatTotal(item.quantity * item.price, divineToChaos)}
                    </span>
                  </div>
                )
              })}

              {tableItems.length === 0 ? (
                <p className="px-4 py-10 text-center text-[15.5px] text-[#888]">{mode === 'snapshots' ? 'No stash change in this snapshot.' : 'No stash items match these filters.'}</p>
              ) : null}
              {tableItems.length > visibleItemLimit ? (
                <button type="button" onClick={() => setVisibleItemLimit((limit) => limit + 100)} className="w-full border-b border-[#243538] bg-[#131d1f] px-4 py-3 text-sm font-medium text-[#2dd4bf] hover:bg-[#203034]">
                  Show more ({tableItems.length - visibleItemLimit} remaining)
                </button>
              ) : null}
            </div>
          </div>

          {mode !== 'snapshots' ? <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#3b3b3b] px-4 py-3 text-xs text-[#858585]">
            <span>
              {rows.length} item{rows.length === 1 ? '' : 's'} · {selectedCount} selected · {chaosFormat.format(filteredTotalChaos)}c ({chaosFormat.format(filteredTotalChaos / (divineToChaos || 225))}d)
              {mode === 'snapshots' ? ` · ${snapshot.label}` : ''}
            </span>
            <span>Values are estimates in chaos orbs</span>
          </footer> : null}
        </div>
      </div>
      {tabEditorOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-md border border-[#4a4a4a] bg-[#252525] p-5 shadow-2xl">
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Edit synced tabs</h2><button type="button" onClick={() => setTabEditorOpen(false)}>×</button></div>
            <div className="mt-4 max-h-64 space-y-1 overflow-auto">
              {stashTabs.map((tab) => <label key={tab.id} className="flex items-center gap-3 border-b border-[#393939] px-2 py-2 text-sm" style={stashTabStyle(tab)}><input type="checkbox" checked={syncedTabIndices.includes(tab.index)} onChange={() => setSyncedTabIndices((current) => current.includes(tab.index) ? current.filter((index) => index !== tab.index) : [...current, tab.index])} className="h-4 w-4 accent-[#55a9da]" /><StashTabIcon tabType={tab.type} kind={tab.kind} /><span>{tab.label || tab.name}</span><span className="ml-auto text-xs text-[#888]">{tab.type || tab.kind}</span></label>)}
            </div>
            <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setTabEditorOpen(false)} className="px-3 py-2 text-sm text-[#aaa]">Cancel</button><button type="button" onClick={() => { localStorage.setItem('poe.syncedTabIndices', JSON.stringify(syncedTabIndices)); setTabEditorOpen(false); setNotice(`${syncedTabIndices.length} tabs selected for sync.`) }} className="bg-[#4b83a3] px-3 py-2 text-sm text-white">Save tabs</button></div>
          </div>
        </div>
      ) : null}
      {false ? (
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
