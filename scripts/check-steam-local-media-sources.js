const assert = require('assert')

const { applyMediaSources } = require('../electron/db/mediaSources')
const { buildBannerSelectFields } = require('../electron/db/helpers')

const localHeader = 'C:/Atlas/src/data/images/42/steam_header.webp'
const localHero = 'C:/Atlas/src/data/images/42/steam_hero.webp'
const localCover = 'C:/Atlas/src/data/images/42/steam_cover.webp'

const game = applyMediaSources({
  record_id: 42,
  steam_id: '12345',
  banner_source: 'stream',
  banner_url: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/12345/header.jpg',
  steam_header: localHeader,
  steam_library_hero: localHero,
  steam_library_capsule: localCover,
}, { sourceOrder: ['steam', 'f95'] })

assert.strictEqual(game.banner_url, localHeader)
assert.strictEqual(game.banner_candidates[0], localHeader)
assert.strictEqual(game.hero_url, localHero)
assert.strictEqual(game.hero_candidates[0], localHero)
assert.strictEqual(game.steam_library_capsule, localCover)

const legacyTemplateGame = applyMediaSources({
  record_id: 43,
  steam_id: '4688100',
  banner_source: 'stream',
  steam_header: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/4688100/${FILENAME}?t=1778573150',
  steam_library_hero: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/4688100/${FILENAME}?t=1778573150',
  steam_logo: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/4688100/${FILENAME}?t=1778573150',
}, { sourceOrder: ['steam'] })

assert.ok(!legacyTemplateGame.banner_candidates.some((url) => String(url).includes('${FILENAME}')))
assert.ok(!legacyTemplateGame.hero_candidates.some((url) => String(url).includes('${FILENAME}')))
assert.ok(!legacyTemplateGame.logo_candidates.some((url) => String(url).includes('${FILENAME}')))

const downloadedF95Game = applyMediaSources({
  record_id: 44,
  steam_id: '12345',
  banner_source: 'download',
  banner_url: 'C:/Atlas/src/data/images/44/banner_f95_mc.webp',
  f95_banner: 'https://f95.example/banner.jpg',
  steam_header: localHeader,
}, { sourceOrder: ['steam', 'f95'] })

assert.strictEqual(downloadedF95Game.banner_url, localHeader)
assert.strictEqual(downloadedF95Game.banner_candidates[0], localHeader)
assert.ok(downloadedF95Game.banner_candidates.includes('C:/Atlas/src/data/images/44/banner_f95_mc.webp'))

const customBannerGame = applyMediaSources({
  record_id: 45,
  steam_id: '12345',
  banner_source: 'download',
  banner_url: 'C:/Atlas/src/data/images/45/banner_custom_mc.webp',
  steam_header: localHeader,
}, { sourceOrder: ['steam', 'f95'] })

assert.strictEqual(customBannerGame.banner_url, 'C:/Atlas/src/data/images/45/banner_custom_mc.webp')
assert.deepStrictEqual(customBannerGame.banner_candidates, ['C:/Atlas/src/data/images/45/banner_custom_mc.webp'])

const bannerSelectFields = buildBannerSelectFields('C:/Atlas/src', 'download')
assert.ok(
  bannerSelectFields.includes("media_assets.asset_type = 'steam_header'"),
  'banner selector should read local steam_header media assets',
)
assert.ok(
  bannerSelectFields.includes('AS has_downloaded_banner'),
  'banner selector should expose downloaded banner state',
)

console.log('Steam local media source checks passed')
