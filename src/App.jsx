import { useEffect, useState } from 'react'
import Topbar from './components/Topbar'
import WealthChartCard from './components/WealthChartCard'
import GoalCard from './components/GoalCard'
import MethodGrid from './components/MethodGrid'
import AccountSettingsModal from './components/AccountSettingsModal'
import { BuildView, MarketView, StashView } from './components/SectionViews'
import { CONTEXTS, createSnapshot, refreshSnapshot, totalOf } from './data/mock'

export default function App() {
  const [nav, setNav] = useState('home')
  const [query, setQuery] = useState('')
  const [contextId, setContextId] = useState('covens')
  const [goalTab, setGoalTab] = useState('goal')
  const [syncedAt, setSyncedAt] = useState(() => Date.now() - 12 * 60 * 1000)
  const [now, setNow] = useState(() => Date.now())
  const [syncing, setSyncing] = useState(false)
  const [snapshot, setSnapshot] = useState(createSnapshot)
  const [marketRate, setMarketRate] = useState(null)
  const [marketRateError, setMarketRateError] = useState('')
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false)
  const [accountName, setAccountName] = useState('')
  const [selectedCharacter, setSelectedCharacter] = useState(null)
  const [selectedLeague, setSelectedLeague] = useState('')

  const context = CONTEXTS.find((item) => item.id === contextId) ?? CONTEXTS[2]
  const total = totalOf(snapshot) * context.factor
  const sessionGain = snapshot.sessionGain * context.factor
  const perHour = sessionGain / (snapshot.sessionMs / 3_600_000)
  const series = snapshot.series.map((point) => ({
    ...point,
    value: Math.round(point.value * context.factor * 10) / 10,
  }))

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/account/config', { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || `Account API returned HTTP ${response.status}.`)
        }
        return result
      })
      .then((config) => setAccountName(config.accountName || ''))
      .catch((error) => {
        if (error.name !== 'AbortError') {
          console.error('Could not load local account configuration:', error)
        }
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function loadMarketRate() {
      const leaguesResponse = await fetch('/api/market/leagues', { signal: controller.signal })
      const leaguesResult = await leaguesResponse.json()
      if (!leaguesResponse.ok) {
        throw new Error(leaguesResult.details || leaguesResult.error || `Market API returned HTTP ${leaguesResponse.status}.`)
      }

      const league = leaguesResult.defaultLeague
      if (typeof league !== 'string' || !league) {
        throw new Error('poe.ninja did not provide an active PoE 1 league.')
      }

      const marketResponse = await fetch(`/api/market/rate?league=${encodeURIComponent(league)}`, {
        signal: controller.signal,
      })
      const marketResult = await marketResponse.json()
      if (!marketResponse.ok) {
        throw new Error(marketResult.details || marketResult.error || `Market API returned HTTP ${marketResponse.status}.`)
      }
      if (!Number.isFinite(marketResult.divineToChaos) || marketResult.divineToChaos <= 0) {
        throw new Error('poe.ninja did not provide a valid Divine Orb rate.')
      }

      setMarketRate({ divineToChaos: marketResult.divineToChaos, league: marketResult.league })
      setMarketRateError('')
    }

    loadMarketRate().catch((error) => {
      if (error.name !== 'AbortError') {
        setMarketRate(null)
        setMarketRateError(error.message || 'Could not load the poe.ninja Divine Orb rate.')
      }
    })

    return () => controller.abort()
  }, [])

  function syncNow() {
    if (syncing) return
    setSyncing(true)
    window.setTimeout(() => {
      setSnapshot((prev) => refreshSnapshot(prev))
      const stamp = Date.now()
      setSyncedAt(stamp)
      setNow(stamp)
      setSyncing(false)
    }, 700)
  }

  return (
    <div className="relative min-h-screen bg-transparent text-[var(--text)]">
        <Topbar
          active={nav}
          contextId={contextId}
          onContext={setContextId}
          onNavigate={setNav}
          accountName={accountName}
          selectedCharacter={selectedCharacter}
          onOpenAccount={() => setAccountSettingsOpen(true)}
        />
        <main className="mx-auto min-w-0 w-full max-w-[1600px] px-4 pb-10 pt-20 sm:px-6 lg:px-8">
          {nav === 'home' ? (
            <>
              <header className="mb-5">
                <h1 className="text-[28px] font-semibold tracking-tight">Welcome back, JambeDeBwa</h1>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Everything below is priced in {context.priceLabel}.
                </p>
              </header>
              <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                <WealthChartCard
                  series={series}
                  total={total}
                  sessionGain={sessionGain}
                  sessionMs={snapshot.sessionMs}
                  tabsTracked={snapshot.tabsTracked}
                  syncedAt={syncedAt}
                  now={now}
                  divineToChaos={marketRate?.divineToChaos}
                  league={marketRate?.league}
                  rateError={marketRateError}
                  syncing={syncing}
                  onSync={syncNow}
                  onOpenStash={() => setNav('stash')}
                />
                <GoalCard
                  wealth={total}
                  perHour={perHour}
                  target={context.target}
                  tab={goalTab}
                  onTab={setGoalTab}
                />
              </div>
              <div className="mt-5">
                <MethodGrid query={query} factor={context.factor} />
              </div>
            </>
          ) : null}
          {nav === 'stash' ? (
            <StashView
              query={query}
              league={marketRate?.league}
              divineToChaos={marketRate?.divineToChaos}
            />
          ) : null}
          {nav === 'market' ? (
            <div className="mx-auto w-full max-w-[1320px] px-4">
              <MarketView
                query={query}
                selectedLeague={selectedLeague}
                onLeagueChange={setSelectedLeague}
                onClearQuery={() => setQuery('')}
                onNavigate={setNav}
              />
            </div>
          ) : null}
          {nav === 'build' ? <BuildView query={query} /> : null}
        </main>
      <AccountSettingsModal
        open={accountSettingsOpen}
        onClose={() => setAccountSettingsOpen(false)}
        onAccountName={setAccountName}
        onAccountSaved={(name) => {
          if (accountName && accountName !== name) {
            setSelectedCharacter(null)
            setSelectedLeague('')
          }
          setAccountName(name)
        }}
        onSelectCharacter={(character) => {
          setSelectedCharacter(character)
          setAccountName(character.accountName)
          if (character.league) setSelectedLeague(character.league)
        }}
        selectedCharacter={selectedCharacter}
      />
    </div>
  )
}
