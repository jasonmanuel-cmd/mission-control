export type PartStatus = 'ok' | 'warn' | 'fail' | 'nodata'

export interface TriagePart {
  status: PartStatus
  detail: string
}

/** Worst of the parts: fail > warn > ok. nodata beside any real result counts as warn. */
export function worstStatus(parts: PartStatus[]): PartStatus {
  if (parts.includes('fail')) return 'fail'
  if (parts.includes('warn')) return 'warn'
  if (parts.every(p => p === 'nodata')) return 'nodata'
  if (parts.includes('nodata')) return 'warn'
  return 'ok'
}
