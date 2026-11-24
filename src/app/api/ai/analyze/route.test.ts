import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'

const call = () => GET(new Request('http://localhost/api/ai/analyze?siteId=a&url=https://a.com'))
const dump = async (res: Response) => JSON.stringify(await res.json())

describe('GET /api/ai/analyze recommends Vercel, not another host', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('an unreachable site points at Vercel deployment logs and DNS', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND')))
    const text = await dump(await call())
    expect(text).toMatch(/Vercel/)
    expect(text).not.toMatch(/net.?lify/i)
  })

  it('missing security headers are fixed in vercel.json with a valid headers block', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html><head><title>x</title></head><body>hi</body></html>', { status: 200 })))
    const res = await call()
    const body = await res.json()
    const issues: any[] = body.recommendations ?? body.issues ?? body.fixes ?? []
    const text = JSON.stringify(body)
    expect(text).not.toMatch(/net.?lify/i)
    expect(text).toContain('vercel.json')
    const csp = issues.find(i => i.id === 'sec-no-csp')
    expect(csp?.fix.filePath).toBe('vercel.json')
    expect(csp?.fix.codeSnippet).toContain('"headers"')
    expect(csp?.fix.codeSnippet).toContain('Content-Security-Policy')
  })

  it('every vercel.json snippet is strict JSON with a headers block', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html><head><title>x</title></head><body>hi</body></html>', { status: 200 })))
    const body = await (await call()).json()
    const issues: any[] = body.issues
    const headerFixes = issues.filter(i => ['sec-no-csp', 'sec-no-hsts', 'sec-no-xframe'].includes(i.id))
    expect(headerFixes.map(i => i.id).sort()).toEqual(['sec-no-csp', 'sec-no-hsts', 'sec-no-xframe'])
    for (const issue of headerFixes) {
      expect(issue.fix.filePath).toBe('vercel.json')
      const parsed = JSON.parse(issue.fix.codeSnippet) // throws on comments or fragments
      expect(Array.isArray(parsed.headers)).toBe(true)
      expect(parsed.headers[0].source).toBe('/(.*)')
      expect(parsed.headers[0].headers[0]).toEqual({ key: expect.any(String), value: expect.any(String) })
    }
    expect(headerFixes.find(i => i.id === 'sec-no-xframe')!.fix.codeSnippet).toContain('X-Frame-Options')
  })

  it('the CSP advice warns that Vercel analytics and the toolbar need allowing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html><head><title>x</title></head><body>hi</body></html>', { status: 200 })))
    const body = await (await call()).json()
    const csp = body.issues.find((i: any) => i.id === 'sec-no-csp')
    expect(csp.aiSuggestion).toMatch(/vercel-scripts\.com|analytics|Speed Insights/i)
  })
})
