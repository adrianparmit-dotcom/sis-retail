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

// Palabras que quedan en minúscula salvo que abran el nombre.
const MINOR_WORDS = new Set(['de','del','la','las','el','los','con','sin','por','y','e','a','en','al','x','o','u'])

// Siglas que NUNCA se acentúan a Título: formas societarias argentinas y
// etiquetas de canal/rubro. Sin "Shuk SRL" terminaría como "Shuk Srl".
// Se comparan sin puntos, así "S.R.L." entra por la misma puerta que "SRL".
const KEEP_UPPER = new Set([
  'SRL', 'SA', 'SAS', 'SH', 'SCA', 'SPA', 'SL',
  'SACIF', 'SACI', 'SAIC', 'SAICF', 'SRLU',
  'ECOM', 'TACC', 'IVA', 'CUIT', 'SKU', 'ONG',
])

/**
 * Pasa un nombre de producto o proveedor de Dux (que viene TODO EN MAYÚSCULAS)
 * a Título Amigable. Además de leerse mejor, ocupa menos ancho: entra más
 * texto antes de que la celda tenga que recortar.
 */
export function toTitleCase(str: string): string {
  return str.toLowerCase().split(' ').map((w, i) => {
    if (w.length === 0) return w
    if (KEEP_UPPER.has(w.replace(/\./g, '').toUpperCase())) return w.toUpperCase()
    if (MINOR_WORDS.has(w) && i > 0) return w
    return w.charAt(0).toUpperCase() + w.slice(1)
  }).join(' ')
}

/** Format a datetime string to DD/MM HH:mm */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

