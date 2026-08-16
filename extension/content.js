// content.js - Atlas Browser Extension Content Script
/* global chrome, module */
;(function () {
  let gamesList = []
  let userSettings = {
    icon_glow: true,
    highlight_tags: false,
    tags_highlights: {},
  }

  // globalThis.atlasBrowser is installed by compat.js, which every manifest
  // lists ahead of this file in content_scripts.js. Content scripts from one
  // extension share an isolated-world global, so it is already present here.
  const api = globalThis.atlasBrowser

  const logoUrl = api?.runtime?.getURL ? api.runtime.getURL('icons/logo.png') : ''

  const THREAD_ID_PATTERNS = {
    f95: /(?:^|\/\/|\.)f95zone\.to\/threads\/(?:(?:[^\/?#]*)[.-])?(\d+)/i,
    lewdcorner: /(?:^|\/\/|\.)lewdcorner\.com\/threads\/(?:(?:[^\/?#]*)[.-])?(\d+)/i,
  }

  // Parses thread URLs to extract host forum site and thread ID, ensuring site-isolated game matching
  const extractThreadInfo = (urlStr) => {
    if (!urlStr) return null
    const text = String(urlStr).trim()

    for (const [site, pattern] of Object.entries(THREAD_ID_PATTERNS)) {
      const match = pattern.exec(text)
      if (match) {
        const id = Number.parseInt(match[1], 10)
        if (Number.isInteger(id) && id > 0) {
          return { site, id }
        }
      }
    }

    // Handles relative thread paths by checking current document domain
    const relativeMatch = /^\/?threads\/(?:(?:[^\/?#]*)[.-])?(\d+)/i.exec(text)
    if (relativeMatch) {
      const id = Number.parseInt(relativeMatch[1], 10)
      if (Number.isInteger(id) && id > 0) {
        let site = null
        const hostname = typeof window !== 'undefined' ? window.location?.hostname || '' : ''
        if (hostname.includes('lewdcorner.com')) site = 'lewdcorner'
        else if (hostname.includes('f95zone.to')) site = 'f95'
        if (site) return { site, id }
      }
    }

    return null
  }

  // Matches a thread against Atlas games by verifying matching site source (f95Id vs lcId) to prevent cross-site ID collisions
  const findGameForThread = (threadInfo, customGamesList = null) => {
    if (!threadInfo || !threadInfo.site || !threadInfo.id) return null
    const list = customGamesList || gamesList
    if (!list || list.length === 0) return null

    const targetId = threadInfo.id

    const found = list.find((g) => {
      if (threadInfo.site === 'f95') {
        const f95 = g.f95Id ? Number.parseInt(g.f95Id, 10) : null
        return f95 === targetId
      }
      if (threadInfo.site === 'lewdcorner') {
        const lc = g.lcId ? Number.parseInt(g.lcId, 10) : null
        return lc === targetId
      }
      return false
    })

    return found || null
  }

  // sendMessage is the one API where the two namespaces genuinely differ in
  // shape rather than just in spelling: Firefox's browser.runtime.sendMessage
  // takes no callback and returns a promise, while Chromium MV3 accepts either.
  // Promise.resolve() over the return value covers both without branching on
  // which browser this is.
  const fetchAtlasData = async () => {
    if (!api?.runtime?.sendMessage) return
    try {
      const response = await Promise.resolve(
        api.runtime.sendMessage({ action: 'get_data' }),
      )
      if (response) {
        if (Array.isArray(response.games)) gamesList = response.games
        if (response.settings) userSettings = response.settings
      }
    } catch {
      // Background asleep, extension reloading, or no host access granted yet.
      // Badges simply do not render this pass; the next refresh retries.
    }
  }

  const createContainer = () => {
    const c = document.createElement('div')
    c.classList.add('atlas-library-icons')
    c.style.display = 'inline-flex'
    c.style.alignItems = 'center'
    c.style.verticalAlign = 'middle'
    c.style.marginRight = '6px'
    return c
  }

  const createIcon = (threadInfo, targetGame = null) => {
    const badge = document.createElement('span')
    badge.classList.add('atlas-badge-pill')

    const img = document.createElement('img')
    img.src = logoUrl
    img.classList.add('atlas-badge-logo')
    img.style.width = '14px'
    img.style.height = '14px'
    img.style.objectFit = 'contain'
    img.style.verticalAlign = 'middle'
    img.style.marginRight = '3px'

    const game = targetGame || findGameForThread(threadInfo)

    let bgColor = '#3b82f6'
    let borderColor = '#60a5fa'
    let symbol = ''
    let tooltipText = 'Tracked in Atlas'

    if (game) {
      if (game.installed) {
        bgColor = '#15803d' // Green for Installed
        borderColor = '#22c55e'
        symbol = '✓'
        tooltipText = `In Atlas Library (Installed: ${game.installedVersion || 'v1.0'})`
      } else if (game.isWishlist) {
        bgColor = '#7e22ce' // Purple for Wishlist
        borderColor = '#a855f7'
        symbol = '♥'
        tooltipText = 'In Atlas Wishlist'
      } else {
        bgColor = '#1d4ed8' // Blue for Tracked
        borderColor = '#3b82f6'
        symbol = '★'
        tooltipText = 'Tracked in Atlas'
      }

      if (game.notes) tooltipText += `\n\nNotes: ${game.notes}`
      if (game.rating) tooltipText += `\nRating: ${game.rating}/10`
    }

    badge.setAttribute('title', tooltipText)
    badge.style.display = 'inline-flex'
    badge.style.alignItems = 'center'
    badge.style.justifyContent = 'center'
    badge.style.backgroundColor = bgColor
    badge.style.border = `1px solid ${borderColor}`
    badge.style.borderRadius = '4px'
    badge.style.padding = '2px 5px'
    badge.style.fontSize = '11px'
    badge.style.fontWeight = 'bold'
    badge.style.color = '#ffffff'
    badge.style.cursor = 'pointer'

    if (userSettings.icon_glow) {
      badge.style.boxShadow = `0 0 8px ${borderColor}aa`
    }

    badge.appendChild(img)
    if (symbol) {
      const symbolSpan = document.createElement('span')
      symbolSpan.textContent = symbol
      symbolSpan.style.fontSize = '11px'
      symbolSpan.style.lineHeight = '1'
      badge.appendChild(symbolSpan)
    }

    badge.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      alert(`Atlas Game Tracker\n\n${tooltipText}`)
    })

    return badge
  }

  const createNbsp = () => {
    const span = document.createElement('span')
    span.style.display = 'inline-block'
    span.innerHTML = '&nbsp;'
    return span
  }

  const isValidHrefElem = (elem, elemInfo, pageInfo) => {
    if (!elem || !elem.href) return false

    if (/reply\?.*$/.test(elem.href)) return false
    if (/page-\d+/.test(elem.href)) return false

    if (elem.closest('.pageNav') || elem.closest('.pageNavWrapper') || elem.closest('.pageNav-page')) return false

    if (elem.closest('.tabs') || elem.closest('.tabs-tab') || elem.closest('.p-body-header') || elem.closest('.memberHeader')) return false
    if (elem.classList.contains('button') || elem.classList.contains('tabs-tab') || elem.classList.contains('u-concealed')) return false

    if (pageInfo && elemInfo && pageInfo.site === elemInfo.site && pageInfo.id === elemInfo.id) return false

    return true
  }

  const renderBadges = () => {
    if (!gamesList || gamesList.length === 0) return

    const pageInfo = extractThreadInfo(document.location.href)
    if (pageInfo) {
      const pageGame = findGameForThread(pageInfo)
      if (pageGame) {
        const titleElem =
          document.getElementsByClassName('p-title-value')[0] ||
          document.querySelector('.p-title > h1')
        if (titleElem && !titleElem.querySelector('.atlas-library-icons')) {
          const container = createContainer()
          container.appendChild(createIcon(pageInfo, pageGame))
          const childNodes = Array.from(titleElem.childNodes)
          const targetChild = childNodes[childNodes.length - 1]
          if (targetChild) {
            titleElem.insertBefore(container, targetChild)
            titleElem.insertBefore(createNbsp(), targetChild)
          } else {
            titleElem.appendChild(container)
          }
        }
      }
    }

    for (const elem of document.querySelectorAll('a[href*="/threads/"]')) {
      const elemInfo = extractThreadInfo(elem.href)
      if (!elemInfo) continue
      const elemGame = findGameForThread(elemInfo)
      if (!elemGame) continue
      if (!isValidHrefElem(elem, elemInfo, pageInfo)) continue
      if (elem.querySelector('.atlas-library-icons') || elem.parentNode?.querySelector('.atlas-library-icons')) continue

      const isImage =
        elem.classList.contains('resource-tile_link') ||
        (elem.parentNode && elem.parentNode.parentNode && elem.parentNode.parentNode.classList.contains('es-slides'))

      const container = createContainer()
      container.appendChild(createIcon(elemInfo, elemGame))

      if (isImage) {
        container.style.position = 'absolute'
        container.style.zIndex = '50'
        container.style.left = '5px'
        container.style.top = '5px'
        container.style.background = 'rgba(24, 24, 27, 0.85)'
        container.style.padding = '2px'
        container.style.borderRadius = '4px'
        elem.appendChild(container)
      } else if (elem.children.length > 0) {
        const whitespaces = elem.querySelectorAll('span.label-append')
        if (whitespaces.length > 0) {
          const lastWhitespace = whitespaces[whitespaces.length - 1]
          lastWhitespace.insertAdjacentElement('afterend', createNbsp())
          lastWhitespace.insertAdjacentElement('afterend', container)
        } else if (elem.classList.contains('link--internal')) {
          if (elem.querySelector('img[data-src]')) continue
          elem.insertAdjacentElement('beforebegin', container)
          elem.insertAdjacentElement('beforebegin', createNbsp())
        }
      } else {
        elem.insertAdjacentElement('beforebegin', container)
        elem.insertAdjacentElement('beforebegin', createNbsp())
      }
    }
  }

  // ── Queue Refresh button (opt-in via popup checkbox) ───────────────────────
  //
  // Shown only when the user enables "Show queue-refresh button" in the
  // extension popup. Default is off. The AtlasDB API still requires an admin
  // session; non-admins get an error toast if they enable the option and click.

  const BUTTON_TEXT = 'Atlas ↻ Refresh'

  const showToast = (msg, isError) => {
    let t = document.getElementById('atlas-refresh-toast')
    if (!t) {
      t = document.createElement('div')
      t.id = 'atlas-refresh-toast'
      document.body.appendChild(t)
    }
    t.textContent = msg
    t.className = isError ? 'atlas-toast error' : 'atlas-toast ok'
    t.style.display = 'block'
    clearTimeout(t._hide)
    t._hide = setTimeout(() => {
      t.style.display = 'none'
    }, 6000)
  }

  const isQueueRefreshEnabled = async () => {
    if (!api?.storage?.local) return false
    try {
      const result = await api.storage.local.get(['showQueueRefresh'])
      return Boolean(result && result.showQueueRefresh)
    } catch {
      return false
    }
  }

  const queueRefreshViaBackground = async (threadId, source) => {
    if (!api?.runtime?.sendMessage) {
      throw new Error('Extension messaging unavailable')
    }
    const response = await Promise.resolve(
      api.runtime.sendMessage({
        action: 'queue_f95_refresh',
        f95Id: threadId,
        source: source,
      }),
    )
    if (!response) {
      throw new Error('No response from background')
    }
    if (!response.ok) {
      throw new Error(response.error || 'Unknown error')
    }
    return response.data || {}
  }

  const removeQueueRefreshButton = () => {
    const existing = document.getElementById('atlas-queue-btn')
    if (existing) existing.remove()
  }

  const addQueueRefreshButton = async () => {
    const pageInfo = extractThreadInfo(document.location.href)
    if (!pageInfo) {
      removeQueueRefreshButton()
      return
    }

    const enabled = await isQueueRefreshEnabled()
    if (!enabled) {
      removeQueueRefreshButton()
      return
    }

    if (document.getElementById('atlas-queue-btn')) return

    const btn = document.createElement('button')
    btn.id = 'atlas-queue-btn'
    btn.textContent = BUTTON_TEXT
    btn.title = `Queue thread ${pageInfo.id} for re-scrape in AtlasDB (admin)`

    btn.addEventListener('click', async () => {
      if (btn.disabled) return
      btn.disabled = true
      btn.textContent = 'Queueing…'

      const source = pageInfo.site === 'lewdcorner' ? 'lc' : 'f95'

      try {
        const result = await queueRefreshViaBackground(pageInfo.id, source)
        if (result.reused) {
          showToast(`Already queued (id ${pageInfo.id})`, false)
        } else {
          showToast(
            `Queued id ${pageInfo.id} (${source}) – worker will pick it up`,
            false,
          )
        }
      } catch (err) {
        showToast(err.message || String(err), true)
        console.error('[Atlas Queue Refresh]', err)
      } finally {
        btn.disabled = false
        btn.textContent = BUTTON_TEXT
      }
    })

    const title =
      document.querySelector('.p-title-value') ||
      document.querySelector('.p-title') ||
      document.querySelector('h1')

    if (title && title.parentElement) {
      title.parentElement.appendChild(btn)
    } else {
      btn.classList.add('atlas-floating')
      document.body.appendChild(btn)
    }
  }

  const init = async () => {
    await fetchAtlasData()
    renderBadges()
    await addQueueRefreshButton()

    const observer = new MutationObserver(() => {
      renderBadges()
      addQueueRefreshButton()
    })
    observer.observe(document.body, { childList: true, subtree: true })

    // React when the popup checkbox changes without requiring a full reload
    if (api?.storage?.onChanged) {
      api.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.showQueueRefresh) {
          addQueueRefreshButton()
        }
      })
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      extractThreadInfo,
      findGameForThread,
      isValidHrefElem,
    }
  }

  if (typeof document !== 'undefined') {
    if (api?.runtime?.onMessage) {
      api.runtime.onMessage.addListener((msg) => {
        if (msg && msg.action === 'refresh') {
          fetchAtlasData().then(renderBadges)
        }
      })
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init)
    } else {
      init()
    }
  }
})()