import { useState, useEffect, useCallback } from 'react'

// Sites Atlas can authenticate against for login-gated media. Steam is shown
// but disabled — its artwork comes from public CDNs and needs no login, so an
// account buys nothing yet (kept as a slot for future owned-library features).
const ACCOUNT_SITES = [
  { id: 'f95', label: 'F95Zone', hint: 'f95zone.to', enabled: true },
  { id: 'lewdcorner', label: 'LewdCorner', hint: 'lewdcorner.com', enabled: true },
  { id: 'steam', label: 'Steam', hint: 'Coming soon', enabled: false },
]

const Accounts = () => {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  const loadAccounts = useCallback(async () => {
    try {
      const list = await window.electronAPI.listAccounts()
      setAccounts(Array.isArray(list) ? list : [])
    } catch (err) {
      console.error('Failed to load accounts:', err)
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const accountFor = (siteId) =>
    accounts.find((a) => a.site === siteId && a.connected) || null

  const handleRemove = async (siteId) => {
    try {
      await window.electronAPI.removeAccount({ site: siteId })
      await loadAccounts()
    } catch (err) {
      console.error('Failed to remove account:', err)
    }
  }

  // Sites that can still have an account added (enabled + not already present).
  const addableSites = ACCOUNT_SITES.filter(
    (s) => s.enabled && !accountFor(s.id),
  )

  return (
    <div className="text-text max-w-2xl">
      <p className="text-sm text-text/70 mb-4">
        Add a site account so Atlas can use your login when fetching artwork and
        previews that are hidden behind a members-only wall. Your username and
        password are stored encrypted on this device and are used only to keep
        the session cookie fresh — nothing is sent anywhere except the site you
        log in to.
      </p>

      <div className="flex flex-col gap-2">
        {ACCOUNT_SITES.map((site) => {
          const account = accountFor(site.id)
          return (
            <div
              key={site.id}
              className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded border border-border bg-primary p-3 ${
                site.enabled ? '' : 'opacity-60'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{site.label}</span>
                  {account ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-500">
                      <i className="fas fa-check-circle" /> Connected
                    </span>
                  ) : site.enabled ? (
                    <span className="text-xs text-text/50">Not connected</span>
                  ) : (
                    <span className="text-xs text-text/50">{site.hint}</span>
                  )}
                </div>
                <div className="text-xs text-text/60 truncate">
                  {account ? account.username : site.enabled ? site.hint : null}
                </div>
              </div>

              {site.enabled && account && (
                <button
                  onClick={() => handleRemove(site.id)}
                  className="self-start sm:self-auto px-3 py-1 text-sm rounded bg-secondary border border-border hover:bg-danger hover:text-white transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-4">
        <button
          onClick={() => setModalOpen(true)}
          disabled={addableSites.length === 0}
          className="px-4 py-2 text-sm rounded bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <i className="fas fa-plus mr-2" />
          Add account
        </button>
        {addableSites.length === 0 && !loading && (
          <span className="ml-3 text-xs text-text/50">
            All available sites are connected.
          </span>
        )}
      </div>

      {modalOpen && (
        <AddAccountModal
          sites={addableSites}
          onClose={() => setModalOpen(false)}
          onSaved={async () => {
            setModalOpen(false)
            await loadAccounts()
          }}
        />
      )}
    </div>
  )
}

const AddAccountModal = ({ sites, onClose, onSaved }) => {
  const [site, setSite] = useState(sites[0]?.id || '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [verified, setVerified] = useState(false)
  const [verify, setVerify] = useState({ status: 'idle', message: '' })
  const [saving, setSaving] = useState(false)

  const busy = verify.status === 'verifying' || saving
  const canVerify = site && username.trim() && password && !busy
  const canBrowser = site && !busy
  const canAdd = verified && !busy

  // Any change to the identity invalidates the prior verification.
  const invalidate = () => {
    setVerified(false)
    if (verify.status !== 'idle') setVerify({ status: 'idle', message: '' })
  }

  const handleVerify = async () => {
    if (!canVerify) return
    setVerify({ status: 'verifying', message: '' })
    setVerified(false)
    try {
      const result = await window.electronAPI.verifyAccount({
        site,
        username: username.trim(),
        password,
      })
      if (result?.ok) {
        setVerified(true)
        setVerify({ status: 'ok', message: 'Login verified.' })
      } else {
        setVerify({ status: 'error', message: result?.error || 'Verification failed.' })
      }
    } catch (err) {
      setVerify({ status: 'error', message: err.message || 'Verification failed.' })
    }
  }

  const handleBrowserLogin = async () => {
    if (!canBrowser) return
    setVerify({ status: 'verifying', message: 'Complete the login in the browser window…' })
    setVerified(false)
    try {
      const result = await window.electronAPI.verifyAccountBrowser({ site })
      if (result?.ok) {
        if (result.username) setUsername(result.username)
        setVerified(true)
        setVerify({ status: 'ok', message: 'Login verified.' })
      } else {
        setVerify({ status: 'error', message: result?.error || 'Browser login was not completed.' })
      }
    } catch (err) {
      setVerify({ status: 'error', message: err.message || 'Browser login failed.' })
    }
  }

  // Commit the already-verified session — no second login.
  const handleAdd = async () => {
    if (!canAdd) return
    setSaving(true)
    try {
      const result = await window.electronAPI.saveAccount({ site })
      if (result?.ok) {
        await onSaved()
      } else {
        setVerify({ status: 'error', message: result?.error || 'Could not add account.' })
        setVerified(false)
        setSaving(false)
      }
    } catch (err) {
      setVerify({ status: 'error', message: err.message || 'Could not add account.' })
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-secondary shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-lg font-semibold text-text">Add account</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-highlight text-text"
          >
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="px-4 py-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-text">
            Site
            <select
              className="bg-primary border border-border text-text rounded p-2"
              value={site}
              onChange={(e) => {
                setSite(e.target.value)
                invalidate()
              }}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-text">
            Username
            <input
              type="text"
              autoComplete="off"
              className="bg-primary border border-border text-text rounded p-2"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                invalidate()
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-text">
            Password
            <input
              type="password"
              autoComplete="off"
              className="bg-primary border border-border text-text rounded p-2"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                invalidate()
              }}
            />
          </label>

          <p className="text-xs text-text/50 -mt-1">
            If the site asks for a captcha or two-factor code, use “Log in with
            browser” instead — you’ll complete it in a real window and Atlas will
            capture the session.
          </p>

          {verify.status === 'ok' && (
            <div className="text-sm text-green-500 flex items-center gap-2">
              <i className="fas fa-check-circle" /> {verify.message}
            </div>
          )}
          {verify.status === 'error' && (
            <div className="text-sm text-danger flex items-start gap-2">
              <i className="fas fa-exclamation-circle mt-0.5" />
              <span>{verify.message}</span>
            </div>
          )}
          {verify.status === 'verifying' && (
            <div className="text-sm text-text/70 flex items-center gap-2">
              <i className="fas fa-spinner fa-spin" /> {verify.message || 'Checking…'}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={handleBrowserLogin}
            disabled={!canBrowser}
            className="px-4 py-2 text-sm rounded bg-primary border border-border text-text hover:bg-highlight transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <i className="fas fa-globe mr-2" />
            Log in with browser
          </button>
          <button
            onClick={handleVerify}
            disabled={!canVerify}
            className="px-4 py-2 text-sm rounded bg-primary border border-border text-text hover:bg-highlight transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Verify
          </button>
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className="px-4 py-2 text-sm rounded bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            title={verified ? '' : 'Verify a login first'}
          >
            {saving ? 'Adding…' : 'Add account'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default Accounts
