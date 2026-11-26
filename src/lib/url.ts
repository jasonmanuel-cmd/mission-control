// Site URLs reach the API in two shapes: bare hosts from SITES_CONFIG
// ("example.com") and full URLs saved from the Add Site form
// ("https://example.com"). Building `https://${url}` on the second shape
// produces "https://https://example.com", which Node resolves as a host
// named "https" and fails with ENOTFOUND. Normalise once, here.

/** Full URL with a scheme and no trailing slash. Keeps http:// if given. */
export function toSiteUrl(input: string): string {
  const trimmed = input.trim()
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withScheme.replace(/\/+$/, '')
}

/** Scheme + host only, for paths that live at the site root (robots.txt, sitemap.xml). */
export function siteOrigin(input: string): string {
  const full = toSiteUrl(input)
  try {
    return new URL(full).origin
  } catch {
    return full
  }
}
