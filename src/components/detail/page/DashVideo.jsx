import { useRef, useEffect } from 'react'
import { isDashUrl } from './gameDetailUtils.js'

// A <video> that transparently plays either a direct file (mp4/webm) or a DASH
// manifest (.mpd) via dash.js. Steam moved store trailers to DASH, which a plain
// <video src> can't play — so for .mpd we attach a dash.js MediaPlayer.
//
// dash.js is imported dynamically so it only loads when a DASH source actually
// needs it (keeps it out of the initial bundle for pages with no trailers).
export default function DashVideo({
  src,
  autoPlay = false,
  controls = false,
  muted = true,
  loop = false,
  style,
  videoRef: externalRef,
  ...rest
}) {
  const innerRef = useRef(null)
  const videoRef = externalRef || innerRef
  const playerRef = useRef(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return undefined

    let cancelled = false

    // Tear down any previous dash player before (re)attaching.
    const destroyPlayer = () => {
      if (playerRef.current) {
        try { playerRef.current.destroy() } catch { /* ignore */ }
        playerRef.current = null
      }
    }

    if (isDashUrl(src)) {
      // Dynamically load dash.js and attach.
      import('dashjs')
        .then((mod) => {
          if (cancelled) return
          const dashjs = mod.default || mod
          destroyPlayer()
          const player = dashjs.MediaPlayer().create()
          player.initialize(video, src, autoPlay)
          player.setMute(muted)
          // Keep the initial quality modest so hover-preview starts fast.
          try { player.updateSettings({ streaming: { abr: { initialBitrate: { video: 800 } } } }) } catch { /* ignore */ }
          playerRef.current = player
        })
        .catch((err) => console.warn('dash.js load/attach failed:', err?.message))
    } else {
      // Direct file — native playback.
      destroyPlayer()
      video.src = src
      if (autoPlay) {
        const p = video.play()
        if (p && typeof p.catch === 'function') p.catch(() => {})
      }
    }

    return () => {
      cancelled = true
      destroyPlayer()
      // Release the native source too.
      if (video && !isDashUrl(src)) {
        try { video.removeAttribute('src'); video.load() } catch { /* ignore */ }
      }
    }
  }, [src, autoPlay, muted, videoRef])

  return (
    <video
      ref={videoRef}
      muted={muted}
      loop={loop}
      controls={controls}
      playsInline
      preload="metadata"
      style={style}
      {...rest}
    />
  )
}
