import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowDownUp,
  ChevronDown,
  CircleDollarSign,
  ExternalLink,
  Gem,
  Layers3,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
} from 'lucide-react'
import { MARKET_CATEGORIES, MARKET_CATEGORY_GROUPS } from '../data/marketCategories'
import { MARKET_CATEGORY_ICONS } from '../data/marketCategoryIcons'

const PAGE_SIZE = 30
const CATEGORY_CACHE_MS = 5 * 60 * 1000
const CURRENCY_ICON_CACHE_KEY = 'poestash.currency-icons.v1'
const CURRENCY_ICON_API_URL = 'https://poe.ninja/api/data/currencyoverview?league=Standard&type=Currency'
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const VARIANT_PREFIX_PATTERN = /^(Uber Blighted|Foulborn|Foil|Relic|Replica|Synthesised|Blighted)\s+/i

let currencyIconMapPromise

function getVariantPrefix(name) {
  return name.match(VARIANT_PREFIX_PATTERN)?.[1] || ''
}

function getFallbackWikiTitle(name) {
  return name.replace(VARIANT_PREFIX_PATTERN, '').trim() || name
}

function wikiPageUrl(title) {
  return `https://www.poewiki.net/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`
}

function normalizeIconUrl(icon) {
  if (typeof icon !== 'string' || !icon.trim()) return null
  try {
    const url = new URL(icon, 'https://web.poecdn.com')
    if (url.hostname === 'poe.ninja' && url.pathname.startsWith('/gen/image/')) {
      url.hostname = 'web.poecdn.com'
    }
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function createIconMap(entries) {
  if (!Array.isArray(entries)) return {}
  const icons = Object.create(null)
  for (const entry of entries) {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
    const icon = normalizeIconUrl(entry?.icon)
    if (name && icon) icons[name] = icon
  }
  return icons
}

function getCachedCurrencyIconMap() {
  try {
    const stored = localStorage.getItem(CURRENCY_ICON_CACHE_KEY)
    if (!stored) return null
    const icons = JSON.parse(stored)
    if (!icons || typeof icons !== 'object' || Array.isArray(icons)) return null
    const validIcons = Object.create(null)
    for (const [name, icon] of Object.entries(icons)) {
      const url = normalizeIconUrl(icon)
      if (name.trim() && url) validIcons[name] = url
    }
    return Object.keys(validIcons).length ? validIcons : null
  } catch (error) {
    console.warn('Could not read the cached poe.ninja currency icons:', error)
    return null
  }
}

function cacheCurrencyIconMap(icons) {
  try {
    localStorage.setItem(CURRENCY_ICON_CACHE_KEY, JSON.stringify(icons))
  } catch (error) {
    console.warn('Could not cache the poe.ninja currency icons:', error)
  }
}

async function fetchCurrencyIconMap() {
  let sourceError
  try {
    const response = await fetch(CURRENCY_ICON_API_URL)
    if (!response.ok) throw new Error(`poe.ninja icon API returned HTTP ${response.status}.`)
    const data = await response.json()
    const icons = createIconMap(data.currencyDetails)
    if (Object.keys(icons).length === 0) {
      throw new Error('poe.ninja icon API did not return currencyDetails icons.')
    }
    cacheCurrencyIconMap(icons)
    return icons
  } catch (error) {
    sourceError = error
  }

  try {
    const response = await fetch('/api/market/category?league=Standard&category=currency')
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.details || data.error || `Market API returned HTTP ${response.status}.`)
    }
    const icons = createIconMap(data.items)
    if (Object.keys(icons).length === 0) {
      throw new Error('The market API did not return currency item icons.')
    }
    cacheCurrencyIconMap(icons)
    return icons
  } catch (fallbackError) {
    throw new Error(
      `Could not load poe.ninja currency icons. ${sourceError.message} ${fallbackError.message}`,
    )
  }
}

function getCurrencyIconMap() {
  if (!currencyIconMapPromise) {
    currencyIconMapPromise = Promise.resolve().then(() => {
      const cached = getCachedCurrencyIconMap()
      return cached || fetchCurrencyIconMap()
    })
  }
  return currencyIconMapPromise
}

function ItemIcon({ item, iconUrl, small = false }) {
  const [failed, setFailed] = useState(false)
  const size = small ? 'h-4 w-4' : 'h-8 w-8'
  const icon = iconUrl || item.icon

  useEffect(() => setFailed(false), [icon])

  if (icon && !failed) {
    return (
      <img
        src={icon}
        alt=""
        loading="lazy"
        className={`${size} shrink-0 object-contain`}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <span className={`${size} grid shrink-0 place-items-center rounded-md bg-[#26343b] text-[10px] font-semibold text-[#9fb4ba]`}>
      {item.name?.slice(0, 1) || '?'}
    </span>
  )
}

function Sparkline({ values, change }) {
  const points = (Array.isArray(values) ? values : []).filter(Number.isFinite)
  if (points.length < 2) {
    return <span className="inline-block w-[72px] text-center text-xs text-[#667780]">—</span>
  }

  const low = Math.min(...points)
  const range = Math.max(...points) - low || 1
  const line = points.map((value, index) => {
    const x = (index / (points.length - 1)) * 72
    const y = 22 - ((value - low) / range) * 18
    return `${x},${y}`
  }).join(' ')
  const color = change < 0 ? '#e87952' : '#00c997'

  return (
    <svg viewBox="0 0 72 24" className="h-6 w-[72px] shrink-0" role="img" aria-label="Price trend">
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function CategoryIcon({ category }) {
  const [failed, setFailed] = useState(false)
  const image = MARKET_CATEGORY_ICONS[category.id]

  useEffect(() => setFailed(false), [image])
  if (image && !failed) {
    return (
      <img
        src={image}
        alt=""
        loading="lazy"
        className="h-4 w-4 shrink-0 object-contain"
        onError={() => setFailed(true)}
      />
    )
  }

  const { label } = category
  const Icon = label.includes('Unique') || label.includes('Skill')
    ? Gem
    : label.includes('Card') || label.includes('Fragment') || label.includes('Scarab')
      ? Layers3
      : label.includes('Currency')
        ? CircleDollarSign
        : label.includes('Map')
          ? Shield
          : Sparkles
  return <Icon size={16} strokeWidth={1.7} />
}

function ValueCell({ item, display, divineToChaos, currencyIcons }) {
  const showDivine = display === 'Divine'
    || (display === 'Adaptive' && divineToChaos > 0 && item.priceChaos >= divineToChaos)
  const value = showDivine ? item.priceDivine : item.priceChaos
  const unit = showDivine ? 'divine' : 'chaos'
  const otherValue = showDivine ? item.priceChaos : item.priceDivine
  const otherUnit = showDivine ? 'chaos' : 'divine'
  const icon = currencyIcons[unit]

  return (
    <div className="flex min-w-0 items-center justify-end gap-2">
      {icon ? <ItemIcon item={icon} small /> : null}
      <span className="font-mono text-sm font-semibold tabular-nums text-[#e4edf0]">
        {number.format(value)}
      </span>
      <span className="text-[11px] text-[#95a4aa]">{showDivine ? 'div' : 'chaos'}</span>
      <span className="hidden text-[11px] text-[#718087] xl:inline">
        ≈ {number.format(otherValue)} {otherUnit === 'divine' ? 'div' : 'c'}
      </span>
    </div>
  )
}

function PopularCell({ item, currencyIcons }) {
  const currencyName = item.maxVolumeCurrency === 'divine' ? 'divine' : 'chaos'
  const icon = currencyIcons[currencyName]
  if (!Number.isFinite(item.maxVolumeRate)) return <span className="text-xs text-[#697980]">—</span>

  return (
    <span className="flex items-center justify-end gap-1.5 font-mono text-xs tabular-nums text-[#c2cdd0]">
      {number.format(item.maxVolumeRate)}
      {icon ? <ItemIcon item={icon} small /> : <span>{currencyName === 'divine' ? 'div' : 'c'}</span>}
      <ArrowDownUp size={12} className="text-[#00c997]" />
    </span>
  )
}

function TooltipImage({ item, fallbackIcon }) {
  const [failedPrimary, setFailedPrimary] = useState(false)
  const [failedFallback, setFailedFallback] = useState(false)
  const primaryIcon = item.iconUrl || fallbackIcon
  const icon = failedPrimary ? (failedFallback ? null : fallbackIcon) : primaryIcon

  useEffect(() => {
    setFailedPrimary(false)
    setFailedFallback(false)
  }, [primaryIcon, fallbackIcon])

  return icon ? (
    <img
      src={icon}
      alt=""
      className="mx-auto mt-3 max-h-20 max-w-24 object-contain"
      onError={() => {
        if (!failedPrimary) setFailedPrimary(true)
        else setFailedFallback(true)
      }}
    />
  ) : (
    <span className="mx-auto mt-3 grid h-12 w-12 place-items-center rounded border border-white/10 bg-white/5 text-lg text-white/70">
      {item.name.slice(0, 1)}
    </span>
  )
}

function WikiItemTooltip({ item, fallbackIcon }) {
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [position, setPosition] = useState(null)
  const triggerRef = useRef(null)
  const wikiButtonRef = useRef(null)
  const panelRef = useRef(null)
  const requestRef = useRef(null)
  const closeTimerRef = useRef(null)
  const tooltipId = `market-item-tooltip-${item.id.replace(/[^a-z0-9_-]/gi, '-')}`
  const inferredUnique = item.category.toLowerCase().startsWith('unique')
  const variantPrefix = getVariantPrefix(item.name)
  const variantLabels = String(item.variant || '').split(',').map((label) => label.trim()).filter(Boolean)
  const unique = (details?.rarity || (inferredUnique ? 'Unique' : '')) === 'Unique'
  const colors = unique
    ? {
      background: '#0C0B0A',
      border: '#AF6025',
      header: '#26170C',
      title: '#AF6025',
      stats: '#C27A43',
      flavour: '#C27A43',
    }
    : {
      background: '#0E0E0E',
      border: '#6E6E6E',
      header: '#262626',
      title: '#E5E5E5',
      stats: '#8888FF',
      flavour: '#D0D0D0',
    }

  function updatePosition() {
    const wikiRect = wikiButtonRef.current?.getBoundingClientRect()
    const rect = wikiRect?.width
      ? wikiRect
      : triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const margin = 12
    const gap = 12
    const maxWidth = Math.max(0, Math.min(460, window.innerWidth - margin * 2))
    const rightSpace = window.innerWidth - rect.right - gap - margin
    const leftSpace = rect.left - gap - margin
    const placeRight = rightSpace >= maxWidth || rightSpace >= leftSpace
    const availableWidth = Math.max(0, placeRight ? rightSpace : leftSpace)
    const width = Math.min(maxWidth, availableWidth)
    const maxHeight = Math.max(0, window.innerHeight - margin * 2)
    const panelHeight = panelRef.current?.getBoundingClientRect().height
      || Math.min(460, maxHeight)
    const height = Math.min(panelHeight, maxHeight)
    const top = Math.max(margin, Math.min(rect.top, window.innerHeight - margin - height))
    const left = placeRight ? rect.right + gap : rect.left - gap - width
    setPosition({
      left: Math.max(margin, Math.min(left, window.innerWidth - margin - width)),
      top,
      width,
      maxWidth,
      maxHeight,
    })
  }

  function cancelClose() {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  function closeLater() {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120)
  }

  function loadDetails(show) {
    cancelClose()
    if (show) {
      updatePosition()
      setOpen(true)
    }
    if (details || requestRef.current) return

    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError('')
    const params = new URLSearchParams({
      name: item.name,
      baseType: item.baseType || '',
      variant: item.variant || '',
    })
    fetch(`/api/wiki/item?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.details || result.error || `PoE Wiki returned HTTP ${response.status}.`)
        }
        return result
      })
      .then(setDetails)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message || 'PoE Wiki details are unavailable.')
      })
      .finally(() => {
        if (requestRef.current === controller) requestRef.current = null
        if (!controller.signal.aborted) setLoading(false)
      })
  }

  function showTooltip() {
    loadDetails(true)
  }

  useEffect(() => () => {
    requestRef.current?.abort()
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const reposition = () => updatePosition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (open) updatePosition()
  }, [open, details, loading, error])

  function renderGroup(title, values, className) {
    if (!values?.length) return null
    return (
      <section className="px-4 py-2">
        <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/45">{title}</p>
        <div className={`space-y-1 text-[12px] leading-relaxed ${className}`}>
          {values.map((line, index) => <p key={`${title}-${index}`}>{line}</p>)}
        </div>
      </section>
    )
  }

  const panel = open && position ? createPortal(
    <div
      ref={panelRef}
      id={tooltipId}
      role="tooltip"
      onMouseEnter={cancelClose}
      onMouseLeave={closeLater}
      className="fixed z-[100] overflow-y-auto rounded border shadow-2xl"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxWidth: position.maxWidth,
        maxHeight: position.maxHeight,
        backgroundColor: colors.background,
        borderColor: colors.border,
        boxShadow: `0 14px 36px rgba(0,0,0,.7), 0 0 0 1px ${colors.border}22`,
      }}
    >
      <header
        className="border-b px-4 py-3 text-center"
        style={{ backgroundColor: colors.header, borderColor: `${colors.border}88` }}
      >
        <a
          href={wikiPageUrl(details?.matchedWikiTitle || getFallbackWikiTitle(item.name))}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-semibold hover:underline"
          style={{ color: colors.title }}
        >
          {item.name}
        </a>
        <p className="mt-1 text-[10px] text-white/55">
          {[details?.rarity || (inferredUnique ? 'Unique' : item.category), details?.baseItem || details?.itemClass]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {variantPrefix || variantLabels.length ? (
          <div className="mt-2 flex flex-wrap justify-center gap-1">
            {variantPrefix ? (
              <span className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] text-white/80">
                {variantPrefix}
              </span>
            ) : null}
            {variantLabels.map((label) => (
              <span key={label} className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/70">
                {label}
              </span>
            ))}
          </div>
        ) : null}
        {details?.isFallbackMatch ? (
          <p className="mt-2 text-[10px] text-white/45">Wiki match: {details.matchedWikiTitle}</p>
        ) : null}
      </header>

      {details ? (
        <div className="divide-y divide-white/10 text-center">
          {renderGroup('Item properties', details.basicStats, 'text-white/75')}
          {renderGroup('Requirements', details.requirements, 'text-white/70')}
          {renderGroup('Implicit modifiers', details.implicitStats, unique ? 'text-[#C27A43]' : 'text-[#8888FF]')}
          {renderGroup('Explicit modifiers', details.explicitStats, unique ? 'text-[#C27A43]' : 'text-[#8888FF]')}
          {renderGroup('Enchantments', details.enchantmentStats, unique ? 'text-[#C27A43]' : 'text-[#8888FF]')}
          {renderGroup('Foulborn modifiers', details.variantInfo, unique ? 'text-[#C27A43]' : 'text-[#8888FF]')}
          {renderGroup('Flavour', details.flavourText, unique ? 'italic text-[#C27A43]' : 'italic text-[#D0D0D0]')}
          {renderGroup('Use', details.helpText, 'text-[#9E9E9E]')}
        </div>
      ) : (
        <div className="px-4 py-3 text-center text-[11px] leading-relaxed text-white/65">
          <p>{item.category} · {number.format(item.priceChaos)} chaos</p>
          <p role={loading ? 'status' : 'note'} className="mt-1 text-white/45">
            {loading ? 'Loading PoE Wiki details…' : error ? 'Wiki details unavailable; showing poe.ninja data.' : 'Showing poe.ninja data.'}
          </p>
        </div>
      )}
      <div className="border-t border-white/10 px-4 pb-3 text-center">
        <TooltipImage item={details || item} fallbackIcon={fallbackIcon} />
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center">
        <a
          ref={triggerRef}
          href={wikiPageUrl(details?.matchedWikiTitle || getFallbackWikiTitle(item.name))}
          target="_blank"
          rel="noreferrer"
          onMouseEnter={showTooltip}
          onMouseLeave={closeLater}
          onFocus={showTooltip}
          onBlur={closeLater}
          aria-describedby={open ? tooltipId : undefined}
          className="group min-w-0 flex-1 truncate text-[12px] text-[#d4e0e3]"
        >
          <span className="text-[#edf3f4] decoration-[#9cacb1]/60 underline-offset-2 group-hover:underline">
            {item.name}
          </span>
          {item.links >= 5 ? <span>, {item.links}L</span> : null}
          {item.variant ? <span>, {item.variant}</span> : null}
          {item.baseType ? <span className="text-[#9baab0]">, {item.baseType}</span> : null}
        </a>
        <a
          href={wikiPageUrl(details?.matchedWikiTitle || getFallbackWikiTitle(item.name))}
          target="_blank"
          rel="noreferrer"
          ref={wikiButtonRef}
          aria-label={`Open ${details?.matchedWikiTitle || item.name} wiki`}
          onMouseEnter={showTooltip}
          onMouseLeave={closeLater}
          onFocus={showTooltip}
          onBlur={closeLater}
          className="ml-auto hidden shrink-0 items-center gap-1 rounded bg-[#27343b] px-1.5 py-0.5 text-[9px] text-[#9cacb1] hover:text-white sm:inline-flex"
        >
          WIKI <ExternalLink size={9} />
        </a>
      </div>
      {panel}
    </>
  )
}

export default function MarketView({ query, selectedLeague, onLeagueChange, onNavigate }) {
  const [leagues, setLeagues] = useState([])
  const [league, setLeague] = useState(selectedLeague || '')
  const [market, setMarket] = useState(null)
  const [selectedCategory, setSelectedCategory] = useState('currency')
  const [filterText, setFilterText] = useState('')
  const [valueDisplay, setValueDisplay] = useState('Adaptive')
  const [sort, setSort] = useState({ key: 'priceChaos', direction: 'desc' })
  const [loading, setLoading] = useState(true)
  const [loadingLeagues, setLoadingLeagues] = useState(true)
  const [error, setError] = useState('')
  const [currencyIconMap, setCurrencyIconMap] = useState({})
  const [currencyIconError, setCurrencyIconError] = useState('')
  const [refreshSequence, setRefreshSequence] = useState(0)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const lastRefreshSequence = useRef(0)
  const categoryCache = useRef(new Map())

  useEffect(() => {
    let active = true
    getCurrencyIconMap()
      .then((icons) => {
        if (active) setCurrencyIconMap(icons)
      })
      .catch((iconError) => {
        console.error('Could not load poe.ninja currency icons:', iconError)
        if (active) setCurrencyIconError(iconError.message || 'Currency icons are unavailable.')
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/market/leagues', { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.details || result.error || `Market API returned HTTP ${response.status}.`)
        }
        return result
      })
      .then((result) => {
        setLeagues(result.leagues)
        const initialLeague = selectedLeague || result.defaultLeague
        setLeague(initialLeague)
        onLeagueChange(initialLeague)
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message || 'Could not load PoE 1 leagues.')
          setLoading(false)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingLeagues(false)
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (selectedLeague && selectedLeague !== league) setLeague(selectedLeague)
  }, [selectedLeague])

  useEffect(() => {
    const category = MARKET_CATEGORIES.find((entry) => entry.id === selectedCategory) || MARKET_CATEGORIES[0]
    if (!league || !category) return undefined

    const controller = new AbortController()
    const refresh = refreshSequence !== lastRefreshSequence.current
    lastRefreshSequence.current = refreshSequence
    const cacheKey = `${league}:${category.id}`
    const cached = refresh ? null : categoryCache.current.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      setMarket(cached.data)
      setLoading(false)
      setError('')
      return () => controller.abort()
    }
    categoryCache.current.delete(cacheKey)

    setLoading(true)
    setError('')
    const refreshParam = refresh ? '&refresh=1' : ''

    fetch(`/api/market/category?league=${encodeURIComponent(league)}&category=${encodeURIComponent(category.id)}${refreshParam}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.details || result.error || `Market API returned HTTP ${response.status}.`)
        }
        return result
      })
      .then((result) => {
        categoryCache.current.set(cacheKey, {
          data: result,
          expiresAt: Date.now() + CATEGORY_CACHE_MS,
        })
        setMarket(result)
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setMarket(null)
          setError(requestError.message || 'Could not load market data.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [league, refreshSequence, selectedCategory])

  const category = MARKET_CATEGORIES.find((entry) => entry.id === selectedCategory) || MARKET_CATEGORIES[0]
  const currencyIcons = market?.currencyIcons || {}
  const rows = useMemo(() => {
    const needle = `${query} ${filterText}`.trim().toLowerCase()
    const filtered = (market?.categoryId === category?.id ? market.items : []).filter((item) => !needle
      || item.name.toLowerCase().includes(needle)
      || item.category.toLowerCase().includes(needle))
    return [...filtered].sort((left, right) => {
      const direction = sort.direction === 'asc' ? 1 : -1
      const leftValue = left[sort.key]
      const rightValue = right[sort.key]
      if (typeof leftValue === 'string') return leftValue.localeCompare(rightValue || '') * direction
      return ((leftValue ?? -Infinity) - (rightValue ?? -Infinity)) * direction
    })
  }, [category, filterText, market, query, sort])
  const visibleRows = rows.slice(0, visibleCount)

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [league, selectedCategory, filterText, query, sort, refreshSequence])

  function sortBy(key) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }))
  }

  function refreshMarket() {
    categoryCache.current.clear()
    setRefreshSequence((value) => value + 1)
  }

  const sortHeader = (label, key, align = 'right') => (
    <button
      type="button"
      onClick={() => sortBy(key)}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#9baab0] hover:text-white ${
        align === 'left' ? 'justify-start' : 'w-full justify-end'
      }`}
    >
      {label}
      {sort.key === key ? <span className="text-[#00c997]">{sort.direction === 'asc' ? '↑' : '↓'}</span> : null}
    </button>
  )

  return (
    <section className="-mx-3 -mt-2 overflow-hidden rounded-lg border border-[#354149] bg-[#182229] text-[#dbe3e5] shadow-xl">
      <div className="grid gap-2 border-b border-[#36434b] bg-[#202b32] p-3 sm:grid-cols-[minmax(0,1fr)_250px]">
        <label className="relative block">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#819198]" />
          <input
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="Search by item..."
            aria-label="Search market items"
            className="h-11 w-full border border-[#43515a] bg-[#11191f] pl-9 pr-3 text-sm text-[#e0e8ea] outline-none placeholder:text-[#77868d] focus:border-[#00b98d]"
          />
        </label>
        <label className="relative block">
          <span className="absolute left-3 top-1.5 text-[10px] text-[#9ba8ad]">League</span>
          <select
            value={league}
            onChange={(event) => {
              setLeague(event.target.value)
              onLeagueChange(event.target.value)
            }}
            disabled={loadingLeagues || leagues.length === 0}
            className="h-11 w-full appearance-none border border-[#43515a] bg-[#11191f] px-3 pb-0 pt-3 text-sm text-[#e0e8ea] outline-none focus:border-[#00b98d] disabled:opacity-50"
          >
            {league && !leagues.some((item) => item.id === league) ? (
              <option value={league}>{league}</option>
            ) : null}
            {leagues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#9ba8ad]" />
        </label>
      </div>

      <div className="grid min-h-[620px] md:grid-cols-[168px_minmax(0,1fr)]">
        <aside className="border-b border-[#354149] bg-[#121b21] md:sticky md:top-16 md:max-h-[calc(100vh-5rem)] md:self-start md:overflow-y-auto md:border-b-0 md:border-r">
          <nav aria-label="Economy categories" className="space-y-0.5 pb-3">
            {MARKET_CATEGORY_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="px-4 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-widest text-[#7d8c92]">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.categories.map((entry) => {
                    const active = entry.id === category?.id
                    const itemCount = market?.categoryId === entry.id ? market.items.length : null
                    return (
                      <button
                        type="button"
                        key={entry.id}
                        onClick={() => setSelectedCategory(entry.id)}
                        aria-current={active ? 'page' : undefined}
                        className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12px] transition ${
                          active
                            ? 'bg-[#25343a] font-semibold text-[#00d0a0]'
                            : 'text-[#c4cdd0] hover:bg-[#1c292f] hover:text-white'
                        }`}
                      >
                        <CategoryIcon category={entry} />
                        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                        {itemCount != null ? <span className="text-[10px] text-[#718087]">{itemCount}</span> : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
          <p className="border-t border-[#29363d] px-4 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-widest text-[#7d8c92]">
            Source
          </p>
          <p className="px-4 pb-4 text-[11px] leading-relaxed text-[#7e8d93]">
            poe.ninja economy
            <br />
            Cached for 5 minutes
          </p>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#354149] px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-[#9baab0]">
              <span>Economy</span>
              <span className="text-[#5d6b72]">›</span>
              <span className="text-[#9baab0]">{category?.group || 'Economy'}</span>
              <span className="text-[#5d6b72]">›</span>
              <span className="text-[#d7e0e2]">{category?.label || 'Currency'}</span>
            </div>
            <div className="inline-flex overflow-hidden rounded border border-[#3b4951] bg-[#131c22]">
              <span className="bg-[#314149] px-4 py-1.5 text-xs font-medium text-white">Exchange</span>
              <button
                type="button"
                onClick={() => onNavigate('stash')}
                className="border-l border-[#3b4951] px-4 py-1.5 text-xs text-[#c4cdd0] hover:bg-[#26353c]"
              >
                Stash
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-3 pt-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-[#edf2f3]">{category?.label || 'Currency'}</h1>
              <p className="mt-1 text-xs text-[#89989e]">
                {market?.league || league || 'Loading league'} · {rows.length.toLocaleString('en-US')} items
                {market ? ` · 1 Divine = ${number.format(market.divineToChaos)} Chaos` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[10px] text-[#92a0a5]">
                Filter by name
                <span className="relative mt-1 block">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#788890]" />
                  <input
                    value={filterText}
                    onChange={(event) => setFilterText(event.target.value)}
                    placeholder="Filter items"
                    className="h-8 w-48 border border-[#3b4951] bg-[#11191f] pl-8 pr-2 text-xs text-white outline-none focus:border-[#00b98d]"
                  />
                </span>
              </label>
              <label className="text-[10px] text-[#92a0a5]">
                Value display
                <span className="relative mt-1 block">
                  <select
                    value={valueDisplay}
                    onChange={(event) => setValueDisplay(event.target.value)}
                    className="h-8 w-36 appearance-none border border-[#3b4951] bg-[#11191f] pl-2 pr-7 text-xs text-white outline-none focus:border-[#00b98d]"
                  >
                    <option>Adaptive</option>
                    <option>Chaos</option>
                    <option>Divine</option>
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#85949a]" />
                </span>
              </label>
              <button
                type="button"
                onClick={refreshMarket}
                disabled={!league || loading || loadingLeagues}
                aria-label="Refresh market prices"
                title="Refresh prices"
                className="grid h-8 w-8 place-items-center border border-[#3b4951] bg-[#11191f] text-[#aebbc0] hover:border-[#00b98d] hover:text-white disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {error ? (
            <div role="alert" className="mx-4 mb-3 border border-[#793f36] bg-[#3a2522] px-3 py-2 text-sm text-[#ff9b83]">
              {error}
            </div>
          ) : null}
          {loading ? (
            <div role="status" className="mx-4 mb-4 border border-[#354149] bg-[#141e24] px-3 py-6 text-sm text-[#9baab0]">
              Loading {category?.label || 'market'} prices for {league || 'league'}…
            </div>
          ) : null}

          {!loading && !error && market?.categoryId === category?.id ? (
            <>
              {currencyIconError ? (
                <p role="status" className="mx-4 mb-2 text-xs text-[#9baab0]">
                  Additional icon mapping is unavailable; using item icons or initials where possible.
                </p>
              ) : null}
              <div className="overflow-x-auto px-4 pb-4">
                <div className="min-w-[790px]">
                  <div className="grid grid-cols-[minmax(210px,1.8fr)_minmax(145px,1fr)_minmax(145px,1fr)_minmax(105px,.8fr)_minmax(120px,.9fr)] items-end gap-3 border-b border-[#425058] px-2 py-2">
                    {sortHeader('Name', 'name', 'left')}
                    {sortHeader('Value', 'priceChaos')}
                    {sortHeader('Last 7 days', 'change')}
                    {sortHeader('Volume / hour', 'volumePerHour')}
                    {sortHeader('Most popular', 'maxVolumeRate')}
                  </div>
                  {visibleRows.map((item) => (
                    <div
                      key={item.id}
                      className="grid min-h-[46px] grid-cols-[minmax(210px,1.8fr)_minmax(145px,1fr)_minmax(145px,1fr)_minmax(105px,.8fr)_minmax(120px,.9fr)] items-center gap-3 border-b border-[#2b383f] px-2 py-1.5 transition hover:bg-[#202d33]"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <ItemIcon item={item} iconUrl={currencyIconMap[item.name]} />
                        <WikiItemTooltip
                          item={item}
                          fallbackIcon={currencyIconMap[item.name] || item.icon}
                        />
                      </div>
                      <ValueCell
                        item={item}
                        display={valueDisplay}
                        divineToChaos={market.divineToChaos}
                        currencyIcons={currencyIcons}
                      />
                      <div className="flex items-center justify-end gap-2">
                        <Sparkline values={item.sparkline} change={item.change} />
                        <span className={`min-w-12 text-right font-mono text-[11px] tabular-nums ${
                          item.change > 0 ? 'text-[#00d0a0]' : item.change < 0 ? 'text-[#e77c58]' : 'text-[#8b9a9f]'
                        }`}>
                          {item.change == null ? '—' : `${item.change > 0 ? '+' : ''}${number.format(item.change)}%`}
                        </span>
                      </div>
                      <span className="text-right font-mono text-xs tabular-nums text-[#c4d0d3]">
                        {Number.isFinite(item.volumePerHour) ? compact.format(item.volumePerHour) : '—'}
                      </span>
                      <PopularCell item={item} currencyIcons={currencyIcons} />
                    </div>
                  ))}
                </div>
              </div>
              {visibleCount < rows.length ? (
                <div className="px-4 pb-4 text-center">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                    className="border border-[#3b4951] bg-[#202c32] px-4 py-2 text-xs text-[#d3dcde] hover:border-[#00b98d]"
                  >
                    Show more
                  </button>
                </div>
              ) : null}
              {rows.length === 0 ? (
                <p className="mx-4 mb-4 border border-[#354149] px-4 py-6 text-sm text-[#9baab0]">
                  {filterText || query
                    ? 'No items match this filter.'
                    : `No market data is available for ${category?.label || 'this category'} in ${league}.`}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  )
}
