export interface ApiKeySet {
  pagespeed: string
  betterstack: string
  github: string
}

const STORAGE_KEY = 'commandCenterApiKeys'

const defaultKeys: ApiKeySet = {
  pagespeed: '',
  betterstack: '',
  github: '',
}

export function getApiKeys(): ApiKeySet {
  if (typeof window === 'undefined') return defaultKeys
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      // Only known keys: anything else left in browser storage from older versions is ignored.
      const parsed = JSON.parse(saved) as Partial<ApiKeySet>
      return {
        pagespeed: parsed.pagespeed ?? '',
        betterstack: parsed.betterstack ?? '',
        github: parsed.github ?? '',
      }
    }
  } catch {}
  return defaultKeys
}

export function saveApiKeys(keys: ApiKeySet): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
  }
}

export function hasAnyKey(): boolean {
  const keys = getApiKeys()
  return Object.values(keys).some(v => v.length > 0)
}
