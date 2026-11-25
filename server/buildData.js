import { normalizePobbinUrl } from '../shared/buildInput.js'
import { buildClusterGraphs, clusterSortOrder, clusterOrbitOffsets } from './buildClusters.js'
import { orbitPosition, visibleTreeNode } from '../shared/passiveGeometry.js'

const MAX_CODE_BYTES = 512 * 1024
// Keep only the release tag in memory, never the complete passive tree.
let latestRelease = { tag: '', checkedAt: 0 }

async function latestTreeTag() {
  if (latestRelease.tag && Date.now() - latestRelease.checkedAt < 60 * 60 * 1000) return latestRelease.tag
  const response = await fetch('https://api.github.com/repos/grindinggear/skilltree-export/tags?per_page=1', {
    headers: { 'User-Agent': 'PoEHelper/0.1.0' }, signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Cannot resolve the current GGG tree release: HTTP ${response.status}.`)
  const tags = await response.json()
  const tag = treeTag(tags[0]?.name)
  if (tag === 'master') throw new Error('GGG did not provide a current tree version.')
  latestRelease = { tag, checkedAt: Date.now() }
  return tag
}

export function pobbinId(value) {
  const url = normalizePobbinUrl(value)
  if (!url) throw new Error('Link pobb.in không hợp lệ.')
  return new URL(url).pathname.slice(1)
}

export async function fetchPobbin(value) {
  const id = pobbinId(value)
  let response
  try { response = await fetch(`https://pobb.in/${id}/raw`, { signal: AbortSignal.timeout(15000), redirect: 'error', cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } }) }
  catch { throw new Error('Không tải được pobb.in trong 15 giây. Kiểm tra kết nối mạng của backend và thử lại.') }
  if (!response.ok) throw new Error(`pobb.in returned HTTP ${response.status}.`)
  // Read with a cap even when upstream does not supply Content-Length.
  let text = ''
  for await (const chunk of response.body) {
    text += Buffer.from(chunk).toString('utf8')
    if (text.length > MAX_CODE_BYTES) { throw new Error('PoB code exceeds 512 KB.') }
  }
  if (!/^[A-Za-z0-9+/_=\s-]+$/.test(text)) throw new Error('pobb.in did not return a PoB code.')
  return text.trim()
}

export function parsePobbinRecovery(html) {
  const text = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|textarea|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|thinsp|ensp|emsp);/gi, ' ')
    .replace(/&minus;/gi, '-')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)
      return value <= 0x10ffff ? String.fromCodePoint(value) : ''
    }).replace(/\s+/g, ' ').trim()
  const fields = [
    ['NetLifeRegen', 'Life\\s+regen(?:eration)?'],
    ['ManaRegenRecovery', 'Mana\\s+regen(?:eration)?'],
    ['EnergyShieldRecharge', '(?:Energy\\s+shield|ES)\\s+recharge'],
    ['LifeRecoupRecovery', 'Life\\s+recoup'],
  ]
  const recovery = {}
  for (const [key, label] of fields) {
    // Require an exact label and a per-second unit; never read item mods or percentages.
    const match = text.match(new RegExp(`\\b(?:${label})\\s*:?\\s*([+\\-−]?(?:\\d{1,3}(?:[, ]\\d{3})+|\\d+)(?:\\.\\d+)?)\\s*/\\s*s(?:ec(?:ond)?s?)?\\b`, 'i'))
    if (!match) continue
    const value = Number(match[1].replace(/[,\s\u202f]/g, '').replace('−', '-'))
    if (Number.isFinite(value)) recovery[key] = value
  }
  // Structured hydration data is parsed as JSON only, never evaluated as JavaScript.
  const jsonKeys = { netliferegen: 'NetLifeRegen', liferegenrecovery: 'NetLifeRegen', netmanaregen: 'ManaRegenRecovery', manaregenrecovery: 'ManaRegenRecovery', energyshieldrecharge: 'EnergyShieldRecharge', esrecharge: 'EnergyShieldRecharge', liferecouprecovery: 'LifeRecoupRecovery', liferecouprecoverymax: 'LifeRecoupRecovery' }
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/type\s*=\s*["']application\/(?:ld\+)?json["']|id\s*=\s*["']__NEXT_DATA__["']/i.test(script[1])) continue
    let data
    try { data = JSON.parse(script[2]) } catch { continue }
    const pending = [[data, 0]]
    let visited = 0
    while (pending.length && ++visited < 5000) {
      const [object, depth] = pending.pop()
      if (!object || typeof object !== 'object' || depth > 12) continue
      for (const [key, value] of Object.entries(object)) {
        const target = jsonKeys[key.toLowerCase()]
        const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^[+\-]?[\d,.]+(?:\/s)?$/.test(value.trim()) ? Number(value.replace(/,/g, '').replace(/\/s$/, '')) : NaN
        if (target && !Object.hasOwn(recovery, target) && Number.isFinite(numeric)) recovery[target] = numeric
        if (value && typeof value === 'object') pending.push([value, depth + 1])
      }
    }
  }
  return recovery
}

export async function fetchPobbinBuild(value) {
  const id = pobbinId(value)
  const page = (async () => {
    const canonical = `https://pobb.in/${id}`
    const sources = [canonical, `https://api.allorigins.win/raw?url=${encodeURIComponent(canonical)}`]
    const recovery = {}
    for (const [index, source] of sources.entries()) {
      try {
        const response = await fetch(source, { signal: AbortSignal.timeout(12000), redirect: 'error', cache: 'no-store', headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        let html = '', size = 0
        const decoder = new TextDecoder()
        for await (const chunk of response.body) {
          size += chunk.byteLength
          if (size > 2 * 1024 * 1024) throw new Error('HTML exceeds 2 MB')
          html += decoder.decode(chunk, { stream: true })
        }
        html += decoder.decode()
        // Keep direct values first; use the backup only to fill missing fields.
        for (const [key, val] of Object.entries(parsePobbinRecovery(html))) if (!Object.hasOwn(recovery, key)) recovery[key] = val
        if (Object.keys(recovery).length === 4) return recovery
        console.warn(`[Build] pobb.in HTML ${index === 0 ? 'direct' : 'backup'}: ${Object.keys(recovery).length}/4 Recovery fields; ES Recharge ${Number.isFinite(recovery.EnergyShieldRecharge) ? 'found' : 'missing'}.`)
      } catch (error) {
        console.warn(`[Build] pobb.in HTML ${index === 0 ? 'direct' : 'backup'} failed: ${error.message}`)
      }
    }
    if (!Number.isFinite(recovery.EnergyShieldRecharge)) console.warn('[Build] Both HTML sources lack Energy shield recharge. The page may omit Recovery or require client rendering; using XML/passive fallback.')
    return recovery
  })()
  const [raw, rendered] = await Promise.allSettled([fetchPobbin(value), page])
  if (raw.status === 'rejected') throw raw.reason
  const recovery = rendered.status === 'fulfilled' ? rendered.value : {}
  const count = Object.keys(recovery).length
  return { code: raw.value, recovery,
    recoveryWarning: count === 4 ? '' : `Chỉ đọc được ${count}/4 chỉ số Recovery từ HTML pobb.in. Các mục còn thiếu dùng fallback từ XML và passive.`,
  }
}

export function treeTag(version) {
  if (!version) return 'master'
  if (typeof version !== 'string') throw new Error('Unsupported passive tree version.')
  const normalized = version.replace(/_/g, '.')
  if (!/^3\.\d{1,2}(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Unsupported passive tree version.')
  return normalized.split('.').length === 2 ? `${normalized}.0` : normalized
}

export function compactTree(data, ids, masteries = {}) {
  const selected = ids ? new Set([...ids.map(String), ...Object.keys(masteries)]) : null
  const nodes = []
  for (const [id, node] of Object.entries(data.nodes || {})) {
    if (selected && !selected.has(id)) continue
    const group = data.groups?.[node.group]
    if ((!group && !selected) || (!node.ascendancyName && !visibleTreeNode(node, data))) continue
    const orbit = node.orbit || 0
    const index = node.orbitIndex || 0
    const effect = node.masteryEffects?.find((entry) => String(entry.effect) === String(masteries[id]))
    nodes.push({ id, name: node.name, stats: node.isMastery ? effect?.stats || [] : node.stats || [],
      kind: node.isMastery ? 'Mastery' : node.isKeystone ? 'Keystone' : node.ascendancyName ? 'Ascendancy' : 'Passive',
      isAscendancyStart: Boolean(node.isAscendancyStart), notable: Boolean(node.isNotable), ascendancy: node.ascendancyName || '',
      iconKey: node.icon || '',
      group: node.group, orbit, orbitIndex: index, ...orbitPosition(group, orbit, index, data.constants),
      straightOut: (node.straightOut || node.straightConnections || []).map(String),
      out: selected ? undefined : [...(node.out || []), ...(node.in || [])].filter(value => value != null).map(value => typeof value === 'object' ? { id: String(value.id), isStraight: Boolean(value.isStraight || value.straight) } : String(value)),
    })
  }
  return { nodes, constants: { jewelRadii: data.constants?.jewelRadii || data.jewelRadii, orbitRadii: data.constants?.orbitRadii, skillsPerOrbit: data.constants?.skillsPerOrbit }, jewelSlots: data.jewelSlots, classes: data.classes?.map((entry) => ({ name: entry.name, base_str: entry.base_str, base_dex: entry.base_dex, base_int: entry.base_int, ascendancies: entry.ascendancies?.map((a) => a.name) })) }
}

export async function fetchTree(version, ids, masteries, clusterJewels = [], { layout = false, jewelData = {} } = {}) {
  const tag = version ? treeTag(version) : await latestTreeTag()
  const response = await fetch(`https://raw.githubusercontent.com/grindinggear/skilltree-export/${tag}/data.json`, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`Passive tree ${tag}: HTTP ${response.status}.`)
  const data = await response.json()
  const compact = compactTree(data, layout ? undefined : ids, masteries)
  const resolvedJewels = clusterJewels.map(jewel => ({ ...jewel, nodeId: String(jewel.nodeId ?? data.jewelSlots?.[jewel.socketIndex] ?? '') })).filter(jewel => /^\d+$/.test(jewel.nodeId))
  if (ids && resolvedJewels.length) {
    // Fetch just the small ordering table on cluster imports; never retain a tree/catalog cache.
    let order = {}, offsets = {}
    try {
      const ordering = await fetch('https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding/dev/src/Data/ClusterJewels.lua', { signal: AbortSignal.timeout(10000) })
      if (ordering.ok) { const text = await ordering.text(); order = clusterSortOrder(text); offsets = clusterOrbitOffsets(text) }
    } catch { /* Unresolved cluster IDs are reported below instead of guessing notables. */ }
    const selected = new Set(ids.map(String))
    const generated = buildClusterGraphs(data, ids, resolvedJewels, order, offsets, jewelData).filter(node => layout || !node.unresolved && (selected.has(node.id) || node.aliases.some(id => selected.has(id))))
    compact.nodes = [...new Map([...compact.nodes, ...generated].map((node) => [node.id, node])).values()]
  }
  const found = new Set(compact.nodes.flatMap((node) => [node.id, ...(node.aliases || [])]))
  const missingIds = ids?.map(String).filter((id) => !found.has(id)) || []
  const resolution = { version: tag, requestedIds: ids?.map(String) || [], missingIds,
    aoeNodes: compact.nodes.filter(node => node.stats.some(line => /^\d+(?:\.\d+)?% (?:increased|reduced) Area of Effect$/i.test(line.trim()))).map(node => ({ id: node.id, name: node.name, stats: node.stats })),
  }
  return { ...compact, clusterJewels: resolvedJewels, resolution, missingIds, version: tag.split('.').slice(0, 2).join('_') }
}
