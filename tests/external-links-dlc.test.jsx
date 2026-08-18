// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { buildExternalLinks, groupLinksByParent } from '../src/components/detail/externalLinks.js'
import ExternalLinksSection from '../src/components/detail/ExternalLinksSection.jsx'

const blob = (o) => JSON.stringify(o)
const WITH_DLC = blob({
  steam_appid: '1000',
  steam_appids: ['1000', '2001', '2002'],
  steam_dlc_appids: ['2001', '2002'],
  steam_dlc_parents: { steam: { 1000: ['2001', '2002'] } },
  patreon: 'someone',
})

describe('buildExternalLinks with the DLC keys', () => {
  // Left alone these produced a second "Steam Dlc Appids" row per DLC, and the
  // parent map -- an object, not a list -- rendered as one "[object Object]".
  it('does not turn the DLC bookkeeping keys into links of their own', () => {
    const labels = buildExternalLinks(WITH_DLC).map((l) => l.label)
    expect(labels).not.toContain('Steam Dlc Appids')
    expect(labels).not.toContain('Steam Dlc Parents')
    expect(buildExternalLinks(WITH_DLC).map((l) => String(l.value)))
      .not.toContain('[object Object]')
  })

  it('types each id and names its parent', () => {
    expect(buildExternalLinks(WITH_DLC).map((l) => [l.value, l.isDlc, l.parentValue]))
      .toEqual([
        ['1000', false, null],
        ['2001', true, 'steam_appid:1000'],
        ['2002', true, 'steam_appid:1000'],
        ['someone', false, null],
      ])
  })

  it('leaves a package without the DLC keys exactly as it was', () => {
    const links = buildExternalLinks(blob({ steam_appids: ['1', '2'], patreon: 'x' }))
    expect(links.map((l) => l.value)).toEqual(['1', '2', 'x'])
    expect(links.every((l) => !l.isDlc)).toBe(true)
  })
})

describe('groupLinksByParent', () => {
  it('nests DLC under the game and leaves other links alone', () => {
    const groups = groupLinksByParent(buildExternalLinks(WITH_DLC))
    expect(groups.map((g) => g.value)).toEqual(['1000', 'someone'])
    expect(groups[0].dlc.map((d) => d.value)).toEqual(['2001', '2002'])
    expect(groups[1].dlc).toEqual([])
  })

  // Dropping it would hide a real store page. Parented to an F95 mapping, to a
  // link the admin removed, or never parented -- all reach this.
  it('keeps a DLC whose parent is not in the list as a top-level entry', () => {
    const groups = groupLinksByParent(buildExternalLinks(blob({
      steam_appids: ['3001'],
      steam_dlc_appids: ['3001'],
      steam_dlc_parents: { f95_zone: { 12345: ['3001'] } },
    })))
    expect(groups.map((g) => g.value)).toEqual(['3001'])
    expect(groups[0].isDlc).toBe(true)
  })

  // Distinct from the case above: here a steam parent IS named, but no link
  // carries that appid -- the admin removed the base-game link and left the DLC.
  // The DLC must be promoted, not silently dropped along with its store page.
  it('promotes a DLC whose named parent is missing from the list', () => {
    const groups = groupLinksByParent(buildExternalLinks(blob({
      steam_appids: ['4001'],
      steam_dlc_appids: ['4001'],
      steam_dlc_parents: { steam: { 9999: ['4001'] } },
    })))
    expect(groups.map((g) => g.value)).toEqual(['4001'])
    expect(groups[0].parentValue).toBe('steam_appid:9999')
  })

  it('never duplicates or loses a link', () => {
    const links = buildExternalLinks(WITH_DLC)
    const groups = groupLinksByParent(links)
    const flattened = groups.flatMap((g) => [g.value, ...g.dlc.map((d) => d.value)])
    expect(flattened.sort()).toEqual(links.map((l) => l.value).sort())
    expect(new Set(flattened).size).toBe(flattened.length)
  })
})

describe('<ExternalLinksSection>', () => {
  const groupsFor = (raw) => groupLinksByParent(buildExternalLinks(raw))

  it('collapses DLC by default and shows how many there are', () => {
    cleanup()
    render(<ExternalLinksSection groups={groupsFor(WITH_DLC)} />)
    expect(screen.getByRole('button', { name: /2 DLC/ })).toHaveProperty('ariaExpanded', 'false')
    expect(screen.getByText('1000')).toBeTruthy()
    expect(screen.queryByText('2001')).toBeNull()
    expect(screen.queryByText('2002')).toBeNull()
  })

  it('reveals them on click and hides them again', () => {
    cleanup()
    render(<ExternalLinksSection groups={groupsFor(WITH_DLC)} />)
    const toggle = screen.getByRole('button', { name: /2 DLC/ })
    fireEvent.click(toggle)
    expect(screen.getByText('2001')).toBeTruthy()
    expect(screen.getByText('2002')).toBeTruthy()
    fireEvent.click(toggle)
    expect(screen.queryByText('2001')).toBeNull()
  })

  it('shows no toggle for a game with no DLC', () => {
    cleanup()
    render(<ExternalLinksSection groups={groupsFor(blob({ steam_appid: '1000' }))} />)
    expect(screen.queryByRole('button', { name: /DLC/ })).toBeNull()
    expect(screen.getByText('1000')).toBeTruthy()
  })

  it('badges an un-nestable DLC so it is not mistaken for a base game', () => {
    cleanup()
    render(<ExternalLinksSection groups={groupsFor(blob({
      steam_appids: ['3001'],
      steam_dlc_appids: ['3001'],
      steam_dlc_parents: { f95_zone: { 12345: ['3001'] } },
    }))} />)
    expect(screen.getByText('DLC')).toBeTruthy()
  })

  it('renders nothing at all when there are no links', () => {
    cleanup()
    const { container } = render(<ExternalLinksSection groups={[]} />)
    expect(container.innerHTML).toBe('')
  })
})

// Several Steam appids all carry the key "steam_appid", so the key alone is not
// unique. With one appid per game this never surfaced; it does now that DLC are
// listed, and React would warn and mis-reconcile on re-render.
it('gives every row a unique React key', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'components', 'detail',
      'ExternalLinksSection.jsx'), 'utf8')
  expect(source).toContain('`${link.key}:${link.value}`')
  expect(source).not.toMatch(/key=\{\w+\.key\}/)
})
