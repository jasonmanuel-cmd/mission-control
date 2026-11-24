import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import tls from 'tls'
import net from 'net'
import type { AddressInfo } from 'net'
import { checkSSL } from './ssl'

// Throwaway self-signed certificate for CN=localhost, valid ~100 years. Test fixture only.
const KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7DXUP+FEpeWFx
hjuPSVJtVmeWOqqL4oe/u2EHY2acB0HFvhqvv+HlomPDp0mTndJ7lTrGKGzaM75d
zhtGgiLs1NNJMq0gvs4gzaPRHDdHmSfOt6NgK3PBj0yyW+m5uUjC26zCO5NAuLwG
E2WyYKWzUPuUZaCLS6zKq309w/ikNPEMLLYhZu0vEE3e7rClP9XtjfPTau486xNz
YiiG8O7gpQjj9iY+Q3rqcGh9u37YPCPZffcFExv50rsKUe7sTIPk7i0baHnkbByD
ruZc3E4N+oid4gAIEyro0rGszRcpHAtvi2g429ZDMf/JFPLH3DJRYCZtipMIh4Zg
WodIrhXXAgMBAAECggEAJACVFXvP81GfhcA2Wn/cU5sb2Ph1tvLk+exQ4qEpMMLc
z/ilHkqqag51cUUTjkwEJTE13MoPGXh4HYn8CfgmTLsx55bPZ8wR1JKAA1GQ+kDq
Polt8qaqYwj31CSIueyFqqupdsEMuJpV5j15h3m+quLdaVSeL/Fi0qdrNaYwhzos
p4G92tT55wNbRQ2dQtvWiwxRrqicZECUcagpJPq/HzkEJYol6gw1Ae2UXV7bXhvn
GkH2tQmoVAQwEWQ1B87gMsmrN19OU8LLVCrgBDy8Jjlvt5TJZCpUrBW4yuIqnXPt
qQSTHbhPRxPXOBAn1q0e5/pi67M7Vb2BeH52GdBWAQKBgQDz4RFg7q2EE2hpXcjl
2JLfZ9OxtMRe2EeO11467e4rqpOxoAQqXGSAeSpJ0TjGmmop+TQvfh+G+Q7MG/3u
PftJ7NZYqOrUnpHKnclOAj9WPq48RP/YWHZeUWkb3/h/2OEAwzy9XTGe8/XJPxc3
89kETkdKkSm/AHI2W96kZwQFgQKBgQDEWV8CTVWV1pZFV+5XEX5gxL7+EkPIpdjM
XhAhH6ZBm8h0UQJaSk5gPS9slkh/uIm+AL0I8Af4k5F6fMCSZeguCuOM0148NGrB
yN75qnAmJNRGe0sZvo4hF02PdLDCq8pNGXLUia9kLHe2MireH9r2tNqylEmhZXaf
VHzjkOG3VwKBgHeIpzX1hoKn6JNMbn2Jy2NIxo/hZCaAp4IxuXP0zroEX2O+ZIxG
wNPfj4Si0cs2QDbWeGeWz+keBcyxI6M0Kgiv1teZ44/XMOo4sERWAalKC6hqwWPO
6CWOjZAmFOzE5nOzPgAqv3mDZcL/82dvU70yiOrZf7aoh1JxcQzvmR8BAoGATTN2
j8koZYnB+/He3I0cS6AQGIXF8RaEb5ZscRmonRNLdbCEZEvjFSP5iZBtYQqF3hcc
PG9kMvCSur5iWS2IZNITNkPFQZa6gwcf5LqG7fh9HllL5gtuhsRK0qTm+yPgnv/q
jna0Z4a0awa+pCeSSH5DnwN/D959DZiColdM6HECgYEAh0dVTCbQxYEFNEuRMeEZ
AL1TeTEJNeu1u1JqQZhGEX537JOwfYQ3gFMhCN3bH8D7mp/d6npFFXGGXKTv8WVc
7LalxEsFq5iPUD3/WR5ywsP5mBxnPVzv3oQr338iyJIIB5mrZD6WI/OcCADLpIlm
zaIUe0dcuizsxR8K2YdJAr4=
-----END PRIVATE KEY-----`
const CERT = `-----BEGIN CERTIFICATE-----
MIIDMTCCAhmgAwIBAgIUfsYFek92j/cysYNb1FTZHQCiEKAwDQYJKoZIhvcNAQEL
BQAwJzESMBAGA1UEAwwJbG9jYWxob3N0MREwDwYDVQQKDAhUZXN0IE9yZzAgFw0y
NjExMjQwMzU4MDlaGA8yMTI2MTAzMTAzNTgwOVowJzESMBAGA1UEAwwJbG9jYWxo
b3N0MREwDwYDVQQKDAhUZXN0IE9yZzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCC
AQoCggEBALsNdQ/4USl5YXGGO49JUm1WZ5Y6qovih7+7YQdjZpwHQcW+Gq+/4eWi
Y8OnSZOd0nuVOsYobNozvl3OG0aCIuzU00kyrSC+ziDNo9EcN0eZJ863o2Arc8GP
TLJb6bm5SMLbrMI7k0C4vAYTZbJgpbNQ+5RloItLrMqrfT3D+KQ08QwstiFm7S8Q
Td7usKU/1e2N89Nq7jzrE3NiKIbw7uClCOP2Jj5DeupwaH27ftg8I9l99wUTG/nS
uwpR7uxMg+TuLRtoeeRsHIOu5lzcTg36iJ3iAAgTKujSsazNFykcC2+LaDjb1kMx
/8kU8sfcMlFgJm2KkwiHhmBah0iuFdcCAwEAAaNTMFEwHQYDVR0OBBYEFHIocvv3
H+4S6GxT2UL83O16UJtqMB8GA1UdIwQYMBaAFHIocvv3H+4S6GxT2UL83O16UJtq
MA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAGIXtWAF+tD5YY+y
FWf8KpzeHL7TpCM8dt8bxCTWU42eFjp9AGRRvqk5IiYHta3JvBL87rYHp8657OiP
yRMclIBPOMZzWZrhoCoIhXMBY0sUyWlww8gCuAbjD3o5E5jWhQwuAfTBGfS6SR4d
OXh50N3JkWkCnC+TLI9xsxm0YEV2CRxX2/QwIfuMnS3dK4bUovO7wd6RS5tZXYIu
LLLSsCVV1dPjo+2SoXU3hV6gWZNZ8lObcMn2KtLofqen72e+80II9s85DylIGmrw
ahmROHE8w9kqLoGooup1/cCofw3ErUfwGqVcdSFXP9rvqXvKQJjal1B1qNyJ/osO
0W/XSUU=
-----END CERTIFICATE-----`

let server: tls.Server
let port: number

beforeAll(async () => {
  server = tls.createServer({ key: KEY, cert: CERT }, socket => socket.end())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

describe('checkSSL', () => {
  it('completes a real TLS handshake and reads the certificate', async () => {
    const info = await checkSSL('localhost', 4000, port)
    expect(info.error).toBeUndefined()
    expect(info.subject).toBe('localhost')
    expect(info.issuer).toBe('Test Org')
    expect(info.validTo).toBeDefined()
    expect(Date.parse(info.validTo!)).toBeGreaterThan(Date.now() + 90 * 86400_000)
    expect(info.daysRemaining).toBeGreaterThan(90)
    expect(info.valid).toBe(true)
  })

  it('reports a connection error (not a timeout) when nothing is listening', async () => {
    const closed = await new Promise<number>(resolve => {
      const s = net.createServer()
      s.listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => resolve(p)) })
    })
    const info = await checkSSL('localhost', 4000, closed)
    expect(info.error).toMatch(/ECONNREFUSED/)
    expect(info.valid).toBe(false)
  })

  it('times out cleanly when the server accepts but never answers', async () => {
    const silent = net.createServer(() => { /* accept and say nothing */ })
    await new Promise<void>(resolve => silent.listen(0, '127.0.0.1', resolve))
    const p = (silent.address() as AddressInfo).port
    const info = await checkSSL('localhost', 300, p)
    silent.close()
    expect(info.error).toMatch(/timed out/i)
  })

  it('an invalid port becomes an error result (no rejection, no stray timer)', async () => {
    const info = await checkSSL('localhost', 200, 99999)
    expect(info.valid).toBe(false)
    expect(info.error).toBeDefined()
    await new Promise(r => setTimeout(r, 350)) // a leaked timer would throw here
  })
})
