import { useState, useEffect } from 'react'

const SOURCE_LABELS = {
  f95: 'F95Zone',
  lewdcorner: 'LewdCorner',
  steam: 'Steam',
  gog: 'GOG',
  atlas: 'Atlas',
}

// blacklisted_at is stored in seconds, like the wishlist's flagged_at.
const formatBlacklistedAt = (seconds) => {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return ''
  return new Date(value * 1000).toLocaleDateString()
}

// The only place a blacklisted title can be seen again, so it is also the only
// way to undo one: Browse no longer shows the title to un-blacklist it from.
const BlacklistSettings = () => {
  const [entries, setEntries] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [removingKey, setRemovingKey] = useState('')

  // Re-read rather than patch local state: blacklisting from the main window
  // while this window is open adds rows this list never saw being written.
  const reload = async () => {
    try {
      setEntries((await window.electronAPI.getBlacklistEntries?.()) || [])
    } catch (err) {
      console.error('Error loading blacklist:', err)
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    reload()
    const off = window.electronAPI.onBlacklistUpdated?.(() => { reload() })
    return () => { if (typeof off === 'function') off() }
  }, [])

  // The row goes straight back to the main process: removeBlacklistEntry keys
  // on the stored identity_key, which the row already carries.
  const handleRemove = async (entry) => {
    setRemovingKey(entry.identity_key)
    try {
      await window.electronAPI.removeBlacklistEntry(entry)
      await reload()
    } catch (err) {
      console.error('Error removing blacklist entry:', err)
      alert('Failed to remove this game from the blacklist.')
    } finally {
      setRemovingKey('')
    }
  }

  return (
    <div className="p-5 text-text">
      <h2 className="text-xl font-bold mb-2 text-aliceblue">Blacklist</h2>
      <p className="text-sm text-text mb-4">
        Games you blacklisted are hidden from Browse. Remove one to show it in Browse again.
      </p>
      {loaded && entries.length === 0 ? (
        <p className="text-text">No blacklisted games.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => {
            const details = [
              entry.creator,
              SOURCE_LABELS[entry.source] || entry.source,
              formatBlacklistedAt(entry.blacklisted_at),
            ].filter(Boolean).join(' · ')
            const removing = removingKey === entry.identity_key
            return (
              <li
                key={entry.identity_key}
                className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 p-2 bg-primary border border-border rounded"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {entry.banner_url && (
                    <img
                      src={entry.banner_url}
                      alt=""
                      className="w-16 h-9 object-cover rounded shrink-0"
                      // A dead remote banner is common for old threads; an
                      // empty slot reads better than the broken-image glyph.
                      onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                    />
                  )}
                  <div className="min-w-0 break-words">
                    <div className="font-medium">{entry.title}</div>
                    {details && <div className="text-[11px] opacity-70">{details}</div>}
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(entry)}
                  disabled={removing}
                  className="p-1 bg-danger text-text rounded hover:bg-dangerHover shrink-0 self-start sm:self-auto disabled:opacity-60"
                >
                  {removing ? 'Removing…' : 'Remove'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default BlacklistSettings
