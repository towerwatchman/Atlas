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
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const loadStatus = async () => {
    if (window.electronAPI?.getExtensionStatus) {
      try {
        const status = await window.electronAPI.getExtensionStatus()
        if (status) setExtStatus((prev) => ({ ...prev, ...status }))
      } catch (err) {
        console.error('Failed to get extension status:', err)
      }
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

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
          <li>Click <strong>Load unpacked</strong> and select the <code className="bg-tertiary px-1.5 py-0.5 rounded text-text font-mono">extension</code> directory inside your Atlas folder.</li>
        </ol>
      </div>
    </div>
  )
}

export default ExtensionSettings
