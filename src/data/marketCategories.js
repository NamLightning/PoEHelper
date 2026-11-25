import { MARKET_CATEGORY_ICONS } from './marketCategoryIcons.js'

const DEFAULT_CATEGORY_ICON = MARKET_CATEGORY_ICONS.currency

const CATEGORY_GROUPS = [
  {
    label: 'General',
    categories: [
      { id: 'currency', label: 'Currency', endpoint: 'exchange', type: 'Currency' },
      { id: 'fragments', label: 'Fragments', endpoint: 'exchange', type: 'Fragment' },
      { id: 'wombgifts', label: 'Wombgifts', endpoint: 'item', type: 'Wombgift', showLevel: true },
      { id: 'runegrafts', label: 'Runegrafts', endpoint: 'exchange', type: 'Runegraft' },
      { id: 'allflame-embers', label: 'Allflame Embers', endpoint: 'exchange', type: 'AllflameEmber' },
      { id: 'corpses', label: 'Corpses', endpoint: 'item', type: 'Corpse' },
      { id: 'viscera', label: 'Viscera', endpoint: 'item', type: 'Viscera' },
      { id: 'tattoos', label: 'Tattoos', endpoint: 'exchange', type: 'Tattoo' },
      { id: 'omens', label: 'Omens', endpoint: 'exchange', type: 'Omen' },
      { id: 'djinn-coins', label: 'Djinn Coins', endpoint: 'item', type: 'DjinnCoin' },
      { id: 'ducats', label: 'Ducats', endpoint: 'exchange', type: 'Ducat' },
      { id: 'enshrouding-crystals', label: 'Enshrouding Crystals', endpoint: 'exchange', type: 'EnshroudingCrystal' },
      { id: 'divination-cards', label: 'Divination Cards', endpoint: 'exchange', type: 'DivinationCard' },
      { id: 'artifacts', label: 'Artifacts', endpoint: 'exchange', type: 'Artifact' },
      { id: 'oils', label: 'Oils', endpoint: 'exchange', type: 'Oil' },
      { id: 'incubators', label: 'Incubators', endpoint: 'item', type: 'Incubator', bulkExchange: true },
    ],
  },
  {
    label: 'Equipment & gems',
    categories: [
      { id: 'unique-weapons', label: 'Unique Weapons', endpoint: 'item', type: 'UniqueWeapon', showLevel: true },
      { id: 'unique-armours', label: 'Unique Armours', endpoint: 'item', type: 'UniqueArmour', showLevel: true },
      { id: 'unique-accessories', label: 'Unique Accessories', endpoint: 'item', type: 'UniqueAccessory', showLevel: true },
      { id: 'unique-flasks', label: 'Unique Flasks', endpoint: 'item', type: 'UniqueFlask', showLevel: true },
      { id: 'unique-jewels', label: 'Unique Jewels', endpoint: 'item', type: 'UniqueJewel', showLevel: true },
      { id: 'forbidden-jewels', label: 'Forbidden Jewels', endpoint: 'item', type: 'ForbiddenJewel', showLevel: false },
      { id: 'shrine-belts', label: 'Shrine Belts', endpoint: 'item', type: 'ShrineBelt', showLevel: true },
      { id: 'unique-tinctures', label: 'Unique Tinctures', endpoint: 'item', type: 'UniqueTincture', showLevel: true },
      { id: 'unique-relics', label: 'Unique Relics', endpoint: 'item', type: 'UniqueRelic', showLevel: true },
      { id: 'skill-gems', label: 'Skill Gems', endpoint: 'item', type: 'SkillGem', showLevel: true },
      { id: 'imbued-gems', label: 'Imbued Gems', endpoint: 'item', type: 'ImbuedGem', showLevel: true },
      { id: 'cluster-jewels', label: 'Cluster Jewels', endpoint: 'item', type: 'ClusterJewel', showLevel: true },
    ],
  },
  {
    label: 'Atlas',
    categories: [
      { id: 'maps', label: 'Maps', endpoint: 'item', type: 'Map' },
      { id: 'blighted-maps', label: 'Blighted Maps', endpoint: 'item', type: 'BlightedMap' },
      { id: 'blight-ravaged-maps', label: 'Blight-ravaged Maps', endpoint: 'item', type: 'BlightRavagedMap' },
      { id: 'unique-maps', label: 'Unique Maps', endpoint: 'item', type: 'UniqueMap' },
      { id: 'valdo-maps', label: 'Valdo Maps', endpoint: 'item', type: 'ValdoMap' },
      { id: 'delirium-orbs', label: 'Delirium Orbs', endpoint: 'exchange', type: 'DeliriumOrb' },
      { id: 'invitations', label: 'Invitations', endpoint: 'item', type: 'Invitation' },
      { id: 'scarabs', label: 'Scarabs', endpoint: 'exchange', type: 'Scarab' },
      { id: 'astrolabes', label: 'Astrolabes', endpoint: 'exchange', type: 'Astrolabe' },
      { id: 'threads', label: 'Threads', endpoint: 'exchange', type: 'Thread' },
      { id: 'memories', label: 'Memories', endpoint: 'item', type: 'Memory' },
      { id: 'temples', label: 'Temples', endpoint: 'item', type: 'IncursionTemple' },
      { id: 'scrying-orbs', label: 'Scrying Orbs', endpoint: 'item', type: 'ScryingOrb' },
    ],
  },
  {
    label: 'Crafting',
    categories: [
      { id: 'base-types', label: 'Base Types', endpoint: 'item', type: 'BaseType', showLevel: true },
      { id: 'flasks', label: 'Flasks', endpoint: 'item', type: 'Flask', showLevel: true },
      { id: 'fossils', label: 'Fossils', endpoint: 'exchange', type: 'Fossil' },
      { id: 'resonators', label: 'Resonators', endpoint: 'exchange', type: 'Resonator' },
      { id: 'beasts', label: 'Beasts', endpoint: 'item', type: 'Beast' },
      { id: 'essences', label: 'Essences', endpoint: 'exchange', type: 'Essence' },
      { id: 'vials', label: 'Vials', endpoint: 'item', type: 'Vial' },
    ],
  },
]

export const MARKET_CATEGORY_GROUPS = CATEGORY_GROUPS.map((group) => ({
  ...group,
  categories: group.categories.map((category) => ({
    ...category,
    bulkExchange: category.bulkExchange ?? category.endpoint === 'exchange',
    fallbackIcon: MARKET_CATEGORY_ICONS[category.id] || DEFAULT_CATEGORY_ICON,
  })),
}))

export const MARKET_CATEGORIES = MARKET_CATEGORY_GROUPS.flatMap((group) => (
  group.categories.map((category) => ({ ...category, group: group.label }))
))
