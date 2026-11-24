import { timingSafeEqual } from 'crypto'

/** Constant-time check of `Authorization: Bearer <secret>`. */
export function isAuthorized(header: string | null, secret: string): boolean {
  if (!header) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header)
  if (given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}
