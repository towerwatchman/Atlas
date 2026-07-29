import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
)

// electron-builder's own default pacman depends list (app-builder-lib
// FpmTarget.js, getDefaultDepends -> case "pacman") includes several packages
// that are not installable on a current Arch system: they are Chromium-internal
// libraries (http-parser, c-ares, re2, snappy, minizip, libevent) that Electron
// bundles statically and have not been standalone distro packages for years.
// Without an explicit override, `pacman -U` fails with
// "cannot resolve <name> as a dependency".
const KNOWN_STALE_DEFAULTS = [
  'http-parser', 'c-ares', 're2', 'snappy', 'minizip', 'libevent', 'libvpx', 'libxslt',
]

test('package.json overrides the pacman depends list', () => {
  const depends = pkg.build?.linux?.pacman?.depends
  expect(Array.isArray(depends)).toBe(true)
  expect(depends.length).toBeGreaterThan(0)
})

test('none of the stale defaults are present in the override', () => {
  const depends = pkg.build.linux.pacman.depends
  for (const stale of KNOWN_STALE_DEFAULTS) {
    expect(depends).not.toContain(stale)
  }
})

// This does not (and cannot, without a live Arch box) verify the packages
// actually exist in a current repo — see the comment in package.json. It only
// guards against the override being deleted and electron-builder's stale
// default silently taking over again.
test('linux.target still includes pacman', () => {
  expect(pkg.build?.linux?.target).toContain('pacman')
})
