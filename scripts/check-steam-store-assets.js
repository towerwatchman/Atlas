const assert = require('assert')

global.fetch = async () => ({
  json: async () => ({
    response: {
      store_items: [{
        assets: {
          asset_url_format: 'steam/apps/4688100/${FILENAME}?t=1778573150',
          header: 'hash/header.jpg',
          library_hero_2x: 'hash/library_hero_2x.jpg',
          library_capsule_2x: 'hash/library_capsule_2x.jpg',
          logo: 'hash/logo.png',
        },
      }],
    },
  }),
})

const { fetchStoreItemAssets } = require('../electron/scanners/steamscanner')

async function main() {
  const assets = await fetchStoreItemAssets(4688100)

  assert.strictEqual(
    assets.header,
    'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/4688100/hash/header.jpg?t=1778573150',
  )
  assert.strictEqual(
    assets.hero,
    'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/4688100/hash/library_hero_2x.jpg?t=1778573150',
  )
  assert.strictEqual(
    assets.capsule,
    'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/4688100/hash/library_capsule_2x.jpg?t=1778573150',
  )
  assert.ok(!assets.header.includes('${FILENAME}'))
  assert.ok(!assets.hero.includes('${FILENAME}'))
  assert.ok(!assets.capsule.includes('${FILENAME}'))

  console.log('Steam store asset URL checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
