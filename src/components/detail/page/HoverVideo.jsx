import { useRef, useState } from 'react'

// A video thumbnail that plays on hover (muted, looping) and stops/resets on
// leave. Click bubbles up to open the shared lightbox fullscreen — same as
// clicking an image preview. Keeps a play-icon overlay while idle so it reads
// as a video at a glance.
export default function HoverVideo({ src, onClick }) {
  const videoRef = useRef(null)
  const [playing, setPlaying] = useState(false)

  const handleEnter = () => {
    const v = videoRef.current
    if (!v) return
    // play() returns a promise that rejects if interrupted — swallow it.
    const p = v.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
    setPlaying(true)
  }

  const handleLeave = () => {
    const v = videoRef.current
    if (!v) return
    v.pause()
    try { v.currentTime = 0 } catch { /* ignore */ }
    setPlaying(false)
  }

  return (
    <div
      className="border border-border overflow-hidden aspect-video cursor-pointer hover:border-accent transition-colors relative"
      onClick={onClick}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      title="Hover to preview · click to play fullscreen"
    >
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        playsInline
        preload="metadata"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }}
      />
      {!playing && (
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'rgba(0,0,0,0.25)', pointerEvents: 'none',
          }}
        >
          <i
            className="fas fa-play-circle"
            style={{ fontSize: 44, color: 'rgba(255,255,255,0.92)', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.6))' }}
          ></i>
        </div>
      )}
    </div>
  )
}
