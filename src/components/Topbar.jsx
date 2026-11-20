import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Search, SunMedium } from 'lucide-react'
import { CONTEXTS, searchAll } from '../data/mock'

export default function Topbar({
  contextId,
  onContext,
  query,
  onQuery,
  onNavigate,
  theme,
  onToggleTheme,
}) {
  const inputRef = useRef(null)
  const boxRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  const results = searchAll(query)

  useEffect(() => {
    function onKey(event) {
      const tag = event.target?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      } else if (!typing && event.key === '/') {
        event.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    function onPointer(event) {
      if (!boxRef.current?.contains(event.target)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [])

  function pick(result) {
    onNavigate(result.tab)
    onQuery(result.name)
    setOpen(false)
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[var(--line)] bg-[var(--bg)]/95 px-5 backdrop-blur">
      <div className="inline-flex shrink-0 items-center rounded-full bg-black/30 p-1 ring-1 ring-[var(--line)]">
        {CONTEXTS.map((item) => {
          const selected = item.id === contextId
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onContext(item.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] transition ${
                selected ? 'bg-[var(--nav)] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {selected ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--mint)]" /> : null}
              {item.short}
            </button>
          )
        })}
      </div>

      <div ref={boxRef} className="relative min-w-0 flex-1 max-w-[520px]">
        <Search
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--faint)]"
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            onQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search items, tools, strategies"
          aria-label="Search items, tools, strategies"
          className="w-full rounded-full border border-[var(--line)] bg-black/25 py-2 pl-10 pr-12 text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--line-strong)]"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-[var(--line)] bg-black/30 px-1.5 py-0.5 text-[10px] text-[var(--faint)]">
          K
        </kbd>
        {open && query.trim() ? (
          <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow)]">
            {results.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[var(--muted)]">No matches for “{query.trim()}”.</p>
            ) : (
              <ul className="py-1">
                {results.map((result) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      onClick={() => pick(result)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.04]"
                    >
                      <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-[var(--gold)]">
                        {result.kind}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{result.name}</span>
                        <span className="block truncate text-xs text-[var(--muted)]">{result.meta}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setFeedbackOpen((value) => !value)
              setSent(false)
            }}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1.5 text-[13px] text-[#d9d0c3] hover:border-[var(--line-strong)]"
          >
            <MessageSquare size={15} />
            Feedback / Bug report
          </button>
          {feedbackOpen ? (
            <form
              className="absolute right-0 top-[calc(100%+8px)] z-40 w-80 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--shadow)]"
              onSubmit={(event) => {
                event.preventDefault()
                if (!note.trim()) return
                setSent(true)
                setNote('')
              }}
            >
              <p className="text-sm font-medium">Local note</p>
              <p className="mt-1 text-xs text-[var(--muted)]">Kept in this session only. Nothing is uploaded.</p>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="What should the next sync surface?"
                className="mt-2 w-full resize-none rounded-xl border border-[var(--line)] bg-black/20 px-3 py-2 text-sm outline-none focus:border-[var(--line-strong)]"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-[var(--mint)]">{sent ? 'Saved for this session.' : ''}</span>
                <button
                  type="submit"
                  className="rounded-full bg-[var(--gold)] px-3 py-1 text-xs font-medium text-[var(--ink)]"
                >
                  Save note
                </button>
              </div>
            </form>
          ) : null}
        </div>

        <button
          type="button"
          aria-pressed={theme === 'ember'}
          aria-label="Toggle warm tone"
          onClick={onToggleTheme}
          className="grid h-9 w-9 place-items-center rounded-full border border-[var(--line)] text-[var(--gold-2)] hover:border-[var(--line-strong)]"
        >
          <SunMedium size={16} />
        </button>

        <div className="flex items-center gap-2.5 pl-1">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#e7a15a] via-[#c46a3a] to-[#7a3b22] text-[11px] font-semibold text-white ring-1 ring-[#e6c48a]/40">
            JD
          </span>
          <span className="hidden leading-tight lg:block">
            <span className="block text-[13px] font-medium">JambeDeBwa#6439</span>
            <span className="block text-[11px] text-[var(--muted)]">JambExile, Hierophant 94</span>
          </span>
        </div>
      </div>
    </header>
  )
}
