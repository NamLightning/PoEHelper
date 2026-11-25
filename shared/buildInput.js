// Shared validation keeps browser imports and the server proxy on the same allowlist.
export function normalizePobbinUrl(value) {
  const input = typeof value === 'string' ? value.trim() : ''
  const candidate = /^pobb\.in(?:[/?#:]|$)/i.test(input) ? `https://${input}` : input
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) return null
  let url
  try { url = new URL(candidate) } catch { throw new Error('Link pobb.in không hợp lệ.') }
  if (url.protocol !== 'https:' || url.hostname !== 'pobb.in' || url.port || url.username || url.password || !/^\/[\w-]{1,100}(?:\/raw)?\/?$/.test(url.pathname)) {
    throw new Error('Dùng link pobb.in/<id>, https://pobb.in/<id> hoặc https://pobb.in/<id>/raw.')
  }
  return `https://pobb.in/${url.pathname.split('/')[1]}`
}
