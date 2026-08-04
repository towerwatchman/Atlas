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
  const [buildMsg, setBuildMsg] = useState('')

  useEffect(() => {
    if (window.electronAPI?.getExtensionStatus) {
      window.electronAPI.getExtensionStatus().then((status) => {
        if (status) setExtStatus((prev) => ({ ...prev, ...status }))
      })
    }
  }, [])

  const updateSetting = async (key, value) => {
    const newStatus = { ...extStatus, [key]: value }
    setExtStatus(newStatus)
    setSaving(true)

    try {
      if (window.electronAPI?.saveExtensionSettings) {
        const result = await window.electronAPI.saveExtensionSettings({
          rpcEnabled: newStatus.rpcEnabled,
          rpcPort: Number.parseInt(newStatus.port, 10) || 57096,
          backgroundAdd: newStatus.backgroundAdd,
          iconGlow: newStatus.iconGlow,
          highlightTags: newStatus.highlightTags,
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

  return (
    <div className="p-6 space-y-6 text-primary">
      <div className="border-b border-tertiary pb-4">
        <h2 className="text-xl font-bold tracking-tight">Browser Extension</h2>
        <p className="text-sm text-secondary mt-1">
          Connect Atlas to Chromium browsers (Chrome, Edge, Brave, Opera) to monitor F95Zone and LewdCorner threads, view game status badges, and add titles directly to Atlas.
        </p>
      </div>

      {/* Server Status & RPC Toggle */}
      <div className="bg-secondary p-4 rounded-lg border border-tertiary space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-base">Atlas RPC Local Server</h3>
            <p className="text-xs text-secondary mt-0.5">
              Allows the browser extension to communicate with Atlas on localhost.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                extStatus.running
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'bg-red-500/10 text-red-400 border border-red-500/20'
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

        {/* Port Input */}
        <div className="pt-2 border-t border-tertiary/50 flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">RPC Port</label>
            <p className="text-xs text-secondary">Port used for extension communication (default: 57096)</p>
          </div>
          <input
            type="number"
            value={extStatus.port}
            onChange={(e) => updateSetting('port', Number.parseInt(e.target.value, 10) || 57096)}
            className="w-28 px-3 py-1.5 bg-primary border border-tertiary rounded-md text-sm text-primary focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Extension Display Preferences */}
      <div className="bg-secondary p-4 rounded-lg border border-tertiary space-y-4">
        <h3 className="font-semibold text-base">Forum Display Options</h3>

        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">Background Add</label>
            <p className="text-xs text-secondary">Add games from browser without stealing desktop focus</p>
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

        <div className="flex items-center justify-between pt-2 border-t border-tertiary/50">
          <div>
            <label className="text-sm font-medium">Atlas Icon Glow Effect</label>
            <p className="text-xs text-secondary">Display a subtle glow around status badges on forum pages</p>
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

        <div className="flex items-center justify-between pt-2 border-t border-tertiary/50">
          <div>
            <label className="text-sm font-medium">Highlight Forum Tags</label>
            <p className="text-xs text-secondary">Custom color highlights for tags on thread pages</p>
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
      <div className="bg-secondary p-4 rounded-lg border border-tertiary space-y-3">
        <h3 className="font-semibold text-base">How to Install in Browser</h3>
        <ol className="list-decimal list-inside text-sm text-secondary space-y-1.5">
          <li>Open your browser&apos;s extensions page (e.g. <code className="bg-tertiary px-1.5 py-0.5 rounded text-primary">chrome://extensions</code> or <code className="bg-tertiary px-1.5 py-0.5 rounded text-primary">edge://extensions</code>).</li>
          <li>Enable <strong>Developer mode</strong> in the top-right corner.</li>
          <li>Click <strong>Load unpacked</strong> and select the <code className="bg-tertiary px-1.5 py-0.5 rounded text-primary">extension</code> directory inside your Atlas installation.</li>
        </ol>
      </div>
    </div>
  )
}

export default ExtensionSettings
