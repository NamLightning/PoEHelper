import { groupedNodes, focusPan } from '../lib/buildTreeInteractions.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Maximize2, ExternalLink, RotateCcw } from 'lucide-react'
import { treeGeometry, nearestTreeNode, nodeRadius, isLargeNode, passiveTreeUrl } from '../lib/buildTreeCanvas.js'
import { traceTreeEdge } from '../../shared/passiveGeometry.js'

function NodeIcon({ node, allowed }) {
  const [failed, setFailed] = useState(false)
  return allowed && node.icon && !failed ? <img src={node.icon} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="build-tree-node-fallback" aria-hidden="true">{node.kind === 'Mastery' ? '✧' : '◆'}</span>
}

export default function BuildPassiveTree({ tree, character }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const [enlarged, setEnlarged] = useState(false), [hover, setHover] = useState(null)
  const [selection, setSelection] = useState(null)
  const [openSections, setOpenSections] = useState({ major: true, masteries: true, tattoos: true })
  const selectedIds = useRef(new Set())
  const [nodeIcons, setNodeIcons] = useState({})
  const canvas = useRef(null), section = useRef(null), renderer = useRef(null)
  const view = useRef({ zoom: 1, x: 0, y: 0 }), expanded = useRef(enlarged)
  expanded.current = enlarged
  const geometry = useMemo(() => data ? treeGeometry(data, tree, character?.class) : null, [data, tree, character?.class])

  useEffect(() => {
    const clear = event => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !event.target.closest?.('[data-tree-selection]')) setSelection(null)
    }
    document.addEventListener('pointerdown', clear, true)
    document.addEventListener('keydown', clear)
    return () => { document.removeEventListener('pointerdown', clear, true); document.removeEventListener('keydown', clear) }
  }, [])
  useEffect(() => {
    selectedIds.current = new Set(selection?.nodeIds || [])
    renderer.current?.focus(selection?.nodeIds || [])
    renderer.current?.redraw()
  }, [selection])

  useEffect(() => {
    const controller = new AbortController()
    setData(null); setError('')
    fetch('/api/build/tree-nodes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ ids: tree.nodes || [], version: tree.version, masteries: tree.masteries || {}, clusterJewels: tree.clusterJewels || [], jewelData: tree.jewelData || {}, layout: true }) })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result })
      .then(result => { if (!controller.signal.aborted) setData(result) })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [tree.version, tree.nodes, tree.clusterJewels, tree.jewelData, tree.masteries, attempt])

  useEffect(() => {
    const controller = new AbortController()
    setNodeIcons({})
    if (geometry?.icons.length) fetch('/api/build/tree-icons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes: geometry.icons.map(({ id, name, iconKey }) => ({ id, name, iconKey })) }), signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('Icons unavailable'); return response.json() })
      .then(result => { if (!controller.signal.aborted) setNodeIcons(result.icons || {}) })
      .catch(() => { /* Geometric markers remain available if individual icons fail. */ })
    return () => controller.abort()
  }, [geometry])

  useEffect(() => {
    if (!enlarged) return undefined
    const previous = document.activeElement, overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; section.current?.focus()
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); setEnlarged(false) }
      if (event.key === 'Tab') {
        const controls = [...section.current.querySelectorAll('button, a, canvas')].filter(el => !el.disabled)
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === section.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === section.current)) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus() }
  }, [enlarged])

  useEffect(() => {
    const element = canvas.current
    if (!geometry || !element) return undefined
    const ctx = element.getContext('2d', { alpha: false })
    if (!ctx) return undefined
    let frame = 0, width = 1, height = 1, transform, mini, drag = null, motion = null, disposed = false
    const images = new Map(), pendingImages = new Set()
    const background = getComputedStyle(section.current).getPropertyValue('--market-input').trim() || '#10191e'
    const gold = '#e7cc8c', muted = '#33434b', bounds = geometry.bounds
    const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 1.5, 2048 / width, 1440 / height)
    const tint = node => node.kind === 'Ascendancy' ? '#45505a' : /Strength/.test(node.stats.join(' ')) ? '#985d57' : /Dexterity/.test(node.stats.join(' ')) ? '#568366' : '#557d9b'
    const updateTransform = () => {
      const scale = Math.min((width - 34) / bounds.width, (height - 34) / bounds.height) * view.current.zoom
      transform = { scale, x: width / 2 - (bounds.x + bounds.width / 2) * scale + view.current.x, y: height / 2 - (bounds.y + bounds.height / 2) * scale + view.current.y }
    }
    const requestDraw = () => { if (!frame && !disposed) frame = requestAnimationFrame(draw) }
    function paintNode(node, scale, detail) {
      const r = Math.max(nodeRadius(node), (node.active ? 2.2 : 1) / scale)
      ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2); ctx.fillStyle = node.active ? gold : tint(node); ctx.fill()
      if (detail && (node.active || node.clusterGenerated) && isLargeNode(node)) {
        const image = images.get(node.id)
        if (image) { ctx.save(); ctx.clip(); ctx.globalAlpha = node.active ? 1 : .35; ctx.drawImage(image, node.x - r, node.y - r, r * 2, r * 2); ctx.restore() }
        ctx.strokeStyle = node.active ? gold : muted; ctx.lineWidth = 1.5 / scale; ctx.stroke()
      }
      if (selectedIds.current.has(node.id)) {
        ctx.save(); ctx.shadowColor = '#79e6e0'; ctx.shadowBlur = 13
        ctx.beginPath(); ctx.arc(node.x, node.y, r + 6 / scale, 0, Math.PI * 2)
        ctx.strokeStyle = '#a3fff0'; ctx.lineWidth = 2.5 / scale; ctx.stroke(); ctx.restore()
      }
    }
    function draw() {
      frame = 0
      if (disposed) return
      if (motion) {
        const progress = Math.min(1, (performance.now() - motion.start) / 220), ease = 1 - Math.pow(1 - progress, 3)
        view.current.x = motion.fromX + (motion.x - motion.fromX) * ease
        view.current.y = motion.fromY + (motion.y - motion.fromY) * ease
        if (progress === 1) motion = null
        else requestDraw()
      }
      updateTransform()
      const dpr = pixelRatio()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = background; ctx.fillRect(0, 0, width, height)
      ctx.save(); ctx.translate(transform.x, transform.y); ctx.scale(transform.scale, transform.scale)
      for (const active of [false, true]) {
        ctx.beginPath()
        for (const edge of geometry.edges) if (edge.active === active) traceTreeEdge(ctx, edge)
        ctx.strokeStyle = active ? gold : muted; ctx.lineWidth = (active ? 1.5 : .65) / transform.scale; ctx.stroke()
      }
      ctx.save(); ctx.strokeStyle = 'rgba(167,207,233,.58)'; ctx.lineWidth = 1 / transform.scale
      for (const ring of geometry.rings) { ctx.beginPath(); ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2); ctx.stroke() }
      ctx.restore()
      const detail = view.current.zoom >= 1.8 || expanded.current
      for (const active of [false, true]) for (const node of geometry.main) {
        if (node.active !== active) continue
        const x = node.x * transform.scale + transform.x, y = node.y * transform.scale + transform.y
        if (x >= -20 && y >= -20 && x <= width + 20 && y <= height + 20) paintNode(node, transform.scale, detail)
      }
      ctx.restore(); mini = null
      if (geometry.ascendancy.length) {
        const radius = Math.min(58, width * .12), cx = width - radius - 14, cy = radius + 14, b = geometry.ascendancyBounds
        const scale = Math.min(radius * 1.55 / b.width, radius * 1.55 / b.height)
        mini = { cx, cy, radius, scale, x: cx - (b.x + b.width / 2) * scale, y: cy - (b.y + b.height / 2) * scale }
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fillStyle = background; ctx.fill(); ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.stroke(); ctx.clip()
        ctx.translate(mini.x, mini.y); ctx.scale(scale, scale)
        for (const active of [false, true]) {
          ctx.beginPath()
          for (const edge of geometry.ascendancyEdges) if (edge.active === active) traceTreeEdge(ctx, edge)
          ctx.strokeStyle = active ? gold : muted; ctx.lineWidth = (active ? 1.5 : .8) / scale; ctx.stroke()
        }
        for (const node of geometry.ascendancy) paintNode(node, scale, detail)
        ctx.restore()
      }
    }
    for (const node of geometry.icons) {
      const url = nodeIcons[node.id] || node.icon
      if (!url) continue
      const image = new Image(); image.decoding = 'async'; image.referrerPolicy = 'no-referrer'; pendingImages.add(image)
      image.onload = () => { pendingImages.delete(image); if (!disposed) { images.set(node.id, image); requestDraw() } }
      image.onerror = () => pendingImages.delete(image)
      image.src = url
    }
    const resize = () => {
      const rect = element.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height)
      const dpr = pixelRatio()
      element.width = Math.round(width * dpr); element.height = Math.round(height * dpr)
      setHover(null); requestDraw()
    }
    const coords = event => { const rect = element.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top } }
    const zoom = (factor, x = width / 2, y = height / 2) => {
      motion = null
      const old = view.current.zoom, next = Math.max(1, Math.min(14, old * factor)), ratio = next / old
      view.current = { zoom: next, x: x - width / 2 - (x - width / 2 - view.current.x) * ratio, y: y - height / 2 - (y - height / 2 - view.current.y) * ratio }
      setHover(null); requestDraw()
    }
    const wheel = event => { event.preventDefault(); const p = coords(event); zoom(Math.exp(-event.deltaY * .0015), p.x, p.y) }
    const down = event => { if (event.button !== 0) return; motion = null; element.focus(); element.setPointerCapture(event.pointerId); drag = { x: event.clientX, y: event.clientY, panX: view.current.x, panY: view.current.y }; element.style.cursor = 'grabbing'; setHover(null) }
    const up = event => { drag = null; element.style.cursor = 'grab'; if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId) }
    const move = event => {
      if (drag) { view.current.x = drag.panX + event.clientX - drag.x; view.current.y = drag.panY + event.clientY - drag.y; requestDraw(); return }
      if (!transform) return
      const p = coords(event), inMini = mini && Math.hypot(p.x - mini.cx, p.y - mini.cy) <= mini.radius, t = inMini ? mini : transform
      const node = nearestTreeNode(geometry, (p.x - t.x) / t.scale, (p.y - t.y) / t.scale, t.scale, Boolean(inMini))
      setHover(node ? { node, x: Math.max(8, Math.min(p.x + 14, width - Math.min(310, width - 16))), y: Math.max(8, Math.min(p.y + 14, height - 140)) } : null)
    }
    const leave = () => setHover(null)
    const keydown = event => {
      const d = { ArrowLeft: [45, 0], ArrowRight: [-45, 0], ArrowUp: [0, 45], ArrowDown: [0, -45] }[event.key]
      if (d) { motion = null; event.preventDefault(); view.current.x += d[0]; view.current.y += d[1]; requestDraw() }
      if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); zoom(event.key === '-' ? .8 : 1.25) }
    }
    const observer = new ResizeObserver(resize); observer.observe(element)
    element.addEventListener('wheel', wheel, { passive: false })
    element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move); element.addEventListener('pointerup', up); element.addEventListener('pointercancel', up); element.addEventListener('pointerleave', leave); element.addEventListener('keydown', keydown)
    renderer.current = { redraw: requestDraw, focus: ids => {
      updateTransform()
      const targets = geometry.nodes.filter(n => ids.includes(n.id))
      const pan = focusPan(targets, transform, width, height, view.current)
      motion = null
      if (pan.x !== view.current.x || pan.y !== view.current.y) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) view.current = { ...view.current, ...pan }
        else motion = { ...pan, fromX: view.current.x, fromY: view.current.y, start: performance.now() }
      }
      setHover(null); requestDraw()
    }, reset: () => { motion = null; view.current = { zoom: 1, x: 0, y: 0 }; setHover(null); requestDraw() } }
    resize()
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); renderer.current = null
      element.removeEventListener('wheel', wheel); element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', up); element.removeEventListener('pointerleave', leave); element.removeEventListener('keydown', keydown)
      for (const image of [...pendingImages, ...images.values()]) { image.onload = null; image.onerror = null; image.src = '' }
      pendingImages.clear(); images.clear(); element.width = 1; element.height = 1
    }
  }, [geometry, nodeIcons])

  useEffect(() => { setHover(null); renderer.current?.redraw() }, [enlarged])
  const active = geometry?.nodes.filter(node => node.active) || tree.allocated || []
  const major = active.filter(node => node.kind === 'Keystone' || (node.kind === 'Ascendancy' && node.notable))
  const masteries = groupedNodes(active.filter(node => node.kind === 'Mastery'))
  const tattoos = groupedNodes(active.filter(node => node.kind === 'Tattoo'))
  const iconIds = new Set(geometry?.icons.map(node => node.id) || [])
  const list = (nodes, showIcons = false) => nodes.length ? nodes.map(node => {
    const key = node.key || node.id, ids = node.nodeIds || [node.id]
    const chosen = selection?.key === key
    return <button type="button" data-tree-selection className={`build-tree-node-card ${chosen ? 'is-selected' : ''}`} aria-pressed={chosen} key={key} onClick={() => setSelection(chosen ? null : { key, nodeIds: ids })}>
      {showIcons && <NodeIcon key={`${node.id}:${nodeIcons[node.id] || node.icon}`} node={{ ...node, icon: nodeIcons[node.id] || node.icon }} allowed={iconIds.has(node.id)} />}
      <div><h4>{node.name}{node.nodeIds && <span className="build-tree-count">{ids.length}</span>}<small>{node.kind}</small></h4>{node.stats.map((stat, i) => <p key={i}>{stat}</p>)}</div>
    </button>
  }) : <p className="build-empty">Chưa có node đã chọn trong nhóm này.</p>
  const summary = (key, title, nodes, count = nodes.length) => <section className={openSections[key] ? '' : 'is-collapsed'}>
    <h3><button className="build-tree-section-toggle" type="button" aria-expanded={openSections[key]} aria-controls={`tree-summary-${key}`} onClick={() => setOpenSections(value => ({ ...value, [key]: !value[key] }))}>
      <span aria-hidden="true">{openSections[key] ? '▾' : '▸'}</span> {title} <span className="build-tree-section-count">{count}</span>
    </button></h3>
    <div className="build-tree-accordion-body" id={`tree-summary-${key}`} aria-hidden={!openSections[key]} inert={openSections[key] ? undefined : ''}><div className="build-passive-node-scroll">{list(nodes, key === 'major')}</div></div>
  </section>
  const missingIds = data?.missingIds ?? tree.missingIds ?? []


  return <section className={`build-panel build-passive-panel ${enlarged ? 'build-passive-enlarged' : ''}`} ref={section} tabIndex={enlarged ? -1 : undefined} role={enlarged ? 'dialog' : undefined} aria-modal={enlarged ? true : undefined} aria-label="Passive Tree">
    <header className="build-panel-heading"><h2>Passive Tree</h2><span className="build-muted">{new Set(tree.nodes || []).size} allocated nodes{character?.class ? ` · ${character.class}` : ''}</span>{enlarged && <button type="button" className="build-button" aria-label="Close enlarged passive tree" onClick={() => setEnlarged(false)}><X size={18} /></button>}</header>
    <div className="build-passive-layout"><div className="build-canvas-wrap">
      <canvas ref={canvas} tabIndex={0} aria-label="Passive skill tree. Scroll to zoom, drag to pan, hover nodes for stats. Arrow keys pan; plus and minus zoom." />
      {!data && !error && <p className="build-canvas-message" role="status">Đang tải Passive Tree…</p>}
      {error && <div className="build-canvas-message" role="alert"><p>{error}</p><button className="build-button" onClick={() => setAttempt(value => value + 1)}>Thử lại</button></div>}
      {hover && <div role="tooltip" className="build-canvas-tooltip" style={{ left: hover.x, top: hover.y }}><strong>{hover.node.name}</strong><small>{hover.node.kind}{hover.node.active ? ' · Allocated' : ''}</small>{hover.node.stats.map((stat, i) => <p key={i}>{stat}</p>)}{hover.node.statsUnavailable && <p>GGG chưa cung cấp mô tả stats cho node này.</p>}</div>}
      <div className="build-canvas-tools"><button className="build-button" type="button" aria-label="Reset passive tree view" onClick={() => renderer.current?.reset()}><RotateCcw size={13} /></button><a className="build-button" href={passiveTreeUrl(tree)} target="_blank" rel="noreferrer">OPEN <ExternalLink size={13} /></a><button className="build-button" type="button" onClick={() => setEnlarged(value => !value)}>{enlarged ? 'REDUCE' : 'ENLARGE'} <Maximize2 size={13} /></button></div>
    </div><div className="build-passive-lists">{summary('major', 'Ascendancy & Keystones', major)}{summary('masteries', 'Masteries', masteries)}{tattoos.length > 0 && summary('tattoos', 'Tattoos', tattoos, tattoos.reduce((sum, group) => sum + group.nodeIds.length, 0))}{missingIds.length > 0 && <p className="build-footnote">{missingIds.length} passive/cluster nodes chưa được phân giải: {missingIds.join(', ')}.</p>}</div></div>
  </section>
}
