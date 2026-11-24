/**
 * Site Configuration for Mission Control Center
 * Type + validation helpers. The registry itself lives in /sites.json (read server-side via lib/sites.ts).
 */

export interface SiteConfig {
  id: string
  name: string
  url: string
  githubRepo?: string
  netlifyId?: string
  vercelProject?: string
  betterStackId?: string
}

/**
 * Validate site configuration
 */
export function validateSiteConfig(site: Partial<SiteConfig>): string[] {
  const errors: string[] = []

  if (!site.name || site.name.trim().length === 0) {
    errors.push('Site name is required')
  }

  if (!site.url || site.url.trim().length === 0) {
    errors.push('Site URL is required')
  } else {
    try {
      new URL(site.url)
    } catch {
      errors.push('Invalid URL format')
    }
  }

  if (site.githubRepo && !site.githubRepo.includes('/')) {
    errors.push('GitHub repo should be in format: owner/repository')
  }

  return errors
}

/**
 * Generate a unique site ID
 */
export function generateSiteId(): string {
  return `site-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}
