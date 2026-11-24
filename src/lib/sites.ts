import { readFile } from 'fs/promises'
import path from 'path'
import type { SiteConfig } from './siteConfig'

const MAX_SITES = 20
const DEFAULT_PATH = path.join(process.cwd(), 'sites.json')

/** Read and validate the committed site registry. Throws Error('sites.json: ...') on any problem. */
export async function readSites(filePath: string = DEFAULT_PATH): Promise<SiteConfig[]> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err: any) {
    throw new Error(`sites.json: cannot read file (${err?.code ?? err?.message})`)
  }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (err: any) {
    throw new Error(`sites.json: invalid JSON (${err?.message})`)
  }

  if (!Array.isArray(data)) throw new Error('sites.json: must be an array of sites')
  if (data.length > MAX_SITES) throw new Error(`sites.json: at most ${MAX_SITES} sites allowed, found ${data.length}`)

  const seen = new Set<string>()
  data.forEach((s: any, i: number) => {
    for (const field of ['id', 'name', 'url'] as const) {
      if (typeof s?.[field] !== 'string' || !s[field].trim()) {
        throw new Error(`sites.json: site #${i + 1} is missing "${field}"`)
      }
    }
    if (seen.has(s.id)) throw new Error(`sites.json: duplicate id "${s.id}"`)
    seen.add(s.id)
  })

  return data as SiteConfig[]
}
