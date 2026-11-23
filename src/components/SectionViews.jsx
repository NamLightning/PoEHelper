import { BUILD_ITEMS } from '../data/mock'
import { matchesQuery } from '../lib/format'

export { default as MarketView } from './MarketView'
export { default as StashView } from './StashView'

function Empty({ query }) {
  return (
    <div className="panel px-5 py-8 text-sm text-[var(--muted)]">
      Nothing matches “{query.trim()}”.
    </div>
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
