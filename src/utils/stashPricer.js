import { getImbuedStatId } from '../data/imbuedStats';

const text = (value) => String(value ?? '').replace(/<[^>]+>/g, '').trim();
const key = (value) => text(value).toLowerCase().replace(/\s+/g, ' ');
const numberProperty = (item, label) => Number(text((item.properties || []).find((p) => key(p.name) === key(label))?.values?.[0]?.[0] || 0));
function marketMap(marketItems = []) { return new Map(marketItems.flatMap((item) => [[key(item.name), item], [key(item.baseType), item], [key(item.id), item]])); }
function links(item) { return Math.max(0, (item.sockets || []).filter((socket) => socket.group != null).reduce((groups, socket) => Math.max(groups, socket.group), 0)); }
function displayName(item) {
  const level = numberProperty(item, 'Level'); const quality = numberProperty(item, 'Quality');
  if (item.category === 'gem' || item.type === 'SkillGem' || item.type === 'ImbuedGem') return `${item.name || item.baseType} - ${level || 1}/${quality || 0}`;
  if (item.category === 'map' || item.type === 'Map') return `${item.name || item.baseType} (Tier ${numberProperty(item, 'Map Tier') || 1})`;
  const linkCount = links(item);
  return `${item.name || item.baseType}${linkCount >= 5 ? ` (${linkCount}L)` : ''}`;
}

export function normalizeStashItem(item) {
  const category = item.type || item.category || (item.baseType?.includes('Map') ? 'Map' : '');
  const quantity = Number(item.stackSize || item.quantity || 1);
  const tab = String(item.tab || item.tabName || 'Unknown').trim() || 'Unknown';
  return { ...item, category, quantity, tab, tabName: tab, name: displayName({ ...item, category }), lookupName: key(item.baseType || item.name), imbuedStatId: category === 'ImbuedGem' ? getImbuedStatId(item)?.id : null };
}

export function priceStashItems(rawItems = [], marketItems = [], divineToChaos = 225) {
  const prices = marketMap(marketItems);
  return rawItems.map(normalizeStashItem).map((item, index) => {
    const candidates = [item.lookupName, key(item.name), item.imbuedStatId, `${item.lookupName} ${links(item)}l`, `${item.lookupName} ${numberProperty(item, 'Map Tier')}`];
    const match = candidates.map((candidate) => prices.get(candidate)).find(Boolean);
    const price = Number(match?.chaosValue ?? match?.price ?? match?.value ?? 0);
    return { ...item, id: item.id || `${item.tabId || 'stash'}-${index}`, tabId: item.tabId, tabName: item.tabName || 'Unknown', tabColor: item.tabColor, price, totalChaos: price * item.quantity, icon: match?.icon, marketItem: match };
  });
}

export function totalChaos(items) { return items.reduce((sum, item) => sum + (Number(item.totalChaos) || 0), 0); }
export function formatChaosOrDivine(value, divineToChaos = 225) { return divineToChaos > 0 && value >= divineToChaos ? `${(value / divineToChaos).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}d` : `${Math.round(value)}c`; }
