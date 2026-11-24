import { describe, it, expect, vi } from 'vitest'
import { checkVercelDeploy } from './vercel'

const dep = (state: string, extra: any = {}) => ({
  deployments: [{ state, created: 1700000000000, meta: { githubCommitSha: 'abc1234', githubCommitMessage: 'fix nav' }, ...extra }],
})
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status })
const env = { token: 'tok' }

describe('checkVercelDeploy', () => {
  it('READY -> ok with commit info', async () => {
    const f = vi.fn().mockResolvedValue(json(dep('READY')))
    const r = await checkVercelDeploy('my-proj', env, f as any)
    expect(r.status).toBe('ok')
    expect(r.sha).toBe('abc1234')
    expect(r.message).toBe('fix nav')
  })

  it.each(['BUILDING', 'QUEUED', 'INITIALIZING', 'CANCELED'])('%s -> warn', async state => {
    const r = await checkVercelDeploy('p', env, vi.fn().mockResolvedValue(json(dep(state))) as any)
    expect(r.status).toBe('warn')
  })

  it('ERROR -> fail and includes errorMessage', async () => {
    const r = await checkVercelDeploy('p', env, vi.fn().mockResolvedValue(json(dep('ERROR', { errorMessage: 'Build failed' }))) as any)
    expect(r.status).toBe('fail')
    expect(r.detail).toContain('Build failed')
  })

  it('no project -> nodata', async () => {
    const r = await checkVercelDeploy(undefined, env, vi.fn() as any)
    expect(r.status).toBe('nodata')
    expect(r.detail).toMatch(/no vercelProject/)
  })

  it('no token -> nodata', async () => {
    const r = await checkVercelDeploy('p', {}, vi.fn() as any)
    expect(r.status).toBe('nodata')
    expect(r.detail).toMatch(/VERCEL_TOKEN not set/)
  })

  it.each([404, 403])('HTTP %i -> nodata with status', async code => {
    const r = await checkVercelDeploy('p', env, vi.fn().mockResolvedValue(json({}, code)) as any)
    expect(r.status).toBe('nodata')
    expect(r.detail).toContain(String(code))
  })

  it('empty deployments -> nodata', async () => {
    const r = await checkVercelDeploy('p', env, vi.fn().mockResolvedValue(json({ deployments: [] })) as any)
    expect(r.status).toBe('nodata')
  })

  it('network error -> nodata with message', async () => {
    const r = await checkVercelDeploy('p', env, vi.fn().mockRejectedValue(new Error('boom')) as any)
    expect(r.status).toBe('nodata')
    expect(r.detail).toContain('boom')
  })

  it('sends bearer token, projectId, limit and teamId', async () => {
    const f = vi.fn().mockResolvedValue(json(dep('READY')))
    await checkVercelDeploy('my-proj', { token: 'tok', teamId: 'team_1' }, f as any)
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('https://api.vercel.com/v6/deployments')
    expect(url).toContain('projectId=my-proj')
    expect(url).toContain('limit=1')
    expect(url).toContain('teamId=team_1')
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('no project / no token are marked unconfigured; API errors are not', async () => {
    expect((await checkVercelDeploy(undefined, env, vi.fn() as any)).unconfigured).toBe(true)
    expect((await checkVercelDeploy('p', {}, vi.fn() as any)).unconfigured).toBe(true)
    expect((await checkVercelDeploy('p', env, vi.fn().mockResolvedValue(json({}, 403)) as any)).unconfigured).toBeFalsy()
  })

  it('a hanging request times out to nodata instead of hanging', async () => {
    const hang = (_u: any, init: any) =>
      new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    const r = await checkVercelDeploy('p', env, hang as any, 20)
    expect(r.status).toBe('nodata')
    expect(r.detail).toMatch(/timeout/i)
  })
})
