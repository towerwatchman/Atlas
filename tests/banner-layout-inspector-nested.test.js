import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
const src = read('src/components/settings/bannerEditor/BannerLayoutEditor.jsx')

// The per-field inspector must be defined at module scope, not inside the
// editor's render body. A component defined inside a render body is a NEW
// component type on every render, so React unmounts and rebuilds its whole
// subtree each re-render. For the Layout-tab colour pickers that means the
// native colour dialog closes the moment the first change fires (the state
// update re-renders the editor, which redefines the nested component, which
// destroys the <input type="color"> the dialog is bound to) — so the picker
// can never be dragged. Hoisting it and threading the editor's state in as
// props keeps the component identity stable across re-renders.
test('the per-field inspector is defined at module scope (colour picker stays open while dragging)', () => {
  const renderBody = src.slice(src.indexOf('const BannerLayoutEditor ='), src.indexOf('export default BannerLayoutEditor'))

  // Module scope: the definition sits at column 0, before the editor component.
  expect(src).toMatch(/(^|\n)function Inspector\(\{/)
  expect(src.indexOf('function Inspector({')).toBeLessThan(src.indexOf('const BannerLayoutEditor ='))

  // Not inside the render body (so its type identity cannot change per render).
  expect(renderBody).not.toMatch(/(^|\n)\s*function Inspector\(/)
})