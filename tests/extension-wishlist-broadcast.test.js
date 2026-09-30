// The extension add-wishlist path broadcasts wishlist-updated with a source
// tag so the renderer can decide whether to refetch the catalog. The extension
// has no optimistic UI, so it keeps the full Browse refresh.
//
// This drives the real HTTP route rather than grepping the source: the module
// is loaded with 'electron' and '../db/wishlist' replaced, the extension POSTs
// a thread url the way it does in the browser, and the broadcast that reaches
// the fake window is what gets asserted. A string match would pass on a
// broadcast that never fires.

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import Module from 'module'
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const require_ = createRequire(import.meta.url)
const __dirname_ = path.dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = path.join(__dirname_, '..', 'electron', 'rpc', 'extensionServer.js')

const TEST_PORT = 57097
const TEST_TOKEN = 'd'.repeat(64)
const AUTH = { 'X-Atlas-Token': TEST_TOKEN, 'Content-Type': 'application/json' }

let broadcasts = []
let addWishlistCalls = []
let restoreLoad
let server

beforeAll(() => {
  broadcasts = []
  addWishlistCalls = []

  const fakeWindow = {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: () => {},
    show: () => {},
    focus: () => {},
    webContents: {
      send: (channel, payload) => {
        if (channel === 'wishlist-updated') broadcasts.push(payload)
      },
    },
  }
  const electronStub = {
    BrowserWindow: { getAllWindows: () => [fakeWindow] },
    app: { getVersion: () => '0.0.0' },
  }
  const wishlistStub = {
    addWishlistEntry: async (entry) => {
      addWishlistCalls.push(entry)
      return { success: true, identityKey: `f95:${entry.f95_id}` }
    },
  }

  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return electronStub
    if (request === '../db/wishlist') return wishlistStub
    if (request === '../db/index') {
      // addGameUrl bails out early on a null db, and before reaching the
      // wishlist write it looks for an existing mapping and a title match.
      // Returning no rows is the "brand new thread" case this test wants.
      return {
        db: {
          get: (sql, params, cb) => cb(null, undefined),
          run: function (sql, params, cb) { cb.call({ lastID: 0, changes: 0 }, null) },
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => { Module._load = originalLoad }

  // Fresh load so the stubs above are the ones captured at module scope.
  delete require_.cache[require_.resolve(SERVER_PATH)]
  server = require_(SERVER_PATH)
  server.startExtensionServer({
    port: TEST_PORT,
    getConfig: () => ({
      Extension: { rpcEnabled: true, rpcPort: TEST_PORT, rpcToken: TEST_TOKEN },
    }),
  })
})

afterAll(() => {
  server?.stopExtensionServer()
  delete require_.cache[require_.resolve(SERVER_PATH)]
  restoreLoad?.()
})

describe('extension wishlist broadcast', () => {
  test('adding a thread url broadcasts wishlist-updated tagged as extension', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/games/add`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify(['https://f95zone.to/threads/some-game.44821/']),
    })
    expect(res.status).toBe(200)

    // The write reached the wishlist layer with the parsed thread identity.
    expect(addWishlistCalls).toHaveLength(1)
    expect(addWishlistCalls[0].f95_id).toBe(44821)

    // ...and the renderer was told, with the tag that keeps its Browse refetch.
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0]).toEqual({ source: 'extension' })
  })
})
