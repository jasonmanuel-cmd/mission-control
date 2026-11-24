import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import path from 'path'

// Everything is hosted on Vercel. This guard keeps Netlify config, tokens and wording from creeping back in.
const WORD = new RegExp('net' + 'lify', 'i')
const ROOT = path.resolve(__dirname, '../..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

describe('no Netlify left in the app', () => {
  it('has no netlify config file', () => {
    expect(existsSync(path.join(ROOT, 'net' + 'lify.toml'))).toBe(false)
  })

  it('has no Netlify reference in source or top-level config', () => {
    const files = [
      ...walk(path.join(ROOT, 'src')).filter(f => !f.endsWith('noNetlify.test.ts')),
      ...['sites.json', 'README.md', '.env.example', 'package.json', 'vercel.json'].map(f => path.join(ROOT, f)),
    ].filter(existsSync)
    const offenders = files.filter(f => WORD.test(readFileSync(f, 'utf8'))).map(f => path.relative(ROOT, f))
    expect(offenders).toEqual([])
  })
})
