/** Format a number as Argentine pesos */
export function formatPesos(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

/** Format a number with thousands separator */
export function formatNum(value: number, decimals = 0): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

/** Format a date string (YYYY-MM-DD) to DD/MM/YYYY */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'
  const [y, m, d] = isoDate.split('-')
  return `${d}/${m}/${y}`
}

/** Format a datetime string to DD/MM HH:mm */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

/** Format days of coverage */
export function formatDias(dias: number | null | undefined): string {
  if (dias === null || dias === undefined) return '—'
  if (dias > 365) return '+1 año'
  if (dias > 90) return `${Math.round(dias / 30)}m`
  return `${Math.round(dias)}d`
}

/** Format a percentage */
export function formatPct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

/** Truncate a string to maxLen chars */
export function truncate(str: string | null | undefined, maxLen = 40): string {
  if (!str) return ''
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str
}
