import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { readSites } from './sites'

const dir = mkdtempSync(path.join(tmpdir(), 'sites-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const write = (name: string, content: string) => {
  const p = path.join(dir, name)
  writeFileSync(p, content)
  return p
}
const site = (i: number) => ({ id: `s${i}`, name: `Site ${i}`, url: `https://s${i}.com` })

describe('readSites', () => {
  it('parses a valid array', async () => {
    const sites = await readSites(write('ok.json', JSON.stringify([site(1), site(2)])))
    expect(sites.map(s => s.id)).toEqual(['s1', 's2'])
  })
  it('returns [] for an empty array', async () => {
    expect(await readSites(write('empty.json', '[]'))).toEqual([])
  })
  it('throws sites.json: on malformed JSON', async () => {
    await expect(readSites(write('bad.json', '{nope'))).rejects.toThrow(/^sites\.json:/)
  })
  it('throws sites.json: when the file is missing', async () => {
    await expect(readSites(path.join(dir, 'missing.json'))).rejects.toThrow(/^sites\.json:/)
  })
  it('throws when not an array', async () => {
    await expect(readSites(write('obj.json', '{}'))).rejects.toThrow(/^sites\.json:/)
  })
  it('throws on duplicate id', async () => {
    await expect(readSites(write('dup.json', JSON.stringify([site(1), site(1)])))).rejects.toThrow(/duplicate/i)
  })
  it('throws on more than 20 sites', async () => {
    const many = Array.from({ length: 21 }, (_, i) => site(i))
    await expect(readSites(write('many.json', JSON.stringify(many)))).rejects.toThrow(/20/)
  })
  it('throws when url is missing', async () => {
    await expect(readSites(write('nourl.json', JSON.stringify([{ id: 'a', name: 'A' }])))).rejects.toThrow(/url/)
  })
  it('throws when name is missing', async () => {
    await expect(readSites(write('noname.json', JSON.stringify([{ id: 'a', url: 'https://a.com' }])))).rejects.toThrow(/name/)
  })
})
