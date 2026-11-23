export const CONTEXTS = [
  { id: 'poe1', short: 'PoE 1', priceLabel: 'PoE 1, Standard', factor: 0.86, target: 168 },
  { id: 'covens', short: 'Covens PC', priceLabel: 'Covens, PC', factor: 1, target: 196 },
]

export const METHODS = [
  {
    id: 'fortress',
    name: 'T17 Fortress',
    tag: 'Mapping',
    risk: 'High',
    rate: 14.6,
    note: 'Risk scarabs, roll pack size, sell invitations',
    icon: 'Swords',
  },
  {
    id: 'ritual',
    name: 'Ritual defer',
    tag: 'Mapping',
    risk: 'Low',
    rate: 9.1,
    note: 'Defer big tickets and rush vessels',
    icon: 'Sparkles',
  },
  {
    id: 'maven',
    name: 'Maven writs',
    tag: 'Bossing',
    risk: 'Medium',
    rate: 11.8,
    note: 'Witness sets, sell writs before the weekend',
    icon: 'Crown',
  },
  {
    id: 'blight',
    name: 'Blight oils',
    tag: 'Mapping',
    risk: 'Low',
    rate: 7.4,
    note: 'Extract oils, anoint, and bulk the rest',
    icon: 'Droplets',
  },
  {
    id: 'harvest',
    name: 'Harvest force',
    tag: 'Crafting',
    risk: 'Low',
    rate: 6.2,
    note: 'Lifeforce into vivid crafts and cluster jewels',
    icon: 'Leaf',
  },
  {
    id: 'essence',
    name: 'Essence spam',
    tag: 'Crafting',
    risk: 'Medium',
    rate: 5.5,
    note: 'Deafening on boots and shields',
    icon: 'Gem',
  },
]

export const STASH_TABS = [
  { id: 'currency', name: 'Currency', items: 142, value: 18.4, note: 'Divines, chaos, stacked deck' },
  { id: 'maps', name: 'Maps', items: 86, value: 4.1, note: 'T16 and a few T17s' },
  { id: 'fragments', name: 'Fragments', items: 54, value: 6.8, note: 'Maven, elder, guardian sets' },
  { id: 'uniques', name: 'Uniques', items: 37, value: 3.2, note: 'Dump tab, Mageblood missing' },
  { id: 'essences', name: 'Essences', items: 210, value: 2.6, note: 'Deafening and shrieking' },
  { id: 'fossils', name: 'Fossils', items: 64, value: 1.9, note: 'Bound and jagged leftovers' },
]

export const MARKET = [
  { id: 'divine', name: 'Divine Orb', tag: 'Currency', price: 1, change: 2.1, note: 'Benchmark unit' },
  { id: 'mageblood', name: 'Mageblood', tag: 'Unique', price: 196, change: -1.4, note: 'Current goal' },
  { id: 'headhunter', name: 'Headhunter', tag: 'Unique', price: 84, change: 3.2, note: 'Soft alternative' },
  { id: 'voidstone', name: 'Voidstone', tag: 'Fragment', price: 2.4, change: 0.4, note: 'Watchers and invitations' },
  { id: 'lifeforce', name: 'Vivid Lifeforce', tag: 'Crafting', price: 0.08, change: -0.6, note: 'Per 100' },
  { id: 'oil', name: 'Golden Oil', tag: 'Crafting', price: 0.35, change: 1.1, note: 'Blight extract' },
  { id: 'deck', name: 'Stacked Deck', tag: 'Currency', price: 0.12, change: 0.2, note: 'Bulk stacks' },
  { id: 'cluster', name: 'Large Cluster', tag: 'Crafting', price: 1.8, change: -0.3, note: 'ilvl 84 bases' },
]

export const BUILD_ITEMS = [
  { id: 'helm', name: 'Crown of the Inward Eye', tag: 'Gear', note: 'Life and aura effect' },
  { id: 'weapon', name: 'Void Battery', tag: 'Gear', note: 'Power charge stacking' },
  { id: 'chest', name: 'Ivory Tower', tag: 'Gear', note: 'Energy shield body' },
  { id: 'belt', name: 'Mageblood', tag: 'Goal', note: '19% funded on Covens' },
  { id: 'jewel1', name: 'Impossible Escape', tag: 'Jewel', note: 'Aura reservation path' },
  { id: 'gem', name: 'Penance Brand of Dissipation', tag: 'Skill', note: 'Main link, Hierophant 94' },
]

const BASE_SERIES = [21.6, 22.4, 23.3, 24.1, 25.2, 26.0, 26.6, 26.9, 24.2, 25.4, 29.8, 34.1, 37.7]

export function createSnapshot() {
  return {
    series: BASE_SERIES.map((value, index) => ({ label: String(index + 1), value })),
    sessionGain: 28.5,
    sessionMs: (3 * 60 + 12) * 60 * 1000,
    tabsTracked: 12,
  }
}

export function refreshSnapshot(prev) {
  const delta = Math.round((0.4 + Math.random() * 1.3) * 10) / 10
  const last = prev.series[prev.series.length - 1].value
  const nextValue = Math.round((last + delta) * 10) / 10
  const series = prev.series
    .slice(1)
    .concat({ label: 'next', value: nextValue })
    .map((point, index) => ({ label: String(index + 1), value: point.value }))

  return {
    series,
    sessionGain: Math.round((prev.sessionGain + delta) * 10) / 10,
    sessionMs: prev.sessionMs + (3 + Math.floor(Math.random() * 4)) * 60 * 1000,
    tabsTracked: prev.tabsTracked,
  }
}

export function totalOf(snapshot) {
  return snapshot.series[snapshot.series.length - 1].value
}

export function searchAll(query) {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const catalogs = [
    [METHODS, 'currency', 'Strategy'],
    [STASH_TABS, 'stash', 'Stash'],
    [MARKET, 'market', 'Market'],
    [BUILD_ITEMS, 'build', 'Build'],
  ]

  return catalogs
    .flatMap(([items, tab, kind]) =>
      items
        .filter((item) =>
          [item.name, item.note, item.tag].some((part) =>
            String(part ?? '').toLowerCase().includes(needle),
          ),
        )
        .map((item) => ({
          id: `${tab}-${item.id}`,
          name: item.name,
          meta: item.note || item.tag || kind,
          kind,
          tab,
        })),
    )
    .slice(0, 8)
}
