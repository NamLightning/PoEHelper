import { useState } from 'react'
import { Archive, Home, MessageSquare, Settings, Shield, TrendingUp } from 'lucide-react'
import { CONTEXTS } from '../data/mock'

const NAV = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'stash', label: 'Stash', icon: Archive },
  { id: 'market', label: 'Market', icon: TrendingUp },
  { id: 'build', label: 'Build', icon: Shield },
]

export default function Topbar({
  active,
  contextId,
  onContext,
  onNavigate,
  accountName,
  selectedCharacter,
  onOpenAccount,
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  const profileTitle = accountName || 'Link PoE account'
  const profileDetails = selectedCharacter
    ? `${selectedCharacter.name}, ${selectedCharacter.class || 'Unknown class'} ${selectedCharacter.level ?? '—'} · ${selectedCharacter.league || 'Unknown league'}`
    : accountName
      ? 'Choose a character'
      : 'Not connected'
  const profileInitials = (selectedCharacter?.name || accountName || 'PoE').slice(0, 2).toUpperCase()

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center border-b border-white/[0.12] bg-[#121922]/75 px-4 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
        <button type="button" onClick={() => onNavigate('home')} className="flex shrink-0 items-center gap-2.5 text-left">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#e7a15a] via-[#c46a3a] to-[#7a3b22] text-xs font-bold text-white ring-1 ring-[#e6c48a]/40">PS</span>
          <span className="hidden text-[15px] font-semibold tracking-tight sm:block">PoeStash</span>
        </button>
        <div className="hidden items-center rounded-full bg-black/30 p-1 ring-1 ring-[var(--line)] lg:inline-flex">
          {CONTEXTS.map((item) => {
            const selected = item.id === contextId
            return (
              <button key={item.id} type="button" onClick={() => onContext(item.id)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] transition ${selected ? 'bg-[var(--nav)] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
                {selected ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--mint)]" /> : null}
                {item.short}
              </button>
            )
          })}
        </div>
      </div>

      <nav aria-label="Primary navigation" className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-[var(--line)] bg-black/20 p-1">
        {NAV.map(({ id, label, icon: Icon }) => {
          const selected = id === active
          return (
            <button key={id} type="button" onClick={() => onNavigate(id)} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] transition sm:px-4 ${selected ? 'bg-[var(--nav)] text-[var(--text)] shadow-sm' : 'text-[var(--muted)] hover:bg-white/[0.04] hover:text-[var(--text)]'}`} aria-current={selected ? 'page' : undefined}>
              <Icon size={15} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          )
        })}
      </nav>

      <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
        <div className="relative">
          <button type="button" onClick={() => { setFeedbackOpen((value) => !value); setSent(false) }} className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-2.5 py-1.5 text-[13px] text-[#d9d0c3] hover:border-[var(--line-strong)] sm:px-3">
            <MessageSquare size={15} />
            <span className="hidden md:inline">Feedback / Bug report</span>
          </button>
          {feedbackOpen ? (
            <form className="absolute right-0 top-[calc(100%+8px)] z-40 w-80 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--shadow)]" onSubmit={(event) => { event.preventDefault(); if (!note.trim()) return; setSent(true); setNote('') }}>
              <p className="text-sm font-medium">Local note</p>
              <p className="mt-1 text-xs text-[var(--muted)]">Kept in this session only. Nothing is uploaded.</p>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="What should the next sync surface?" className="mt-2 w-full resize-none rounded-xl border border-[var(--line)] bg-black/20 px-3 py-2 text-sm outline-none focus:border-[var(--line-strong)]" />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-[var(--mint)]">{sent ? 'Saved for this session.' : ''}</span>
                <button type="submit" className="rounded-full bg-[var(--gold)] px-3 py-1 text-xs font-medium text-[var(--ink)]">Save note</button>
              </div>
            </form>
          ) : null}
        </div>
        <button type="button" onClick={onOpenAccount} aria-label="Open Settings" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--line)] text-[var(--gold-2)] hover:border-[var(--line-strong)]">
          <Settings size={16} />
        </button>
        <button type="button" onClick={onOpenAccount} aria-label="Open Account & Character settings" className="flex min-w-0 items-center gap-2.5 rounded-full pl-1 text-left hover:opacity-85">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#e7a15a] via-[#c46a3a] to-[#7a3b22] text-[11px] font-semibold text-white ring-1 ring-[#e6c48a]/40">{profileInitials}</span>
          <span className="hidden min-w-0 max-w-56 leading-tight xl:block">
            <span className="block truncate text-[13px] font-medium">{profileTitle}</span>
            <span className="block truncate text-[11px] text-[var(--muted)]">{profileDetails}</span>
          </span>
        </button>
      </div>
    </header>
  )
}
