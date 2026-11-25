// Compact base-item metadata. `r` = [level, strength, dexterity, intelligence].
// `p` stores only immutable base properties; itemoverview data always wins when present.
export const BASE_ITEMS_DATA = Object.freeze({
  "Sage's Robe": { r: [1, 0, 0, 21], p: { es: 94, ms: -3 } },
  'Elegant Round Shield': { r: [70, 85, 85, 0], p: { block: 27, ar: 196, ev: 196 } },
  'Praetor Crown': { r: [68, 0, 0, 154], p: { es: 101 } },
  'Warlock Boots': { r: [72, 0, 95, 0], p: { ev: 145, ms: 30 } },
  'Simplex Amulet': { r: [70, 0, 0, 155] },
  'Zodiac Leather': { r: [68, 0, 197, 0], p: { ev: 223 } },
  'Astral Plate': { r: [62, 180, 0, 0], p: { ar: 711 } },
  'Hubris Circlet': { r: [69, 0, 0, 154], p: { es: 103 } },
  'Titan Greaves': { r: [68, 120, 0, 0], p: { ar: 231, ms: 25 } },
  'Spiked Gloves': { r: [70, 95, 0, 0], p: { ar: 96 } },
  'Lion Pelt': { r: [62, 0, 151, 0], p: { ev: 177 } },
  'Vaal Regalia': { r: [68, 0, 0, 194], p: { es: 175 } },
  'Carnal Armour': { r: [63, 0, 0, 96], p: { es: 116, ev: 116 } },
  'Glorious Plate': { r: [68, 191, 0, 0], p: { ar: 776 } },
  'Titanium Spirit Shield': { r: [68, 0, 0, 159], p: { es: 117, block: 30 } },
  'Void Sceptre': { r: [68, 54, 0, 122], p: { phys: [39, 73], crit: 6.5, aps: 1.2 } },
  'Prophecy Wand': { r: [68, 0, 0, 212], p: { phys: [35, 65], crit: 7, aps: 1.5 } },
  'Harbinger Bow': { r: [68, 0, 212, 0], p: { phys: [44, 81], crit: 6.5, aps: 1.2 } },
  'Imperial Claw': { r: [68, 113, 113, 0], p: { phys: [29, 76], crit: 6.3, aps: 1.6 } },
  'Ambusher': { r: [60, 0, 113, 113], p: { phys: [33, 86], crit: 6.5, aps: 1.5 } },
  'Judgement Staff': { r: [68, 113, 0, 113], p: { phys: [66, 138], crit: 6.5, aps: 1.15 } },
  'Diamond Ring': { r: [1, 0, 0, 0] },
  'Stygian Vise': { r: [67, 50, 0, 50] },
  'Leather Belt': { r: [1, 0, 0, 0] },
  'Small Hybrid Flask': { r: [1, 0, 0, 0], p: { duration: 6, charges: 30 } },
})

const BASE_ITEMS_BY_KEY = new Map(
  Object.entries(BASE_ITEMS_DATA).map(([name, data]) => [name.trim().toLowerCase(), data]),
)

export function getBaseItemData(baseType) {
  if (typeof baseType !== 'string' || !baseType.trim()) return null
  return BASE_ITEMS_BY_KEY.get(baseType.trim().toLowerCase()) || null
}
