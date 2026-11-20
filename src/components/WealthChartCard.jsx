import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  Area,
  AreaChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatAgo, formatChaos, formatDiv, formatDuration, formatRate } from '../lib/format'

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
  return reduced
}

export default function WealthChartCard({
  series,
  total,
  sessionGain,
  sessionMs,
  tabsTracked,
  syncedAt,
  now,
  divineToChaos,
  league,
  rateError,
  syncing,
  onSync,
  onOpenStash,
}) {
  const reduced = useReducedMotion()
  const last = series[series.length - 1]
  const values = series.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(0.5, max - min)
  const rate = formatRate(sessionGain, sessionMs)

  return (
    <article className="panel flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4 px-5 pb-1 pt-4">
        <div>
          <p className="text-[13px] text-[var(--muted)]">Total wealth</p>
          <p className="mt-1 font-num text-[42px] font-semibold leading-none tracking-tight text-[var(--text)]">
            {formatDiv(total)}
            <span className="ml-1.5 align-baseline text-[20px] font-medium text-[#d9d0c3]">div</span>
          </p>
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-[#cfc6b8]">
            <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-gradient-to-br from-[#f0d48a] to-[#a56b22] text-[8px] font-bold text-[#2a1c08]">
              c
            </span>
            {Number.isFinite(divineToChaos) ? (
              <>
                ≈ {formatChaos(total, divineToChaos)} chaos
                <span className="text-xs text-[var(--muted)]">
                  ({divineToChaos.toLocaleString('en-US', { maximumFractionDigits: 2 })} chaos/div · {league})
                </span>
              </>
            ) : (
              <span title={rateError || undefined}>Chaos equivalent unavailable</span>
            )}
          </p>
        </div>
        <div className="hidden h-14 w-px self-center bg-[var(--line)] sm:block" />
        <div>
          <p className="text-[13px] text-[var(--muted)]">This session</p>
          <p className="mt-1 font-num text-[32px] font-semibold leading-none tracking-tight text-[var(--mint)]">
            +{formatDiv(sessionGain)}
            <span className="ml-1.5 text-[18px] font-medium">div</span>
          </p>
          <p className="mt-2 text-sm text-[#d7cec2]">
            {rate} div/h <span className="text-[var(--muted)]">over {formatDuration(sessionMs)}</span>
          </p>
        </div>
      </div>

      <div className="min-h-[168px] w-full min-w-0 flex-1 px-2" role="img" aria-label={`Wealth trend ending at ${formatDiv(total)} div`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 28, right: 28, left: 8, bottom: 8 }}>
            <defs>
              <linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e3c78a" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#e3c78a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" hide />
            <YAxis hide domain={[min - span * 0.45, max + span * 0.28]} />
            <Tooltip
              cursor={{ stroke: 'rgba(212,179,106,0.35)', strokeWidth: 1 }}
              contentStyle={{
                background: '#1c1915',
                border: '1px solid rgba(198,164,112,0.28)',
                borderRadius: 12,
                boxShadow: 'none',
              }}
              labelStyle={{ color: '#9a9186', fontSize: 12 }}
              itemStyle={{ color: '#f6f1e8', fontSize: 13 }}
              formatter={(value) => [`${formatDiv(value)} div`, 'Wealth']}
              labelFormatter={(label) => `Point ${label}`}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#e7c98a"
              strokeWidth={2.25}
              fill="url(#goldFill)"
              dot={false}
              isAnimationActive={!reduced}
              activeDot={{ r: 4, fill: '#f8f1df', stroke: '#d7b56a' }}
            />
            {last ? (
              <>
                <ReferenceDot x={last.label} y={last.value} r={8} fill="rgba(227,199,138,0.22)" stroke="none" />
                <ReferenceDot x={last.label} y={last.value} r={4} fill="#f8f1df" stroke="#d7b56a" />
              </>
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-[var(--line)] px-5 py-3">
        <p className="inline-flex items-center gap-2 text-sm text-[#d5cbbd]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--mint)]" />
          Synced {formatAgo(syncedAt, now)}
        </p>
        <p className="text-sm text-[var(--muted)]">{tabsTracked} tabs tracked</p>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenStash}
            className="rounded-full border border-[#4a4034] px-3.5 py-1.5 text-sm text-[#efe7da] hover:border-[var(--gold)]"
          >
            Open stash
          </button>
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--gold)] px-3.5 py-1.5 text-sm font-medium text-[var(--ink)] hover:bg-[var(--gold-2)] disabled:opacity-70"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>
    </article>
  )
}
