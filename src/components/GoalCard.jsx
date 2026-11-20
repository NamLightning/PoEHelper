import { Gem } from 'lucide-react'
import { formatDiv } from '../lib/format'

export default function GoalCard({ wealth, perHour, target, tab, onTab }) {
  const pct = Math.min(100, (wealth / target) * 100)
  const remain = Math.max(0, target - wealth)
  const daily = perHour * 2.8
  const days = remain === 0 || daily <= 0 ? 0 : Math.max(1, Math.ceil(remain / daily))
  const size = 148
  const stroke = 8
  const radius = (size - stroke) / 2
  const circ = 2 * Math.PI * radius
  const dash = (pct / 100) * circ

  return (
    <article className="panel flex h-full min-h-[320px] flex-col px-5 pb-5 pt-4">
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() => onTab('goal')}
          className={tab === 'goal' ? 'text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}
        >
          Goal
        </button>
        <button
          type="button"
          onClick={() => onTab('details')}
          className={tab === 'details' ? 'text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}
        >
          Details
        </button>
      </div>

      {tab === 'goal' ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="relative grid place-items-center">
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
              <defs>
                <linearGradient id="goalGold" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#f0d48a" />
                  <stop offset="100%" stopColor="#a8843d" />
                </linearGradient>
              </defs>
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="#2c2823"
                strokeWidth={stroke}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="url(#goalGold)"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circ - dash}`}
              />
            </svg>
            <span className="absolute grid h-[92px] w-[92px] place-items-center rounded-full border border-[var(--line)] bg-black/20">
              <Gem size={28} strokeWidth={1.4} className="text-[#d9c4a2]" />
            </span>
          </div>
          <p className="mt-4 text-[11px] font-medium tracking-[0.22em] text-[#cbb89a]">MAGEBLOOD</p>
          <p className="mt-1 font-num text-[40px] font-semibold leading-none tracking-tight">
            {Math.round(pct)}%
            <span className="ml-2 text-[16px] font-medium tracking-normal text-[#d5cbbd]">of {target} div</span>
          </p>
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
            {remain === 0 ? (
              'Goal funded. Sync again to keep the belt priced.'
            ) : (
              <>
                ≈ {Math.round(daily)} div a day recently,
                <br />
                about {days} days to go
              </>
            )}
          </p>
        </div>
      ) : (
        <dl className="mt-6 flex flex-1 flex-col justify-center gap-3 text-sm">
          <Row label="Owned" value={`${formatDiv(wealth)} div`} />
          <Row label="Target" value={`${target} div`} />
          <Row label="Remaining" value={`${formatDiv(remain)} div`} />
          <Row label="Recent pace" value={`${Math.round(daily)} div/day`} />
          <Row label="Estimate" value={remain === 0 ? 'Funded' : `${days} days`} />
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40">
            <div className="h-full rounded-full bg-[var(--gold)]" style={{ width: `${pct}%` }} />
          </div>
        </dl>
      )}
    </article>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line)] pb-2">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="font-num text-[15px]">{value}</dd>
    </div>
  )
}
