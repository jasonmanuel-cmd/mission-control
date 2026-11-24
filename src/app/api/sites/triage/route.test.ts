import { describe, it, expect } from 'vitest'
import * as route from './route'

describe('triage route config', () => {
  it('asks for enough time for the live probe, expiry lookups and database calls', () => {
    expect((route as any).maxDuration).toBeGreaterThanOrEqual(30)
  })
  it('is never statically cached', () => {
    expect((route as any).dynamic).toBe('force-dynamic')
  })
})
