/**
 * Hoy en formato YYYY-MM-DD usando la zona horaria LOCAL.
 * No usar `new Date().toISOString().split('T')[0]` para "hoy": eso devuelve la
 * fecha UTC, que en Argentina (UTC-3) ya es "mañana" a partir de las 21:00.
 */
export function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

