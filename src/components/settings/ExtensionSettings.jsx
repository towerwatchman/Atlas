import { useState, useEffect } from 'react'

const ExtensionSettings = () => {
  const [extStatus, setExtStatus] = useState({
    running: false,
    port: 57096,
    rpcEnabled: true,
    backgroundAdd: true,
    iconGlow: true,
    highlightTags: false,
    tagHighlights: {},
  })
  const [extensionPath, setExtensionPath] = useState('')
  const [copied, setCopied] = useState(false)
  const [showSteps, setShowSteps] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const loadStatus = async () => {
    if (window.electronAPI?.getExtensionStatus) {
      try {
        const status = await window.electronAPI.getExtensionStatus()
        if (status) {
          setExtStatus((prev) => ({ ...prev, ...status }))
          if (status.extensionPath) {
            setExtensionPath(status.extensionPath)
          }
        }
      } catch (err) {
        console.error('Failed to get extension status:', err)
      }
    }

    if (window.electronAPI?.getExtensionPath) {
      try {
        const res = await window.electronAPI.getExtensionPath()
        if (res?.extensionPath) {
          setExtensionPath(res.extensionPath)
        }
      } catch (err) {
        console.error('Failed to get extension path:', err)
      }
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const handleCopyPath = async () => {
    if (!extensionPath) return
    try {
      await navigator.clipboard.writeText(extensionPath)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy extension path to clipboard:', err)
    }
  }

  const handleOpenFolder = async () => {
    if (window.electronAPI?.openExtensionFolder) {
      try {
        await window.electronAPI.openExtensionFolder()
      } catch (err) {
        console.error('Failed to open extension folder:', err)
      }
    }
  }

  const updateSetting = async (key, value) => {
    const newStatus = { ...extStatus, [key]: value }
    setExtStatus(newStatus)
    setSaving(true)

    try {
      if (window.electronAPI?.saveExtensionSettings) {
        const result = await window.electronAPI.saveExtensionSettings({
          rpcEnabled: key === 'rpcEnabled' ? value : newStatus.rpcEnabled,
          rpcPort: key === 'port' ? Number.parseInt(value, 10) || 57096 : Number.parseInt(newStatus.port, 10) || 57096,
          backgroundAdd: key === 'backgroundAdd' ? value : newStatus.backgroundAdd,
          iconGlow: key === 'iconGlow' ? value : newStatus.iconGlow,
          highlightTags: key === 'highlightTags' ? value : newStatus.highlightTags,
          tagHighlights: newStatus.tagHighlights,
        })
        if (result) {
          setExtStatus((prev) => ({
            ...prev,
            running: result.running,
            port: result.port,
          }))
        }
      }
    } catch (err) {
      console.error('Failed to save extension settings:', err)
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    setTestResult('testing')
    try {
      const res = await fetch(`http://127.0.0.1:${extStatus.port}/api/status`)
      if (res.ok) {
        const data = await res.json()
        setTestResult(`Success! Server connected (${data.app} ${data.version || ''})`)
      } else {
        setTestResult(`Server returned HTTP ${res.status}`)
      }
    } catch {
      setTestResult(`Failed to connect on 127.0.0.1:${extStatus.port}`)
    }
  }

  return (
    <div className="text-text max-w-2xl">
      <h3 className="text-base font-medium text-text">Browser Extension</h3>
      <p className="text-sm text-text/70 mt-1 mb-4">
        Connect Atlas to Chromium browsers (Chrome, Edge, Brave, Opera GX) to monitor F95Zone and LewdCorner threads, view game status badges, and add titles directly to Atlas.
      </p>

      <div className="border-t border-text opacity-25 my-4" />

      {/* Extension Folder Location & Actions */}
      <div className="bg-secondary border border-border p-4 rounded mb-4 space-y-3">
        <div>
          <h4 className="text-sm font-medium text-text">Extension Location</h4>
          <p className="text-xs text-text/70 mt-0.5">
            Path to the unpacked browser extension files. This persistent location automatically stays up to date across Atlas updates.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
          <input
            type="text"
            readOnly
            value={extensionPath || 'Resolving path...'}
            className="flex-1 bg-tertiary border border-border text-text rounded px-3 py-1.5 text-xs font-mono select-all focus:outline-none"
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleCopyPath}
              disabled={!extensionPath}
              className="flex-1 sm:flex-none px-3 py-1.5 bg-tertiary hover:bg-tertiary/80 text-text rounded text-xs transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-green-400 font-medium">Copied!</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5 text-text/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span>Copy Path</span>
                </>
              )}
            </button>
            <button
              onClick={handleOpenFolder}
              disabled={!extensionPath}
              className="flex-1 sm:flex-none px-3 py-1.5 bg-accent hover:bg-accent/80 text-white rounded text-xs transition cursor-pointer flex items-center justify-center gap-1.5 font-medium disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
              <span>Open Folder</span>
            </button>
          </div>
        </div>
      </div>

      {/* Install steps. Chrome refuses to let any application -- including this
          one -- navigate to a chrome:// URL, so there is no button that can open
          the extensions page for the user. Spelling the steps out is the most
          help we are actually allowed to give. */}
      <div className="bg-secondary border border-border p-4 rounded mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-medium text-text">How to Install</h4>
            <p className="text-xs text-text/70 mt-0.5">
              Browsers only allow extensions from their own store to install automatically,
              so Atlas&apos;s extension is added manually. You only do this once.
            </p>
          </div>
          <button
            onClick={() => setShowSteps((v) => !v)}
            className="shrink-0 px-3 py-1.5 bg-tertiary hover:bg-tertiary/80 text-text rounded text-xs transition cursor-pointer"
          >
            {showSteps ? 'Hide steps' : 'Show steps'}
          </button>
        </div>

        {showSteps && (
          <ol className="mt-3 space-y-2.5 text-xs text-text/85 list-decimal list-inside marker:text-text/50">
            <li>
              Click <span className="font-medium text-text">Open Folder</span> above, or copy
              the path. Leave the window open — you&apos;ll need it in step 4.
            </li>
            <li>
              In Chrome, open a new tab and go to{' '}
              <code className="bg-tertiary px-1.5 py-0.5 rounded font-mono select-all">chrome://extensions</code>.
              <span className="block text-text/60 mt-0.5">
                Edge uses <code className="font-mono">edge://extensions</code>, Brave uses{' '}
                <code className="font-mono">brave://extensions</code>. This address has to be
                typed or pasted — browsers block links to it, including from Atlas.
              </span>
            </li>
            <li>
              Turn on <span className="font-medium text-text">Developer mode</span> using the
              toggle in the top-right corner of that page.
            </li>
            <li>
              Click <span className="font-medium text-text">Load unpacked</span> (top-left),
              then select the extension folder from step 1.
            </li>
            <li>
              Atlas should appear in your extension list. Make sure Atlas is running, then
              use <span className="font-medium text-text">Test Connection</span> below to
              confirm the browser and Atlas can talk to each other.
            </li>
          </ol>
        )}

        {showSteps && (
          <div className="mt-3 pt-3 border-t border-border/50 space-y-1.5">
            <p className="text-xs text-text/60">
              <span className="font-medium text-text/80">If Chrome warns about developer mode</span>{' '}
              on startup, that notice is expected for any manually added extension and is safe
              to dismiss. Don&apos;t click &quot;Disable&quot; — that will turn Atlas&apos;s
              extension off.
            </p>
            <p className="text-xs text-text/60">
              <span className="font-medium text-text/80">Keep the folder where it is.</span>{' '}
              Chrome loads these files from disk every time it starts, so moving or deleting
              the folder disables the extension. Atlas keeps it updated automatically.
            </p>
          </div>
        )}
      </div>

      {/* Server Status & RPC Toggle */}
      <div className="bg-secondary border border-border p-4 rounded mb-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-text">Atlas RPC Local Server</h4>
            <p className="text-xs text-text/70 mt-0.5">
              Allows the browser extension to communicate with Atlas on localhost.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                extStatus.running
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                  extStatus.running ? 'bg-green-400 animate-pulse' : 'bg-red-400'
                }`}
              />
              {extStatus.running ? `Active (Port ${extStatus.port})` : 'Stopped'}
            </span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={extStatus.rpcEnabled}
                onChange={(e) => updateSetting('rpcEnabled', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-tertiary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent" />
            </label>
          </div>
        </div>

        {/* Port Input & Test Connection */}
        <div className="pt-3 border-t border-border/50 flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-text">RPC Port</label>
            <p className="text-xs text-text/70">Port used for extension communication (default: 57096)</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={extStatus.port}
              onChange={(e) => updateSetting('port', Number.parseInt(e.target.value, 10) || 57096)}
              className="w-24 bg-secondary border border-border text-text rounded px-3 py-1 text-sm focus:outline-none focus:border-accent"
            />
            <button
              onClick={testConnection}
              className="px-3 py-1 bg-tertiary hover:bg-tertiary/80 text-text rounded text-xs transition cursor-pointer"
            >
              Test Connection
            </button>
          </div>
        </div>

        {testResult && (
          <div className="text-xs text-text/80 pt-1">
            {testResult === 'testing' ? 'Testing connection...' : testResult}
          </div>
        )}
      </div>

      {/* Forum Display Options */}
      <div className="bg-secondary border border-border p-4 rounded mb-4 space-y-4">
        <h4 className="text-sm font-medium text-text">Forum Display Options</h4>

        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-text">Background Add</label>
            <p className="text-xs text-text/70">Add games from browser without stealing desktop window focus</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={extStatus.backgroundAdd}
              onChange={(e) => updateSetting('backgroundAdd', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-tertiary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent" />
          </label>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border/50">
          <div>
            <label className="text-sm font-medium text-text">Atlas Icon Glow Effect</label>
            <p className="text-xs text-text/70">Display a subtle glow around status badges on forum pages</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={extStatus.iconGlow}
              onChange={(e) => updateSetting('iconGlow', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-tertiary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent" />
          </label>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border/50">
          <div>
            <label className="text-sm font-medium text-text">Highlight Forum Tags</label>
            <p className="text-xs text-text/70">Custom color highlights for tags on thread pages</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={extStatus.highlightTags}
              onChange={(e) => updateSetting('highlightTags', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-tertiary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent" />
          </label>
        </div>
      </div>

      {/* Extension Installation Guide */}
      <div className="bg-secondary border border-border p-4 rounded space-y-2">
        <h4 className="text-sm font-medium text-text">How to Install in Opera GX / Chrome / Edge</h4>
        <ol className="list-decimal list-inside text-xs text-text/80 space-y-1.5">
          <li>Open your browser extensions page (e.g. <code className="bg-tertiary px-1.5 py-0.5 rounded text-text font-mono">opera://extensions</code> or <code className="bg-tertiary px-1.5 py-0.5 rounded text-text font-mono">chrome://extensions</code>).</li>
          <li>Enable <strong>Developer mode</strong> in the top-right corner.</li>
          <li>Click <strong>Load unpacked</strong> and select the <code className="bg-tertiary px-1.5 py-0.5 rounded text-text font-mono">extension</code> folder (click <strong>Copy Path</strong> or <strong>Open Folder</strong> above to locate it).</li>
        </ol>
      </div>
    </div>
  )
}

export default ExtensionSettings
