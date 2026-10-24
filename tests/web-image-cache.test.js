const fsp = require('fs/promises')
const os = require('os')
const path = require('path')

const { resolveWebImageCacheDir, webImageCacheInfo } = require('../electron/webImageCache.js')

describe('resolveWebImageCacheDir', () => {
  it('finds the default-session cache at <userData>/Cache/Cache_Data', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'atlas-cache-info-'))
    const dir = path.join(root, 'Cache', 'Cache_Data')
    await fsp.mkdir(dir, { recursive: true })
    expect(await resolveWebImageCacheDir(root)).toBe(dir)
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('returns null when no cache exists yet', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'atlas-cache-info-'))
    expect(await resolveWebImageCacheDir(root)).toBeNull()
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('accepts explicit candidate shapes (ported setups)', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'atlas-cache-info-'))
    const dir = path.join(root, 'chrome', 'Cache', 'Cache_Data')
    await fsp.mkdir(dir, { recursive: true })
    expect(await resolveWebImageCacheDir(root, ['Cache/Cache_Data', path.join('chrome', 'Cache', 'Cache_Data')])).toBe(dir)
    await fsp.rm(root, { recursive: true, force: true })
  })
})

describe('webImageCacheInfo', () => {
  it('sums files under the cache dir and reports exists', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'atlas-cache-info-'))
    const dir = path.join(root, 'Cache', 'Cache_Data')
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(dir, 'a'), Buffer.alloc(1024, 1))
    await fsp.writeFile(path.join(dir, 'b'), Buffer.alloc(512, 1))

    const info = await webImageCacheInfo(root)
    expect(info.exists).toBe(true)
    expect(info.sizeBytes).toBe(1536)
    expect(info.dir).toBe(dir)
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('reports a zero size when nothing is cached yet', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'atlas-cache-info-'))
    const info = await webImageCacheInfo(root)
    expect(info.exists).toBe(false)
    expect(info.sizeBytes).toBe(0)
    await fsp.rm(root, { recursive: true, force: true })
  })
})
