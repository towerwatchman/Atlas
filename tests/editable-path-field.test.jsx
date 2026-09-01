// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { useState } from 'react'

import EditablePathField from '../src/components/ui/EditablePathField.jsx'

beforeEach(() => {
  cleanup()
  const fakeCheck = async (p) => {
    const trimmed = String(p).trim().replace(/^["']|["']$/g, '')
    if (!trimmed) return { exists: false }
    if (trimmed === '/tmp/games' || trimmed === '/tmp/valid' || trimmed === 'C:/Games') {
      return { exists: true, isDirectory: true, isFile: false }
    }
    if (trimmed === '/usr/bin/app' || trimmed === 'C:/Programs/app.exe') {
      return { exists: true, isDirectory: false, isFile: true }
    }
    if (trimmed === '/tmp/file.txt') {
      return { exists: true, isDirectory: false, isFile: true }
    }
    return { exists: false }
  }
  vi.stubGlobal('window', {
    electronAPI: {
      checkPath: vi.fn(fakeCheck),
      selectDirectory: vi.fn(async () => null),
      selectFile: vi.fn(async () => null),
    },
  })
})

const renderSettled = async (ui) => {
  let result
  await act(async () => { result = render(ui) })
  return result
}

// Helper that mimics a controlled parent updating value on onSave
function StatefulWrapper({ initialValue, ...props }) {
  const [val, setVal] = useState(initialValue)
  const onSave = vi.fn((p) => {
    setVal(p)
    props.onSave?.(p)
  })
  // expose spy via props
  return <EditablePathField {...props} value={val} onSave={onSave} />
}

test('enters edit on focus and can commit a valid directory via Enter (stateful parent)', async () => {
  const onSave = vi.fn()
  const { container } = await renderSettled(
    <StatefulWrapper initialValue="/tmp/old" mode="directory" pickerLabel="Set Folder" onPick={async () => null} onSave={onSave} />
  )
  const input = container.querySelector('input')
  expect(input.readOnly).toBe(true)
  await act(async () => { fireEvent.focus(input) })
  expect(input.readOnly).toBe(false)
  await act(async () => { fireEvent.change(input, { target: { value: '/tmp/games' } }) })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  expect(window.electronAPI.checkPath).toHaveBeenCalledWith('/tmp/games')
  expect(onSave).toHaveBeenCalledWith('/tmp/games')
  expect(input.readOnly).toBe(true)
  // parent state updated, so input now shows new value
  expect(input.value).toBe('/tmp/games')
})

test('valid blur also commits', async () => {
  const onSave = vi.fn()
  const { container } = await renderSettled(
    <EditablePathField value="/tmp/old" mode="directory" onPick={async () => null} onSave={onSave} />
  )
  const input = container.querySelector('input')
  await act(async () => { fireEvent.focus(input) })
  await act(async () => { fireEvent.change(input, { target: { value: '/tmp/games' } }) })
  await act(async () => { fireEvent.blur(input) })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  expect(onSave).toHaveBeenCalledWith('/tmp/games')
})

test('invalid keeps error border, does not call onSave, stays in edit', async () => {
  const onSave = vi.fn()
  const { container } = await renderSettled(
    <EditablePathField value="/tmp/old" mode="directory" onPick={async () => null} onSave={onSave} />
  )
  const input = container.querySelector('input')
  await act(async () => { fireEvent.focus(input) })
  await act(async () => { fireEvent.change(input, { target: { value: '/tmp/does-not-exist' } }) })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  expect(onSave).not.toHaveBeenCalled()
  expect(input.readOnly).toBe(false)
  expect(input.className).toMatch(/border-danger/)
  window.electronAPI.checkPath.mockClear()
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  expect(window.electronAPI.checkPath).toHaveBeenCalled()
  expect(onSave).not.toHaveBeenCalled()
})

test('blur on invalid drops focus but keeps error and draft', async () => {
  const onSave = vi.fn()
  const { container } = await renderSettled(
    <EditablePathField value="/tmp/old" mode="directory" onPick={async () => null} onSave={onSave} />
  )
  const input = container.querySelector('input')
  await act(async () => { fireEvent.focus(input) })
  await act(async () => { fireEvent.change(input, { target: { value: '/tmp/bad' } }) })
  await act(async () => { fireEvent.blur(input) })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  expect(onSave).not.toHaveBeenCalled()
  expect(document.activeElement).not.toBe(input)
  expect(input.className).toMatch(/border-danger/)
  expect(input.value).toBe('/tmp/bad')
  await act(async () => { fireEvent.focus(input) })
  expect(input.value).toBe('/tmp/bad')
})

test('Escape while invalid reverts to value and clears error', async () => {
  const onSave = vi.fn()
  const { container } = await renderSettled(
    <EditablePathField value="/tmp/old" mode="directory" onPick={async () => null} onSave={onSave} />
  )
  const input = container.querySelector('input')
  await act(async () => { fireEvent.focus(input) })
  await act(async () => { fireEvent.change(input, { target: { value: '/tmp/bad' } }) })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  expect(input.className).toMatch(/border-danger/)
  await act(async () => { fireEvent.keyDown(input, { key: 'Escape' }) })
  expect(input.readOnly).toBe(true)
  expect(input.value).toBe('/tmp/old')
  expect(input.className).not.toMatch(/border-danger/)
  expect(onSave).not.toHaveBeenCalled()
})

test('allowEmpty accepts "" without IPC', async () => {
  const onSave = vi.fn()
  const { container } = await renderSettled(
    <EditablePathField value="/tmp/old" mode="directory" allowEmpty onPick={async () => null} onSave={onSave} />
  )
  const input = container.querySelector('input')
  await act(async () => { fireEvent.focus(input) })
  await act(async () => { fireEvent.change(input, { target: { value: '   ' } }) })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 15)) })
  expect(window.electronAPI.checkPath).not.toHaveBeenCalled()
  expect(onSave).toHaveBeenCalledWith('')
})

test('file vs directory mismatch is invalid', async () => {
  const onSave = vi.fn()
  const { container } = await renderSettled(
    <EditablePathField value="/tmp/old" mode="directory" onPick={async () => null} onSave={onSave} />
  )
  const input = container.querySelector('input')
  await act(async () => { fireEvent.focus(input) })
  await act(async () => { fireEvent.change(input, { target: { value: '/tmp/file.txt' } }) })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  expect(onSave).not.toHaveBeenCalled()
  expect(input.className).toMatch(/border-danger/)
})

test('file mode valid when isFile', async () => {
  const onSave = vi.fn()
  const { container } = await renderSettled(
    <EditablePathField value="" mode="file" onPick={async () => null} onSave={onSave} />
  )
  const input = container.querySelector('input')
  await act(async () => { fireEvent.focus(input) })
  await act(async () => { fireEvent.change(input, { target: { value: '/usr/bin/app' } }) })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  expect(onSave).toHaveBeenCalledWith('/usr/bin/app')
})

test('onPick returning a path calls onSave without checkPath', async () => {
  const onSave = vi.fn()
  const onPick = vi.fn(async () => '/tmp/games')
  await renderSettled(
    <EditablePathField value="/tmp/old" mode="directory" pickerLabel="Set Folder" onPick={onPick} onSave={onSave} />
  )
  const button = screen.getByText('Set Folder')
  await act(async () => { fireEvent.click(button) })
  await act(async () => { await new Promise((r) => setTimeout(r, 15)) })
  expect(onPick).toHaveBeenCalled()
  expect(window.electronAPI.checkPath).not.toHaveBeenCalled()
  expect(onSave).toHaveBeenCalledWith('/tmp/games')
})

test('onPick returning null does nothing', async () => {
  const onSave = vi.fn()
  const onPick = vi.fn(async () => null)
  const { container } = await renderSettled(
    <EditablePathField value="/tmp/old" mode="directory" pickerLabel="Set Folder" onPick={onPick} onSave={onSave} />
  )
  const input = container.querySelector('input')
  await act(async () => { fireEvent.click(screen.getByText('Set Folder')) })
  await act(async () => { await new Promise((r) => setTimeout(r, 15)) })
  expect(onSave).not.toHaveBeenCalled()
  expect(input.value).toBe('/tmp/old')
})

test('validating flag blocks second commit (Enter then blur)', async () => {
  let resolveCheck
  const slowCheck = vi.fn(() => new Promise((res) => { resolveCheck = res }))
  window.electronAPI.checkPath = slowCheck
  const onSave = vi.fn()
  const { container } = await renderSettled(
    <EditablePathField value="/tmp/old" mode="directory" onPick={async () => null} onSave={onSave} />
  )
  const input = container.querySelector('input')
  await act(async () => { fireEvent.focus(input) })
  await act(async () => { fireEvent.change(input, { target: { value: '/tmp/games' } }) })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  await act(async () => { fireEvent.blur(input) })
  expect(slowCheck).toHaveBeenCalledTimes(1)
  await act(async () => { resolveCheck({ exists: true, isDirectory: true, isFile: false }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 15)) })
  expect(onSave).toHaveBeenCalledTimes(1)
})

test('trims whitespace and strips surrounding quotes before validation', async () => {
  const onSave = vi.fn()
  const { container } = await renderSettled(
    <EditablePathField value="/tmp/old" mode="directory" onPick={async () => null} onSave={onSave} />
  )
  const input = container.querySelector('input')
  await act(async () => { fireEvent.focus(input) })
  await act(async () => { fireEvent.change(input, { target: { value: '  "/tmp/games"  ' } }) })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  expect(window.electronAPI.checkPath).toHaveBeenCalledWith('/tmp/games')
  expect(onSave).toHaveBeenCalledWith('/tmp/games')
})
