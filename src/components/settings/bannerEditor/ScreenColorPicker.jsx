import { useEffect, useRef, useState, useCallback } from 'react'

// Cross-screen eyedropper overlay. The native EyeDropper API can't see other
// windows or the desktop when running inside Electron, so this samples from a
// full desktop capture instead: main captures every display (capture-screens
// IPC), and this overlay paints those captures to an offscreen canvas so a
// click anywhere returns the exact pixel color — across ANY window or monitor.
//
// Because a renderer overlay can only cover its OWN window, we can't literally
// draw over other apps. Instead the overlay shows the captured desktop image
// itself (a frozen snapshot of everything on screen at open time), scaled to
// fit, with a live magnifier + hex readout following the cursor. Clicking
// samples the pixel under the cursor and returns its hex via onPick.
//
// onPick(hex) is called with a #rrggbb string on selection; onCancel() on
// Escape / right-click / clicking the close affordance.
export default function ScreenColorPicker({ onPick, onCancel }) {
  const [captures, setCaptures] = useState(null) // array or null while loading
  const [error, setError] = useState('')
  const [cursor, setCursor] = useState({ x: 0, y: 0, hex: '', visible: false })
  const [zoom, setZoom] = useState(1) // 1 = 100% (1:1 device pixels)
  const scrollRef = useRef(null)
  const canvasRef = useRef(null) // offscreen canvas holding the composited desktop
  const imgRef = useRef(null) // the on-screen <img> we sample relative to
  const compositeRef = useRef({ width: 0, height: 0, dataUrl: '' })

  // Composite all display captures into one image laid out by their bounds, so
  // multi-monitor setups sample correctly. Single display = just that capture.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const result = await window.electronAPI.captureScreens?.()
        if (cancelled) return
        if (!result?.success || !Array.isArray(result.captures) || result.captures.length === 0) {
          setError(result?.error || 'Screen capture unavailable')
          return
        }
        // Normalize to a single composite in device pixels. Offset each capture
        // by (bounds - minBounds) * scaleFactor so displays tile correctly.
        const caps = result.captures
        const withBounds = caps.filter((c) => c.bounds)
        const usable = withBounds.length > 0 ? withBounds : caps.map((c) => ({ ...c, bounds: { x: 0, y: 0, width: 0, height: 0 }, scaleFactor: 1 }))
        const minX = Math.min(...usable.map((c) => c.bounds.x))
        const minY = Math.min(...usable.map((c) => c.bounds.y))

        const images = await Promise.all(usable.map((c) => new Promise((resolve) => {
          const img = new Image()
          img.onload = () => resolve({ img, cap: c })
          img.onerror = () => resolve(null)
          img.src = c.dataUrl
        })))
        if (cancelled) return
        const loaded = images.filter(Boolean)
        if (loaded.length === 0) { setError('Failed to load screen capture'); return }

        // Composite size in device pixels.
        let compW = 0
        let compH = 0
        for (const { img, cap } of loaded) {
          const offX = Math.round((cap.bounds.x - minX) * (cap.scaleFactor || 1))
          const offY = Math.round((cap.bounds.y - minY) * (cap.scaleFactor || 1))
          compW = Math.max(compW, offX + img.naturalWidth)
          compH = Math.max(compH, offY + img.naturalHeight)
        }
        const canvas = document.createElement('canvas')
        canvas.width = compW
        canvas.height = compH
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        for (const { img, cap } of loaded) {
          const offX = Math.round((cap.bounds.x - minX) * (cap.scaleFactor || 1))
          const offY = Math.round((cap.bounds.y - minY) * (cap.scaleFactor || 1))
          ctx.drawImage(img, offX, offY)
        }
        canvasRef.current = canvas
        compositeRef.current = { width: compW, height: compH, dataUrl: canvas.toDataURL() }
        setCaptures(loaded)
      } catch (err) {
        if (!cancelled) setError(String(err?.message || err))
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const toHex = (r, g, b) =>
    '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

  // Map a pointer position over the displayed <img> back to composite device
  // pixels and read that pixel from the offscreen canvas.
  const sampleAt = useCallback((clientX, clientY) => {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return null
    const rect = img.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null
    const relX = (clientX - rect.left) / rect.width
    const relY = (clientY - rect.top) / rect.height
    const px = Math.min(canvas.width - 1, Math.max(0, Math.round(relX * canvas.width)))
    const py = Math.min(canvas.height - 1, Math.max(0, Math.round(relY * canvas.height)))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const data = ctx.getImageData(px, py, 1, 1).data
    return { hex: toHex(data[0], data[1], data[2]), px, py }
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Once the composite is ready, start zoomed to fit the scroll area so the
  // whole (multi-monitor) desktop is visible; the user can then zoom in for
  // pixel-exact sampling.
  useEffect(() => {
    if (!captures) return
    const el = scrollRef.current
    const comp = compositeRef.current
    if (!el || !comp.width || !comp.height) return
    const fit = Math.min(el.clientWidth / comp.width, el.clientHeight / comp.height)
    // Clamp: never start above 1:1, and keep a sane floor.
    setZoom(Math.max(0.1, Math.min(1, fit || 1)))
  }, [captures])

  const clampZoom = (z) => Math.max(0.1, Math.min(16, z))
  const zoomIn = () => setZoom((z) => clampZoom(z * 1.5))
  const zoomOut = () => setZoom((z) => clampZoom(z / 1.5))
  const zoomActual = () => setZoom(1)
  const zoomFit = () => {
    const el = scrollRef.current
    const comp = compositeRef.current
    if (!el || !comp.width || !comp.height) return
    setZoom(clampZoom(Math.min(el.clientWidth / comp.width, el.clientHeight / comp.height)))
  }

  const handleWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return // plain scroll = pan; Ctrl/Cmd = zoom
    e.preventDefault()
    setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
  }

  const handleMove = (e) => {
    const sample = sampleAt(e.clientX, e.clientY)
    if (sample) setCursor({ x: e.clientX, y: e.clientY, hex: sample.hex, visible: true })
    else setCursor((c) => ({ ...c, visible: false }))
  }

  // Commit the color on mouse-UP rather than click, so the user can press and
  // drag across pixels (watching the live magnifier update) and only lock in
  // the color where they release. A plain click (press+release in place) still
  // works exactly as before.
  const handleMouseUp = (e) => {
    if (e.button !== 0) return // left button only; right-click cancels via overlay
    const sample = sampleAt(e.clientX, e.clientY)
    if (sample) onPick?.(sample.hex)
  }

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex flex-col"
      onContextMenu={(e) => { e.preventDefault(); onCancel?.() }}
    >
      <div className="flex items-center justify-between px-4 py-2 bg-primary text-text text-sm gap-4">
        <span className="min-w-0 truncate">
          {error
            ? 'Color picker unavailable'
            : captures
              ? 'Click any pixel to pick its color \u2014 scroll to pan, Ctrl+scroll or the buttons to zoom. Esc / right-click to cancel.'
              : 'Capturing screen\u2026'}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {captures && (
            <div className="flex items-center gap-1">
              <button type="button" onClick={zoomOut} title="Zoom out" aria-label="Zoom out" className="w-7 h-7 flex items-center justify-center bg-button hover:bg-buttonHover rounded">
                <i className="fas fa-minus" aria-hidden="true"></i>
              </button>
              <span className="w-12 text-center tabular-nums text-xs">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={zoomIn} title="Zoom in" aria-label="Zoom in" className="w-7 h-7 flex items-center justify-center bg-button hover:bg-buttonHover rounded">
                <i className="fas fa-plus" aria-hidden="true"></i>
              </button>
              <button type="button" onClick={zoomFit} title="Fit to view" className="px-2 h-7 bg-button hover:bg-buttonHover rounded text-xs">Fit</button>
              <button type="button" onClick={zoomActual} title="Actual size (100%)" className="px-2 h-7 bg-button hover:bg-buttonHover rounded text-xs">1:1</button>
            </div>
          )}
          <button
            type="button"
            onClick={() => onCancel?.()}
            className="px-3 py-1 bg-button hover:bg-buttonHover rounded"
          >
            Cancel
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto" onWheel={handleWheel}>
        {error ? (
          <div className="h-full flex items-center justify-center text-text text-sm max-w-md text-center px-6 mx-auto">
            {error}. Your system may not allow screen capture for this app.
          </div>
        ) : captures ? (
          <img
            ref={imgRef}
            src={compositeRef.current.dataUrl}
            alt="Screen capture"
            draggable={false}
            onMouseMove={handleMove}
            onMouseUp={handleMouseUp}
            onMouseDown={(e) => e.preventDefault()}
            onDragStart={(e) => e.preventDefault()}
            className="cursor-crosshair select-none max-w-none"
            style={{
              width: Math.round(compositeRef.current.width * zoom),
              height: Math.round(compositeRef.current.height * zoom),
              imageRendering: 'pixelated',
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-accent" role="status" aria-label="Capturing screen" />
          </div>
        )}
      </div>

      {cursor.visible && (
        <div
          className="pointer-events-none fixed flex items-center gap-2 px-2 py-1 rounded bg-primary border border-border text-xs text-text shadow-lg"
          style={{ left: cursor.x + 16, top: cursor.y + 16 }}
        >
          <span className="inline-block w-4 h-4 rounded border border-border" style={{ background: cursor.hex }} />
          <span className="tabular-nums">{cursor.hex.toUpperCase()}</span>
        </div>
      )}
    </div>
  )
}
