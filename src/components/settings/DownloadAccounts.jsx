import { useCallback, useEffect, useState } from 'react'
import HostIcon from '../downloads/HostIcon.jsx'

// ── Settings: Download Accounts ──────────────────────────────────────────────
//
// Per-host credentials for the download manager.
//
// The form is generated from each plugin's `credentialFields`, so adding a host
// needs no change here — Mega will render its own fields the moment its plugin
// declares them.
//
// Two things this screen is careful about, because it handles real
// cloud-storage credentials:
//
//   * A value is verified against the host BEFORE being stored, so a typo
//     surfaces here rather than as a mysteriously failing download later.
//   * Secrets are write-only. Once saved, the input clears and the field shows
//     "saved" rather than the value — nothing ever reads a secret back out to
//     the renderer, so there is nothing to display even if we wanted to.
//
// When the OS has no secure storage the whole screen says so and saving is
// disabled, rather than silently writing credentials somewhere weaker.

function formatBytes(value) {
  const bytes = Number(value) || 0
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const scaled = bytes / 1024 ** index
  return `${scaled.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

// Seconds are the wrong unit for a four-minute wait and minutes are the wrong
// unit for a six-second one.
function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  if (total < 90) return `${total} second${total === 1 ? '' : 's'}`
  return `${Math.round(total / 60)} minutes`
}

function HostCard({ plugin, account, available, onSaved, onRemoved }) {
  const [values, setValues] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [quota, setQuota] = useState(null)
  // A centred modal rather than a panel expanding inside the card, matching the
  // site accounts above (Accounts.jsx / AddAccountModal). Signing in to a host
  // is the same kind of act as signing in to a site, and MEGA's form is three
  // fields with help text under each -- inline it pushed every card below it
  // down the page and read as part of the list rather than as a task.
  const [modalOpen, setModalOpen] = useState(false)
  // MEGA is the only host that charges CPU to sign in, so the diagnostic is
  // scoped to it rather than added to every card.
  const [selfTest, setSelfTest] = useState(null)
  const [testing, setTesting] = useState(false)
  const supportsSelfTest = plugin.id === 'mega'

  const fields = plugin.credentialFields || []
  const hasAccount = Boolean(account)

  const loadQuota = useCallback(async () => {
    if (!hasAccount) return
    try {
      const result = await window.electronAPI.hostsQuota?.({ hostId: plugin.id })
      if (result?.ok) setQuota(result)
    } catch {
      // A quota readout is informational; failing to get one is not an error
      // worth showing.
    }
  }, [plugin.id, hasAccount])

  useEffect(() => { loadQuota() }, [loadQuota])

  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await window.electronAPI.hostsSaveAccount?.({
        hostId: plugin.id,
        secrets: values,
      })
      if (result?.ok) {
        // Clear the inputs: the value is stored and will never be read back.
        setValues({})
        setModalOpen(false)
        setNotice(
          result.validated?.username
            ? `Signed in as ${result.validated.username}`
            : 'Account saved',
        )
        onSaved?.()
      } else {
        setError(result?.error || 'Could not save that account')
      }
    } catch (err) {
      setError(err.message || 'Could not save that account')
    } finally {
      setBusy(false)
    }
  }

  const runSelfTest = async () => {
    setTesting(true)
    setSelfTest(null)
    try {
      const result = await window.electronAPI.hostsMegaSelfTest?.()
      setSelfTest(result || { ok: false, error: 'No response from the app.' })
    } catch (err) {
      setSelfTest({ ok: false, error: err.message || 'The test could not be started.' })
    } finally {
      setTesting(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await window.electronAPI.hostsRemoveAccount?.({ hostId: plugin.id })
      setQuota(null)
      setNotice('')
      onRemoved?.()
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = fields.some((field) => String(values[field.key] || '').trim())

  return (
    <div className="rounded border border-border bg-primary p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <HostIcon host={plugin.id} className="w-4 h-4 text-text" />
            <span className="text-sm text-text">{plugin.label}</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                hasAccount
                  ? 'border-success/40 text-success'
                  : 'border-border text-muted'
              }`}
            >
              {hasAccount ? 'Account saved' : 'Anonymous'}
            </span>
          </div>
          <p className="text-[11px] text-muted mt-1">
            {hasAccount
              ? [account.username, account.label].filter(Boolean).join(' · ') || 'Signed in'
              : plugin.supportsAnonymous
                ? 'Downloads work without an account, usually with lower limits.'
                : 'This host requires an account.'}
          </p>
          {quota?.ok && (quota.cap != null || quota.used != null) && (
            <p className="text-[11px] text-muted mt-0.5">
              Transfer used {formatBytes(quota.used)}
              {quota.cap != null && ` of ${formatBytes(quota.cap)}`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasAccount && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="h-8 px-3 text-xs rounded-buttonTheme bg-button hover:bg-buttonHover text-text disabled:opacity-40"
            >
              Remove
            </button>
          )}
          {fields.length > 0 && (
            <button
              type="button"
              onClick={() => { setValues({}); setError(''); setModalOpen(true) }}
              disabled={busy || !available}
              className="h-8 px-3 text-xs rounded-buttonTheme bg-accent hover:bg-accentHover text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {hasAccount ? 'Replace' : 'Add account'}
            </button>
          )}
        </div>
      </div>

      {supportsSelfTest && (
        <div className="mt-2 pt-2 border-t border-border">
          {/* Signing in to MEGA is CPU-bound and MEGA does not demand it of every
              client, so a failure here can mean a slow machine, a broken build,
              or nothing at all. This measures which, on the hardware where it
              actually matters. Wraps rather than sitting in one row so it holds
              up on a narrow window. */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runSelfTest}
              disabled={testing}
              className="h-7 px-2.5 text-[11px] rounded-buttonTheme bg-button hover:bg-buttonHover text-text disabled:opacity-40"
            >
              {testing ? 'Testing\u2026' : 'Test proof-of-work'}
            </button>
            <span className="text-[11px] text-muted">
              Checks that this computer can complete a MEGA sign-in.
            </span>
          </div>
          {selfTest && (
            <div className="mt-2 text-[11px] leading-relaxed">
              {selfTest.ok ? (
                <>
                  <p className="text-success">
                    Working \u2014 solved and verified using {selfTest.workers}{' '}
                    {selfTest.workers === 1 ? 'thread' : 'threads'}.
                  </p>
                  <p className="text-muted">
                    About {formatDuration(selfTest.estimateSeconds)} for a real MEGA
                    sign-in on this computer
                    {Number(selfTest.throughputMBps) > 0
                      && ` (${Math.round(selfTest.throughputMBps)} MB/s)`}
                    . This is an average, so individual attempts vary a lot.
                  </p>
                  {selfTest.estimateSeconds > 240 && (
                    <p className="text-warning">
                      That is slow enough that a sign-in may not finish. It is a
                      one-off: once signed in, the session is saved and this is not
                      repeated.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-danger">
                    {selfTest.outcome === 'load-error'
                      ? 'Failed \u2014 the background task could not start. This is a fault in the app, not this computer.'
                      : `Failed \u2014 ${selfTest.error || 'the test did not complete.'}`}
                  </p>
                  {selfTest.logPath && (
                    <p className="text-muted break-all">Details written to {selfTest.logPath}</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* The modal owns the error while it is open, and a failed save keeps it
          open, so the card only reports the outcome that closed it. */}
      {notice && <p className="text-xs text-success mt-2">{notice}</p>}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => { if (!busy) { setModalOpen(false); setValues({}); setError('') } }}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-secondary shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-lg font-semibold text-text">
                {hasAccount ? `Replace ${plugin.label} account` : `Add ${plugin.label} account`}
              </h3>
              <button
                type="button"
                onClick={() => { setModalOpen(false); setValues({}); setError('') }}
                disabled={busy}
                aria-label="Close"
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-highlight text-text disabled:opacity-40"
              >
                <i className="fas fa-times" />
              </button>
            </div>

            <div className="px-4 py-4 flex flex-col gap-3">
              {fields.map((field) => (
                <label
                  key={field.key}
                  htmlFor={`${plugin.id}-${field.key}`}
                  className="flex flex-col gap-1 text-sm text-text"
                >
                  {field.label}
                  <input
                    id={`${plugin.id}-${field.key}`}
                    type={field.type === 'password' ? 'password' : 'text'}
                    value={values[field.key] || ''}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
                    disabled={busy}
                    autoComplete="off"
                    className="bg-primary border border-border text-text rounded p-2 focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  />
                  {field.help && (
                    <span className="text-[11px] text-muted font-normal">{field.help}</span>
                  )}
                </label>
              ))}

              {error && <p className="text-xs text-danger">{error}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={() => { setModalOpen(false); setValues({}); setError('') }}
                disabled={busy}
                className="h-8 px-3 text-xs rounded-buttonTheme bg-button hover:bg-buttonHover text-text disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy || !canSubmit}
                className="h-8 px-4 text-xs rounded-buttonTheme bg-accent hover:bg-accentHover text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? 'Checking\u2026' : 'Verify and save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DownloadAccounts() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await window.electronAPI.hostsList?.()
      if (result?.ok) setData(result)
      else setError(result?.error || 'Could not load download hosts')
    } catch (err) {
      setError(err.message || 'Could not load download hosts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p className="text-sm text-muted">Loading hosts…</p>

  const plugins = data?.plugins || []
  const accountsById = Object.fromEntries(
    (data?.accounts || []).map((account) => [account.hostId, account]),
  )

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h3 className="text-base font-medium text-text">File hosts</h3>
        <p className="text-sm text-text/70 mt-1">
          Where game archives are actually downloaded from — Pixeldrain, Mega and
          the like. These are separate from your game-site logins above and are
          optional: downloads work anonymously, an account usually just raises
          the transfer limit. Details are verified with the host before being
          saved, and stored encrypted by your operating system.
        </p>
      </div>

      {/* Refusing to store is deliberate; say so plainly rather than letting
          saves fail one at a time with no explanation. */}
      {data && !data.available && (
        <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-text">
          <p className="font-medium text-amber-400">Secure storage unavailable</p>
          <p className="mt-1">
            This system has no secure credential store, so Atlas will not save
            accounts here. On Linux this usually means no keyring service is
            running. Downloads still work without an account.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="space-y-2">
        {plugins.map((plugin) => (
          <HostCard
            key={plugin.id}
            plugin={plugin}
            account={accountsById[plugin.id]}
            available={data?.available}
            onSaved={load}
            onRemoved={load}
          />
        ))}
        {plugins.length === 0 && (
          <p className="text-xs text-muted">No download hosts are available yet.</p>
        )}
      </div>
    </div>
  )
}
