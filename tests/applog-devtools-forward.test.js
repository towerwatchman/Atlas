import { describe, it, expect, vi, afterEach } from 'vitest'
import Module from 'module'

// appLog mirrors every structured line into the console of windows whose
// DevTools are open — the "enable console" setting — because main-process
// output otherwise never reaches the app's own console panel, which is the
// renderer's DevTools only. Windows without DevTools are skipped so ordinary
// use pays nothing.

let restoreLoad = null

const installStubs = (windows) => {
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') {
      return { BrowserWindow: { getAllWindows: () => windows } }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => {
    Module._load = originalLoad
  }
  const { write } = require('../electron/appLog.js')
  return { write }
}

const fakeWindow = ({ devToolsOpen }) => ({
  isDestroyed: () => false,
  webContents: {
    isDevToolsOpened: () => devToolsOpen,
    executeJavaScript: vi.fn(async () => {}),
  },
})

afterEach(() => {
  if (restoreLoad) {
    restoreLoad()
    restoreLoad = null
  }
  vi.resetModules()
})

describe('appLog devtools forwarding', () => {
  it('forwards the line into windows with DevTools open and skips the others', async () => {
    const open = fakeWindow({ devToolsOpen: true })
    const closed = fakeWindow({ devToolsOpen: false })
    const { write } = installStubs([open, closed, { isDestroyed: () => true, webContents: null }])
    write('cf-jar', { host: 'f95zone.to' }, { devtools: true })
    await new Promise((r) => setImmediate(r))
    expect(open.webContents.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(open.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('[cf-jar]'),
    )
    expect(open.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('f95zone.to'),
    )
    expect(closed.webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  it('forwards only when the callsite opts in with { devtools: true }', async () => {
    const open = fakeWindow({ devToolsOpen: true })
    const { write } = installStubs([open])
    write('f95-links', { threadId: '1', totalMs: 2 })
    write('masked-resolve', { event: 'reveal', reason: 'timeout' }, { devtools: true })
    await new Promise((r) => setImmediate(r))
    expect(open.webContents.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(open.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('[masked-resolve]'),
    )
  })

  it('survives a window that throws mid-logging', async () => {
    const broken = fakeWindow({ devToolsOpen: true })
    broken.webContents.executeJavaScript = vi.fn(async () => {
      throw new Error('gone')
    })
    const open = fakeWindow({ devToolsOpen: true })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { write } = installStubs([broken, open])
    write('cf-jar', 'ok', { devtools: true })
    await new Promise((r) => setImmediate(r))
    expect(open.webContents.executeJavaScript).toHaveBeenCalledTimes(1)
  })
})
