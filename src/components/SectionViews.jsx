import { useState } from 'react'
import { BUILD_ITEMS, CRAFTS, STASH_TABS, TOOLS } from '../data/mock'
import { formatDiv, matchesQuery } from '../lib/format'

export { default as MarketView } from './MarketView'

function Empty({ query }) {
  return (
    <div className="panel px-5 py-8 text-sm text-[var(--muted)]">
      Nothing matches “{query.trim()}”.
    </div>
  )
}

export function StashView({ query, factor }) {
  const [selected, setSelected] = useState(STASH_TABS[0].id)
  const tabs = STASH_TABS.filter((tab) => matchesQuery(query, tab.name, tab.note))
  const current = tabs.find((tab) => tab.id === selected) ?? tabs[0]

  return (
    <Page
      title="Stash"
      subtitle="Twelve tabs from the last sync. Values follow the league selected above."
    >
      {tabs.length === 0 ? (
        <Empty query={query} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tabs.map((tab) => {
              const active = current?.id === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelected(tab.id)}
                  className={`panel min-w-0 px-4 py-3.5 text-left transition hover:border-[var(--line-strong)] ${
                    active ? 'border-[var(--line-strong)]' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="truncate text-[15px] font-medium">{tab.name}</h3>
                    <p className="font-num text-lg font-semibold leading-none">
                      {formatDiv(tab.value * factor)}
                      <span className="ml-1 text-[11px] font-medium text-[var(--muted)]">div</span>
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {tab.items} items · {tab.note}
                  </p>
                </button>
              )
            })}
          </div>
          {current ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              Selected {current.name}. {current.items} stacks, about {formatDiv(current.value * factor)} div.
            </p>
          ) : null}
        </>
      )}
    </Page>
  )
}

export function ToolsView({ query }) {
  const tools = TOOLS.filter((tool) => matchesQuery(query, tool.name, tool.note, tool.tag))
  return (
    <Page title="Tools" subtitle="Local helpers. They describe a check; they do not talk to Path of Exile.">
      {tools.length === 0 ? (
        <Empty query={query} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {tools.map((tool) => (
            <article key={tool.id} className="panel min-w-0 px-4 py-4">
              <p className="text-[11px] uppercase tracking-wide text-[var(--gold)]">{tool.tag}</p>
              <h3 className="mt-1 text-[15px] font-medium">{tool.name}</h3>
              <p className="mt-1 text-sm leading-snug text-[var(--muted)]">{tool.note}</p>
            </article>
          ))}
        </div>
      )}
    </Page>
  )
}

export function CraftView({ query, factor }) {
  const [openId, setOpenId] = useState(null)
  const crafts = CRAFTS.filter((craft) => matchesQuery(query, craft.name, craft.note, craft.tag))
  return (
    <Page title="Craft" subtitle="Bench notes priced in the selected economy. Click a row to read the step.">
      {crafts.length === 0 ? (
        <Empty query={query} />
      ) : (
        <ul className="space-y-2">
          {crafts.map((craft) => {
            const open = openId === craft.id
            return (
              <li key={craft.id} className="panel overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : craft.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  aria-expanded={open}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{craft.name}</span>
                    <span className="text-xs text-[var(--muted)]">{craft.tag}</span>
                  </span>
                  <span className="font-num text-sm text-[var(--gold-2)]">{formatDiv(craft.cost * factor)} div</span>
                </button>
                {open ? <p className="border-t border-[var(--line)] px-4 py-3 text-sm text-[#d9d0c3]">{craft.note}</p> : null}
              </li>
            )
          })}
        </ul>
      )}
    </Page>
  )
}

export function BuildView({ query }) {
  const items = BUILD_ITEMS.filter((item) => matchesQuery(query, item.name, item.note, item.tag))
  return (
    <Page
      title="Build"
      subtitle="JambeDeBwa · Hierophant 94. The belt is the wealth goal on the home screen."
    >
      {items.length === 0 ? (
        <Empty query={query} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((item) => (
            <article key={item.id} className="panel min-w-0 px-4 py-3.5">
              <p className="text-[11px] uppercase tracking-wide text-[var(--gold)]">{item.tag}</p>
              <h3 className="mt-1 truncate text-[15px] font-medium">{item.name}</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">{item.note}</p>
            </article>
          ))}
        </div>
      )}
    </Page>
  )
}

function Page({ title, subtitle, children }) {
  return (
    <section>
      <header className="mb-5">
        <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>
      </header>
      {children}
    </section>
  )
}
