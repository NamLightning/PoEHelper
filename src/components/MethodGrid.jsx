import { useState } from 'react'
import { Crown, Droplets, Gem, Leaf, Sparkles, Swords } from 'lucide-react'
import { METHODS } from '../data/mock'
import { formatDiv, matchesQuery } from '../lib/format'

const FILTERS = ['All', 'Mapping', 'Bossing', 'Crafting']

const ICONS = { Crown, Droplets, Gem, Leaf, Sparkles, Swords }

export default function MethodGrid({ query, factor }) {
  const [filter, setFilter] = useState('All')
  const visible = METHODS.filter((method) => {
    const tagOk = filter === 'All' || method.tag === filter
    return tagOk && matchesQuery(query, method.name, method.note, method.tag, method.risk)
  })

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Currency methods</h2>
          <p className="text-sm text-[var(--muted)]">
            {visible.length} strategies in this filter
            {query.trim() ? ` · matching “${query.trim()}”` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((item) => {
            const selected = filter === item
            return (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`rounded-full border px-3 py-1 text-[13px] transition ${
                  selected
                    ? 'border-[var(--line-strong)] bg-[#3a2e1c] text-[var(--gold-2)]'
                    : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {item}
              </button>
            )
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="panel px-5 py-8 text-sm text-[var(--muted)]">
          No strategies match this search. Clear the box or switch the filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((method) => {
            const Icon = ICONS[method.icon] ?? Sparkles
            const rate = method.rate * factor
            return (
              <article key={method.id} className="panel min-w-0 px-4 py-3.5 transition hover:border-[var(--line-strong)]">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#2a2116] text-[var(--gold-2)] ring-1 ring-[var(--line)]">
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="truncate text-[15px] font-medium">{method.name}</h3>
                      <p className="shrink-0 font-num text-lg font-semibold leading-none text-[var(--gold-2)]">
                        {formatDiv(rate)}
                        <span className="ml-1 text-[11px] font-medium text-[var(--muted)]">div/h</span>
                      </p>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm leading-snug text-[var(--muted)]">{method.note}</p>
                    <p className="mt-2 flex gap-2 text-[12px] text-[#cfc6b8]">
                      <span>{method.tag}</span>
                      <span className="text-[var(--faint)]">·</span>
                      <span>{method.risk} risk</span>
                    </p>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
