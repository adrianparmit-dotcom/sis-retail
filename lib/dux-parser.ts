import type { ParsedInvoice, ParsedInvoiceItem } from './types'

// Argentine number format: "1.234,56" → 1234.56
function parseArgNum(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0
}

// Matches Argentine number format: 24,00 / 1.234,56 / 253,08
function isArgNum(s: string): boolean {
  return /^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s) || /^\d+,\d+$/.test(s)
}

function parseItemLine(line: string): Omit<ParsedInvoiceItem, 'cantidad_recibida' | 'fecha_vencimiento' | 'estado_recepcion'> | null {
  const parts = line.trim().split(/\s+/)
  // Minimum: code + at least 1 desc word + 6 numbers = 8 parts
  if (parts.length < 8) return null
  // First token must be a numeric product code (4-6 digits)
  if (!/^\d{4,6}$/.test(parts[0])) return null

  const code = parts[0]
  const rest = parts.slice(1)

  // Take last 6 tokens as numeric fields; everything before is description
  const maybeNums = rest.slice(-6)
  if (!maybeNums.every(isArgNum)) return null

  const descripcion = rest.slice(0, rest.length - 6).join(' ').trim()
  if (!descripcion) return null

  const cantidad = Math.round(parseArgNum(maybeNums[0]))
  const precio_unitario = parseArgNum(maybeNums[1])

  return { codigo: code, descripcion, cantidad, precio_unitario }
}

export function parseDuxInvoice(text: string): ParsedInvoice {
  const lines = text.split('\n')

  let comprobante = ''
  let fecha = ''
  let proveedor = ''
  const items: ParsedInvoiceItem[] = []
  // Deduplicate repeated page headers by comprobante number
  const seenComprobantes = new Set<string>()
  let skipUntilNewComp = false

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    // Comprobante line: "Nº  FACT-B-0001-00012345" or "N°  X-0001-00012345"
    const matchComp = line.match(/^N[°º.]\s+(.+)$/i)
    if (matchComp) {
      const comp = matchComp[1].trim()
      if (seenComprobantes.has(comp)) {
        // Repeated page header — skip repeated header lines until items resume
        skipUntilNewComp = true
      } else {
        seenComprobantes.add(comp)
        if (!comprobante) comprobante = comp
        skipUntilNewComp = false
      }
      continue
    }

    // Fecha line
    const matchFecha = line.match(/^FECHA:\s*(\d{2}\/\d{2}\/\d{4})/i)
    if (matchFecha) {
      if (!fecha) fecha = matchFecha[1]
      continue
    }

    // Proveedor line
    const matchProv = line.match(/^PROVEEDOR:\s*(.+?)\s+IVA:/i)
    if (matchProv) {
      if (!proveedor) proveedor = matchProv[1].trim()
      continue
    }

    // Skip table header rows
    if (/^(C[oó]d|Descripci[oó]n|Cant|Precio|Subtotal)/i.test(line)) continue

    // Try to parse as item line (even during skipUntilNewComp — items resume right after header)
    const parsed = parseItemLine(line)
    if (parsed) {
      skipUntilNewComp = false
      items.push({
        ...parsed,
        cantidad_recibida: 0,
        fecha_vencimiento: '',
        estado_recepcion: 'ok',
      })
    }
  }

  return { comprobante, fecha, proveedor, items }
}

// Convert Dux date "DD/MM/YYYY" to ISO "YYYY-MM-DD"
export function duxDateToISO(duxDate: string): string {
  if (!duxDate) return ''
  const [d, m, y] = duxDate.split('/')
  if (!d || !m || !y) return ''
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}
