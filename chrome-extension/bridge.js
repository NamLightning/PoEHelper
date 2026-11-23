(function installWealthyExileBridge() {
  document.documentElement.dataset.weExtensionReady = 'true'

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data || {}
    const message = data.type === 'WE_SYNC_REQUEST'
      ? { type: 'SYNC_STASH' }
      : data.action === 'CAPTURE_WEALTHY_EXILE_CSV'
        ? { action: 'CAPTURE_WEALTHY_EXILE_CSV' }
        : null
    if (!message) return

    const requestId = data.requestId
    const postResponse = (payload) => window.postMessage({
      type: 'WE_SYNC_RESPONSE',
      requestId,
      payload,
    }, '*')

    if (typeof chrome === 'undefined' || !chrome.runtime?.id || typeof chrome.runtime.sendMessage !== 'function') {
      postResponse({
        success: false,
        error: 'Extension context đã hết hạn. Hãy reload extension và nhấn F5 lại trang localhost.',
      })
      return
    }

    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError
      postResponse(runtimeError ? { success: false, error: runtimeError.message } : response)
    })
  })
})()
