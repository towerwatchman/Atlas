import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = readFileSync(resolve(root, 'src/App.jsx'), 'utf8')
const tree = readFileSync(resolve(root, 'src/components/library/GameTree.jsx'), 'utf8')

describe('game list width', () => {
  it('uses a 300px panel and clears it with matching content offsets', () => {
    expect(app).toContain('w-[300px] bg-secondary fixed top-[70px] bottom-[40px]')
    expect(app).toContain("showLibrarySidebarInView ? 'ml-[300px]' : ''")
    expect(app).toContain("showLibrarySidebarInView ? 'ml-[360px]' : 'ml-[60px]'")
    expect(app).not.toContain('ml-[200px]')
    expect(app).not.toContain('ml-[260px]')
    expect(tree).toContain('300px library side panel')
  })
})
