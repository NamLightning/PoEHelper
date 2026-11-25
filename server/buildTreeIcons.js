// GGG exports atlas keys, not working individual CDN image URLs. Resolve only
// selected large-node images through the wiki's small, individual thumbnails.
const iconUrls = new Map()
let nextImageStart = 0

export async function fetchTreeIcon(url, signal) {
  const now = Date.now(), start = Math.max(now, nextImageStart)
  nextImageStart = start + 350
  if (start > now) await new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, start - now)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  return fetch(url, { signal, redirect: 'error', headers: { 'User-Agent': 'PoeStash/1.0 (passive node icons)' } })
}

export async function resolveTreeIcons(nodes, signal) {
  const keyOf = node => `${node.name}:${node.iconKey || ''}`
  const missing = nodes.filter(node => !iconUrls.has(keyOf(node)))
  if (!missing.length) return Object.fromEntries(nodes.flatMap(node => iconUrls.get(keyOf(node)) ? [[node.id, iconUrls.get(keyOf(node))]] : []))
  const query = async params => {
    const url = new URL('https://www.poewiki.net/w/api.php')
    url.search = new URLSearchParams({ action: 'query', format: 'json', ...params })
    const response = await fetch(url, { signal, headers: { 'User-Agent': 'PoeStash/1.0 (passive node icons)' } })
    if (!response.ok) throw new Error(`Passive icons: HTTP ${response.status}`)
    return Object.values((await response.json()).query?.pages || {})
  }
  const pages = await query({ titles: [...new Set(missing.map(node => node.name))].join('|'), prop: 'images', imlimit: '500', redirects: '1' })
  const files = new Map()
  for (const node of missing) {
    const page = pages.find(page => page.title.toLowerCase() === node.name.toLowerCase())
    const candidates = (page?.images || []).map(image => image.title).filter(title => /(?:passive skill|mastery) icon\.png$/i.test(title))
    const key = (node.iconKey || '').split('/').at(-1)?.replace(/\.png$/i, '').toLowerCase()
    const file = candidates.find(title => key && title.toLowerCase().startsWith(`file:${key} `)) || (candidates.length === 1 ? candidates[0] : undefined)
    if (file) files.set(node.id, file)
  }
  const images = files.size ? await query({ titles: [...new Set(files.values())].join('|'), prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: '64' }) : []
  const urls = new Map(images.map(page => {
    const image = page.imageinfo?.[0]
    // Most passive icons are already 128px. Use their static originals rather
    // than asking the wiki thumbnail renderer to regenerate many tiny files.
    return [page.title, image?.width <= 128 && image?.height <= 128 ? image.url : image?.thumburl || image?.url]
  }))
  for (const node of missing) {
    const url = urls.get(files.get(node.id))
    iconUrls.set(keyOf(node), typeof url === 'string' && /^https:\/\/(?:www\.)?poewiki\.net\//.test(url) ? url : '')
    if (iconUrls.size > 512) iconUrls.delete(iconUrls.keys().next().value)
  }
  return Object.fromEntries(nodes.flatMap(node => iconUrls.get(keyOf(node)) ? [[node.id, iconUrls.get(keyOf(node))]] : []))
}
