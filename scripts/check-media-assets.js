'use strict'

const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const sharp = require('sharp')

const { downloadImages } = require('../electron/imageUtils')

sharp.cache(false)

async function main() {
  const imageBytes = await sharp({
    create: {
      width: 16,
      height: 12,
      channels: 4,
      background: { r: 40, g: 90, b: 170, alpha: 1 },
    },
  }).png().toBuffer()

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(imageBytes)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const url = (name) => `http://127.0.0.1:${port}/${name}.png`
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-media-assets-'))
  const bannerRows = []
  const previewRows = []
  const assetRows = []
  const recordId = 98765

  const updateBanners = async (id, rowPath, type) => bannerRows.push({ id, rowPath, type })
  const updatePreviews = async (id, rowPath) => previewRows.push({ id, rowPath })
  const upsertMediaAsset = async (row) => assetRows.push(row)

  try {
    const assets = [
      { source: 'steam', assetType: 'steam_header', url: url('steam-header'), preferredFilename: 'steam_header', targetKind: 'banner' },
      { source: 'steam', assetType: 'steam_hero', url: url('steam-hero'), preferredFilename: 'steam_hero', targetKind: 'asset' },
      { source: 'steam', assetType: 'steam_cover', url: url('steam-cover'), preferredFilename: 'steam_cover', targetKind: 'asset' },
      { source: 'steam', assetType: 'steam_logo', url: url('steam-logo'), preferredFilename: 'steam_logo', targetKind: 'asset' },
    ]

    const first = await downloadImages(
      recordId,
      'atlas-1',
      () => {},
      true,
      true,
      'Unlimited',
      false,
      dataDir,
      async () => url('f95-banner'),
      async () => [{ url: url('steam-screenshot'), source: 'steam' }],
      updateBanners,
      updatePreviews,
      {
        source: 'f95',
        additionalAssets: assets,
        upsertMediaAsset,
      },
    )

    assert.strictEqual(first.success, true)
    assert.strictEqual(first.bannerRowsWritten, 2)
    assert.strictEqual(first.previewRowsWritten, 1)
    assert.strictEqual(first.mediaAssetRowsWritten, 4)
    assert.strictEqual(first.mediaAssetUrlCount, 4)
    assert.strictEqual(bannerRows.length, 2)
    assert.strictEqual(previewRows.length, 1)
    assert.strictEqual(assetRows.length, 4)
    for (const expected of [
      'banner_f95_mc.webp',
      'banner_f95_sc.webp',
      'preview_steam_001_pr.webp',
      'steam_header.webp',
      'steam_hero.webp',
      'steam_cover.webp',
      'steam_logo.webp',
    ]) {
      assert.ok(fs.existsSync(path.join(dataDir, 'images', String(recordId), expected)), `${expected} should exist`)
    }
    for (const row of assetRows) {
      assert.ok(row.path.startsWith(`data${path.sep}images${path.sep}${recordId}${path.sep}`))
      assert.ok(fs.existsSync(path.join(dataDir, 'images', String(recordId), path.basename(row.path))))
      assert.ok(Number.isInteger(row.width))
      assert.ok(Number.isInteger(row.height))
    }

    const second = await downloadImages(
      recordId,
      'atlas-1',
      () => {},
      true,
      true,
      'Unlimited',
      false,
      dataDir,
      async () => url('f95-banner'),
      async () => [{ url: url('steam-screenshot'), source: 'steam' }],
      updateBanners,
      updatePreviews,
      {
        source: 'f95',
        additionalAssets: assets,
        upsertMediaAsset,
      },
    )

    assert.strictEqual(second.success, true)
    assert.ok(second.filesExisting >= 7, 'second pass should use existing files')
    assert.strictEqual(second.mediaAssetRowsWritten, 4)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
