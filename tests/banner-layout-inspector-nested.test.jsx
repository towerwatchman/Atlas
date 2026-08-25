// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'

import BannerLayoutEditor from '../src/components/settings/bannerEditor/BannerLayoutEditor.jsx'

// The bug: the Layout tab's colour pickers closed the instant the colour
// changed, so the shade square and hue slider could only be click-selected,
// never dragged.
//
// Nothing about a colour change should close the native dialog. The path was
// entirely through React identity: the per-field `Inspector` was defined INSIDE
// the editor's render body, which makes it a NEW component type on every
// render. React compares types to decide reconcile-vs-remount, so the first
// onChange re-rendered the editor, produced a different Inspector type, and
// React tore down the whole subtree -- destroying the `<input type="color">`
// that the OS colour dialog was attached to. The dialog dies with its anchor.
//
// The fix hoists Inspector to module scope and threads the editor's state in as
// props, so its type is a stable module-level binding.
//
// These assert the DOM node identity of the colour input across a re-render:
// same node means React reconciled, a different node means it remounted and the
// picker would have closed. A test that only greps the source for `function
// Inspector` at column 0 cannot tell those two apart -- it passes on any file
// containing the string, and misses a re-nesting under a different name.

const layout = {
  fields: [
    { id: 'title', slot: 'top-left', region: 'image', visible: true, textColor: '#ffffff' },
  ],
  panels: {},
}

const baseProps = {
  layout,
  fieldLabels: { title: 'Title' },
  slotLabels: {
    'top-left': 'Top left', 'top-center': 'Top center', 'top-right': 'Top right',
    'center-left': 'Center left', center: 'Center', 'center-right': 'Center right',
    'bottom-left': 'Bottom left', 'bottom-center': 'Bottom center', 'bottom-right': 'Bottom right',
  },
  badgeFields: new Set(),
  fieldRegistry: [{ id: 'title', label: 'Title', category: 'Basic' }],
  fieldCategories: ['Basic'],
  onFieldChange: () => {},
  onResetField: () => {},
  onAddDivider: () => {},
  onRemoveField: () => {},
  onEnablePanel: () => {},
  onDisablePanel: () => {},
  eyedropperAvailable: false,
  onPickColor: () => {},
}

// The inspector renders several colour inputs (border, text, outline). Pick the
// one under the "Text color" label rather than the first in document order, so
// the value assertions below refer to a known field.
const textColorInput = (container) => {
  const label = [...container.querySelectorAll('label')]
    .find((el) => el.textContent.trim().startsWith('Text color'))
  return label?.querySelector('input[type="color"]') || null
}

afterEach(cleanup)

describe('banner layout inspector stability', () => {
  it('keeps the same colour input node when the editor re-renders', () => {
    // This is the regression. Before the fix the rerender below replaced the
    // node, which is exactly what closed the picker mid-drag.
    const { container, rerender } = render(<BannerLayoutEditor {...baseProps} />)
    const before = textColorInput(container)
    expect(before).toBeTruthy()

    rerender(<BannerLayoutEditor {...baseProps} />)

    const after = textColorInput(container)
    expect(after).toBe(before)
  })

  it('keeps the same colour input node when a colour change re-renders the editor', () => {
    // The real sequence: onChange fires -> parent state updates -> the editor
    // re-renders with a new layout object. The input must survive it.
    const { container, rerender } = render(<BannerLayoutEditor {...baseProps} />)
    const before = textColorInput(container)

    const nextLayout = {
      ...layout,
      fields: [{ ...layout.fields[0], textColor: '#ff0000' }],
    }
    rerender(<BannerLayoutEditor {...baseProps} layout={nextLayout} />)

    const after = textColorInput(container)
    expect(after).toBe(before)
    expect(after.value).toBe('#ff0000')
  })

  it('still swaps the inspector when a different field is selected', () => {
    // Guard against "fixing" remounts by freezing the inspector: selecting a
    // different field must genuinely change what it shows.
    const twoFields = {
      ...layout,
      fields: [
        layout.fields[0],
        { id: 'creator', slot: 'top-right', region: 'image', visible: true },
      ],
    }
    const props = {
      ...baseProps,
      layout: twoFields,
      fieldLabels: { title: 'Title', creator: 'Creator' },
      fieldRegistry: [
        { id: 'title', label: 'Title', category: 'Basic' },
        { id: 'creator', label: 'Creator', category: 'Basic' },
      ],
    }
    const { container } = render(<BannerLayoutEditor {...props} />)
    expect(container.textContent).toContain('Title')

    fireEvent.click(container.querySelector('span[title="Creator"]'))
    expect(container.textContent).toContain('Creator')
  })
})
