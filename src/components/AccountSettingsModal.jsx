import { useEffect, useState } from 'react'
import { Eye, EyeOff, X } from 'lucide-react'
import { recordPoeCooldown, currentPoeDeadline } from '../lib/poeCooldown.js'
import usePoeCooldown from '../lib/usePoeCooldown.js'

async function readJson(response) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('json')) {
    if (response.status === 404) {
      throw new Error('Backend local chưa có API tài khoản (HTTP 404). Hãy dừng rồi chạy lại npm run dev.')
    }
    throw new Error(`Backend local trả HTTP ${response.status} thay vì JSON. Hãy kiểm tra server và proxy /api.`)
  }

  let result
  try {
    result = await response.json()
  } catch {
    throw new Error('The local API returned an invalid response.')
  }

  recordPoeCooldown(response, result)
  if (!response.ok) {
    const error = new Error(result.error || `Account API returned HTTP ${response.status}.`)
    error.code = result.code
    throw error
  }
  return result
}

function errorStatus(error) {
  if (error.code === 'SESSION_INVALID') {
    return 'POESESSID hết hạn hoặc không hợp lệ. Hãy cập nhật cookie.'
  }
  if (error.code === 'ACCOUNT_NOT_FOUND') {
    return 'Không tìm thấy tài khoản. Hãy kiểm tra Account Name#Tag.'
  }
  if (error.code === 'ACCOUNT_NOT_CONFIGURED') {
    return 'Chưa cấu hình Account Name#Tag hợp lệ.'
  }
  return error.message || 'Không thể kết nối tài khoản Path of Exile.'
}

export default function AccountSettingsModal({
  open,
  onClose,
  onAccountName,
  onAccountSaved,
  onSelectCharacter,
  selectedCharacter,
}) {
  const retrySeconds = usePoeCooldown()
  const [accountName, setAccountName] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [cookieConfigured, setCookieConfigured] = useState(false)
  const [characters, setCharacters] = useState([])
  const [showSessionId, setShowSessionId] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingCharacters, setLoadingCharacters] = useState(false)
  const [status, setStatus] = useState({ kind: 'idle', message: '' })

  useEffect(() => {
    if (!open) {
      setSessionId('')
      return undefined
    }

    const controller = new AbortController()
    setLoadingConfig(true)
    setCharacters([])
    setStatus({ kind: 'idle', message: '' })

    fetch('/api/account/config', { signal: controller.signal })
      .then(readJson)
      .then((config) => {
        setAccountName(config.accountName || '')
        setCookieConfigured(Boolean(config.cookieConfigured))
        onAccountName(config.accountName || '')
        setStatus(config.configured
          ? { kind: 'neutral', message: 'Đã cấu hình. Nhấn “Load Characters” để kiểm tra kết nối.' }
          : { kind: 'neutral', message: 'Chưa cấu hình tài khoản Path of Exile.' })
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setStatus({ kind: 'error', message: errorStatus(error) })
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingConfig(false)
      })

    return () => controller.abort()
  }, [open, onAccountName])

  async function loadCharacters() {
    if (currentPoeDeadline() > Date.now()) return false
    setLoadingCharacters(true)
    try {
      const response = await fetch('/api/account/characters')
      const result = await readJson(response)
      setCharacters(result)
      setStatus({ kind: 'success', message: `Đã kết nối thành công · ${result.length} nhân vật.` })
      return true
    } catch (error) {
      setCharacters([])
      setStatus({ kind: 'error', message: errorStatus(error) })
      return false
    } finally {
      setLoadingCharacters(false)
    }
  }

  async function saveConfig(event) {
    event.preventDefault()
    setSaving(true)
    setStatus({ kind: 'neutral', message: 'Đang lưu cấu hình…' })

    try {
      const response = await fetch('/api/account/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountName, poeSessId: sessionId }),
      })
      const config = await readJson(response)
      setAccountName(config.accountName || accountName)
      setCookieConfigured(Boolean(config.cookieConfigured))
      onAccountSaved(config.accountName || accountName)
      setSessionId('')
      setStatus({ kind: 'neutral', message: 'Đã lưu cục bộ. Đang kiểm tra kết nối…' })
      const connected = await loadCharacters()
      if (connected && !config.cookieConfigured) {
        setStatus({ kind: 'success', message: 'Đã lưu chế độ public profile · không gửi cookie POESESSID.' })
      }
    } catch (error) {
      setStatus({ kind: 'error', message: errorStatus(error) })
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const statusColor = status.kind === 'error'
    ? 'text-[#e07a68]'
    : status.kind === 'success'
      ? 'text-[var(--mint)]'
      : 'text-[var(--muted)]'

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-settings-title"
        className="panel max-h-[90vh] w-full max-w-xl overflow-y-auto p-5 shadow-[var(--shadow)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="account-settings-title" className="text-xl font-semibold">Account &amp; Character</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Liên kết tài khoản Path of Exile trên máy này và chọn nhân vật.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account settings"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={saveConfig} className="mt-5 space-y-3">
          <label className="block text-sm">
            Account Name#Tag
            <input
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              required
              autoComplete="username"
              placeholder="Name#1234"
              className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-[var(--line-strong)]"
            />
          </label>

          <label className="block text-sm">
            POESESSID
            <span className="mt-1.5 flex rounded-xl border border-[var(--line)] bg-black/20 focus-within:border-[var(--line-strong)]">
              <input
                type={showSessionId ? 'text' : 'password'}
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                autoComplete="new-password"
                placeholder={cookieConfigured ? 'Để trống và Save để xóa cookie đã lưu' : 'Không bắt buộc với public profile'}
                className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => setShowSessionId((visible) => !visible)}
                aria-label={showSessionId ? 'Hide POESESSID' : 'Show POESESSID'}
                className="px-3 text-[var(--muted)] hover:text-[var(--text)]"
              >
                {showSessionId ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>

          <p className="text-xs leading-relaxed text-[var(--muted)]">
            POESESSID được lưu trong <code>config.local.json</code> trên máy này và không được trả về giao diện.
            Để trống và bấm Save để xóa cookie đã lưu, chuyển sang public profile. Stash riêng tư cần cookie.
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={saving || loadingConfig}
              className="rounded-full bg-[var(--gold)] px-4 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--gold-2)] disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Account'}
            </button>
            <button
              type="button"
              onClick={loadCharacters}
              disabled={loadingConfig || saving || loadingCharacters || retrySeconds > 0 || !accountName.trim()}
              className="rounded-full border border-[var(--line)] px-4 py-2 text-sm hover:border-[var(--line-strong)] disabled:opacity-50"
            >
              {loadingCharacters ? 'Loading…' : 'Load Characters'}
            </button>
          </div>
        </form>

        {status.message || retrySeconds > 0 ? (
          <p role={status.kind === 'error' ? 'alert' : 'status'} className={`mt-4 text-sm ${statusColor}`}>
            {retrySeconds > 0 ? `GGG API đang giới hạn tốc độ truy cập. Vui lòng thử lại sau ${retrySeconds}s` : status.message}
          </p>
        ) : null}

        {characters.length > 0 ? (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-medium">Characters</h3>
            <ul className="space-y-2">
              {characters.map((character) => {
                const selected = selectedCharacter?.name === character.name
                return (
                  <li key={`${character.league}-${character.name}`}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectCharacter({ ...character, accountName })
                        onClose()
                      }}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
                        selected ? 'border-[var(--gold)] bg-white/[0.04]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{character.name}</span>
                        <span className="mt-0.5 block text-xs text-[var(--muted)]">
                          {character.class || 'Unknown class'} · Level {character.level ?? '—'} · {character.league || 'Unknown league'}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-[var(--gold-2)]">
                        {selected ? 'Selected' : 'Choose'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  )
}
