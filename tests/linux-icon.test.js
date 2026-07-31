import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const root = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

// Without linux.icon, electron-builder ships its own default Electron logo. A
// .ico cannot be used here — Linux targets need PNGs — which is why pointing at
// the existing win.icon would not have worked either.
test('the linux build declares an icon directory', () => {
  expect(pkg.build.linux.icon).toBe('build/icons')
})

test('the icon directory exists with the sizes electron-builder expects', () => {
  const dir = path.join(root, pkg.build.linux.icon)
  expect(fs.existsSync(dir)).toBe(true)
  const files = fs.readdirSync(dir)
  // 512 is the size AppImage and the hicolor theme want; the smaller entries
  // populate the rest of the theme so launchers do not rescale one big PNG.
  for (const size of [16, 32, 48, 64, 128, 256, 512]) {
    expect(files).toContain(`${size}x${size}.png`)
  }
})

// electron-builder matches on the <size>x<size>.png filename, so a file whose
// real dimensions disagree with its name produces silently wrong icons.
test('each icon\'s real dimensions match its filename', () => {
  const dir = path.join(root, pkg.build.linux.icon)
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.png'))) {
    const expected = Number(file.split('x')[0])
    const buf = fs.readFileSync(path.join(dir, file))
    // PNG IHDR: width and height are big-endian uint32 at byte 16 and 20.
    expect(buf.subarray(1, 4).toString()).toBe('PNG')
    expect(buf.readUInt32BE(16), `${file} width`).toBe(expected)
    expect(buf.readUInt32BE(20), `${file} height`).toBe(expected)
  }
})

// build/icons is a build-time input and is NOT inside the packaged asar, so the
// runtime window icon has to come from a path that is.
test('the runtime window icon is packaged', () => {
  const runtimeIcon = path.join(root, 'src', 'assets', 'ui', 'appicon.png')
  expect(fs.existsSync(runtimeIcon)).toBe(true)
  const covered = pkg.build.files.some((pattern) => pattern.startsWith('src/assets/ui/'))
  expect(covered).toBe(true)
})

test('the window icon is applied on Linux only', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8')
  expect(main).toContain('function getWindowIconPath()')
  // Windows embeds its icon in the exe and macOS uses the bundle.
  expect(main).toMatch(/getWindowIconPath[\s\S]{0,300}process\.platform !== 'linux'/)
  expect(main).toContain('icon: getWindowIconPath()')
})
