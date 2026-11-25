const WIKI_API = 'https://www.poewiki.net/w/api.php'
const plain = (value) => String(value || '').replace(/&#(\d+);/g, (_, code) => Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : '').replace(/&(amp|quot|apos);/g, (_, name) => ({ amp: '&', quot: '"', apos: "'" })[name])
const fileKey = (value) => plain(value).replace(/_/g, ' ')

function validImage(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && ['www.poewiki.net', 'web.poecdn.com'].includes(url.hostname) ? url.href : null
  } catch { return null }
}

async function wiki(params, signal, fetcher) {
  const url = new URL(WIKI_API)
  url.search = new URLSearchParams({ format: 'json', origin: '*', ...params })
  const response = await fetcher(url.href, { signal, credentials: 'omit' })
  if (!response.ok) throw new Error(`Icon lookup: HTTP ${response.status}`)
  const data = await response.json()
  if (data.error) throw new Error('Icon lookup unavailable')
  return data
}

export async function resolveWikiIcons(names, { signal, fetcher = fetch } = {}) {
  // No catalogue, binary cache or persistent map: only names used in this build.
  const requested = [...new Set(names)].filter((name) => typeof name === 'string' && name.trim() && name.length <= 160).slice(0, 160)
  const icons = Object.create(null)
  for (let offset = 0; offset < requested.length; offset += 40) {
    const batch = requested.slice(offset, offset + 40)
    const quoted = batch.map((name) => `'${name.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`).join(',')
    let data
    try { data = await wiki({ action: 'cargoquery', tables: 'items', fields: 'name,inventory_icon=icon', where: `name IN (${quoted})`, limit: '120' }, signal, fetcher) }
    catch (error) { if (signal?.aborted) throw error; data = {} }
    const rows = (data.cargoquery || []).map((entry) => ({ name: plain(entry.title?.name), icon: plain(entry.title?.icon) })).filter((entry) => batch.includes(entry.name) && entry.icon.startsWith('File:'))
    const files = [...new Set(rows.map((row) => row.icon))]
    for (let start = 0; start < files.length; start += 40) {
      const images = await wiki({ action: 'query', prop: 'imageinfo', iiprop: 'url', titles: files.slice(start, start + 40).join('|') }, signal, fetcher)
      const urls = new Map(Object.values(images.query?.pages || {}).map((page) => [fileKey(page.title), validImage(page.imageinfo?.[0]?.url)]))
      for (const row of rows) if (!icons[row.name] && urls.get(fileKey(row.icon))) icons[row.name] = urls.get(fileKey(row.icon))
    }
    // New league items can have uploaded artwork before Cargo indexes their
    // item row. Ask MediaWiki for exact files; never invent a CDN art path.
    const missing = batch.filter(name => !icons[name])
    if (missing.length) {
      const candidates = missing.map(name => ({ name, file: `File:${name} inventory icon.png` }))
      const images = await wiki({ action: 'query', prop: 'imageinfo', iiprop: 'url', redirects: '1', titles: candidates.map(entry => entry.file).join('|') }, signal, fetcher)
      const urls = new Map(Object.values(images.query?.pages || {}).map(page => [fileKey(page.title), validImage(page.imageinfo?.[0]?.url)]))
      for (const candidate of candidates) if (urls.get(fileKey(candidate.file))) icons[candidate.name] = urls.get(fileKey(candidate.file))
    }
  }
  return icons
}

