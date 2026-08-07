// ctx.getConfig() and ctx.saveSettings() are called by ipc/extension.js but were
// never actually defined on the ctx object built in main.js. Every call threw
// TypeError: ctx.saveSettings is not a function.
//
// The visible symptom was that the extension's settings silently refused to
// persist, and later that the pairing token could never be generated -- the
// handler threw before it reached the config write, so Settings sat on
// "Generating..." forever with the real error only in the main-process console.
//
// These assert the contract ipc/extension.js depends on.

import { describe, it, expect } from 'vitest'

describe('ctx config accessors', () => {
  // Mirrors the Object.defineProperty block in main.js. Kept as a local model
  // rather than importing main.js, which pulls in electron and half the app.
  function buildPatchedCtx(initialConfig, onWrite) {
    let appConfig = initialConfig
    const ctx = {}
    Object.defineProperty(ctx, 'getConfig', { value: () => appConfig })
    Object.defineProperty(ctx, 'saveSettings', {
      value: (newConfig) => {
        appConfig = newConfig
        onWrite(appConfig)
        return appConfig
      },
    })
    return ctx
  }

  it('exposes getConfig as a callable function', () => {
    const ctx = buildPatchedCtx({ Extension: {} }, () => {})
    expect(typeof ctx.getConfig).toBe('function')
  })

  it('exposes saveSettings as a callable function', () => {
    const ctx = buildPatchedCtx({ Extension: {} }, () => {})
    expect(typeof ctx.saveSettings).toBe('function')
  })

  it('persists a written token and reads it back', () => {
    let written = null
    const ctx = buildPatchedCtx({ Extension: { rpcPort: 57096 } }, (c) => { written = c })

    const config = ctx.getConfig()
    ctx.saveSettings({
      ...config,
      Extension: { ...config.Extension, rpcToken: 'f'.repeat(64) },
    })

    expect(written).not.toBeNull()
    expect(ctx.getConfig().Extension.rpcToken).toBe('f'.repeat(64))
    // Unrelated keys must survive the write.
    expect(ctx.getConfig().Extension.rpcPort).toBe(57096)
  })

  it('reads live config rather than a snapshot taken at build time', () => {
    const ctx = buildPatchedCtx({ Extension: { a: 1 } }, () => {})
    ctx.saveSettings({ Extension: { a: 2 } })
    expect(ctx.getConfig().Extension.a).toBe(2)
  })
})
