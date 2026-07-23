import { useState, useEffect, useCallback } from 'react'

// Steam connection panel for Settings → Accounts. Two-step connect:
//   1. Sign in through Steam (OpenID) → establishes SteamID
//   2. Paste a Web API key → validated live, then owned-library reads work
//
// Steam is intentionally NOT part of the username/password AddAccountModal flow
// used for forum sites — it's OpenID + key, a different shape entirely.

const API_KEY_URL = 'https://steamcommunity.com/dev/apikey'

const SteamConnect = () => {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [msg, setMsg] = useState({ type: 'idle', text: '' })

  const refresh = useCallback(async () => {
    try {
      const s = await window.electronAPI.steamStatus()
      setStatus(s || { connected: false })
    } catch (err) {
      console.error('Failed to load Steam status:', err)
      setStatus({ connected: false })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleSignIn = async () => {
    setSigningIn(true)
    setMsg({ type: 'idle', text: '' })
    try {
      const result = await window.electronAPI.steamSignIn()
      if (result?.ok) {
        setMsg({ type: 'ok', text: 'Signed in. Now add your Web API key to load your library.' })
        await refresh()
      } else {
        setMsg({ type: 'error', text: result?.error || 'Steam sign-in failed.' })
      }
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Steam sign-in failed.' })
    } finally {
      setSigningIn(false)
    }
  }

  const handleSaveKey = async () => {
    const key = keyInput.trim()
    if (!key) return
    setSavingKey(true)
    setMsg({ type: 'idle', text: '' })
    try {
      const result = await window.electronAPI.steamSetKey({ apiKey: key })
      if (result?.ok) {
        setKeyInput('')
        setMsg({ type: 'ok', text: 'API key saved — your Steam library is ready.' })
        await refresh()
      } else {
        setMsg({ type: 'error', text: result?.error || 'Could not save API key.' })
      }
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Could not save API key.' })
    } finally {
      setSavingKey(false)
    }
  }

  const handleDisconnect = async () => {
    setMsg({ type: 'idle', text: '' })
    try {
      await window.electronAPI.steamDisconnect()
      await refresh()
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Could not disconnect.' })
    }
  }

  if (loading) {
    return (
      <div className="rounded border border-border bg-primary p-3 text-sm text-text/60">
        <i className="fas fa-spinner fa-spin mr-2" /> Checking Steam connection…
      </div>
    )
  }

  const signedIn = Boolean(status?.steamId)
  const hasKey = Boolean(status?.hasApiKey)
  const fullyConnected = signedIn && hasKey

  return (
    <div className="rounded border border-border bg-primary p-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <i className="fab fa-steam text-lg" />
            <span className="font-semibold">Steam</span>
            {fullyConnected ? (
              <span className="inline-flex items-center gap-1 text-xs text-green-500">
                <i className="fas fa-check-circle" /> Connected
              </span>
            ) : signedIn ? (
              <span className="text-xs text-yellow-500">Signed in — API key needed</span>
            ) : (
              <span className="text-xs text-text/50">Not connected</span>
            )}
          </div>
          <div className="text-xs text-text/60 truncate">
            {signedIn ? `SteamID ${status.steamId}` : 'Sign in to load your owned library'}
            {fullyConnected && status.cachedCount
              ? ` · ${status.cachedCount} games cached`
              : ''}
          </div>
        </div>

        {signedIn && (
          <button
            onClick={handleDisconnect}
            className="self-start sm:self-auto px-3 py-1 text-sm rounded bg-secondary border border-border hover:bg-danger hover:text-white transition-colors"
          >
            Disconnect
          </button>
        )}
      </div>

      {/* Step 1: sign in */}
      {!signedIn && (
        <div className="mt-3">
          <button
            onClick={handleSignIn}
            disabled={signingIn}
            className="px-4 py-2 text-sm rounded bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {signingIn ? (
              <><i className="fas fa-spinner fa-spin mr-2" /> Waiting for Steam…</>
            ) : (
              <><i className="fab fa-steam mr-2" /> Sign in through Steam</>
            )}
          </button>
        </div>
      )}

      {/* Step 2: API key */}
      {signedIn && !hasKey && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs text-text/60">
            Atlas needs your personal Steam Web API key to read your owned games.
            It's free and takes a moment to create — paste it below.
          </p>
          <button
            type="button"
            onClick={() => window.electronAPI.openExternalUrl?.(API_KEY_URL)}
            className="self-start text-xs text-accent hover:underline"
          >
            <i className="fas fa-external-link-alt mr-1" />
            Get your API key
          </button>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your 32-character API key"
              className="flex-1 bg-primary border border-border text-text rounded p-2 text-sm font-mono"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button
              onClick={handleSaveKey}
              disabled={savingKey || !keyInput.trim()}
              className="px-4 py-2 text-sm rounded bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savingKey ? 'Validating…' : 'Save key'}
            </button>
          </div>
        </div>
      )}

      {msg.type === 'ok' && (
        <div className="mt-3 text-sm text-green-500 flex items-start gap-2">
          <i className="fas fa-check-circle mt-0.5" /> <span>{msg.text}</span>
        </div>
      )}
      {msg.type === 'error' && (
        <div className="mt-3 text-sm text-danger flex items-start gap-2">
          <i className="fas fa-exclamation-circle mt-0.5" /> <span>{msg.text}</span>
        </div>
      )}
    </div>
  )
}

export default SteamConnect
