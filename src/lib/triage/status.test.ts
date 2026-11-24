import { describe, it, expect } from 'vitest'
import { worstStatus } from './status'

describe('worstStatus', () => {
  it('returns ok when all parts are ok', () => {
    expect(worstStatus(['ok', 'ok', 'ok'])).toBe('ok')
  })
  it('fail beats warn and ok', () => {
    expect(worstStatus(['ok', 'warn', 'fail'])).toBe('fail')
  })
  it('warn beats ok', () => {
    expect(worstStatus(['ok', 'warn', 'ok'])).toBe('warn')
  })
  it('nodata alongside ok parts counts as warn', () => {
    expect(worstStatus(['ok', 'nodata', 'ok'])).toBe('warn')
  })
  it('all nodata stays nodata', () => {
    expect(worstStatus(['nodata', 'nodata', 'nodata'])).toBe('nodata')
  })
  it('fail beats nodata', () => {
    expect(worstStatus(['fail', 'nodata', 'ok'])).toBe('fail')
  })
})
