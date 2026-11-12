import { describe, it, expect } from 'vitest'
import { DEFAULT_TIMEOUT_MS, F95_CAPTCHA_TIMEOUT_MS } from '../electron/downloads/maskedResolver.js'

describe('DEFAULT_TIMEOUT_MS', () => {
  it('is 2 minutes', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(2 * 60 * 1000)
  })
})

describe('F95_CAPTCHA_TIMEOUT_MS', () => {
  it('is 5 minutes', () => {
    expect(F95_CAPTCHA_TIMEOUT_MS).toBe(5 * 60 * 1000)
  })
})
