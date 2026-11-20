import {
  Archive,
  Box,
  Coins,
  Hammer,
  Home,
  Shield,
  Settings,
  TrendingUp,
  Wrench,
} from 'lucide-react'

const NAV = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'stash', label: 'Stash', icon: Archive },
  { id: 'market', label: 'Market', icon: TrendingUp },
  { id: 'currency', label: 'Make Currency', icon: Coins, dot: true },
  { id: 'tools', label: 'Tools', icon: Wrench, dot: true },
  { id: 'craft', label: 'Craft', icon: Hammer },
  { id: 'build', label: 'Build', icon: Shield },
]

export default function Sidebar({ active, onChange, onOpenSettings }) {
  return (
    <aside className="sticky top-0 flex h-screen w-[228px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg-raise)]">
      <button
        type="button"
        onClick={() => onChange('home')}
        className="flex h-16 items-center gap-2.5 px-4 text-left"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#2a2116] ring-1 ring-[#c6a15a]/35">
          <Box size={16} className="text-[var(--gold-2)]" />
        </span>
        <span className="text-[17px] font-semibold tracking-tight">PoeStash</span>
      </button>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-6">
        {NAV.map((item) => {
          const Icon = item.icon
          const selected = active === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={selected ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] transition ${
                selected
                  ? 'bg-[var(--nav)] text-[var(--text)]'
                  : 'text-[#c4baae] hover:bg-white/[0.03] hover:text-[var(--text)]'
              }`}
            >
              <Icon
                size={18}
                strokeWidth={1.75}
                className={selected ? 'text-[var(--gold-2)]' : 'text-[#b7aa96]'}
              />
              <span className="truncate">{item.label}</span>
              {item.dot ? (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#e0b15a]" aria-hidden="true" />
              ) : null}
            </button>
          )
        })}
      </nav>
      <button
        type="button"
        onClick={onOpenSettings}
        className="mx-3 mb-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-[#c4baae] transition hover:bg-white/[0.03] hover:text-[var(--text)]"
      >
        <Settings size={18} strokeWidth={1.75} className="text-[#b7aa96]" />
        <span>Settings</span>
      </button>
    </aside>
  )
}
