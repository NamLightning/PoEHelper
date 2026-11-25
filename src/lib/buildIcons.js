const FLASK_BASES = [
  ...['Small', 'Medium', 'Large', 'Greater', 'Grand', 'Giant', 'Colossal', 'Sacred', 'Hallowed', 'Sanctified', 'Divine', 'Eternal'].flatMap((tier) => [`${tier} Life`, `${tier} Mana`]),
  ...['Small', 'Medium', 'Large', 'Colossal', 'Sacred', 'Hallowed'].map((tier) => `${tier} Hybrid`),
  'Quicksilver', 'Granite', 'Jade', 'Basalt', 'Quartz', 'Silver', 'Gold', 'Diamond', 'Sulphur', 'Bismuth', 'Amethyst', 'Ruby', 'Sapphire', 'Topaz', 'Stibnite', 'Aquamarine', 'Iron', 'Corundum',
]
export const itemIcon = item => item?.icon || item?.iconUrl || item?.icon_url || ''
export function iconFallbackSlot(item, slot = 'Gem') {
  const text = [item?.name, item?.baseType, item?.typeLine, slot].filter(Boolean).join(' ')
  if (/\bHead\b|\bSkull\b|\bVisage\b/i.test(text)) return 'Helmet'
  if (/\bLeg\b|\bLower Limb\b/i.test(text)) return 'Boots'
  if (/\bClaw\b|\bUpper Limb\b/i.test(text)) return 'Offhand'
  if (/\bBanner\b/i.test(text)) return 'Weapon'
  return slot
}

export function iconNames(item, gem = false, slot = '') {
  if (gem) return [item.name].filter((name) => typeof name === 'string' && name.trim())
  const names = []
  const special = /Wickerman|Graft|Viscera|Companion|Corpse/i.test([slot, item.inventoryId, item.itemClass, item.baseType, item.typeLine].filter(Boolean).join(' '))
  if (([3, 9].includes(item.frameType) || special) && item.name) {
    names.push(item.name)
    if (special) names.push(item.name.replace(/^(?:Greater|Lesser)\s+/i, ''))
  }
  const base = item.baseType || item.typeLine
  if (typeof base === 'string' && base.trim()) {
    names.push(base)
    const untiered = base.replace(/^(?:Greater|Lesser)\s+/i, '')
    if (untiered !== base) names.push(untiered)
    const flask = FLASK_BASES.find((name) => base.includes(`${name} Flask`))
    if (flask) names.push(`${flask} Flask`)
    const jewel = base.match(/\b((?:Cobalt|Crimson|Viridian|Prismatic|Large Cluster|Medium Cluster|Small Cluster|Searching Eye|Murderous Eye|Hypnotic Eye|Ghastly Eye) Jewel)\b/)
    if (jewel) names.push(jewel[1])
  }
  return [...new Set(names)]
}

export async function resolveBuildIcons(names, { signal, fetcher = fetch } = {}) {
  const response = await fetcher('/api/build/icons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names }), signal })
  if (!response.ok) throw new Error('Icon lookup unavailable')
  const data = await response.json()
  return data.icons || {}
}

export function missingIconNames(build) {
  return [...new Set([
    ...Object.entries(build.equipment).filter(([, item]) => !itemIcon(item)).flatMap(([slot, item]) => iconNames(item, false, slot)),
    ...build.jewels.filter(item => !itemIcon(item)).flatMap(item => iconNames(item)),
    ...build.skills.flatMap((group) => group.gems.filter((gem) => !gem.icon).flatMap((gem) => iconNames(gem, true))),
  ])]
}

export function applyBuildIcons(build, icons) {
  const withIcon = (item, gem = false, slot = '') => {
    const icon = itemIcon(item) || iconNames(item, gem, slot).map((name) => icons[name]).find(Boolean)
    return icon && icon !== item.icon ? { ...item, icon } : item
  }
  return { ...build,
    equipment: Object.fromEntries(Object.entries(build.equipment).map(([slot, item]) => [slot, withIcon(item, false, slot)])),
    jewels: build.jewels.map((item) => withIcon(item)),
    skills: build.skills.map((group) => ({ ...group, gems: group.gems.map((gem) => withIcon(gem, true)) })),
  }
}
