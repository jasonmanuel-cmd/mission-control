export interface SSLInfo {
  hostname: string
  valid: boolean
  issuer?: string
  subject?: string
  validFrom?: string
  validTo?: string
  daysRemaining: number
  protocol?: string
  error?: string
}

export async function checkSSL(hostname: string, timeoutMs = 10000, port = 443): Promise<SSLInfo> {
  const cleanHostname = hostname.replace(/^https?:\/\//, '').replace(/\/.*$/, '')

  if (typeof window !== 'undefined') {
    return {
      hostname: cleanHostname,
      valid: false,
      daysRemaining: 0,
      error: 'SSL checks only available server-side'
    }
  }

  const tls = await import('tls')

  return new Promise((resolve) => {
    let settled = false
    let tlsSocket: import('tls').TLSSocket | undefined

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        tlsSocket?.destroy()
        resolve({
          hostname: cleanHostname,
          valid: false,
          daysRemaining: 0,
          error: 'SSL check timed out'
        })
      }
    }, timeoutMs)

    // tls.connect opens the TCP connection itself. (A pre-made, never-connected net.Socket here meant
    // the handshake could never start, so every check used to end as "timed out".)
    try {
      tlsSocket = tls.connect({
        host: cleanHostname,
        port,
        servername: cleanHostname,
        rejectUnauthorized: false
      })
    } catch (err) {
      // tls.connect can throw synchronously (e.g. an out-of-range port); don't leave the timer armed.
      settled = true
      clearTimeout(timeout)
      resolve({
        hostname: cleanHostname,
        valid: false,
        daysRemaining: 0,
        error: `TLS error: ${err instanceof Error ? err.message : String(err)}`
      })
      return
    }
    const socket = tlsSocket

    socket.once('secureConnect', () => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)

        const cert = socket.getPeerCertificate()
        const validTo = cert.valid_to ? new Date(cert.valid_to) : new Date()
        const now = new Date()
        const daysRemaining = Math.max(0, Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))

        resolve({
          hostname: cleanHostname,
          valid: daysRemaining > 0,
          issuer: typeof cert.issuer?.O === 'string' ? cert.issuer.O : typeof cert.issuer?.CN === 'string' ? cert.issuer.CN : undefined,
          subject: typeof cert.subject?.CN === 'string' ? cert.subject.CN : undefined,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          daysRemaining,
          protocol: socket.getProtocol() || undefined
        })

        socket.destroy()
      }
    })

    socket.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        resolve({
          hostname: cleanHostname,
          valid: false,
          daysRemaining: 0,
          error: `TLS error: ${err.message}`
        })
      }
    })
  })
}
