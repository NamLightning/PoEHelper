import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { itemSource, nodeSource, skillSource } from '../lib/buildBreakdown.js'

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 })
const signed = (value, unit = '') => `${value >= 0 ? '+' : ''}${number.format(value)}${unit}`
const sections = ['Base / Flat', 'Conversion', 'Increased / Reduced', 'More / Less', 'Maximum Cap']

export default function StatBreakdown({ selection, rows = [], stats, build, onClose }) {
  const close = useRef(null)
  const drawer = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    close.current?.focus()
    const keydown = (event) => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    const outside = (event) => {
      if (!(event.target instanceof Element) || drawer.current?.contains(event.target)) return
      // Another stat owns the next selection; let its click handler update the
      // existing drawer rather than closing and mounting it again.
      if (event.target.closest('[data-stat-inspect]')) return
      onClose()
    }
    document.addEventListener('keydown', keydown)
    document.addEventListener('pointerdown', outside)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('pointerdown', outside)
      if (previous?.isConnected) previous.focus()
    }
  }, [onClose])
  const isSnapshot = build.source === 'pob' && build.savedStatKeys
  const cap = stats[`${selection.key}Max`]
  const flat = rows.filter((row) => row.section === 'Base / Flat').reduce((sum, row) => sum + row.value, 0)
  const context = isSnapshot ? [
    ...Object.entries(build.equipment || {}).filter(([slot]) => !slot.includes('Swap')).map(([, item]) => itemSource(item)),
    ...(build.jewels || []).map(itemSource), ...(build.tree?.allocated || []).map(nodeSource),
    ...(build.skills || []).flatMap((group) => group.gems.filter((gem) => gem.enabled && !gem.support).map(skillSource)),
  ] : []
  return createPortal(<aside ref={drawer} className="economy-theme build-breakdown" role="dialog" aria-modal="false" aria-labelledby="stat-breakdown-title">
    <header className="build-breakdown-heading"><h2 id="stat-breakdown-title">{selection.label}</h2><button ref={close} type="button" aria-label="Close stat breakdown" onClick={onClose}><X size={18} /></button></header>
    <div className="build-breakdown-scroll" key={selection.key}>
      <div className="build-breakdown-summary"><strong>{selection.label}</strong><strong>{selection.display}</strong></div>
      {[['Uncapped', stats[`${selection.key}Total`]], ['Over cap', stats[`${selection.key}OverCap`]], ['Max', cap]].filter(([, value]) => Number.isFinite(value)).map(([label, value]) => <div className="build-breakdown-subtitle" key={label}><span>{label}</span><span>{number.format(value)}%</span></div>)}
      {!isSnapshot && <p className="build-footnote">Ước tính GGG. Mỗi dòng ghi lại giá trị thực sự dùng trong phép tính; tooltip có dòng mod gốc.</p>}
      {sections.map((section) => {
        const entries = rows.filter((row) => row.section === section).slice().sort((a, b) => section === 'Maximum Cap' ? Number(b.category === 'BASE') - Number(a.category === 'BASE') : 0)
        if (!entries.length) return null
        const units = new Set(entries.map((row) => row.unit))
        const total = units.size === 1 ? entries.reduce((sum, row) => sum + row.value, 0) : undefined
        const more = section === 'More / Less'
        const moreMultiplier = entries.reduce((product, row) => product * (1 + row.value / 100), 1)
        return <section className="build-breakdown-section" key={section}><h3><span>{section === 'Maximum Cap' ? `Maximum ${selection.label}` : section}</span><span>{more ? `×${number.format(moreMultiplier)}` : total === undefined ? 'Mixed units' : signed(total, entries[0].unit)}</span></h3>
          {entries.map((row, index) => <div key={index} className={`build-breakdown-row ${row.rarity === 3 ? 'source-unique' : row.rarity === 2 ? 'source-rare' : row.category === 'TREE' ? 'source-tree' : ''}`} title={row.detail}>
            <span>{row.label}{row.detail && <small className="build-breakdown-mod">{row.detail}</small>}</span><small className={`source-badge source-${row.category.toLowerCase()}`}>{row.category}</small><strong>{signed(row.value, row.unit)}</strong>
          </div>)}
        </section>
      })}
      {!rows.length && <p className="build-footnote">Nguồn này chưa cung cấp breakdown cho chỉ số đã chọn.</p>}
      {!isSnapshot && <p className="build-footnote">Base / Flat: {number.format(flat)}. Increased/Reduced cộng phần trăm; More/Less nhân riêng; áp trần sau cùng. Life/Mana/ES và defences dùng phép làm tròn của bộ ước tính. Mana regen từ đồ được cộng sau hệ số regen.</p>}
      {context.length > 0 && <details className="build-breakdown-context"><summary>Nguồn có trong XML ({context.length})</summary><p className="build-footnote">Danh sách tham chiếu, không phải các số hạng cộng vào PlayerStat. Không suy đoán phần đóng góp mà XML không xuất.</p>{context.map((row, index) => <div className="build-breakdown-row" key={index}><span>{row.label}</span><small className="source-badge">{row.category}</small></div>)}</details>}
    </div>
  </aside>, document.body)
}
