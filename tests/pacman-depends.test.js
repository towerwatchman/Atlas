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

// pacman is a TOP-LEVEL target config, a sibling of `linux`. Nesting it under
// `linux` broke the build outright: LinuxConfiguration has
// additionalProperties:false, so electron-builder rejected the whole config with
// "configuration.linux should be one of these: null".
test('the pacman config sits at the top level, not under linux', () => {
  expect(pkg.build?.pacman).toBeDefined()
  expect(pkg.build?.linux?.pacman).toBeUndefined()
})

test('package.json overrides the pacman depends list', () => {
  const depends = pkg.build?.pacman?.depends
  expect(Array.isArray(depends)).toBe(true)
  expect(depends.length).toBeGreaterThan(0)
})

test('none of the stale defaults are present in the override', () => {
  const depends = pkg.build.pacman.depends
  for (const stale of KNOWN_STALE_DEFAULTS) {
    expect(depends).not.toContain(stale)
  }
})

// This does not (and cannot, without a live Arch box) verify the packages
// actually exist in a current repo — see build/LINUX_PACKAGING_NOTES.md. It only
// guards against the override being deleted and electron-builder's stale
// default silently taking over again.
test('linux.target still includes pacman', () => {
  expect(pkg.build?.linux?.target).toContain('pacman')
})

// The build itself validates package.json against this schema before doing any
// work, so validating it here turns a CI failure into a local test failure.
// Reasoning about where a key belongs is exactly what went wrong.
test('the build config validates against electron-builder\'s own schema', async () => {
  const { default: Ajv } = await import('ajv')
  const schemaPath = path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'scheme.json')
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
  const ajv = new Ajv({ allErrors: true, strict: false })
  const validate = ajv.compile(schema)
  const valid = validate(pkg.build)
  expect(validate.errors ?? [], JSON.stringify(validate.errors, null, 1)).toEqual([])
  expect(valid).toBe(true)
})
