// Contract for the F95Checker external-library reader.
//
// scripts/check-f95checker-parser.js already exercises the reader end-to-end
// against a real temporary SQLite file. This suite covers the PURE pieces that
// the three import bugs actually lived in, so a regression is caught by
// `npm test` rather than only by the slower check script:
//
//   1. Executables stored relative to settings.default_exe_dir. Treating them
//      as absolute made an entire installed library import as uninstalled.
//   2. Thread ids surviving on custom (user-created) entries via their URL.
//      Discarding them made real, catalogued games look unmatchable.
//   3. Which rows default to the wishlist rather than the library.
//
// These are deliberately filesystem-free: buildImportRow's stat() behaviour is
// the check script's job, while everything asserted here is decision logic.

import { describe, it, expect } from 'vitest'

const {
  pickExeBaseDir,
  joinExeBase,
  extractThreadId,
  parseJsonArray,
  buildImportRow,
} = require('../electron/scanners/externalLibrary/f95checker')

// A minimal games row. Defaults mirror F95Checker's own column defaults so a
// test only states the field it is actually about.
const gameRow = (overrides = {}) => ({
  id: 12345,
  custom: 0,
  name: 'Some Game',
  version: 'v1.0',
  developer: 'Some Dev',
  url: '',
  added_on: 0,
  last_launched: 0,
  rating: 0,
  finished: '',
  installed: '',
  archived: 0,
  executables: '[]',
  labels: '[]',
  tab: null,
  notes: '',
  ...overrides,
})

const build = (overrides = {}, opts = {}) =>
  buildImportRow(gameRow(overrides), {
    labelsById: new Map(),
    tabsById: new Map(),
    ...opts,
  })

describe('pickExeBaseDir', () => {
  // Keyed by F95Checker's Os enum value (modules/structs.py), NOT by platform
  // name — the single easiest thing to get wrong when reading their schema.
  it('reads this platform key', () => {
    expect(pickExeBaseDir('{"0":"D:\\\\Spice"}', 'win32')).toBe('D:\\Spice')
    expect(pickExeBaseDir('{"1":"/Users/x/Games"}', 'darwin')).toBe('/Users/x/Games')
    expect(pickExeBaseDir('{"2":"/home/x/games"}', 'linux')).toBe('/home/x/games')
  })

  it('prefers this platform when several are present', () => {
    const raw = '{"0":"D:\\\\Win","2":"/home/x/linux"}'
    expect(pickExeBaseDir(raw, 'linux')).toBe('/home/x/linux')
    expect(pickExeBaseDir(raw, 'win32')).toBe('D:\\Win')
  })

  it('falls back to any populated key for a database from another machine', () => {
    // Better to resolve against a foreign base path (and report it as missing)
    // than to silently treat every relative path as absolute.
    expect(pickExeBaseDir('{"0":"D:\\\\Spice"}', 'linux')).toBe('D:\\Spice')
  })

  it('degrades safely on empty, absent or malformed values', () => {
    expect(pickExeBaseDir('{}', 'win32')).toBe('')
    expect(pickExeBaseDir('{"0":""}', 'win32')).toBe('')
    expect(pickExeBaseDir('', 'win32')).toBe('')
    expect(pickExeBaseDir(null, 'win32')).toBe('')
    expect(pickExeBaseDir('not json', 'win32')).toBe('')
    expect(pickExeBaseDir('[1,2]', 'win32')).toBe('')
  })
})

describe('joinExeBase', () => {
  it('joins a relative entry onto the base directory', () => {
    expect(joinExeBase('D:\\Spice', 'Sakura Gozen/Game.exe'))
      .toBe('D:\\Spice\\Sakura Gozen\\Game.exe')
  })

  it('normalises separators to the base so the path is displayable', () => {
    expect(joinExeBase('/games', 'A/B/g.sh')).toBe('/games/A/B/g.sh')
    expect(joinExeBase('D:\\Spice\\', 'A/B/g.exe')).toBe('D:\\Spice\\A\\B\\g.exe')
  })

  it('leaves absolute entries alone', () => {
    expect(joinExeBase('D:\\Spice', 'C:\\Other\\g.exe')).toBe('C:\\Other\\g.exe')
    expect(joinExeBase('/games', '/usr/bin/g')).toBe('/usr/bin/g')
    expect(joinExeBase('/games', '\\\\nas\\share\\g.exe')).toBe('\\\\nas\\share\\g.exe')
  })

  it('recognises a Windows absolute path regardless of host platform', () => {
    // path.isAbsolute() alone returns false for "D:\..." on POSIX, which would
    // mangle a Windows database read on Linux into base + "D:\...".
    expect(joinExeBase('/games', 'D:\\Spice\\g.exe')).toBe('D:\\Spice\\g.exe')
  })

  it('passes the entry through when no base directory is configured', () => {
    expect(joinExeBase('', 'Game/g.exe')).toBe('Game/g.exe')
    expect(joinExeBase('D:\\Spice', '')).toBe('')
  })
})

describe('extractThreadId', () => {
  it('reads the bare numeric form', () => {
    expect(extractThreadId('https://f95zone.to/threads/37378', 'f95')).toBe('37378')
    expect(extractThreadId('https://f95zone.to/threads/37378/', 'f95')).toBe('37378')
  })

  it('reads the XenForo slug form, including a trailing post anchor', () => {
    expect(extractThreadId('https://f95zone.to/threads/a-slug.243406/', 'f95')).toBe('243406')
    expect(extractThreadId('https://f95zone.to/threads/a-slug.243406/post-99', 'f95')).toBe('243406')
  })

  it('reads LewdCorner threads', () => {
    expect(extractThreadId('https://lewdcorner.com/threads/x.13917/', 'lewdcorner')).toBe('13917')
  })

  it('never returns another forum\u2019s id', () => {
    expect(extractThreadId('https://lewdcorner.com/threads/x.13917/', 'f95')).toBe('')
    expect(extractThreadId('https://f95zone.to/threads/37378', 'lewdcorner')).toBe('')
  })

  it('returns empty for unrelated or missing URLs', () => {
    expect(extractThreadId('https://www.ryuugames.com/a-game-rj01415588/', 'f95')).toBe('')
    expect(extractThreadId('https://haelgames.com/camp-arcadia/', 'f95')).toBe('')
    expect(extractThreadId('', 'f95')).toBe('')
    expect(extractThreadId(null, 'f95')).toBe('')
  })
})

describe('buildImportRow: source identification', () => {
  it('uses a positive row id as the thread id', () => {
    const row = build({ id: 54321, url: 'https://f95zone.to/threads/54321' })
    expect(row.f95Id).toBe('54321')
    expect(row.f95IdFromUrl).toBe(false)
    expect(row.isCustomEntry).toBe(false)
  })

  it('never lets a custom entry\u2019s synthetic id become a thread id', () => {
    const row = build({ id: -37, custom: 1, url: '' })
    expect(row.f95Id).toBe('')
    expect(row.externalId).toBe(-37)
    expect(row.isCustomEntry).toBe(true)
  })

  it('recovers the real thread id from a custom entry\u2019s URL', () => {
    // The regression: 25 of 34 custom entries in a real library link to a live
    // thread, and dropping that link is what made existing games unfindable.
    const row = build({ id: -37, custom: 1, url: 'https://f95zone.to/threads/37378' })
    expect(row.f95Id).toBe('37378')
    expect(row.f95IdFromUrl).toBe(true)
    expect(row.externalId).toBe(-37)
    expect(row.isCustomEntry).toBe(true)
  })

  it('recovers a LewdCorner id without inventing an F95 one', () => {
    const row = build({ id: -3, custom: 1, url: 'https://lewdcorner.com/threads/g.4242/' })
    expect(row.lcId).toBe('4242')
    expect(row.lewdCornerId).toBe('4242')
    expect(row.f95Id).toBe('')
  })

  it('leaves a genuinely unidentifiable row with no ids to match on', () => {
    const row = build({ id: -21, custom: 1, url: 'https://www.ryuugames.com/x-rj014/' })
    expect(row.f95Id).toBe('')
    expect(row.lcId).toBe('')
    expect(row.lookupTitle).toBe(row.title)
  })

  it('trusts the custom column over the sign of the id', () => {
    expect(build({ id: 999, custom: 1 }).isCustomEntry).toBe(true)
    expect(build({ id: 999, custom: 1 }).f95Id).toBe('')
    expect(build({ id: 42, custom: 0 }).isCustomEntry).toBe(false)
  })

  it('falls back to the sign of the id when custom is absent', () => {
    // Databases written before F95Checker added the column.
    expect(build({ id: -5, custom: null }).isCustomEntry).toBe(true)
    expect(build({ id: 5, custom: null }).isCustomEntry).toBe(false)
  })
})

describe('buildImportRow: wishlist defaults', () => {
  // The rule is whether an executable RESOLVED on disk, not whether one was
  // recorded. The earlier rule asked only about `executables` and `installed`,
  // which left rows that satisfy neither the importer's launchable check nor the
  // wishlist check — so pressing Import wrote them nowhere and said nothing.
  it('flags a tracked game with nothing on disk', () => {
    const row = build({ executables: '[]', installed: '' })
    expect(row.wishlistCandidate).toBe(true)
    expect(row.addToWishlist).toBe(true)
    expect(row.isInstalled).toBe(false)
    expect(row.wishlistReason).toBe('not-installed')
  })

  it('flags a row whose recorded executable does not resolve', () => {
    // This is the regression the rule change fixed. Atlas cannot launch it, so it
    // cannot become a library record — and under the old rule it was not a
    // wishlist candidate either, so it was silently dropped by both paths. For a
    // library on a drive that is not mounted, that was every row.
    const row = build({ executables: JSON.stringify(['Game/g.exe']), installed: '' })
    expect(row.addToWishlist).toBe(true)
    expect(row.isInstalled).toBe(false)
    expect(row.wishlistReason).toBe('install-path-missing')
  })

  it('flags a row with an installed version but nothing to launch', () => {
    const row = build({ executables: '[]', installed: 'v1.2' })
    expect(row.addToWishlist).toBe(true)
    expect(row.isInstalled).toBe(false)
    expect(row.wishlistReason).toBe('no-launchable')
  })

  // Every row belongs to exactly one destination: a library record or the
  // wishlist. Asserted as an invariant because that is what the old rule broke.
  it('never leaves a row in both destinations or neither', () => {
    for (const fixture of [
      { executables: '[]', installed: '' },
      { executables: JSON.stringify(['Game/g.exe']), installed: '' },
      { executables: '[]', installed: 'v1.2' },
    ]) {
      const row = build(fixture)
      expect(Boolean(row.singleExecutable)).not.toBe(Boolean(row.addToWishlist))
    }
  })
})

describe('buildImportRow: version and state mapping', () => {
  it('prefers the installed version over the thread\u2019s latest', () => {
    const row = build({ version: 'v1.3', installed: 'v1.2' })
    expect(row.version).toBe('v1.2')
    expect(row.latestVersion).toBe('v1.3')
  })

  it('falls back to the thread version when nothing is installed', () => {
    expect(build({ version: 'v0.1', installed: '' }).version).toBe('v0.1')
  })

  it('treats zero as unset for rating, last played and date added', () => {
    const row = build({ rating: 0, last_launched: 0, added_on: 0 })
    expect(row.externalState.rating).toBeNull()
    expect(row.externalState.lastPlayed).toBeNull()
    expect(row.externalState.dateAdded).toBeNull()
  })

  it('keeps a finished version distinct from the installed one', () => {
    const row = build({ installed: 'v2.9', finished: 'v2.0' })
    expect(row.externalState.isFinished).toBe(true)
    expect(row.externalState.finishedVersion).toBe('v2.0')
    expect(row.externalState.installedVersion).toBe('v2.9')
  })

  it('never marks an unfinished game as finished', () => {
    expect(build({ finished: '' }).externalState.isFinished).toBe(false)
  })

  it('always defers matching to resolve-import-matches', () => {
    expect(build().scanStatus).toBe('pendingMatch')
    expect(build().in_place).toBe(1)
  })
})

describe('parseJsonArray', () => {
  it('parses a JSON array', () => {
    expect(parseJsonArray('["a","b"]')).toEqual(['a', 'b'])
  })

  it('treats unparseable text as a single element, matching their sql_to_py', () => {
    expect(parseJsonArray('C:/games/game.exe')).toEqual(['C:/games/game.exe'])
  })

  it('returns an empty array for empty, null or non-array JSON', () => {
    expect(parseJsonArray('')).toEqual([])
    expect(parseJsonArray(null)).toEqual([])
    expect(parseJsonArray('{"a":1}')).toEqual([])
  })
})
