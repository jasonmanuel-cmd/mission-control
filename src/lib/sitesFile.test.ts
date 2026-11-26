import { describe, it, expect } from 'vitest'
import path from 'path'
import { readSites } from './sites'

// Mappings below were verified against the Vercel account (project domains + latest deployment metadata).
// Each site must point at the Vercel project that actually serves its domain, and the repo that deploys it.
const VERIFIED: Record<string, { vercelProject: string; githubRepo: string }> = {
  'https://coaibakersfield.com': { vercelProject: 'coaibakersfield', githubRepo: 'jasonmanuel-cmd/coainewweb' },
  'https://bakersfieldcheesesteak.com': { vercelProject: 'phillycheesesteak', githubRepo: 'jasonmanuel-cmd/phillycheesesteak' },
  'https://coaibuilds.com': { vercelProject: 'tradinglanding', githubRepo: 'jasonmanuel-cmd/tradinglanding' },
  'https://tandmbak.com': { vercelProject: 'tandm-hauling-bakersfield', githubRepo: 'jasonmanuel-cmd/tandm' },
  'https://williamdeanrealphotography.com': { vercelProject: 'williamdean', githubRepo: 'jasonmanuel-cmd/williamdean' },
  'https://poisonwellrecords.com': { vercelProject: 'poisonrecord', githubRepo: 'jasonmanuel-cmd/poisonrecord' },
  'https://homegrowmoney.com': { vercelProject: 'greenhome-6cx9', githubRepo: 'jasonmanuel-cmd/greenhome' },
  'https://callharbison.com': { vercelProject: 'hbh', githubRepo: 'jasonmanuel-cmd/HBH' },
  'https://aspen2homes.com': { vercelProject: 'aspen2-astro-preview', githubRepo: 'jasonmanuel-cmd/apen2website' },
  'https://mgsusa.llc': { vercelProject: 'mgsusa-llc', githubRepo: 'jasonmanuel-cmd/mgsusa.llc' },
}

const loadReal = () => readSites(path.resolve(__dirname, '../../sites.json'))

describe('the committed sites.json', () => {
  it('is valid per the registry rules', async () => {
    const sites = await loadReal()
    expect(sites.length).toBeGreaterThan(0)
    expect(new Set(sites.map(s => s.url)).size).toBe(sites.length)
  })

  it.each(Object.entries(VERIFIED))('%s points at its real Vercel project and repo', async (url, expected) => {
    const site = (await loadReal()).find(s => s.url === url)
    expect(site).toBeDefined()
    expect(site!.vercelProject).toBe(expected.vercelProject)
    expect(site!.githubRepo).toBe(expected.githubRepo)
  })

  it("monitors Phil's on its live domain, not the old one that has no DNS records", async () => {
    const sites = await loadReal()
    const urls = sites.map(s => s.url)
    expect(urls).not.toContain('https://phils-cheesesteaks-and-more.com')
    expect(sites.find(s => s.url === 'https://bakersfieldcheesesteak.com')?.name).toMatch(/Phil/)
  })

  it('has dropped the sites that were removed', async () => {
    const urls = (await loadReal()).map(s => s.url)
    expect(urls).not.toContain('https://edwinwardconsulting.com')
    expect(urls).not.toContain('https://dffbseniorliving.com')
  })

  it('has no site pointing at a domain that does not exist (callharbibson was a typo for callharbison)', async () => {
    const urls = (await loadReal()).map(s => s.url)
    expect(urls).not.toContain('https://callharbibson.com')
  })

  it('every vercelProject and githubRepo that is set is well-formed', async () => {
    for (const s of await loadReal()) {
      if (s.vercelProject !== undefined) expect(s.vercelProject).toMatch(/^[a-z0-9][a-z0-9._-]*$|^prj_[A-Za-z0-9]+$/)
      if (s.githubRepo !== undefined) expect(s.githubRepo).toMatch(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/)
    }
  })
})
