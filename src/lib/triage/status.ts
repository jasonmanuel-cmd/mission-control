export type PartStatus = 'ok' | 'warn' | 'fail' | 'nodata'

export interface TriagePart {
  status: PartStatus
  detail: string
  /** true when the part simply isn't set up (no key / no project / no monitor); not a problem to flag */
  unconfigured?: boolean
}

/** Worst of the parts: fail > warn > ok. nodata beside any real result counts as warn. */
export function worstStatus(parts: PartStatus[]): PartStatus {
  if (parts.includes('fail')) return 'fail'
  if (parts.includes('warn')) return 'warn'
  if (parts.every(p => p === 'nodata')) return 'nodata'
  if (parts.includes('nodata')) return 'warn'
  return 'ok'
}
