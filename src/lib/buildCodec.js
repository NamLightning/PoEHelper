import { normalizeOverrides, applyOverrides } from './buildTreeInteractions.js'
import { deflate, Inflate } from 'pako'
import { ASPECT_DATA, isSelfAura, canonicalSkillName, auraStats } from './buildAuraData.js'
import { resolvePassiveConditions } from './buildPassiveConditions.js'
import { withSocketedQuality, withPobGemQuality } from './buildMainSkills.js'
import { supportData } from './buildGemCalculator.js'
import { SLOT_NAMES, gggEquipmentEntries, isEquippedInventoryItem, equippedJewels, isJewel } from './buildEquipment.js'
export { SLOT_NAMES } from './buildEquipment.js'
import { recordStat, itemSource, nodeSource, baseSource, skillSource, snapshotBreakdown, resistanceMod } from './buildBreakdown.js'

export const MAX_CODE_LENGTH = 512 * 1024
const MAX_XML_LENGTH = 8 * 1024 * 1024
export const BUILD_CACHE_KEY = 'poehelper.builds.v1'
const BASE_CLASSES = [
  { name: 'Scion', base_str: 20, base_dex: 20, base_int: 20 },
  { name: 'Marauder', base_str: 32, base_dex: 14, base_int: 14 },
  { name: 'Ranger', base_str: 14, base_dex: 32, base_int: 14 },
  { name: 'Witch', base_str: 14, base_dex: 14, base_int: 32 },
  { name: 'Duelist', base_str: 23, base_dex: 23, base_int: 14 },
  { name: 'Templar', base_str: 23, base_dex: 14, base_int: 23 },
  { name: 'Shadow', base_str: 14, base_dex: 23, base_int: 23 },
]
const escapeXml = (value) => String(value ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]))
const MOD_FIELDS = ['enchantMods', 'implicitMods', 'fracturedMods', 'explicitMods', 'craftedMods', 'crucibleMods', 'scourgeMods']
const asArray = (value) => Array.isArray(value) ? value : []

function gggText(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  for (const key of ['description', 'text', 'name']) {
    if (typeof value[key] === 'string') return value[key]
  }
  return ''
}

export function modLines(value) {
  const entries = Array.isArray(value) ? value : [value]
  return entries.flatMap((entry) => gggText(entry).split(/\r?\n/)).map((line) => line.trim()).filter(Boolean)
}

function propertyValues(property) {
  return asArray(property?.values).flatMap((entry) => {
    const raw = Array.isArray(entry) ? entry[0] : entry
    const text = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : gggText(raw)
    return text ? [[text, Array.isArray(entry) ? entry[1] : 0]] : []
  })
}

function normalizeProperties(properties) {
  return asArray(properties).flatMap((property) => {
    const name = gggText(property?.name)
    return name ? [{ ...property, name, values: propertyValues(property) }] : []
  })
}

function normalizeGggItem(item) {
  return { ...item,
    ...Object.fromEntries(MOD_FIELDS.map((key) => [key, modLines(item[key])])),
    properties: normalizeProperties(item.properties),
    requirements: normalizeProperties(item.requirements),
    socketedItems: asArray(item.socketedItems).filter((entry) => entry && typeof entry === 'object').map(normalizeGggItem),
  }
}

export const modsOf = (item) => MOD_FIELDS.flatMap((key) => modLines(item?.[key]))

export function encodePob(xml) {
  const bytes = deflate(xml)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_')
}

export function decodePob(input) {
  const code = input.replace(/\s/g, '')
  if (!code || code.length > MAX_CODE_LENGTH || !/^[\w+/=-]+$/.test(code)) throw new Error('Mã PoB không hợp lệ hoặc vượt quá 512 KB.')
  try {
    const bytes = Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    const inflater = new Inflate({ chunkSize: 16384 })
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let xml = ''
    let size = 0
    inflater.onData = (chunk) => {
      size += chunk.byteLength
      if (size > MAX_XML_LENGTH) throw new Error('PoB XML vượt quá 8 MB.')
      xml += decoder.decode(chunk, { stream: true })
    }
    inflater.push(bytes, true)
    xml += decoder.decode()
    if (inflater.err || !xml) throw new Error('Invalid zlib stream')
    return xml
  } catch (error) { throw new Error(`Không giải nén được mã PoB: ${error.message}`) }
}

export function recentBuilds(storage) {
  try {
    storage ??= globalThis.localStorage
    const entries = JSON.parse(storage.getItem(BUILD_CACHE_KEY) || '[]')
    if (!Array.isArray(entries)) return []
    const seen = new Set()
    return entries.flatMap((entry, index) => {
      const code = typeof entry === 'string' ? entry : entry?.code
      if (typeof code !== 'string' || !code || code.length > MAX_CODE_LENGTH || seen.has(code)) return []
      seen.add(code)
      const label = typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim().slice(0, 200) : `Build đã lưu ${index + 1}`
      const sourceUrl = typeof entry?.sourceUrl === 'string' && /^https:\/\/pobb\.in\/[\w-]{1,100}$/.test(entry.sourceUrl) ? entry.sourceUrl : ''
      return [{ code, label, ...(sourceUrl ? { sourceUrl } : {}) }]
    }).slice(0, 5)
  } catch { return [] }
}

export function cacheBuild(code, storage, label = '', sourceUrl = '') {
  try {
    storage ??= globalThis.localStorage
    if (typeof code !== 'string' || !code || code.length > MAX_CODE_LENGTH) return false
    const previous = recentBuilds(storage)
    const name = label || previous.find((entry) => entry.code === code)?.label || 'PoB build'
    sourceUrl = /^https:\/\/pobb\.in\/[\w-]{1,100}$/.test(sourceUrl) ? sourceUrl : ''
    storage.setItem(BUILD_CACHE_KEY, JSON.stringify([{ code, label: name.slice(0, 200), ...(sourceUrl ? { sourceUrl } : {}) }, ...previous.filter((entry) => entry.code !== code && (!sourceUrl || entry.sourceUrl !== sourceUrl))].slice(0, 5)))
    return true
  } catch { return false }
}

export const cachedCodes = (storage) => recentBuilds(storage).map((entry) => entry.code)

export function buildLabel(build) {
  const character = build.character || {}
  const group = build.skills?.[build.mainSkill || 0]
  const main = group?.gems.filter((gem) => !gem.support && gem.enabled)[group.mainActiveSkill || 0]
  return [character.name && character.name !== 'Imported build' ? character.name : '', character.class, character.level ? `Lv ${character.level}` : '', main?.name].filter(Boolean).join(' · ').slice(0, 200) || 'PoB build'
}

export function itemText(item) {
  const rarity = ['Normal', 'Magic', 'Rare', 'Unique', 'Gem', 'Currency'][item.frameType] || 'Rare'
  const lines = [`Rarity: ${rarity.toUpperCase()}`, item.name || item.baseType || item.typeLine]
  if (item.name) lines.push(item.baseType || item.typeLine)
  for (const property of normalizeProperties(item.properties)) {
    if (['Quality', 'Armour', 'Evasion Rating', 'Energy Shield', 'Physical Damage', 'Elemental Damage', 'Critical Strike Chance', 'Attacks per Second'].includes(property.name)) {
      lines.push(`${property.name}: ${property.values.map(([value]) => value).join(', ').replace(/ \(augmented\)/g, '')}`)
    }
  }
  lines.push(`Item Level: ${item.ilvl || 1}`)
  if (item.sockets?.length) {
    const groups = []
    for (const socket of item.sockets) {
      const color = ({ S: 'R', D: 'G', I: 'B', G: 'W', A: 'A' })[socket.attr] || socket.sColour || 'W'
      if (!groups[socket.group]) groups[socket.group] = []
      groups[socket.group].push(color)
    }
    lines.push(`Sockets: ${groups.filter(Boolean).map((group) => group.join('-')).join(' ')}`)
  }
  const implicits = [...modLines(item.enchantMods).map((mod) => `${mod} {enchant}`), ...modLines(item.implicitMods)]
  lines.push(`Implicits: ${implicits.length}`, ...implicits)
  lines.push(...modLines(item.fracturedMods).map((mod) => `${mod} {fractured}`), ...modLines(item.explicitMods), ...modLines(item.craftedMods).map((mod) => `${mod} {crafted}`), ...modLines(item.crucibleMods), ...modLines(item.scourgeMods))
  if (item.corrupted) lines.push('Corrupted')
  return lines.join('\n')
}

export function parseItemText(text, id) {
  if (typeof text !== 'string') throw new Error('PoB item text must be a string.')
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const rarity = lines[0]?.replace(/^Rarity:\s*/i, '').toLowerCase()
  const frameType = { normal: 0, magic: 1, rare: 2, unique: 3, gem: 4, currency: 5, relic: 9 }[rarity] ?? 2
  const named = [2, 3, 9].includes(frameType)
  const start = named ? 3 : 2
  const item = { id, rawText: text, name: named ? lines[1] : '', baseType: lines[named ? 2 : 1], frameType, properties: [], sockets: [], implicitMods: [], fracturedMods: [], explicitMods: [], craftedMods: [], enchantMods: [] }
  let implicitCount = 0
  const metadata = /^(?:Quality|Armour|Evasion Rating|Energy Shield|Item Level|LevelReq|Requires|Unique ID|League|Crafted|Prefix|Suffix|Variant|Selected Variant|Has Alt Variant|Selected Alt Variant|Catalyst|CatalystQuality|Radius|Limited to|Jewel|Shaper Item|Elder Item|Crusader Item|Hunter Item|Redeemer Item|Warlord Item|Synthesised Item|Fractured Item|Mirrored|Unreleased|Source|Tags|Sockets|Physical Damage|Elemental Damage|Chaos Damage|Critical Strike Chance|Attacks per Second|Weapon Range|Ward|Evasion|EnergyShield|Unidentified)(?::|$)/i
  const selectedVariant = Number(lines.find((line) => line.startsWith('Selected Variant:'))?.split(':')[1] || 1)
  for (const line of lines.slice(start)) {
    if (line.startsWith('Implicits:')) { implicitCount = Number(line.split(':')[1]); continue }
    if (line.startsWith('Sockets:')) {
      line.slice(8).trim().split(' ').forEach((group, index) => group.split('-').forEach((color) => item.sockets.push({ group: index, sColour: color })))
      continue
    }
    if (line === 'Corrupted') { item.corrupted = true; continue }
    if (metadata.test(line)) {
      if (/^(Quality|Armour|Evasion Rating|Energy Shield|Radius):/.test(line)) item.properties.push({ name: line.split(':')[0], values: [[line.split(':').slice(1).join(':').trim(), 0]] })
      continue
    }
    const isImplicit = implicitCount > 0
    if (isImplicit) implicitCount--
    const variants = line.match(/\{variant:([^}]+)\}/)?.[1]
    if (variants && !variants.split(',').map(Number).includes(selectedVariant)) continue
    const key = line.includes('{crafted}') ? 'craftedMods' : line.includes('{fractured}') ? 'fracturedMods' : line.includes('{enchant}') ? 'enchantMods' : isImplicit ? 'implicitMods' : 'explicitMods'
    const cleanLine = line.replace(/\{[^}]*\}/g, '').trim()
    // A colon is valid mod text (notably "Added Small Passive Skills grant:").
    // Known item metadata was filtered above; never discard remaining mods just
    // because the export omitted an "Implicits:" header.
    if (cleanLine) item[key].push(cleanLine)
  }
  return item
}

const propNumber = (gem, name, fallback) => {
  const property = asArray(gem.properties).find((prop) => prop?.name === name)
  const value = propertyValues(property)[0]?.[0]
  if (typeof value !== 'string') return fallback
  return Number(value.match(/[\d.]+/)?.[0] || fallback)
}
function supportedSkill(gem, supports) {
  const name = canonicalSkillName(gem.name || '')
  const generosity = supports.find((support) => /^(?:Awakened )?Generosity Support$/i.test(support.name))
  const empower = supports.filter((support) => supportData(support)?.modifiers.some(mod => mod.stat === 'level'))
  const supportNotes = [...(gem.supportNotes || [])]
  if (gem.isGranted && empower.length) supportNotes.push('Empower affects skill gems only; item-granted skill level is unchanged.')
  const appliesToSelf = gem.appliesToSelf !== false && !(generosity && isSelfAura(name))
  if (generosity && !appliesToSelf) supportNotes.push(`${generosity.name}: aura does not affect you.`)
  return { ...gem, name, appliesToSelf, supportNotes: [...new Set(supportNotes)] }
}

export function gggSkills(items, allocated = [], jewels = []) {
  const entries = gggEquipmentEntries(items)
  const groups = entries.flatMap(([slot, item]) => {
    if (['Weapon2', 'Offhand2', 'Flask', 'PassiveJewels'].includes(item.inventoryId)) return []
    const groups = new Map()
    for (const gem of item.socketedItems || []) {
      if (gem.frameType !== 4) continue
      const group = item.sockets?.[gem.socket]?.group ?? gem.socket
      if (!groups.has(group)) groups.set(group, [])
      const tags = propertyValues(asArray(gem.properties).find((prop) => prop?.name === 'Tags'))[0]?.[0] || asArray(gem.properties).filter(prop => typeof prop?.name === 'string' && !prop.values?.length && /^[A-Za-z, ]+$/.test(prop.name)).map(prop => prop.name).join(', ')
      groups.get(group).push({ name: gem.baseType || gem.typeLine, level: propNumber(gem, 'Level', 1), quality: propNumber(gem, 'Quality', 0), socketIndex: gem.socket, skillTags: tags.split(',').map(tag => tag.trim()).filter(Boolean), support: Boolean(gem.support || /Support/.test(tags) || /Support$/.test(gem.typeLine)), icon: gem.icon, description: gem.descrText || gem.secDescrText || '', statLines: modsOf(gem), enabled: gem.enabled !== false })
    }
    const grantedBy = item.name || item.baseType || item.typeLine || 'Equipment'
    const sourceItemName = itemSource(item).label
    const granted = new Map()
    for (const line of modsOf(item)) {
      // GGG uses linked stat text, e.g. [PurityOfElements::10|Purity of Elements],
      // and may omit the trailing word "Skill" entirely.
      const text = line.replace(/<<[^>]*>>|<[^>]*>/g, '').replace(/\[[^\]|]+\|([^\]]+)\]/g, '$1').replace(/\[([^\]]+)\]/g, '$1').replace(/\s+/g, ' ').trim()
      if (/\b(?:Trigger|while|when|if)\b/i.test(text)) continue
      const match = text.match(/^Grants Level (\d+) ([A-Za-z0-9 '’:\-]+?)(?: Skill)?(?:\s*\([^)]*\))?$/i)
      if (!match) continue
      const name = match[2].trim(), key = name.toLowerCase(), level = Number(match[1])
      if (!granted.has(key) || level > granted.get(key).level) granted.set(key, { name, level, sourceItemName, isGranted: true, quality: 0, enabled: true, support: false, color: 'W', grantedBy })
    }
    const allSupports = [...groups.values()].flat().filter((gem) => gem.support && gem.enabled)
    return [...groups.entries()].map(([socketGroup, gems]) => ({ slot, socketGroup, gems, enabled: true, links: item.sockets?.filter((socket) => socket.group === socketGroup).length || gems.length }))
      .concat(granted.size ? [{ slot, gems: [...granted.values()].map((gem) => supportedSkill(gem, allSupports)), enabled: true, grantedBy }] : [])
  })
  const equipment = Object.fromEntries(entries)
  return withSocketedQuality(groups, equipment, [...jewels, ...items.filter(item => item.inventoryId === 'PassiveJewels')], allocated).map(group => ({ ...group, gems: group.gems.map(gem => gem.support ? gem : supportedSkill(gem, group.gems.filter(gem => gem.support && gem.enabled !== false))) }))
}

export function activeSkills(groups) {
  const selected = new Map()
  for (const group of groups) {
    if (!group.enabled) continue
    for (const gem of group.gems) {
      if (!gem.enabled || gem.support || typeof gem.name !== 'string' || !gem.name.trim()) continue
      const name = canonicalSkillName(gem.name)
      const previous = selected.get(name)
      const applies = gem.appliesToSelf !== false, previousApplies = previous?.appliesToSelf !== false
      if (!previous || applies && !previousApplies || applies === previousApplies && (gem.level > previous.level || gem.level === previous.level && gem.quality > previous.quality)) selected.set(name, { ...gem, name })
    }
  }
  return [...selected.values()]
}

export function auraBonuses(items, allocated, skills = activeSkills(gggSkills(items, allocated))) {
  let effect = 0
  for (const line of [...items.flatMap(modsOf), ...allocated.flatMap((node) => modLines(node?.stats))]) {
    const match = line.match(/^(\d+(?:\.\d+)?)% (increased|reduced) (?:effect of (?:(?:Non-Curse )?Auras from your Skills|Auras on you)|Aura Effect)$/i)
    if (match) effect += Number(match[1]) * (match[2].toLowerCase() === 'reduced' ? -1 : 1)
  }
  const totals = {}, effects = []
  for (const gem of skills) {
    const values = auraStats(gem.name, gem.level)
    if (!values) {
      if (gem.isGranted) effects.push({ ...gem, stats: {}, unsupported: true, note: 'No verified lightweight data for this skill/level; not included in totals.' })
      continue
    }
    if (gem.name === 'Discipline') values.EnergyShieldRechargeRate = 30
    if (/^Purity of /.test(gem.name)) {
      const key = Object.keys(values).find((key) => /Resist$/.test(key))
      if (key) values[key] += (gem.quality || 0) * (gem.name === 'Purity of Elements' ? 0.25 : 0.5)
    }
    const aspect = ASPECT_DATA[gem.name]
    const appliedEffect = aspect ? 0 : effect
    const multiplier = Math.max(0, 1 + appliedEffect / 100)
    const scaled = Object.fromEntries(Object.entries(values).map(([key, value]) => [key,
      /RegenFlat$/.test(key) ? value * multiplier : Math.floor(value * multiplier + 1e-8)]))
    if (gem.appliesToSelf !== false && !aspect) for (const [key, value] of Object.entries(scaled)) totals[key] = (totals[key] || 0) + value
    effects.push({ ...gem, isGranted: Boolean(gem.isGranted), baseStats: values, increasedAuraEffect: appliedEffect, isAspect: Boolean(aspect), note: aspect?.note, stats: scaled })
  }
  return { ...totals, effects }
}

export function exportGgg(character, items, passives, tree = {}) {
  const nodes = [...new Set([...(passives.hashes || []), ...(passives.hashes_ex || [])])]
  const classId = Number.isInteger(passives.character) ? passives.character : Math.max(0, tree.classes?.findIndex((entry) => entry.name === character.class || entry.ascendancies?.includes(character.class)) ?? 0)
  const ascendClassId = passives.ascendancy || 0
  const equipped = items.filter((item) => isEquippedInventoryItem(item) || item.inventoryId === 'PassiveJewels')
  const equipmentSlots = new Map(gggEquipmentEntries(equipped).map(([slot, item]) => [item, slot]))
  const skills = gggSkills(equipped).filter((group) => !group.grantedBy)
  const masteryEffects = Object.entries(passives.mastery_effects || {}).map(([id, effect]) => `{${id},${effect}}`).join(',')
  const socketsXml = equipped.map((item, index) => {
    const slot = passives.jewel_slots?.[item.x] ?? tree.jewelSlots?.[item.x]
    const nodeId = typeof slot === 'object' ? slot?.nodeId ?? slot?.id ?? slot?.node : slot
    return item.inventoryId === 'PassiveJewels' && nodeId != null ? `<Socket nodeId="${escapeXml(nodeId)}" itemId="${index + 1}"/>` : ''
  }).join('')
  const itemsXml = equipped.map((item, index) => `<Item id="${index + 1}">${escapeXml(itemText(item))}</Item>`).join('')
  const slotsXml = equipped.map((item, index) => item.inventoryId !== 'PassiveJewels' ? `<Slot name="${escapeXml(equipmentSlots.get(item))}" itemId="${index + 1}"/>` : '').join('')
  const skillsXml = skills.map((group) => `<Skill slot="${escapeXml(group.slot)}" enabled="true">${group.gems.filter(gem => !gem.isItemSupport).map((gem) => `<Gem nameSpec="${escapeXml(gem.name)}" level="${gem.baseLevel ?? gem.level}" quality="${gem.baseQuality ?? gem.quality}" enabled="true"/>`).join('')}</Skill>`).join('')
  const helperXml = escapeXml(JSON.stringify({ character, items: equipped, passives: { ...passives, items: undefined }, tree }))
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build targetVersion="3_0" level="${character.level || 1}" className="${escapeXml(tree.classes?.[classId]?.name || BASE_CLASSES[classId]?.name || character.class)}" ascendClassName="${escapeXml(character.class)}" mainSocketGroup="1"/>
  <Tree activeSpec="1"><Spec classId="${classId}" ascendClassId="${ascendClassId}" nodes="${nodes.join(',')}" masteryEffects="${escapeXml(masteryEffects)}"${tree.version ? ` treeVersion="${escapeXml(tree.version.replace(/\./g, '_'))}"` : ''}><Sockets>${socketsXml}</Sockets></Spec></Tree>
  <Items activeItemSet="1">${itemsXml}<ItemSet id="1">${slotsXml}</ItemSet></Items>
  <Skills activeSkillSet="1"><SkillSet id="1">${skillsXml}</SkillSet></Skills>
  <PoEHelper>${helperXml}</PoEHelper>
</PathOfBuilding>`
  return encodePob(xml)
}

export function decodeTreeUrl(url) {
  const bytes = Uint8Array.from(atob(url.trim().split('/').pop().replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  const version = view.getUint32(0)
  if (version < 1 || version > 7) throw new Error('Unsupported passive tree URL version')
  let offset = version >= 4 ? 7 : 6
  const count = version >= 5 ? bytes[6] : Math.floor((bytes.length - offset) / 2)
  const nodes = []
  for (let i = 0; i < count; i++, offset += 2) nodes.push(String(view.getUint16(offset)))
  if (version >= 5) {
    const clusters = bytes[offset++] || 0
    for (let i = 0; i < clusters; i++, offset += 2) nodes.push(String(view.getUint16(offset) + 65536))
  }
  const masteries = {}
  if (version >= 6) {
    const count = bytes[offset++] || 0
    for (let i = 0; i < count; i++, offset += 4) masteries[view.getUint16(offset + 2)] = view.getUint16(offset)
  }
  return { nodes, masteries }
}

export function parsePob(code) {
  const xml = decodePob(code)
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('PoB XML chứa khai báo không được hỗ trợ.')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror') || doc.documentElement.nodeName !== 'PathOfBuilding') throw new Error('XML không phải Path of Building hợp lệ.')
  // Diagnostic only: includes inactive items/configs too, without applying them.
  // Split tags as well as newlines so a minified export cannot log the whole XML.
  if (import.meta.env?.DEV) console.log('[Raw Quality Lines]', xml.split(/[\r\n<>]+/).filter(line => /Quality/i.test(line)))
  const helper = doc.querySelector('PoEHelper')
  if (helper && !doc.querySelector('Build > PlayerStat')) {
    const source = JSON.parse(helper.textContent)
    return fromGgg(source.character, { items: source.items, passives: source.passives }, source.tree, code)
  }
  const build = doc.querySelector('Build')
  if (!build) throw new Error('PoB thiếu thông tin Build.')
  const stats = Object.fromEntries([...build.querySelectorAll('PlayerStat')].filter((entry) => entry.getAttribute('value')?.trim()).map((entry) => [entry.getAttribute('stat'), Number(entry.getAttribute('value'))]).filter(([, value]) => Number.isFinite(value)))
  const tree = doc.querySelector('Tree')
  const specs = [...(tree?.querySelectorAll('Spec') || [])]
  const spec = specs[Number(tree?.getAttribute('activeSpec') || 1) - 1] || specs[0]
  let nodes = (spec?.getAttribute('nodes') || '').split(/[\s,]+/).filter(Boolean)
  const treeUrl = spec?.querySelector('URL')?.textContent?.trim()
  let urlMasteries = {}
  if (!nodes.length && treeUrl) {
    try {
      const decoded = decodeTreeUrl(treeUrl)
      nodes = decoded.nodes
      urlMasteries = decoded.masteries
    } catch { /* The allocated IDs attribute is preferred by modern PoB. */ }
  }
  const masteries = { ...urlMasteries, ...Object.fromEntries([...(spec?.getAttribute('masteryEffects') || '').matchAll(/\{\s*(\d+)\s*,\s*(\d+)\s*\}/g)].map((match) => [match[1], Number(match[2])])) }
  nodes = [...new Set([...nodes, ...Object.keys(masteries)])]
  const allItems = new Map([...doc.querySelectorAll('Items > Item')].map((entry) => [entry.getAttribute('id'), parseItemText(entry.textContent, entry.getAttribute('id'))]))
  const itemsElement = doc.querySelector('Items')
  const itemSet = [...doc.querySelectorAll('Items > ItemSet')].find((entry) => entry.getAttribute('id') === itemsElement?.getAttribute('activeItemSet')) || doc.querySelector('Items > ItemSet') || itemsElement
  const equipment = Object.fromEntries([...(itemSet?.querySelectorAll('Slot') || [])].map((slot) => [slot.getAttribute('name'), allItems.get(slot.getAttribute('itemId'))]).filter(([, item]) => item))
  const specSockets = [...(spec?.querySelectorAll('Socket') || [])]
  const sockets = specSockets.length ? specSockets : [...(tree?.children || [])].filter(entry => entry.nodeName === 'Sockets').flatMap(entry => [...entry.children].filter(child => child.nodeName === 'Socket'))
  const overrides = normalizeOverrides(Object.fromEntries([...(spec?.querySelectorAll('Overrides > Node, Overrides > Override') || [])].map(entry => [entry.getAttribute('nodeId'), {
    nodeId: entry.getAttribute('nodeId'), name: entry.getAttribute('name') || entry.getAttribute('dn'),
    stats: entry.textContent, icon: entry.getAttribute('icon'),
  }])))
  const socketedJewels = sockets.flatMap(socket => {
    const item = allItems.get(socket.getAttribute('itemId'))
    return item ? [{ nodeId: socket.getAttribute('nodeId'), item }] : []
  })
  const jewels = sockets.map((socket) => allItems.get(socket.getAttribute('itemId'))).filter(Boolean)
  const clusterJewels = sockets.flatMap((socket) => {
    const item = allItems.get(socket.getAttribute('itemId'))
    return item && /^(Small|Medium|Large) Cluster Jewel$/.test(item.baseType) ? [{ nodeId: socket.getAttribute('nodeId'), baseType: item.baseType, mods: modsOf(item) }] : []
  })
  const skillsElement = doc.querySelector('Skills')
  const skillSet = [...doc.querySelectorAll('Skills > SkillSet')].find((entry) => entry.getAttribute('id') === skillsElement?.getAttribute('activeSkillSet')) || doc.querySelector('Skills > SkillSet') || skillsElement
  const config = doc.querySelector('Config')
  const configSet = [...(config?.querySelectorAll('ConfigSet') || [])].find(entry => entry.getAttribute('id') === config?.getAttribute('activeConfigSet')) || config?.querySelector('ConfigSet') || config
  const customMods = [...(configSet?.querySelectorAll('Input') || [])].filter(entry => /^(?:customMods|customModifiers)$/i.test(entry.getAttribute('name') || '')).flatMap(entry => modLines(entry.getAttribute('string') ?? entry.textContent))
  if (import.meta.env?.DEV) {
    const slots = [...(itemSet?.querySelectorAll('Slot') || [])]
    console.log('[Special Items & Config]', {
      activeItemSet: itemSet?.getAttribute('id') || itemsElement?.getAttribute('activeItemSet') || 'legacy',
      itemSets: [...doc.querySelectorAll('Items > ItemSet')].map(set => ({ id: set.getAttribute('id'), title: set.getAttribute('title'), slots: [...set.querySelectorAll('Slot')].map(slot => ({ slot: slot.getAttribute('name'), itemId: slot.getAttribute('itemId') })) })),
      items: [...allItems.values()].flatMap(item => {
        const equippedSlots = slots.filter(slot => slot.getAttribute('itemId') === item.id).map(slot => slot.getAttribute('name'))
        return /\+10% to Quality of all Skill Gems/i.test(item.rawText) || equippedSlots.some(slot => /Graft|Trinket|Ring|Belt|Gloves|Boots|Weapon|Shield|Offhand/i.test(slot))
          ? [{ itemId: item.id, equippedSlots, active: equippedSlots.length > 0 || jewels.includes(item), rawText: item.rawText }] : []
      }),
      configXml: config?.outerHTML || '',
      gemQualityAttributes: [...(skillSet?.querySelectorAll('Gem') || [])].map(gem => ({ name: gem.getAttribute('nameSpec') || gem.getAttribute('skillId'), slot: gem.parentElement?.getAttribute('slot'), attributes: Object.fromEntries([...gem.attributes].filter(attr => /quality/i.test(attr.name)).map(attr => [attr.name, attr.value])) })),
      qualityPlayerStats: [...doc.querySelectorAll('PlayerStat')].filter(stat => /quality/i.test(stat.getAttribute('stat') || '')).map(stat => ({ parent: stat.parentElement.nodeName, slot: stat.parentElement.getAttribute('slot'), stat: stat.getAttribute('stat'), value: stat.getAttribute('value') })),
    })
  }
  const conditions = Object.fromEntries([...(configSet?.querySelectorAll('Input') || [])].flatMap(entry => {
    const number = entry.getAttribute('number')
    return number != null && Number.isFinite(Number(number)) ? [[entry.getAttribute('name'), Number(number)]] : []
  }))
  const skills = withSocketedQuality([...(skillSet?.querySelectorAll('Skill') || [])].map((group) => ({
    slot: group.getAttribute('slot') || group.getAttribute('label') || 'Skill group',
    enabled: group.getAttribute('enabled') !== 'false',
    includeInFullDPS: group.getAttribute('includeInFullDPS') === 'true',
    mainActiveSkill: Number(group.getAttribute('mainActiveSkill') || 1) - 1,
    stats: Object.fromEntries([...group.children].filter(entry => entry.nodeName === 'PlayerStat' && entry.getAttribute('value')?.trim()).map(entry => [entry.getAttribute('stat'), Number(entry.getAttribute('value'))]).filter(([, value]) => Number.isFinite(value))),
    gems: [...group.querySelectorAll('Gem')].map((gem) => ({
      name: gem.getAttribute('nameSpec') || gem.getAttribute('skillId') || 'Unknown gem',
      level: Number(gem.getAttribute('level') || 1), baseQuality: Number.parseInt(gem.getAttribute('quality') || '0', 10) || 0,
      quality: Number.parseInt(gem.getAttribute('quality') || '0', 10) || 0, qualityId: gem.getAttribute('qualityId') || 'Default',
      // Standard PoB `quality` is the gem's base quality. Only explicitly named
      // final/effective values can override the calculated result.
      savedFinalQuality: [
        ...['finalQuality', 'effectiveQuality'].map(name => gem.getAttribute(name)),
        ...[...gem.children].filter(entry => entry.nodeName === 'PlayerStat' && /^(?:(?:Final|Effective)?(?:Gem|SkillGem)?)Quality$/i.test(entry.getAttribute('stat') || '')).map(entry => entry.getAttribute('value')),
      ].filter(value => value != null && value.trim() !== '').map(Number).find(value => Number.isFinite(value) && value >= 0),
      support: /Support/.test(gem.getAttribute('skillId') || gem.getAttribute('nameSpec') || ''),
      enabled: gem.getAttribute('enabled') !== 'false', color: gem.getAttribute('color') || 'W',
      socketIndex: gem.hasAttribute('socket') && Number(gem.getAttribute('socket')) > 0
        ? Number(gem.getAttribute('socket')) - 1
        : gem.hasAttribute('socketId') ? Number(gem.getAttribute('socketId')) : undefined,
    })),
  })), equipment, jewels, [], conditions, customMods)
  // PoB item text often omits sockets. Skills supply the link groups in that case.
  const missingSockets = new Set(Object.values(equipment).filter(item => !item.sockets.length))
  const inferredGroups = new Map()
  for (const group of skills) {
    const item = equipment[group.slot]
    if (item && missingSockets.has(item)) {
      const socketGroup = inferredGroups.get(group.slot) || 0
      inferredGroups.set(group.slot, socketGroup + 1)
      group.socketGroup = socketGroup
      for (const gem of group.gems.filter(gem => !gem.isItemSupport)) {
        gem.socketIndex = item.sockets.length
        item.sockets.push({ group: socketGroup, sColour: gem.color })
      }
    }
  }
  return completePobStats({ source: 'pob', code, conditions, customMods, character: { name: build.getAttribute('name') || 'Imported build', level: Number(build.getAttribute('level')), class: build.getAttribute('ascendClassName') || build.getAttribute('className') }, stats, equipment, jewels, skills, mainSkill: Number(build.getAttribute('mainSkillIndex') || build.getAttribute('mainSocketGroup') || 1) - 1, tree: { nodes, masteries, overrides, socketedJewels, url: treeUrl, classId: Number(spec?.getAttribute('classId') || 0), ascendClassId: Number(spec?.getAttribute('ascendClassId') || 0), version: spec?.getAttribute('treeVersion') || '', allocated: [], clusterJewels } })
}

export function basicStats(items, allocated, base = {}, trace) {
  const totals = { FireResist: -60, ColdResist: -60, LightningResist: -60, ChaosResist: -60, Str: base.base_str ?? 0, Dex: base.base_dex ?? 0, Int: base.base_int ?? 0, LifeInc: 0, EnergyShieldInc: 0 }
  const lines = [...items.flatMap((item) => modsOf(item).map((line) => [line, itemSource(item)])), ...allocated.flatMap((node) => modLines(node?.stats).map((line) => [line, nodeSource(node)]))]
  for (const [line, source] of lines) {
    if (typeof line !== 'string') continue
    // Only unconditional whole-line modifiers: local and conditional stats must not inflate totals.
    const resistance = resistanceMod(line)
    if (resistance && !resistance.maximum) for (const element of resistance.elements) {
      totals[`${element}Resist`] += resistance.value
      recordStat(trace, `${element}Resist`, source, 'Base / Flat', resistance.value, '%', line)
    }
    let match = line.match(/^\+?(\d+) to (Strength|Dexterity|Intelligence|all Attributes|(?:Strength|Dexterity|Intelligence)(?: and |, )(?:Strength|Dexterity|Intelligence))$/i)
    if (match) for (const [attribute, stat] of [['Strength', 'Str'], ['Dexterity', 'Dex'], ['Intelligence', 'Int']]) {
      if (match[2] === 'all Attributes' || match[2].includes(attribute)) totals[stat] += Number(match[1])
    }
    match = line.match(/^(\d+)% increased maximum (Life|Energy Shield)$/i)
    if (match) totals[match[2].toLowerCase() === 'life' ? 'LifeInc' : 'EnergyShieldInc'] += Number(match[1])
  }
  for (const element of ['Fire', 'Cold', 'Lightning', 'Chaos']) recordStat(trace, `${element}Resist`, baseSource('Base (Campaign Penalty)'), 'Base / Flat', -60, '%')
  return totals
}

export const ESTIMATED_CORE_KEYS = ['Life', 'Mana', 'EnergyShield', 'Armour', 'Evasion', 'BlockChance', 'SpellBlockChance', 'SpellSuppressionChance']
const ESTIMATED_RECOVERY_KEYS = ['PhysicalDamageTakenAsFire', 'PhysicalDamageTakenAsCold', 'PhysicalDamageTakenAsLightning', 'PhysicalDamageTakenAsChaos', 'LifeRegen', 'ManaRegen', 'EnergyShieldRecharge', 'LifeRecoup', 'LifeRecoupRecovery']
const ELEMENTS = ['Fire', 'Cold', 'Lightning', 'Chaos']
const ESTIMATED_HIT_KEYS = ['TotalEHP', ...['Physical', ...ELEMENTS].map((element) => `${element}MaximumHitTaken`)]

function purityAuraBonuses(items, allocated, bonuses = auraBonuses(items, allocated)) {
  return Object.fromEntries(ELEMENTS.map((element) => [element, {
    resistance: (bonuses[`${element}Resist`] || 0) + (element !== 'Chaos' ? bonuses.ElementalResist || 0 : 0),
    maximum: bonuses[`${element}ResistMax`] || 0,
  }]))
}

const appliedAuraEffects = (auras) => (auras.effects || []).filter((effect) => effect.appliesToSelf !== false && !effect.unsupported && !effect.isAspect)

function resistanceCaps(items, allocated, auras = purityAuraBonuses(items, allocated), trace) {
  const caps = Object.fromEntries(ELEMENTS.map((element) => [element, 75]))
  for (const element of ELEMENTS) recordStat(trace, `${element}Resist`, baseSource('Base maximum resistance'), 'Maximum Cap', 75, '%')
  const sources = [...items.flatMap((item) => modsOf(item).map((line) => [line, itemSource(item)])), ...allocated.flatMap((node) => modLines(node?.stats).map((line) => [line, nodeSource(node)]))]
  for (const [line, source] of sources) {
    const match = resistanceMod(line)
    if (!match?.maximum) continue
    for (const element of match.elements) {
      caps[element] += match.value
      recordStat(trace, `${element}Resist`, source, 'Maximum Cap', match.value, '%', line)
    }
  }
  for (const element of ELEMENTS) caps[element] += auras[element].maximum
  if (allocated.some((node) => /^Valako, Storm['’]s Embrace$/i.test(node?.name || ''))) {
    for (const element of ['Cold', 'Lightning']) recordStat(trace, `${element}Resist`, { label: "Valako, Storm's Embrace (match maximum Fire Resistance)", category: 'ASCENDANCY' }, 'Maximum Cap', caps.Fire - caps[element], '%')
    caps.Cold = caps.Fire
    caps.Lightning = caps.Fire
  }
  for (const element of ELEMENTS) if (caps[element] > 90) recordStat(trace, `${element}Resist`, baseSource('Game maximum resistance limit (90%)'), 'Maximum Cap', 90 - caps[element], '%')
  return Object.fromEntries(ELEMENTS.map((element) => [element, Math.min(90, caps[element])]))
}

export function estimateResistances(items, allocated, uncapped, trace, suppliedAuras) {
  const totals = { ...uncapped }
  const auras = purityAuraBonuses(items, allocated, suppliedAuras)
  for (const element of ELEMENTS) totals[`${element}Resist`] = (totals[`${element}Resist`] || 0) + auras[element].resistance
  for (const effect of appliedAuraEffects(suppliedAuras || auraBonuses(items, allocated))) for (const element of ELEMENTS) {
    const value = (effect.stats[`${element}Resist`] || 0) + (element !== 'Chaos' ? effect.stats.ElementalResist || 0 : 0)
    if (value) recordStat(trace, `${element}Resist`, skillSource(effect), 'Base / Flat', value, '%', `floor(${(effect.baseStats[`${element}Resist`] || 0) + (element !== 'Chaos' ? effect.baseStats.ElementalResist || 0 : 0)} × (1 + ${effect.increasedAuraEffect} / 100)) = ${value}% · Lv ${effect.level}${effect.sourceItemName ? ` · ${effect.sourceItemName}` : ''}`)
    if (effect.stats[`${element}ResistMax`]) recordStat(trace, `${element}Resist`, skillSource(effect), 'Maximum Cap', effect.stats[`${element}ResistMax`], '%', 'Includes aura effect')
  }
  if (allocated.some((node) => /^Tasalio, Cleansing Water$/i.test(node?.name || ''))) {
    // basicStats already includes Kitava's -60. Inherit bonuses BEFORE that penalty.
    const inherited = Math.floor((totals.FireResist + 60) * 0.5)
    totals.ColdResist += inherited
    totals.LightningResist += inherited
    for (const element of ['Cold', 'Lightning']) recordStat(trace, `${element}Resist`, { label: 'Tasalio, Cleansing Water (50% Fire Res before campaign penalty)', category: 'ASCENDANCY' }, 'Conversion', inherited, '%')
  }
  const caps = resistanceCaps(items, allocated, auras, trace)
  return Object.fromEntries(ELEMENTS.flatMap((element) => {
    const total = totals[`${element}Resist`] || 0
    return [[`${element}Resist`, Math.max(-200, Math.min(total, caps[element]))], [`${element}ResistTotal`, total], [`${element}ResistMax`, caps[element]], [`${element}ResistOverCap`, Math.max(0, total - caps[element])]]
  }))
}

export function estimateMaximumHits(items, allocated, stats) {
  const caps = resistanceCaps(items, allocated)
  const multipliers = Object.fromEntries(ELEMENTS.map((element) => [element, 1 - Math.max(-200, Math.min(stats[`${element}Resist`] || 0, caps[element])) / 100]))
  const life = Math.max(0, stats.Life || 0), es = Math.max(0, stats.EnergyShield || 0)
  const pool = life + es, armour = Math.max(0, stats.Armour || 0)
  const conversion = ELEMENTS.map((element) => Math.max(0, stats[`PhysicalDamageTakenAs${element}`] || 0) / 100)
  const total = conversion.reduce((sum, value) => sum + value, 0)
  const portions = conversion.map((value) => value / Math.max(1, total))
  const physicalPortion = Math.max(0, 1 - total)
  // Solve the physical hit after conversion and armour (A / (A + 5D), capped at 90%).
  // Reference: PathOfBuildingCommunity/PathOfBuilding src/Modules/CalcDefence.lua, armourReductionF.
  // Chaos bypasses ES. A split hit must fit both the total pool and the life-only pool.
  const survives = (hit) => {
    const physical = hit * physicalPortion
    const reduction = armour + physical * 5 > 0 ? Math.min(0.9, armour / (armour + physical * 5)) : 0
    const converted = portions.map((portion, index) => hit * portion * multipliers[ELEMENTS[index]])
    return physical * (1 - reduction) + converted.reduce((sum, value) => sum + value, 0) <= pool && converted[3] <= life
  }
  let low = 0, high = pool * 30 + armour + 1
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2
    if (survives(middle)) low = middle
    else high = middle
  }
  const hits = { PhysicalMaximumHitTaken: Math.floor(low + 1e-7) }
  for (const element of ELEMENTS) hits[`${element}MaximumHitTaken`] = Math.floor((element === 'Chaos' ? life : pool) / multipliers[element] + 1e-7)
  // Conservative reference: the weakest single-type hit, without avoidance/recovery or enemy configuration.
  return { ...hits, TotalEHP: Math.min(...Object.values(hits)) }
}

export function mergeAllocatedPassives(build, metadata) {
  const selected = new Set([...build.tree.nodes.map(String), ...Object.keys(build.tree.masteries || {})])
  // An allocated socket may be saved under its static proxy ID or its
  // generated/native ID. Resolve aliases before filtering selected nodes.
  const resolved = new Map()
  for (const node of [...(build.tree.allocated || []), ...(metadata.nodes || []), ...(metadata.clusterNodes || [])]) {
    if (!node) continue
    const id = [node.id, ...(node.aliases || [])].map(String).find(id => selected.has(id))
    if (id) resolved.set(id, { ...node, id, stats: modLines(node.stats) })
  }
  const allocated = applyOverrides([...resolved.values()], build.tree.overrides)
  const found = new Set(allocated.flatMap(node => [String(node.id), ...(node.aliases || []).map(String)]))
  const missingIds = [...selected].filter((id) => !found.has(id))
  return withPobGemQuality({ ...build, tree: { ...build.tree, allocated, missingIds, resolution: metadata.resolution },
    ...(missingIds.length ? { warning: `Chưa phân giải được ${missingIds.length} passive/cluster node; các chỉ số tính từ mod có thể còn thiếu.` } : {}),
  })
}

export function withPobbinRecovery(build, values) {
  const recovery = Object.fromEntries(['NetLifeRegen', 'ManaRegenRecovery', 'EnergyShieldRecharge', 'LifeRecoupRecovery']
    .filter((key) => Number.isFinite(values?.[key])).map((key) => [key, values[key]]))
  if (!Object.keys(recovery).length) return build
  const result = { ...build, recovery }
  return { ...result, breakdown: { ...build.breakdown, ...snapshotBreakdown(result) } }
}

export function completePobStats(build) {
  // Remember original keys, so loading passive metadata can recompute fallbacks without
  // mistaking an earlier estimate (or a default zero) for a saved PlayerStat.
  const savedStatKeys = build.savedStatKeys || Object.keys(build.stats)
  const savedResistanceStats = build.savedResistanceStats || Object.fromEntries(Object.entries(build.stats).filter(([key]) => /resist/i.test(key)))
  const saved = { ...Object.fromEntries(savedStatKeys.map((key) => [key, build.stats[key]])), ...savedResistanceStats }
  const stats = { ...saved }, estimatedStats = []
  const savedEntries = Object.entries(saved).filter(([, value]) => Number.isFinite(value))
  function findSaved(aliases, predicate = () => false) {
    for (const alias of aliases) {
      const entry = savedEntries.find(([key]) => key.toLowerCase() === alias.toLowerCase())
      if (entry) return entry[1]
    }
    return savedEntries.find(([key]) => predicate(key.toLowerCase()))?.[1]
  }
  const equipment = Object.entries(build.equipment || {}).filter(([slot]) => !slot.includes('Swap'))
  const items = [...equipment.filter(([slot]) => !slot.startsWith('Flask')).map(([, item]) => item), ...(build.jewels || [])]
  const flasks = equipment.filter(([slot]) => slot.startsWith('Flask')).map(([, item]) => item)
  const allocated = build.tree?.allocated || []
  for (const element of ELEMENTS) {
    const effective = findSaved([`Effective${element}Resist`, `Effective${element}Resistance`, `${element}EffectiveResist`])
    // PoB's canonical Resist is already final; OverCap is excess, not resistance.
    const final = findSaved([`${element}Resist`, `${element}Resistance`]) ?? effective
    const total = findSaved([`${element}ResistTotal`, `${element}ResistanceTotal`])
    const overCap = findSaved([`${element}ResistOverCap`])
    const maximum = findSaved([`${element}ResistMax`, `${element}MaximumResistance`])
    const fromTotal = total === undefined ? undefined : overCap !== undefined && overCap > 0 ? total - overCap : Math.min(total, maximum ?? 75)
    const value = final ?? fromTotal
    // Never cap, inherit, apply auras or otherwise recalculate a saved PoB resistance.
    stats[`${element}Resist`] = value
    if (value !== undefined && overCap !== undefined) stats[`${element}ResistTotal`] = value + overCap
  }
  // Snapshot Core Stats are authoritative. Never call the GGG core/aura estimator here.
  const core = { Life: 0, Mana: 0, EnergyShield: 0, ...saved }
  const energyShield = findSaved(['EnergyShield'])
  const fallback = estimateRecoveryStats(items, allocated, { ...core, EnergyShield: energyShield ?? core.EnergyShield }, flasks, {})
  function fill(key, aliases, value, estimated = false) {
    const source = [key, ...aliases].find((name) => Number.isFinite(saved[name]))
    stats[key] = source ? saved[source] : value
    if (!source && estimated) estimatedStats.push(key)
  }
  fill('BlockChance', ['EffectiveBlockChance'], 0)
  fill('SpellBlockChance', ['EffectiveSpellBlockChance'], 0)
  fill('SpellSuppressionChance', ['EffectiveSpellSuppressionChance', 'SuppressionChance'], 0)
  for (const element of ELEMENTS) fill(`PhysicalDamageTakenAs${element}`, [`PhysicalTakenAs${element}`, `PhysicalDamageFromHitsTakenAs${element}`], fallback[`PhysicalDamageTakenAs${element}`], true)
  const netLife = findSaved(['NetLifeRegen'])
  if (netLife !== undefined) stats.NetLifeRegen = netLife
  else {
    const life = findSaved(['LifeRegenRecovery', 'LifeRegen'])
    stats.LifeRegenRecovery = life ?? fallback.LifeRegen
    if (life === undefined) estimatedStats.push('LifeRegenRecovery')
  }
  const mana = findSaved(['NetManaRegen', 'ManaRegenRecovery', 'ManaRegen'])
  stats.ManaRegenRecovery = mana ?? fallback.ManaRegen
  if (mana === undefined) estimatedStats.push('ManaRegenRecovery')
  const derived = deriveRecoveryStats(items, allocated, {
    EnergyShield: energyShield ?? core.EnergyShield,
    Life: findSaved(['Life', 'Spec:Life']),
    PhysicalMaximumHitTaken: findSaved(['PhysicalMaximumHitTaken', 'PhysicalMaxHit']),
  }, flasks, {})
  // Preserve a saved flat rate if available; otherwise use the same mod calculation as GGG.
  const recharge = findSaved(['EnergyShieldRecharge', 'ESRecharge', 'EnergyShieldRechargeRecovery'])
  stats.EnergyShieldRecharge = recharge ?? derived.EnergyShieldRecharge
  const recoup = findSaved(['LifeRecoupRecovery', 'LifeRecoupRecoveryMax', 'LifeRecoupRecoveryAvg'])
  stats.CalculatedLifeRecoupPercent = derived.LifeRecoup
  if (!Number.isFinite(stats.LifeRecoup)) stats.LifeRecoup = derived.LifeRecoup
  if (recoup !== undefined) stats.LifeRecoupRecovery = recoup
  else {
    stats.RecoupDuration = derived.RecoupDuration
    stats.RecoupHit = derived.RecoupHit
    if (derived.LifeRecoupRecovery !== undefined) stats.LifeRecoupRecovery = derived.LifeRecoupRecovery
  }
  const result = withPobGemQuality({ ...build, stats, savedStatKeys, savedResistanceStats, estimatedStats, recoveryNote: '', recoupCalculated: recoup === undefined })
  return { ...result, breakdown: snapshotBreakdown(result, snapshotContributions(result)) }
}

// Reconstruct source terms for inspection only. Saved PlayerStats remain immutable:
// these formulas are not the full PoB engine and must never replace its totals.
function snapshotContributions(build) {
  const trace = {}
  const entries = Object.entries(build.equipment || {}).filter(([slot]) => !/Swap/i.test(slot))
  const jewels = equippedJewels(build.equipment, build.jewels)
  const seen = new Set()
  const unique = list => list.filter(item => {
    const key = item.id || item
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const gear = unique([...entries.filter(([slot, item]) => !/^Flask/i.test(slot) && !isJewel(item)).map(([, item]) => item), ...jewels])
  const flasks = unique(entries.filter(([slot]) => /^Flask/i.test(slot)).map(([, item]) => item))
  const skills = activeSkills(build.skills || [])
  const nodes = resolvePassiveConditions(build.tree?.allocated || [], skills, gear).nodes
  const allItems = [...gear, ...flasks]
  const auras = auraBonuses(gear, nodes, skills)
  const attributes = basicStats(allItems, nodes, {}, trace)
  estimateResistances(allItems, nodes, attributes, trace, auras)
  estimateCoreStats(allItems, nodes, { ...attributes, ...build.stats }, build.character?.level, auras, trace)
  estimateRecoveryStats(gear, nodes, build.stats, flasks, auras, trace)
  deriveRecoveryStats(gear, nodes, build.stats, flasks, auras, trace)
  return trace
}

export function deriveRecoveryStats(items, allocated, stats, flasks = [], auras = auraBonuses(items, allocated), trace) {
  let rechargeRate = 0, recoupPercent = 0, duration = 4
  const lines = [...items.flatMap(modsOf), ...allocated.flatMap((node) => modLines(node?.stats))]
  for (const line of lines) {
    const recoup = line.match(/^(\d+(?:\.\d+)?)% of Damage Taken Recouped as Life$/i)
    if (recoup) recoupPercent += Number(recoup[1])
    if (/^(?:Damage taken Recouped|Life Recoup(?: occurs)?) over 3 seconds(?: instead(?: of 4)?)?$/i.test(line)) duration = 3
  }
  const rechargeSources = [...items, ...flasks].flatMap((item) => modsOf(item).map((line) => [line, itemSource(item)]))
    .concat(allocated.flatMap((node) => modLines(node?.stats).map((line) => [line, nodeSource(node)])))
  recordStat(trace, 'EnergyShieldRecharge', baseSource('Base: Energy Shield × 1/3 per second'), 'Base / Flat', Math.max(0, stats.EnergyShield || 0) / 3, '/s')
  for (const [line, source] of rechargeSources) {
    const match = line.match(/^(\d+(?:\.\d+)?)% (increased|reduced) Energy Shield Recharge Rate$/i)
    if (match) {
      const amount = Number(match[1]) * (match[2].toLowerCase() === 'reduced' ? -1 : 1)
      rechargeRate += amount
      recordStat(trace, 'EnergyShieldRecharge', source, 'Increased / Reduced', amount, '%', line)
    }
  }
  rechargeRate += auras.EnergyShieldRechargeRate || 0
  for (const effect of appliedAuraEffects(auras)) if (effect.stats.EnergyShieldRechargeRate) recordStat(trace, 'EnergyShieldRecharge', skillSource(effect), 'Increased / Reduced', effect.stats.EnergyShieldRechargeRate, '%')
  // Reference-hit estimate requested by the viewer: use Life, then physical Max Hit.
  // This is not a simulation of incoming DPS or overlapping recoup instances.
  const hit = [stats.Life, stats.PhysicalMaximumHitTaken].find((value) => Number.isFinite(value) && value >= 0)
  return {
    EnergyShieldRecharge: Math.max(0, stats.EnergyShield || 0) / 3 * Math.max(0, 1 + rechargeRate / 100),
    LifeRecoup: recoupPercent, RecoupDuration: duration, RecoupHit: hit,
    ...(recoupPercent === 0 ? { LifeRecoupRecovery: 0 } : hit !== undefined ? { LifeRecoupRecovery: hit * recoupPercent / 100 / duration } : {}),
  }
}

export function estimateRecoveryStats(items, allocated, core, flasks = [], auras = auraBonuses(items, allocated), trace) {
  const totals = { PhysicalDamageTakenAsFire: 0, PhysicalDamageTakenAsCold: 0, PhysicalDamageTakenAsLightning: 0, PhysicalDamageTakenAsChaos: 0, LifeRecoup: 0 }
  let flatLife = 0, percentLife = 0, lifeRate = 0, flatMana = 0, manaRate = 0, rechargeRate = 0
  function takenAs(line, source) {
    const match = line.match(/^(\d+(?:\.\d+)?)% of Physical Damage (?:from Hits )?taken as (Fire|Cold|Lightning|Chaos) Damage$/i)
    if (match) {
      const element = match[2][0].toUpperCase() + match[2].slice(1).toLowerCase()
      totals[`PhysicalDamageTakenAs${element}`] += Number(match[1])
      recordStat(trace, `PhysicalDamageTakenAs${element}`, source, 'Conversion', Number(match[1]), '%', line)
    }
  }
  const lines = [...items.flatMap((item) => modsOf(item).map((line) => [line, itemSource(item)])), ...allocated.flatMap((node) => modLines(node?.stats).map((line) => [line, nodeSource(node)]))]
  recordStat(trace, 'ManaRegen', baseSource('Base: Mana × 1.75% per second'), 'Base / Flat', core.Mana * 0.0175, '/s')
  for (const [line, source] of lines) {
    takenAs(line, source)
    let match = line.match(/^Regenerate (\d+(?:\.\d+)?) (Life|Mana) per second$/i)
    if (match) {
      if (match[2].toLowerCase() === 'life') flatLife += Number(match[1])
      else flatMana += Number(match[1])
      recordStat(trace, match[2].toLowerCase() === 'life' ? 'LifeRegen' : 'ManaRegen', source, 'Base / Flat', Number(match[1]), '/s', `${line}${match[2].toLowerCase() === 'mana' ? ' (added after mana regeneration multiplier)' : ''}`)
    }
    match = line.match(/^Regenerate (\d+(?:\.\d+)?)% of (?:maximum )?Life per second$/i)
    if (match) {
      percentLife += Number(match[1])
      recordStat(trace, 'LifeRegen', source, 'Base / Flat', Number(match[1]) * core.Life / 100, '/s', `${line} × ${core.Life} Life`)
    }
    match = line.match(/^(\d+(?:\.\d+)?)% (increased|reduced) (Life Regeneration Rate|Mana Regeneration Rate|Energy Shield Recharge Rate)$/i)
    if (match) {
      const amount = Number(match[1]) * (match[2].toLowerCase() === 'reduced' ? -1 : 1)
      if (match[3].toLowerCase().startsWith('life')) {
        lifeRate += amount
        recordStat(trace, 'LifeRegen', source, 'Increased / Reduced', amount, '%', match[0])
      } else if (match[3].toLowerCase().startsWith('mana')) {
        manaRate += amount
        recordStat(trace, 'ManaRegen', source, 'Increased / Reduced', amount, '%', match[0])
      }
      else rechargeRate += amount
    }
    match = line.match(/^(\d+(?:\.\d+)?)% of Damage Taken Recouped as Life$/i)
    if (match) totals.LifeRecoup += Number(match[1])
  }
  // Conversion on equipped flasks assumes their effect is active; do not add flask recovery properties.
  for (const flask of flasks) for (const line of modsOf(flask)) takenAs(line, itemSource(flask))
  flatLife += auras.LifeRegenFlat || 0
  for (const effect of appliedAuraEffects(auras)) {
    if (effect.stats.LifeRegenFlat) recordStat(trace, 'LifeRegen', skillSource(effect), 'Base / Flat', effect.stats.LifeRegenFlat, '/s')
    if (effect.stats.ManaRegenFlat) recordStat(trace, 'ManaRegen', skillSource(effect), 'Base / Flat', effect.stats.ManaRegenFlat, '/s', 'Before mana regeneration multiplier')
  }
  rechargeRate += auras.EnergyShieldRechargeRate || 0
  for (const element of ELEMENTS) {
    const key = `PhysicalDamageTakenAs${element}`
    if (trace && !trace[key]?.length) recordStat(trace, key, baseSource('No physical damage conversion'), 'Conversion', 0, '%')
  }
  return { ...totals,
    LifeRegen: (flatLife + percentLife * core.Life / 100) * Math.max(0, 1 + lifeRate / 100),
    ManaRegen: (core.Mana * 0.0175 + (auras.ManaRegenFlat || 0)) * Math.max(0, 1 + manaRate / 100) + flatMana,
    EnergyShieldRecharge: core.EnergyShield / 3 * Math.max(0, 1 + rechargeRate / 100),
  }
}

export function estimateCoreStats(items, allocated, attributes, level, auras = auraBonuses(items, allocated), trace) {
  const flat = { life: 0, mana: 0, 'energy shield': 0, armour: 0, evasion: 0 }
  const inc = { ...flat }
  const speeds = {}
  let block = 0, spellBlock = 0, suppression = 0
  const property = (item, names) => (item.properties || []).reduce((sum, prop) => {
    if (!names.includes(prop.name)) return sum
    const value = propertyValues(prop)[0]?.[0]?.replace(/,/g, '') || ''
    return sum + (Number(value.match(/[\d.]+/)?.[0]) || 0)
  }, 0)
  const statName = (key) => ({ life: 'Life', mana: 'Mana', 'energy shield': 'EnergyShield', armour: 'Armour', evasion: 'Evasion' })[key]
  function addLine(line, local = {}, source) {
    const speed = line.match(/^(\d+(?:\.\d+)?)% (increased|reduced) (Attack and Cast Speed|Attack Speed|Cast Speed|Movement Speed)$/i)
    if (speed) {
      const amount = Number(speed[1]) * (speed[2].toLowerCase() === 'reduced' ? -1 : 1)
      const keys = /attack and cast/i.test(speed[3]) ? ['AttackSpeedInc', 'CastSpeedInc'] : [/attack/i.test(speed[3]) ? 'AttackSpeedInc' : /cast/i.test(speed[3]) ? 'CastSpeedInc' : 'MovementSpeedInc']
      for (const key of keys) {
        speeds[key] = (speeds[key] || 0) + amount
        recordStat(trace, key, source, 'Increased / Reduced', amount, '%', line)
      }
    }
    let match = line.match(/^\+?(-?\d+(?:\.\d+)?) to (?:maximum )?(.+)$/i)
    if (match) {
      const targets = match[2].toLowerCase().replace(/,? and /g, ',').split(',').map((part) => part.trim().replace('evasion rating', 'evasion'))
      if (targets.every((target) => Object.hasOwn(flat, target))) for (const target of targets) {
        if (!local[target]) {
          flat[target] += Number(match[1])
          recordStat(trace, statName(target), source, 'Base / Flat', Number(match[1]), '', line)
        }
      }
    }
    match = line.match(/^(\d+(?:\.\d+)?)% (increased|reduced) (.+)$/i)
    if (match) {
      const maximum = /^maximum /i.test(match[3])
      const targets = match[3].toLowerCase().replace(/^maximum /, '').replace(/,? and /g, ',').split(',').map((part) => part.trim().replace('evasion rating', 'evasion'))
      const amount = Number(match[1]) * (match[2].toLowerCase() === 'reduced' ? -1 : 1)
      if (targets.every((target) => Object.hasOwn(inc, target) || target === 'global defences' || target === 'defences')) {
        for (const target of targets) {
          if (target === 'global defences' || target === 'defences') {
            for (const defence of ['armour', 'evasion', 'energy shield']) {
              inc[defence] += amount
              recordStat(trace, statName(defence), source, 'Increased / Reduced', amount, '%', line)
            }
          } else if (!local[target] || maximum || ['life', 'mana'].includes(target)) {
            inc[target] += amount
            recordStat(trace, statName(target), source, 'Increased / Reduced', amount, '%', line)
          }
        }
      }
    }
    match = line.match(/^\+?(\d+(?:\.\d+)?)% (?:additional )?chance to Block(?:( Attack| Spell) Damage)?$/i)
    if (match) {
      if (match[2]?.trim().toLowerCase() === 'spell') {
        spellBlock += Number(match[1])
        recordStat(trace, 'SpellBlockChance', source, 'Base / Flat', Number(match[1]), '%', line)
      } else if (match[2] || !local.block) {
        block += Number(match[1])
        recordStat(trace, 'BlockChance', source, 'Base / Flat', Number(match[1]), '%', line)
      }
    }
    match = line.match(/^\+?(\d+(?:\.\d+)?)% chance to Suppress Spell Damage$/i)
    if (match) {
      suppression += Number(match[1])
      recordStat(trace, 'SpellSuppressionChance', source, 'Base / Flat', Number(match[1]), '%', line)
    }
  }
  for (const item of items) {
    // Displayed armour properties already include local flat mods, increases and quality.
    const defences = {
      armour: property(item, ['Armour']), evasion: property(item, ['Evasion Rating', 'Evasion']),
      'energy shield': property(item, ['Energy Shield']), block: property(item, ['Chance to Block', 'Block Chance']),
    }
    for (const key of ['armour', 'evasion', 'energy shield']) {
      flat[key] += defences[key]
      if (defences[key]) recordStat(trace, statName(key), itemSource(item), 'Base / Flat', defences[key], '', 'Displayed item property (includes local mods and quality)')
    }
    block += defences.block
    if (defences.block) recordStat(trace, 'BlockChance', itemSource(item), 'Base / Flat', defences.block, '%', 'Displayed shield block property (includes local mods)')
    for (const line of modsOf(item)) addLine(line, defences, itemSource(item))
  }
  for (const node of allocated) for (const line of modLines(node?.stats)) addLine(line, {}, nodeSource(node))
  flat.armour += auras.ArmourFlat || 0
  flat.evasion += auras.EvasionFlat || 0
  flat['energy shield'] += auras.EnergyShieldFlat || 0
  spellBlock += auras.SpellBlockChance || 0
  const strength = Number(attributes.Str) || 0, intelligence = Number(attributes.Int) || 0
  const characterLevel = Math.max(1, Number(level) || 1)
  for (const [stat, label, value] of [['Life', 'Base Life', 38], ['Life', `Level ${characterLevel} × 12`, characterLevel * 12], ['Life', 'Strength / 2 (floored)', Math.floor(strength / 2)], ['Mana', 'Base Mana', 34], ['Mana', `Level ${characterLevel} × 6`, characterLevel * 6], ['Mana', 'Intelligence / 2 (floored)', Math.floor(intelligence / 2)]]) recordStat(trace, stat, baseSource(label), 'Base / Flat', value)
  recordStat(trace, 'EnergyShield', baseSource('Intelligence / 5 (floored)'), 'Increased / Reduced', Math.floor(intelligence / 5), '%')
  for (const effect of appliedAuraEffects(auras)) for (const [key, stat, section, unit] of [['ArmourFlat', 'Armour', 'Base / Flat', ''], ['EvasionFlat', 'Evasion', 'Base / Flat', ''], ['EnergyShieldFlat', 'EnergyShield', 'Base / Flat', ''], ['SpellBlockChance', 'SpellBlockChance', 'Base / Flat', '%'], ['ArmourMore', 'Armour', 'More / Less', '%'], ['EvasionMore', 'Evasion', 'More / Less', '%']]) {
    if (effect.stats[key]) recordStat(trace, stat, skillSource(effect), section, effect.stats[key], unit, 'Includes aura effect')
  }
  const scaled = (base, increase) => Math.floor(Math.max(0, base * (1 + increase / 100)) + 1e-8)
  const caps = { BlockChance: 75, SpellBlockChance: 75, SpellSuppressionChance: 100 }
  for (const key of Object.keys(caps)) recordStat(trace, key, baseSource('Base maximum chance'), 'Maximum Cap', caps[key], '%')
  for (const [line, source] of [...items.flatMap((item) => modsOf(item).map((line) => [line, itemSource(item)])), ...allocated.flatMap((node) => modLines(node?.stats).map((line) => [line, nodeSource(node)]))]) {
    const match = line.match(/^([+-]?\d+(?:\.\d+)?)% to maximum Chance to Block (Attack|Spell) Damage$/i)
    if (match) {
      const key = match[2].toLowerCase() === 'spell' ? 'SpellBlockChance' : 'BlockChance'
      caps[key] += Number(match[1])
      recordStat(trace, key, source, 'Maximum Cap', Number(match[1]), '%', line)
    }
  }
  return {
    Life: scaled(38 + characterLevel * 12 + Math.floor(strength / 2) + flat.life, inc.life),
    Mana: scaled(34 + characterLevel * 6 + Math.floor(intelligence / 2) + flat.mana, inc.mana),
    EnergyShield: scaled(flat['energy shield'], inc['energy shield'] + Math.floor(intelligence / 5)),
    Armour: Math.floor(scaled(flat.armour, inc.armour) * (1 + (auras.ArmourMore || 0) / 100)), Evasion: Math.floor(scaled(flat.evasion, inc.evasion) * (1 + (auras.EvasionMore || 0) / 100)),
    BlockChance: Math.max(0, Math.min(caps.BlockChance, block)), SpellBlockChance: Math.max(0, Math.min(caps.SpellBlockChance, spellBlock)), SpellSuppressionChance: Math.max(0, Math.min(caps.SpellSuppressionChance, suppression)),
    BlockChanceMax: caps.BlockChance, SpellBlockChanceMax: caps.SpellBlockChance, SpellSuppressionChanceMax: caps.SpellSuppressionChance,
    LifeInc: inc.life, ManaInc: inc.mana, EnergyShieldInc: inc['energy shield'],
    ...speeds,
  }
}

export function gggClusterJewels(payload, jewelSlots = []) {
  const passives = payload.passives || {}
  const items = [...asArray(payload.items), ...asArray(passives.items)]
  const seen = new Set()
  return items.flatMap(item => {
    if (!item || !/^(Small|Medium|Large) Cluster Jewel$/.test(item.baseType || item.typeLine || '')) return []
    if (item.inventoryId && item.inventoryId !== 'PassiveJewels') return []
    const index = Number(item.x)
    const slot = passives.jewel_slots?.[index] ?? jewelSlots[index]
    const nodeId = typeof slot === 'object' ? slot?.nodeId ?? slot?.id ?? slot?.node : slot
    const key = item.id || `${nodeId}:${index}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ ...(nodeId != null ? { nodeId: String(nodeId) } : { socketIndex: index }), baseType: item.baseType || item.typeLine, mods: modsOf(item) }]
  }).filter(jewel => jewel.nodeId != null || Number.isInteger(jewel.socketIndex) && jewel.socketIndex >= 0)
}

export function gggJewelData(payload) {
  const passives = payload.passives || {}
  return { ...(passives.jewel_data || {}), ...(passives.expansion ? { expansion: passives.expansion } : {}) }
}

export function fromGgg(character, payload, metadata = {}, code) {
  character = { ...character, ...payload.character }
  const items = asArray(payload.items).filter((item) => item && typeof item === 'object').map(normalizeGggItem)
  const passives = payload.passives || {}
  const jewels = [...items, ...asArray(passives.items).filter((item) => item && typeof item === 'object').map(normalizeGggItem)].filter((item) => item.inventoryId === 'PassiveJewels')
  const uniqueJewels = [...new Map(jewels.map((item) => [item.id || item.x, item])).values()]
  const equipment = Object.fromEntries(gggEquipmentEntries(items))
  const equipped = Object.entries(equipment).filter(([slot]) => !slot.includes('Swap') && !slot.startsWith('Flask')).map(([, item]) => item)
  const classId = passives.character || 0
  const overrides = normalizeOverrides(passives.passive_overrides, passives.skill_overrides, passives.tattoo_data)
  const socketedJewels = uniqueJewels.flatMap(item => {
    const slot = passives.jewel_slots?.[item.x] ?? metadata.jewelSlots?.[item.x]
    const nodeId = typeof slot === 'object' ? slot?.nodeId ?? slot?.id ?? slot?.node : slot
    return nodeId != null ? [{ nodeId: String(nodeId), item }] : []
  })
  const allocated = applyOverrides(asArray(metadata.nodes).filter((node) => node && typeof node === 'object').map((node) => ({ ...node, stats: modLines(node.stats) })), overrides)
  const base = metadata.classes?.[classId] || BASE_CLASSES[classId] || {}
  const allItems = [...items.filter((item) => item.inventoryId !== 'PassiveJewels'), ...uniqueJewels]
  const weaponStats = {}
  const weaponBreakdowns = {}
  const skills = gggSkills(Object.values(equipment), allocated, uniqueJewels)
  const selectedSkills = activeSkills(skills)
  const passiveEffects = resolvePassiveConditions(allocated, selectedSkills, equipped)
  const calculationNodes = passiveEffects.nodes
  const auras = auraBonuses([...equipped, ...uniqueJewels], calculationNodes, selectedSkills)
  const flasks = Object.entries(equipment).filter(([slot]) => slot.startsWith('Flask')).map(([, item]) => item)
  const weaponPassiveConditions = {}
  for (const weaponSet of [1, 2]) {
    const breakdown = {}
    const gear = weaponSet === 1 ? equipped : Object.entries(equipment).filter(([slot]) => !['Weapon 1', 'Weapon 2'].includes(slot) && !slot.startsWith('Flask')).map(([, item]) => item)
    const activeItems = [...gear, ...uniqueJewels]
    const setConditions = weaponSet === 1 ? passiveEffects : resolvePassiveConditions(allocated, selectedSkills, gear)
    const calculationNodes = setConditions.nodes
    weaponPassiveConditions[weaponSet] = setConditions.notes
    const attributes = basicStats(activeItems, calculationNodes, base, breakdown)
    const core = estimateCoreStats(activeItems, calculationNodes, attributes, character.level, auras, breakdown)
    const recovery = estimateRecoveryStats(activeItems, calculationNodes, core, flasks, auras, breakdown)
    const combined = { ...attributes, ...estimateResistances(activeItems, calculationNodes, attributes, breakdown), ...core, ...recovery }
    const hits = estimateMaximumHits(activeItems, calculationNodes, combined)
    weaponStats[weaponSet] = { ...combined, ...hits, ...deriveRecoveryStats(activeItems, calculationNodes, { ...combined, ...hits }, flasks, auras, breakdown) }
    for (const key of ['Life', 'Mana', 'EnergyShield', 'Armour', 'Evasion', 'BlockChance', 'SpellBlockChance', 'SpellSuppressionChance', 'LifeRegen', 'ManaRegen', 'EnergyShieldRecharge']) {
      if (!breakdown[key]?.some((row) => row.section === 'Base / Flat')) recordStat(breakdown, key, baseSource('Base (no flat contribution)'), 'Base / Flat', 0, /Chance/.test(key) ? '%' : /Regen|Recharge/.test(key) ? '/s' : '')
    }
    weaponBreakdowns[weaponSet] = breakdown
  }
  return { source: 'ggg', code: code || exportGgg(character, allItems, passives, metadata), character, baseAttributes: base, stats: weaponStats[1], weaponStats, breakdown: weaponBreakdowns[1], weaponBreakdowns, estimatedStats: [...ESTIMATED_CORE_KEYS, ...ESTIMATED_RECOVERY_KEYS, ...ESTIMATED_HIT_KEYS], equipment, jewels: uniqueJewels, skills, activeSkills: selectedSkills, auraEffects: auras.effects, passiveConditions: passiveEffects.notes, weaponPassiveConditions, activeAuraCount: passiveEffects.auraCount, mainSkill: 0, tree: { overrides, socketedJewels, clusterJewels: metadata.clusterJewels || gggClusterJewels(payload, metadata.jewelSlots), jewelData: gggJewelData(payload), classId, ascendClassId: Math.max(0, (metadata.classes?.[classId]?.ascendancies || []).indexOf(character.class) + 1), nodes: [...new Set([...(passives.hashes || []), ...(passives.hashes_ex || [])])].map(String), masteries: passives.mastery_effects || {}, version: metadata.version || '', allocated }, warning: !metadata.nodes ? 'Không tải được metadata cây: tổng hiện chỉ tính trang bị.' : '' }
}

export function displayedStats(build, weaponSet) {
  if (build?.source !== 'ggg') return build?.stats || {}
  if (build.weaponStats) return build.weaponStats[weaponSet] || build.stats
  if (weaponSet === 1) return build.stats
  const equipment = Object.entries(build.equipment).filter(([slot]) => !['Weapon 1', 'Weapon 2'].includes(slot) && !slot.startsWith('Flask')).map(([, item]) => item)
  const items = [...equipment, ...build.jewels]
  const attributes = basicStats(items, build.tree.allocated, build.baseAttributes)
  return { ...attributes, ...estimateResistances(items, build.tree.allocated, attributes) }
}
