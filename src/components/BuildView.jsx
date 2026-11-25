import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Download, Gem, RefreshCw, Shield, Network, X, Check, Sword, Shirt, Hand, Footprints, FlaskConical, Circle, HardHat, Link } from 'lucide-react'
import { buildLabel, completePobStats, mergeAllocatedPassives, withPobbinRecovery, displayedStats, cacheBuild, recentBuilds, fromGgg, gggClusterJewels, gggJewelData, itemText, MAX_CODE_LENGTH, parsePob } from '../lib/buildCodec'
import { applyBuildIcons, missingIconNames, resolveBuildIcons, itemIcon, iconFallbackSlot } from '../lib/buildIcons'
import { normalizePobbinUrl } from '../../shared/buildInput.js'
import { canonicalStat, INSPECTABLE_STATS } from '../lib/buildBreakdown.js'
import StatBreakdown from './StatBreakdown.jsx'
import { recordPoeCooldown, currentPoeDeadline } from '../lib/poeCooldown.js'
import usePoeCooldown from '../lib/usePoeCooldown.js'
import { mainSkillEntries, skillAreaModifiers } from '../lib/buildMainSkills.js'
import { calculateGemGroups, gemKey, gemModSources, gemQualityExplanation, gemTags, auxiliaryGemStats } from '../lib/buildGemCalculator.js'
import { equipmentSockets, adjacentTooltip } from '../lib/buildSocketLayout.js'
import { SKILL_RADII, GEM_BASE_STATS } from '../lib/buildGemMetadata.js'
import { specialEquipmentEntries, equippedJewels } from '../lib/buildEquipment.js'

const PassiveTree = lazy(() => import('./BuildPassiveTree'))
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const rarities = ['Normal', 'Magic', 'Rare', 'Unique', 'Gem', 'Currency']
function resistanceTooltip(stats, key) {
  return [['Uncapped', `${key}Total`], ['Over cap', `${key}OverCap`], ['Max', `${key}Max`]]
    .filter(([, field]) => Number.isFinite(stats[field]))
    .map(([label, field]) => `${label}: ${number.format(stats[field])}%`).join(' · ') || undefined
}
const statGroups = [
  ['Core Stats', [
    ['Life', ['Life', 'Spec:Life']], ['Energy Shield', ['EnergyShield']], ['Mana', ['Mana', 'UnreservedMana']], ['Armour', ['Armour']], ['Evasion', ['Evasion']],
    ['Block', ['BlockChance'], '%'], ['Spell Block', ['SpellBlockChance'], '%'], ['Spell Suppression', ['SpellSuppressionChance', 'SuppressionChance'], '%'],
    ['Effective Health Pool', ['TotalEHP', 'EffectiveHealthPool']], ['Max Hit · Physical', ['PhysicalMaximumHitTaken', 'PhysicalMaxHit']], ['Max Hit · Fire', ['FireMaximumHitTaken']], ['Max Hit · Cold', ['ColdMaximumHitTaken']], ['Max Hit · Lightning', ['LightningMaximumHitTaken']], ['Max Hit · Chaos', ['ChaosMaximumHitTaken']],
  ]],
  ['Physical Taken As', [['Fire', ['PhysicalDamageTakenAsFire', 'PhysicalTakenAsFire'], '%'], ['Cold', ['PhysicalDamageTakenAsCold', 'PhysicalTakenAsCold'], '%'], ['Lightning', ['PhysicalDamageTakenAsLightning', 'PhysicalTakenAsLightning'], '%'], ['Chaos', ['PhysicalDamageTakenAsChaos', 'PhysicalTakenAsChaos'], '%']]],
  ['Recovery', [['Life Regen', ['NetLifeRegen', 'LifeRegenRecovery', 'LifeRegen'], '/s'], ['Mana Regen', ['NetManaRegen', 'ManaRegenRecovery', 'ManaRegen'], '/s'], ['ES Recharge', ['EnergyShieldRecharge'], '/s']]],
]
const compactDps = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function MainSkills({ build }) {
  // Recalculate from raw gem bases at the actual rendering boundary. A stale
  // parsed skills array must not bypass newly hydrated item/mastery modifiers.
  const entries = useMemo(() => {
    const skills = calculateGemGroups(build?.skills || [], build?.equipment || {}, build?.jewels || [], build?.tree?.allocated || [], build?.conditions || {}, build?.customMods || [])
    const displayBuild = { ...build, skills }
    return mainSkillEntries(displayBuild).map(entry => {
      const area = skillAreaModifiers(displayBuild, entry.gem, entry.group)
      const curve = SKILL_RADII[gemKey(entry.gem)]
      const baseRadius = curve ? curve.levels[Math.max(0, Math.min(curve.levels.length - 1, Math.floor(entry.gem.level || 1) - 1))] + (entry.gem.quality || 0) * curve.qualityRadius : null
      const totalIncAoE = area.totalIncreasedAoE
      const rawResult = baseRadius == null ? null : baseRadius * Math.sqrt(Math.max(0.01, (1 + totalIncAoE / 100) * area.moreLessAreaMultiplier))
      // Keep a saved final PlayerStat radius; round mod-based estimates here,
      // immediately before these values are used by the MAIN SKILLS card.
      const radius = entry.radius?.estimated && rawResult != null ? { value: Math.round(rawResult * 10) / 10, estimated: true } : entry.radius
      const contribution = category => area.matches.filter(row => category.includes(row.category) && ['INC', 'increased', 'reduced'].includes(row.operation)).reduce((sum, row) => sum + row.value * (row.operation === 'reduced' ? -1 : 1), 0)
      return { ...entry, radius, area, aoeDebug: { baseRadius, skillIncAoE: contribution(['SKILL', 'SUPPORT']), treeIncAoE: contribution(['TREE']), itemIncAoE: contribution(['ITEM']), customIncAoE: contribution(['CONFIG']), totalIncAoE, moreLessAreaMultiplier: area.moreLessAreaMultiplier, rawResult } }
    })
  }, [build])
  // Temporary verification: once per committed build, never on every render.
  useEffect(() => {
    if (!import.meta.env.DEV || !build) return
    console.log('[All XML Quality/AoE Lines]', gemModSources(build.equipment, build.jewels, build.tree?.allocated, build.customMods).filter(source => /Quality|Area of Effect/i.test(source.line)))
    console.log('[Tree Node Resolution]', {
      selectedIds: build.tree?.nodes || [],
      clusterJewels: build.tree?.clusterJewels || [],
      resolvedNodes: (build.tree?.allocated || []).map(node => ({ id: node.id, name: node.name, stats: node.stats })),
      missingIds: build.tree?.missingIds || [],
      backendResolution: build.tree?.resolution,
    })
    for (const entry of entries.filter(entry => entry.primary)) {
      const item = build.equipment?.[entry.group.slot]
      console.log('[AoE Debug]', entry.aoeDebug)
      console.log('[Quality Debug]', {
        masteryEffects: build.tree?.masteries || {},
        resolvedMasteries: build.tree?.allocated?.filter(node => node.kind === 'Mastery'),
        missingNodeIds: build.tree?.missingIds || [],
        allMatchedQualityMods: entry.gem.qualitySources || [],
        socketColor: entry.gem.socketColor,
        baseQuality: entry.gem.baseQuality, finalQuality: entry.gem.quality,
      })
      console.log('[Build Gem Verification]', {
        skill: entry.gem.name, slot: entry.group.slot,
        rawItemText: item ? item.rawText || itemText(item) : '',
        socketColor: entry.gem.socketColor,
        baseQuality: entry.gem.baseQuality, finalQuality: entry.gem.quality,
        matchedQualityMods: entry.gem.qualitySources || [],
        area: entry.area,
        savedPoBArea: Object.fromEntries(['AreaOfEffectInc', 'IncreasedAreaOfEffect', 'AreaOfEffectMod', 'AreaOfEffectRadius', 'Radius'].filter(key => Number.isFinite(entry.stats[key])).map(key => [key, entry.stats[key]])),
        finalRadius: entry.radius,
      })
    }
    // Icon hydration keeps the same revision and must not repeat these logs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build?.revision, build?.code])
  return <Panel title="Main Skills">{entries.length ? entries.map(({ gem, group, index, supports, stats, damage, auxiliary, radius, hasDps }) => {
    const rows = []
    if (!damage.dotOnly && damage.dot > 0) rows.push(['DoT DPS', ['DisplayedDotDPS']])
    const speed = ['Speed', 'AttackSpeed', 'CastSpeed'].find(key => stats[key] > 0)
    if (!damage.dotOnly && speed) rows.push(['Attack / Cast Rate', [speed], '/s'])
    if (stats.TotalDPS !== 0 && !damage.dotOnly) rows.push(['Crit Chance', ['CritChance'], '%'], ['Crit Multiplier', ['CritMultiplier'], '×'])
    return <details className="build-main-skill-entry" key={`${build?.revision || build?.code || build?.character?.name || 0}:${index}:${gem.name}`}>
      <summary className="build-main-skill-summary">
      <div className="build-main-skill-heading"><BuildIcon icon={gem.icon} size={20} /><h3 className="build-main-skill">{gem.name}</h3>
      {Number.isFinite(damage.total) && <div className="build-main-dps" title={`${damage.dotOnly ? 'DoT DPS' : 'DPS'}: ${number.format(damage.total)}`}><span className={damage.dotOnly ? 'build-dot-badge' : 'build-dps-badge'}>{damage.dotOnly ? 'DOT' : 'DPS'}</span><strong>{compactDps.format(damage.total)}</strong></div>}
      </div>
      <p className="build-muted">Level {gem.level} · Quality {gem.quality}% · {group.slot}</p>
      </summary>
      <div className="build-main-skill-details">
      {gem.qualityBonus !== 0 && gem.qualityBonus != null && <p className="build-footnote">Quality: {gemQualityExplanation(gem)}</p>}
      <StatRows rows={rows.filter(([, keys]) => keys.some(key => Number.isFinite(key === 'DisplayedDotDPS' ? damage.dot : stats[key])))} stats={{ ...stats, DisplayedDotDPS: damage.dot }} />
      {radius && <dl className="build-stats"><div><dt>AoE Radius{radius.estimated && <small> (Est.)</small>}</dt><dd title={radius.estimated ? 'Ước tính từ base radius, quality và AoE có sẵn; chưa mô phỏng đầy đủ support/buff/điều kiện PoB.' : 'PlayerStat từ XML PoB'}>{radius.value.toFixed(1)}m</dd></div></dl>}
      {supports.length > 0 && <div className="build-main-supports" aria-label={`${gem.name} supports`}>{supports.map((support, i) => <span key={i} title={`Level ${support.level} · Quality ${support.quality}%${support.isItemSupport ? ` · ${support.sourceItemName}` : ''}`}>{support.name}{support.isItemSupport && <small> · Item Support</small>}</span>)}</div>}
      {(auxiliary.effects.length > 0 || auxiliary.notes.length > 0) && <details className="build-node-group"><summary>Gem &amp; Support modifiers (Est.)</summary><p className="build-footnote">Ước tính từ gem và support; chưa bao gồm đầy đủ modifier nhân vật, trang bị và điều kiện chiến đấu. DPS từ PoB giữ nguyên.</p><StatRows rows={[["Base cast rate", ['castRate'], '/s'], ['Mana cost', ['manaCost']], ['Duration', ['duration'], 's']].filter(([, keys]) => Number.isFinite(auxiliary[keys[0]]))} stats={auxiliary} />{auxiliary.effects.map((effect, i) => <p className="build-footnote" key={i}>{effect.source}{effect.isItemSupport ? ' · Item Support' : ''}: {number.format(effect.value)}% {effect.type} {effect.stat}{effect.flags?.length ? ` (${effect.flags.join(', ')})` : ''}</p>)}{auxiliary.notes.map(note => <p className="build-footnote" key={note}>{note}</p>)}</details>}
      {!hasDps && <p className="build-footnote">Xem DPS chi tiết trong PoB</p>}
      </div>
    </details>
  }) : <p className="build-empty">Chưa có kỹ năng chính.</p>}<p className="build-footnote">{build?.source === 'ggg' ? 'Level / Quality tính từ gem, trang bị, jewel, passive và support. Dán PoB để xem DPS.' : 'PlayerStats thuộc kỹ năng chính đã lưu trong PoB. Các nhóm phụ chỉ dùng số liệu riêng nếu XML có xuất.'}</p></Panel>
}
async function buildRequest(url, signal, body) {
  let response
  try {
    response = await fetch(url, { signal, cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('Không kết nối được API Build. Kiểm tra kết nối mạng và backend local; link pobb.in được tải qua proxy để tránh CORS.')
  }
  let result
  try { result = await response.json() }
  catch { throw new Error(`API Build không trả JSON (HTTP ${response.status}). Kiểm tra backend local và thử lại.`) }
  recordPoeCooldown(response, result)
  if (!response.ok) {
    const failure = new Error(result.error || `HTTP ${response.status}`)
    failure.status = response.status
    throw failure
  }
  return result
}

function StatRows({ rows, stats, estimated = [], missingHint, roundRecovery = false, overrides, onInspect }) {
  return <dl className="build-stats">{rows.map(([label, keys, suffix = '']) => {
    const statKey = keys.find((key) => Number.isFinite(overrides?.[key])) || keys.find((key) => Number.isFinite(stats[key]))
    const authoritative = Number.isFinite(overrides?.[statKey])
    const value = authoritative ? overrides[statKey] : stats[statKey]
    const isEstimated = !authoritative && estimated.includes(statKey)
    const regen = ['NetLifeRegen', 'LifeRegenRecovery', 'LifeRegen', 'NetManaRegen', 'ManaRegenRecovery', 'ManaRegen'].includes(statKey)
    const displayedValue = roundRecovery && regen ? Math.floor(value)
      : (roundRecovery && !isEstimated) || ['EnergyShieldRecharge', 'LifeRecoupRecovery'].includes(statKey) ? Math.round(value) : value
    const unit = typeof suffix === 'function' ? suffix(statKey) : suffix
    const inspectable = onInspect && INSPECTABLE_STATS[canonicalStat(statKey)] && Number.isFinite(value)
    const inspect = () => inspectable && onInspect({ key: canonicalStat(statKey), label, display: `${number.format(displayedValue)}${unit}` })
    const hint = keys.some((key) => /MaximumHitTaken|TotalEHP/.test(key))
      ? 'Ước tính hit đơn theo Life + ES, armour, kháng và chuyển sát thương. Chaos bỏ qua ES. EHP là Max Hit thấp nhất trong 5 hệ; chưa tính block, né tránh, suppression, recovery, buff, keystone đặc biệt hay cấu hình kẻ địch.'
      : 'Ước tính từ mod cố định trên trang bị và passive; chuyển sát thương trên flask giả định flask đang có hiệu lực. Chưa mô phỏng điều kiện, buff và keystone đặc biệt.'
    const recoupHint = !authoritative && keys.includes('LifeRecoupRecovery') && Number.isFinite(stats.RecoupDuration)
      ? `Tham khảo: Life ${Number.isFinite(stats.RecoupHit) ? number.format(stats.RecoupHit) : 'chưa xác định'} × % recoup từ mod / ${stats.RecoupDuration} giây. Fallback Physical Max Hit nếu thiếu Life; không mô phỏng sát thương nhận liên tục.` : undefined
    return <div key={label} data-stat-inspect={inspectable ? true : undefined} className={inspectable ? 'build-inspectable' : undefined} role={inspectable ? 'button' : undefined} tabIndex={inspectable ? 0 : undefined} aria-label={inspectable ? `View ${label} breakdown` : undefined} onClick={inspectable ? inspect : undefined} onKeyDown={inspectable ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect() } } : undefined}><dt title={authoritative ? 'Giá trị hiển thị trên pobb.in.' : recoupHint}>{label}{isEstimated && <small className="build-estimate" title={recoupHint || hint}> (Est.)</small>}</dt><dd>{value == null ? <span className="build-muted" title={missingHint || 'PoB không lưu chỉ số này'}>—</span> : `${number.format(displayedValue)}${unit}`}</dd></div>
  })}</dl>
}


export function DefensiveStats({ build, stats, onInspect }) {
  const live = build?.source === 'ggg'
  const elements = ['Fire', 'Cold', 'Lightning', 'Chaos']
  return <Panel title="Core Stats">
    <h3 className="build-subheading">Defensive</h3>
    <div className="build-defensive-list">
    <StatRows rows={statGroups[0][1]} stats={stats} estimated={build?.estimatedStats} onInspect={onInspect} />
    <dl className="build-stats"><div><dt>Physical taken as{live && <small className="build-estimate"> (Est.)</small>}</dt><dd className="build-physical-taken">{elements.map((element, index) => {
      const value = stats[`PhysicalDamageTakenAs${element}`] ?? stats[`PhysicalTakenAs${element}`] ?? 0
      return <span key={element}>{index > 0 && <span className="build-muted"> / </span>}<button type="button" data-stat-inspect className={`resist-${element.toLowerCase()}`} title={`${element}: ${number.format(value)}%`} aria-label={`View Physical taken as ${element} breakdown`} onClick={() => onInspect?.({ key: `PhysicalDamageTakenAs${element}`, label: `Physical taken as ${element}`, display: `${number.format(value)}%` })}>{number.format(value)}%</button></span>
    })}</dd></div></dl>
    <StatRows rows={statGroups[2][1]} stats={stats} estimated={build?.estimatedStats} roundRecovery={!live} overrides={!live ? build?.recovery : undefined} onInspect={onInspect} />
    </div>
    {live && <p className="build-footnote">EHP tham khảo = Max Hit thấp nhất trong 5 hệ. Ước tính hit đơn, chưa tính block, né tránh, suppression hay recovery. Flask được giả định đang có hiệu lực.</p>}
    {!live && build?.recoveryNote && <p className="build-footnote">{build.recoveryNote}</p>}
  </Panel>
}

function Panel({ title, children, action }) {
  return <section className="build-panel"><header className="build-panel-heading"><h2>{title}</h2>{action}</header><div className="build-panel-content">{children}</div></section>
}

const auraLabels = {
  ArmourMore: 'More Armour', ArmourFlat: 'Armour', EvasionMore: 'More Evasion', EvasionFlat: 'Evasion', EnergyShieldFlat: 'Energy Shield', EnergyShieldRechargeRate: 'ES Recharge Rate',
  LifeRegenFlat: 'Life Regen', ManaRegenFlat: 'Mana Regen', AccuracyFlat: 'Accuracy', CritChanceInc: 'Increased Crit Chance', SpellCritChanceInc: 'Increased Spell Crit Chance', SpellBlockChance: 'Spell Block',
  FireResist: 'Fire Resistance', ColdResist: 'Cold Resistance', LightningResist: 'Lightning Resistance', ElementalResist: 'All Elemental Resistances', FireResistMax: 'Maximum Fire Resistance', ColdResistMax: 'Maximum Cold Resistance', LightningResistMax: 'Maximum Lightning Resistance',
  SpellDamageMore: 'More Spell Damage', SpellLightningMore: 'More Lightning Spell Damage', DamageOverTimeMore: 'More Damage over Time', SkillDurationInc: 'Increased Skill Duration', PhysicalAsExtraCold: 'Physical Damage as Extra Cold',
  AttackSpeedInc: 'Increased Attack Speed', CastSpeedInc: 'Increased Cast Speed', MovementSpeedInc: 'Increased Movement Speed', EnemyPhysicalTakenMin: 'Enemy Physical Damage Taken (initial)', EnemyPhysicalTakenMax: 'Enemy Physical Damage Taken (maximum exposure)',
  SandNearbyHitDamageTakenLess: 'Less Hit Damage Taken (Sand, nearby)', BloodNearbyPhysicalTakenMore: 'Enemy Physical Damage Taken (Blood, nearby)', StationaryPhysicalHitTakenLess: 'Less Physical Hit Damage Taken (stationary)', StationaryFireHitTakenLess: 'Less Fire Hit Damage Taken (stationary)',
  SpiderMaxWebs: 'Maximum Spider Webs', SpiderDamageTakenPerWeb: 'Enemy Damage Taken per Web', CatStealthCritChance: "Increased Crit Chance (Cat's Stealth)", CatStealthAvoidHit: "Avoid Hit Damage (Cat's Stealth)", CatAgilityAttackSpeed: "Attack Speed (Cat's Agility)", CatAgilityCastSpeed: "Cast Speed (Cat's Agility)", AvianMightDoubleDamage: "Double Damage Chance (Avian's Might)", AvianFlightMovementSpeed: "Movement Speed (Avian's Flight)", CrabMaxBarriers: 'Maximum Crab Barriers', CrabPhysicalReductionPerBarrier: 'Physical Damage Reduction per Crab Barrier',
}
function AuraEffects({ effects }) {
  return <Panel title="Aura & Buff Effects">{effects.map((effect) => <div className="build-gem-group" key={effect.name}>
    <h3>{effect.name} <span>Lv {effect.level}</span></h3>
    {effect.grantedBy && <p className="build-muted" title={effect.sourceItemName}>Granted by {effect.grantedBy}</p>}
    {effect.appliesToSelf === false && <p className="build-footnote">Không áp dụng lên bản thân — Generosity.</p>}
    {effect.supportNotes?.map((note) => <p className="build-footnote" key={note}>{note}</p>)}
    {effect.note && <p className="build-footnote">{effect.note}</p>}
    {effect.isAspect ? <p className="build-footnote">Aspect buff · không nhận aura effect; các hiệu ứng có điều kiện chưa được cộng vào Core Stats.</p> : Number.isFinite(effect.increasedAuraEffect) && <p className="build-footnote">Aura effect: {number.format(effect.increasedAuraEffect)}%</p>}
    <dl className="build-stats">{Object.entries(effect.stats).map(([key, value]) => {
      const damage = key.match(/^(Attack|Spell)(Fire|Lightning|Chaos)(Min|Max)$/)
      const label = auraLabels[key] || (damage ? `${damage[1]} ${damage[2]} Damage (${damage[3].toLowerCase()})` : key)
      const unit = /RegenFlat$/.test(key) ? '/s' : /Flat$|MaxWebs$|MaxBarriers$/.test(key) || damage ? '' : '%'
      return <div key={key}><dt>{label}<small className="build-estimate"> (Est.)</small></dt><dd>{number.format(value)}{unit}</dd></div>
    })}</dl>
  </div>)}<p className="build-footnote">Giả định aura/buff đã bật. Hiệu ứng theo stance, khoảng cách hoặc đứng yên chỉ áp dụng khi thỏa điều kiện; DPS cần PoB.</p></Panel>
}

function BuildIcon({ icon, slot = 'Gem', size = 22 }) {
  const [failed, setFailed] = useState(null)
  if (icon && icon !== failed) return <img src={icon} loading="lazy" decoding="async" referrerPolicy="no-referrer" alt="" onError={() => setFailed(icon)} />
  const Fallback = /Flask/i.test(slot) ? FlaskConical : /Weapon/i.test(slot) ? Sword : /Offhand/i.test(slot) ? Shield : /Helmet/i.test(slot) ? HardHat : /Body/i.test(slot) ? Shirt : /Gloves/i.test(slot) ? Hand : /Boots/i.test(slot) ? Footprints : /Ring|Amulet/i.test(slot) ? Circle : /Belt/i.test(slot) ? Link : Gem
  return <Fallback size={size} className="build-icon-fallback" aria-label={`${slot} icon`} />
}

function ItemTooltip({ item, position, onEnter, onLeave }) {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 330, height: 400 })
  useEffect(() => {
    const bounds = ref.current?.getBoundingClientRect()
    if (bounds) setSize({ width: bounds.width, height: bounds.height })
  }, [item])
  const { left, top } = adjacentTooltip(position, size, { width: window.innerWidth, height: window.innerHeight })
  return createPortal(<aside ref={ref} role="tooltip" id="build-item-tooltip" onMouseEnter={onEnter} onMouseLeave={onLeave} className={`economy-theme build-tooltip rarity-${item.frameType}`} style={{ left, top }}>
    <header><span className="build-muted">{rarities[item.frameType] || 'Relic'}</span><strong>{item.name || item.baseType || item.typeLine}</strong>{item.name && <span>{item.baseType || item.typeLine}</span>}</header>
    {item.sockets?.length > 0 && <Sockets sockets={item.sockets} />}
    {item.properties?.length > 0 && <div className="build-mod-group">{item.properties.map((prop, i) => <p key={i}>{prop.name}: {prop.values?.map(([value]) => value).join(', ')}</p>)}</div>}
    {item.requirements?.length > 0 && <p className="build-muted">Requires {item.requirements.map((prop) => `${prop.values?.[0]?.[0]} ${prop.name}`).join(', ')}</p>}
    {['enchantMods', 'implicitMods', 'fracturedMods', 'explicitMods', 'craftedMods', 'crucibleMods', 'scourgeMods'].map((key) => item[key]?.length > 0 && <div key={key} className={`build-mod-group ${key}`}>{item[key].map((mod, i) => <p key={i}>{mod}</p>)}</div>)}
    {item.corrupted && <p className="build-corrupted">Corrupted</p>}
  </aside>, document.body)
}

function Sockets({ sockets }) {
  return <div className="build-sockets" aria-label={`Sockets: ${sockets.map((s, i) => `${i && sockets[i - 1].group === s.group ? 'linked ' : ''}${s.sColour || s.attr}`).join(', ')}`}>{sockets.map((socket, index) => <span key={index} className="build-socket-unit">{index > 0 && sockets[index - 1].group === socket.group && <i className="build-link" />}<i className={`build-socket socket-${socket.sColour || ({ S: 'R', D: 'G', I: 'B', G: 'W' })[socket.attr] || 'W'}`} /></span>)}</div>
}

function GemTooltip({ gem, group, position, conditions, onEnter, onLeave }) {
  const ref = useRef(null)
  const [description, setDescription] = useState(gem.description || '')
  const [size, setSize] = useState({ width: 330, height: 400 })
  useEffect(() => {
    let alive = true
    if (!gem.description) import('../lib/buildGemDescriptions.js').then(data => { if (alive) setDescription(data.GEM_DESCRIPTIONS[gemKey(gem)] || '') }).catch(() => {})
    return () => { alive = false }
  }, [gem])
  useEffect(() => { const bounds = ref.current?.getBoundingClientRect(); if (bounds) setSize({ width: bounds.width, height: bounds.height }) }, [gem, description])
  const auxiliary = auxiliaryGemStats(gem, group, conditions)
  const base = GEM_BASE_STATS[gemKey(gem)] || {}
  const { left, top } = adjacentTooltip(position, size, { width: window.innerWidth, height: window.innerHeight })
  return createPortal(<aside ref={ref} role="tooltip" id="build-gem-tooltip" className="economy-theme build-tooltip build-gem-tooltip" style={{ left, top }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
    <header><strong>{gem.name}</strong><span>{[...gemTags(gem)].map(tag => ({ area: 'AoE', channel: 'Channelling' })[tag] || tag[0].toUpperCase() + tag.slice(1)).join(', ')}</span></header>
    <p>Level: {gem.level} · Quality: +{gem.quality}%</p>
    {Number.isFinite(auxiliary.manaCost) && <p>Mana Cost: {number.format(auxiliary.manaCost)}</p>}
    {base.castTime && <p>Cast Time: {number.format(base.castTime)}s</p>}
    {Number.isFinite(auxiliary.duration) && <p>Duration: {number.format(auxiliary.duration)}s</p>}
    {description && <p className="build-mod-group">{description}</p>}
    {gem.statLines?.length > 0 && <div className="build-mod-group">{gem.statLines.map((line, i) => <p key={i}>{line}</p>)}</div>}
    {auxiliary.effects.length > 0 && <div className="build-mod-group">{auxiliary.effects.map((effect, i) => <p key={i}>{effect.source}: {number.format(Math.abs(effect.value))}% {effect.type === 'MORE' ? effect.value < 0 ? 'less' : 'more' : effect.value < 0 ? 'reduced' : 'increased'} {({ area: 'Area of Effect', manaCost: 'Mana Cost', castSpeed: 'Cast Speed', attackSpeed: 'Attack Speed', elementalDamage: 'Elemental Damage' })[effect.stat] || effect.stat.replace(/([A-Z])/g, ' $1')}</p>)}</div>}
    {gem.qualitySources?.length > 0 && <p className="build-footnote">Quality: {gemQualityExplanation(gem)}</p>}
  </aside>, document.body)
}

function SocketOverlay({ sockets, onGem, onLeave }) {
  const rows = Math.max(1, Math.ceil(sockets.length / 2))
  const x = socket => socket.col * 50 + 25, y = socket => (socket.row + .5) * 100 / rows
  return <div className="build-socket-overlay" aria-label="Socketed gems">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{sockets.slice(1).map((socket, index) => socket.socket.group != null && socket.socket.group === sockets[index].socket.group ? <line key={socket.index} x1={x(sockets[index])} y1={y(sockets[index])} x2={x(socket)} y2={y(socket)} /> : null)}</svg>
    {sockets.map(socket => <button type="button" key={socket.index} className={`build-overlay-socket socket-${socket.colour}`} style={{ left: `${x(socket)}%`, top: `${y(socket)}%` }} aria-label={socket.gem ? `${socket.gem.name}, Level ${socket.gem.level}, Quality ${socket.gem.quality}%` : `Empty ${socket.colour} socket`} disabled={!socket.gem} onMouseEnter={() => onGem(socket)} onMouseLeave={onLeave} onFocus={() => onGem(socket)} onBlur={onLeave} onClick={event => event.stopPropagation()}>{socket.gem && <BuildIcon icon={socket.gem.icon} slot="Gem" size={20} />}</button>)}
  </div>
}

function Item({ item, label, className = '', showRarity = false, sockets = [], conditions }) {
  const [position, setPosition] = useState(null)
  const [hoverGem, setHoverGem] = useState(null)
  const closeTimer = useRef(null)
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  const keepOpen = () => clearTimeout(closeTimer.current)
  const closeLater = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => { setPosition(null); setHoverGem(null) }, 160) }
  const show = (event) => {
    keepOpen()
    if (!item) return
    const bounds = event.currentTarget.getBoundingClientRect()
    setPosition({ left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom })
  }
  return <div className={`build-item-wrap ${className}`} onMouseEnter={show} onMouseLeave={closeLater} onFocusCapture={show} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeLater() }} onKeyDown={event => { if (event.key === 'Escape') { setPosition(null); setHoverGem(null) } }}>
    <button type="button" disabled={!item} className={`build-item rarity-${item?.frameType ?? 0}`} aria-label={item ? `${label}: ${item.name || item.baseType || item.typeLine}` : `${label}: Empty`} aria-describedby={position ? hoverGem ? 'build-gem-tooltip' : 'build-item-tooltip' : undefined} onClick={event => position ? setPosition(null) : show(event)}>
      <span className="build-slot-label">{label}</span>
      <BuildIcon icon={itemIcon(item)} slot={iconFallbackSlot(item, label)} />
      <span className="build-item-name">{item ? item.name || item.baseType || item.typeLine : 'Empty'}</span>
      {showRarity && item && <small className="build-item-rarity">{rarities[item.frameType] || 'Relic'}</small>}
    </button>
    {position && sockets.length > 0 && <SocketOverlay sockets={sockets} onGem={socket => { keepOpen(); setHoverGem(socket) }} onLeave={() => setHoverGem(null)} />}
    {position && item && !hoverGem && <ItemTooltip item={item} position={position} onEnter={keepOpen} onLeave={closeLater} />}
    {position && hoverGem && <GemTooltip key={hoverGem.index} gem={hoverGem.gem} group={hoverGem.group} conditions={conditions} position={position} onEnter={keepOpen} onLeave={closeLater} />}
  </div>
}

export function Equipment({ build, weaponSet, onWeaponSet }) {
  const equipment = build?.equipment || {}
  const allJewels = equippedJewels(equipment, build?.jewels)
  const special = specialEquipmentEntries(equipment, allJewels)
  const [specialOpen, setSpecialOpen] = useState(false)
  const slots = [['weapon', weaponSet === 1 ? 'Weapon 1' : 'Weapon 1 Swap', 'Weapon'], ['helmet', 'Helmet', 'Helmet'], ['offhand', weaponSet === 1 ? 'Weapon 2' : 'Weapon 2 Swap', 'Offhand'], ['amulet', 'Amulet', 'Amulet'], ['ring1', 'Ring 1', 'Ring 1'], ['body', 'Body Armour', 'Body Armour'], ['ring2', 'Ring 2', 'Ring 2'], ['gloves', 'Gloves', 'Gloves'], ['belt', 'Belt', 'Belt'], ['boots', 'Boots', 'Boots'], ['trinket', 'Trinket', 'Trinket']]
  const cluster = (item) => /Cluster Jewel/i.test(item.baseType || item.typeLine || '')
  return <>
    <Panel title="Equipment" action={<div className="build-segment" aria-label="Weapon set">{[1, 2].map((value) => <button type="button" key={value} aria-pressed={weaponSet === value} onClick={() => onWeaponSet(value)}>{value === 1 ? 'I' : 'II'}</button>)}</div>}>
      <div className="build-paper-doll-frame"><div className="build-paper-doll">{slots.map(([area, slot, label]) => <Item key={`${area}:${slot}`} className={`slot-${area}`} label={label} item={equipment[slot]} sockets={equipmentSockets(build, slot)} conditions={build?.conditions} />)}</div></div>
      <h3 className="build-subheading">Flasks</h3><div className="build-flasks">{[1, 2, 3, 4, 5].map((index) => <Item key={index} label={`Flask ${index}`} item={equipment[`Flask ${index}`]} />)}</div>
    </Panel>
    <Panel title="Jewels">{['Cluster Jewels', 'Base Jewels'].map((title, index) => {
      const jewels = allJewels.filter((item) => cluster(item) === (index === 0))
      return <div key={title}><h3 className="build-subheading">{title} <span className="build-muted">({jewels.length})</span></h3>{jewels.length ? <div className="build-jewels">{jewels.map((item, i) => <Item key={`${item.id}-${i}`} label={title === 'Cluster Jewels' ? 'Cluster' : 'Jewel'} item={item} />)}</div> : <p className="build-empty">Không có jewel.</p>}</div>
    })}</Panel>
    {special.length > 0 && <details className="build-panel build-wickerman" onToggle={event => setSpecialOpen(event.currentTarget.open)}>
      <summary>Wickerman: {special.map(([, item]) => item.name || item.baseType || item.typeLine).join(', ')}</summary>
      {specialOpen && <div className="build-special-grid">{special.map(([slot, item]) => <Item key={slot} label={slot} item={item} showRarity />)}</div>}
    </details>}
  </>
}

export default function BuildView({ selectedCharacter, onOpenAccount }) {
  const retrySeconds = usePoeCooldown()
  const [activeBuild, setActiveBuild] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const [inspection, setInspection] = useState(null)
  const closeInspection = useCallback(() => setInspection(null), [])
  const [weaponSet, setWeaponSet] = useState(1)
  // Keep labels only in React; compressed history stays in localStorage.
  const [history, setHistory] = useState(() => recentBuilds().map(({ label }) => label))
  const request = useRef(null)
  const iconRequest = useRef(null)
  const buildRevision = useRef(0)
  const copyTimer = useRef(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; request.current?.abort(); clearTimeout(copyTimer.current) }
  }, [])

  useEffect(() => {
    if (!activeBuild || activeBuild.source !== 'pob') return undefined
    const names = missingIconNames(activeBuild)
    if (!names.length) return undefined
    const controller = new AbortController()
    iconRequest.current = controller
    const code = activeBuild.code
    const revision = activeBuild.revision
    // Art is optional and loads after stats. Switching/unmounting cancels it.
    const timeout = setTimeout(() => controller.abort(), 15000)
    resolveBuildIcons(names, { signal: controller.signal }).then((icons) => {
      if (!controller.signal.aborted && Object.keys(icons).length) setActiveBuild((current) => current?.code === code && current.revision === revision && current.source === 'pob' ? applyBuildIcons(current, icons) : current)
    }).catch(() => { /* Keep per-slot fallbacks when the image service is unavailable. */ }).finally(() => clearTimeout(timeout))
    return () => { clearTimeout(timeout); controller.abort() }
    // Icon updates keep the same code; they must not trigger another lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBuild?.code, activeBuild?.source, activeBuild?.revision])

  function startRequest() {
    request.current?.abort()
    iconRequest.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError(''); setNotice(''); setCopied(false); setInspection(null)
    return controller
  }

  function commit(build) {
    setWeaponSet(1)
    setInspection(null)
    setActiveBuild({ ...build, revision: ++buildRevision.current })
    setInput(build.pobbinUrl || build.code)
    if (!cacheBuild(build.code, undefined, buildLabel(build), build.pobbinUrl)) setNotice('Đã tải build; không thể lưu lịch sử vì localStorage đầy hoặc bị tắt.')
    setHistory(recentBuilds().map(({ label }) => label))
  }

  async function loadCharacter(character, { force = false } = {}) {
    if (force && currentPoeDeadline() > Date.now()) return
    const controller = startRequest()
    // Switching characters releases the previous character data immediately.
    if (!force) { setActiveBuild(null); setInput('') }
    try {
      const payload = await buildRequest(`/api/build/character?character=${encodeURIComponent(character.name)}${force ? '&refresh=true' : ''}`, controller.signal)
      let metadata = {}
      try {
        metadata = await buildRequest('/api/build/tree-nodes', controller.signal, { ids: [...(payload.passives.hashes || []), ...(payload.passives.hashes_ex || [])], masteries: payload.passives.mastery_effects || {}, clusterJewels: gggClusterJewels(payload), jewelData: gggJewelData(payload) })
      } catch (failure) {
        if (controller.signal.aborted) throw failure
        setNotice(`Không tải được metadata passive: ${failure.message}`)
      }
      if (!controller.signal.aborted) commit(fromGgg(character, payload, metadata))
    } catch (failure) { if (!controller.signal.aborted && failure.status !== 429) setError(failure.message) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }

  useEffect(() => {
    request.current?.abort()
    if (selectedCharacter?.name) loadCharacter(selectedCharacter)
    else { setActiveBuild(null); setInput(''); setBusy(false) }
    return () => request.current?.abort()
    // Header identity drives reloads. Object reference changes do not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCharacter?.name, selectedCharacter?.accountName, selectedCharacter?.league])

  async function loadCode(value) {
    const controller = startRequest()
    try {
      let code = value.trim()
      const url = normalizePobbinUrl(code)
      let linkedRecovery, recoveryWarning = ''
      if (url) {
        const linked = await buildRequest(`/api/build/pobbin?url=${encodeURIComponent(url)}`, controller.signal)
        code = linked.code
        linkedRecovery = linked.recovery
        recoveryWarning = linked.recoveryWarning || ''
      }
      let build = parsePob(code)
      // A pasted/reopened code is a snapshot, including codes exported from GGG.
      build.source = 'pob'
      if (build.source === 'pob' && build.tree.nodes.length) {
        try {
          const metadata = await buildRequest('/api/build/tree-nodes', controller.signal, { ids: build.tree.nodes, version: build.tree.version, masteries: build.tree.masteries, clusterJewels: build.tree.clusterJewels || [] })
          build = mergeAllocatedPassives(build, metadata)
        } catch (failure) {
          if (controller.signal.aborted) throw failure
          build.warning = `Không tải được tên passive: ${failure.message}`
        }
      }
      if (build.savedStatKeys) build = completePobStats(build)
      // Reopened GGG export codes are also PoB snapshots.
      build.estimatedStats = build.estimatedStats?.filter((key) => !['EnergyShieldRecharge', 'LifeRecoupRecovery', 'LifeRecoup'].includes(key))
      // Apply rendered recovery LAST. Render reads it independently of all XML/tree calculations.
      if (url) build = { ...withPobbinRecovery(build, linkedRecovery), pobbinUrl: url }
      if (recoveryWarning) build.warning = [build.warning, recoveryWarning].filter(Boolean).join(' ')
      if (!controller.signal.aborted) commit(build)
    } catch (failure) { if (!controller.signal.aborted) setError(failure.message) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(activeBuild.code)
      if (!mounted.current) return
      setCopied(true); clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch { setError('Không truy cập được clipboard. Chọn và copy mã trong ô nhập.') }
  }

  const character = activeBuild?.character
  const isLive = activeBuild?.source === 'ggg'
  const stats = displayedStats(activeBuild, weaponSet)
  const breakdown = isLive ? activeBuild?.weaponBreakdowns?.[weaponSet] || activeBuild?.breakdown : activeBuild?.breakdown
  const passiveConditions = activeBuild?.weaponPassiveConditions?.[weaponSet] || activeBuild?.passiveConditions || []
  const mainGroups = (activeBuild?.skills || []).filter((group) => /Swap/.test(group.slot) ? weaponSet === 2 : !/^Weapon/.test(group.slot) || weaponSet === 1)

  return <section className="economy-theme economy-surface build-view">
    <header className="build-toolbar">
      <div className="build-identity"><div className="build-emblem"><Gem size={25} /></div><div><p className="build-eyebrow">CHARACTER WORKSPACE</p><h1>{character?.name || selectedCharacter?.name || 'Build'}</h1><p className="build-muted">{character ? `Level ${character.level || '—'} · ${character.class || '—'}${character.league ? ` · ${character.league}` : ''}` : 'PoB & GGG Character Viewer'}</p></div>
        <span className="build-badge" role="status">{activeBuild ? <><strong>{isLive ? 'Live from GGG API' : 'PoB / pobb.in Snapshot'}</strong>{isLive && <small>{character.name} · {character.league || '—'}</small>}</> : 'Chưa tải build'}</span>
      </div>
      <form className="build-import" onSubmit={(event) => { event.preventDefault(); loadCode(input) }}><label htmlFor="build-code">Link pobb.in / PoB Import Code</label><div className="build-import-controls"><input id="build-code" type="text" autoComplete="off" spellCheck={false} value={input} maxLength={MAX_CODE_LENGTH} onChange={(event) => setInput(event.target.value)} placeholder="https://pobb.in/… hoặc dán mã PoB" /><button className="build-button primary" disabled={busy || !input.trim()}><Download size={14} />{busy ? 'Loading…' : 'Load Build'}</button></div></form>
      <div className="build-toolbar-actions">
        <button type="button" className="build-button" disabled={!activeBuild} onClick={copyCode}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied!' : 'Copy PoB Code'}</button>
        <button type="button" className="build-button" disabled={busy || retrySeconds > 0 || !selectedCharacter} onClick={() => loadCharacter(selectedCharacter, { force: true })}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />{retrySeconds > 0 ? `\u0110\u1ee3i (${retrySeconds}s)...` : activeBuild && !isLive ? 'Quay lại nhân vật của tôi' : 'Reload My Character'}</button>
        <label className="build-muted build-history">Recent<select aria-label="Recent compressed builds" value="" disabled={busy || history.length === 0} onChange={(event) => { if (event.target.value !== '') loadCode((recentBuilds()[Number(event.target.value)]?.sourceUrl || recentBuilds()[Number(event.target.value)]?.code) || '') }}>
          <option value="">{history.length}/5 builds</option>{history.map((label, i) => <option key={i} value={i}>{label}{i === 0 ? ' · latest' : ''}</option>)}
        </select></label>
      </div>
    </header>
    {retrySeconds > 0 && <p className="build-info" role="status">GGG API đang giới hạn tốc độ truy cập. Vui lòng thử lại sau {retrySeconds}s</p>}
    {error && <div className="build-alert" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
    {(notice || activeBuild?.warning) && <p className="build-info" role="status">{notice || activeBuild.warning}</p>}
    {busy && <p className="build-loading" role="status"><RefreshCw size={14} className="animate-spin" />Đang tải build và các passive đã cộng…</p>}
    {!activeBuild && !busy && !selectedCharacter?.name && <div className="build-welcome"><Network size={26} /><div><h2>Khám phá nhân vật của bạn</h2><p>Chọn nhân vật GGG để tự động tải trang bị, gems và passive, hoặc dán mã PoB ở trên.</p></div><button type="button" className="build-button" onClick={onOpenAccount}>Chọn nhân vật</button></div>}
    <div className="build-columns" aria-busy={busy}>
      <div className="build-column build-equipment-column"><Equipment key={activeBuild?.revision || 0} build={activeBuild} weaponSet={weaponSet} onWeaponSet={(value) => { setWeaponSet(value); setInspection(null) }} /></div>
      <div className="build-column build-stats-column">
        <Panel title="Resistances"><div className="build-resistances">{[['Fire', 'FireResist'], ['Cold', 'ColdResist'], ['Lightning', 'LightningResist'], ['Chaos', 'ChaosResist']].map(([label, key]) => <button type="button" data-stat-inspect key={key} disabled={!Number.isFinite(stats[key])} aria-label={`View ${label} Resistance breakdown`} onClick={() => setInspection({ key, label: `${label} Resistance`, display: `${number.format(stats[key])}%` })} className={`resist-${label.toLowerCase()}`}><span>{label}</span><strong title={resistanceTooltip(stats, key)}>{Number.isFinite(stats[key]) ? `${number.format(stats[key])}%` : '—'}</strong></button>)}</div><p className="build-footnote">{activeBuild?.source === 'ggg' ? 'Kháng ước tính sau mức trần · giả định các Purity đang bật · đã trừ 60% campaign. Rê chuột để xem uncapped / max.' : 'Kháng cuối cùng từ PoB snapshot · không tính lại từ GGG.'}</p></Panel>
        <Panel title="Attributes"><div className="build-attributes">{[['Strength', 'Str'], ['Dexterity', 'Dex'], ['Intelligence', 'Int']].map(([label, key]) => <div key={key}><strong>{stats[key] == null ? '—' : number.format(stats[key])}</strong><span>{label}</span></div>)}</div></Panel>
        <DefensiveStats build={activeBuild} stats={stats} onInspect={setInspection} />
        {isLive ? <><MainSkills build={activeBuild} /><Panel title="Key Modifiers"><StatRows stats={{ AttackSpeedInc: 0, CastSpeedInc: 0, MovementSpeedInc: 0, ...stats }} rows={[['Increased maximum Life', ['LifeInc'], '%'], ['Increased maximum ES', ['EnergyShieldInc'], '%'], ['Increased Attack Speed', ['AttackSpeedInc'], '%'], ['Increased Cast Speed', ['CastSpeedInc'], '%'], ['Increased Movement Speed', ['MovementSpeedInc'], '%']]} />{passiveConditions.length > 0 && <details className="build-node-group"><summary>Passive conditions ({activeBuild.activeAuraCount} assumed active auras)</summary><p className="build-footnote">GGG does not expose live aura or combat buff states. Only conditions inferred from equipped gear and assumed active auras are applied.</p>{passiveConditions.map((condition, index) => <p className="build-footnote" key={index}><strong>{condition.node}</strong>: {condition.text} - {condition.status === 'applied' ? 'Applied' : condition.status === 'inactive' ? 'Inactive' : 'Not applied: live condition unknown'}</p>)}</details>}<p className="build-footnote" title="Ước tính từ mod cố định trên đồ và passive; chưa mô phỏng flask, buff và hiệu ứng biến đổi.">Dữ liệu trực tiếp từ GGG — Dán link pobb.in ở trên để xem DPS / EHP / Max Hit.</p></Panel></> : <><MainSkills build={activeBuild} /></>}
        {activeBuild?.source === 'pob' && <details key={activeBuild.revision || activeBuild.code} className="build-panel build-all-stats"><summary>All saved PlayerStats ({(activeBuild.savedStatKeys || Object.keys(stats)).length})</summary><StatRows rows={(activeBuild.savedStatKeys || Object.keys(stats)).slice().sort().map((key) => [key, [key]])} stats={stats} /></details>}
{isLive && activeBuild?.auraEffects?.length > 0 && <AuraEffects effects={activeBuild.auraEffects} />}

      </div>
    </div>
    {activeBuild && <div className="build-passive-section"><Suspense fallback={<p className="build-info" role="status">Đang tải Passive Tree…</p>}><PassiveTree key={activeBuild.revision} tree={activeBuild.tree} character={activeBuild.character} /></Suspense></div>}
    <div className="build-skills-section"><Panel title="Skill Gems" action={<span className="build-muted">{mainGroups.length} groups</span>}>{mainGroups.length ? <div className="build-gem-groups">{mainGroups.map((group, index) => <div key={index} className={`build-gem-group ${group.enabled ? '' : 'build-disabled'}`}><h3>{group.slot} <span>{group.grantedBy ? 'Granted Skill' : `${group.links || group.gems.filter(gem => !gem.isItemSupport).length}-Link`}{!group.enabled ? ' · disabled' : ''}</span></h3>{group.gems.map((gem, i) => <div key={i} className={`build-gem ${gem.support ? 'support' : 'active'} ${gem.enabled ? '' : 'build-disabled'}`}><BuildIcon key={activeBuild?.revision || 0} icon={gem.icon} size={16} /><span>{gem.name}<small>{gem.grantedBy ? `Granted by ${gem.grantedBy}` : gem.isItemSupport ? 'Item Support' : gem.support ? 'Support' : 'Active'}{!gem.enabled ? ' · disabled' : ''}</small>{gem.supportNotes?.map(note => <small key={note}>{note}</small>)}</span><span className="build-gem-level" title={gem.levelSources?.map(source => `${source.label}: +${source.value} (${source.scope})`).join("\n")}>{gem.level}<small title={gem.qualityBonus ? `Base ${gem.baseQuality}% + bonuses ${gem.qualityBonus}%` : undefined}>{gem.quality}% Q</small></span></div>)}</div>)}</div> : <p className="build-empty">Chưa có skill gems.</p>}</Panel></div>
    {inspection && activeBuild && <StatBreakdown selection={inspection} rows={breakdown?.[inspection.key] || []} stats={stats} build={activeBuild} onClose={closeInspection} />}

  </section>
}
