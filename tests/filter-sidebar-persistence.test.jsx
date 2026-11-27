import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const app = readFileSync(resolve(root, 'src/App.jsx'), 'utf8')

const bodyOf = (src, declaration) => {
  const start = src.indexOf(declaration)
  if (start < 0) return ''
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  return ''
}

const slice = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)))

describe('filter sidebar persistence', () => {
  it('declares a closed-by-default config key', () => {
    const { buildDefaultConfig } = require('../electron/config/configSchema.js')
    expect(buildDefaultConfig().Interface.showFilterSidebar).toBe(false)
  })

  it('routes every visibility change through one config-saving helper', () => {
    const helper = bodyOf(app, 'const setAndPersistFilterSidebar')
    expect(helper).toContain('setShowSearchSidebar(next)')
    expect(helper).toContain('.getConfig()')
    expect(helper).toContain('...config,')
    expect(helper).toContain('...config.Interface,')
    expect(helper).toContain('showFilterSidebar: next')
    expect(helper).toContain('.saveSettings(')
    expect(helper).toContain('.catch(')

    expect(bodyOf(app, 'const toggleSearchSidebar')).toContain('setAndPersistFilterSidebar(!showSearchSidebar)')
    const jump = slice(app, 'const handleMetadataSearch', 'const resetFilters')
    expect(jump.match(/setAndPersistFilterSidebar\(true\)/g)).toHaveLength(2)
    expect(app).not.toContain("if (filterSidebarMode === 'inline' && !selectedGame)")
    expect((app.match(/onClose=\{\(\) => setAndPersistFilterSidebar\(false\)\}/g) || [])).toHaveLength(3)

    for (const handler of [
      'const toggleSearchSidebar',
      'const handleMetadataSearch',
    ]) {
      expect(bodyOf(app, handler)).not.toContain('setShowSearchSidebar(')
    }
    expect(app).not.toContain('onClose={() => setShowSearchSidebar(false)}')
  })

  it('restores a saved open sidebar on startup and stays closed without the key', () => {
    const startup = slice(app, '.then(([nsfwStatus, config])', '.catch(() => setSidebarMode')
    expect(startup).toContain('config?.Interface?.showFilterSidebar === true')
    expect(startup).toContain('setShowSearchSidebar(true)')
    expect(startup).not.toContain('setShowSearchSidebar(config.Interface.showFilterSidebar)')
    expect(bodyOf(app, 'const setAndPersistFilterSidebar')).not.toContain('showFilterSidebar ===')
  })

  it('ignores the saved value once the user has changed the sidebar', () => {
    const startup = slice(app, '.then(([nsfwStatus, config])', '.catch(() => setSidebarMode')
    expect(startup).toContain('if (!filterSidebarTouchedRef.current')
    expect(bodyOf(app, 'const setAndPersistFilterSidebar')).toContain('filterSidebarTouchedRef.current = true')
    expect(app).toContain('const filterSidebarTouchedRef = useRef(false)')
  })

  it('keeps Download and detail masking on the derived view flag', () => {
    expect(app).toContain('const showSearchSidebarInView = showSearchSidebar && libraryView !== \'downloads\'')
    expect(app).toContain('{showSearchSidebarInView && !selectedGame')
  })
})
