/**
 * invoice-parsers.ts
 * PDF text parsers for the 3 main SOHO suppliers.
 * All PDFs are text-based (no OCR needed) — user copies text from PDF and pastes it.
 *
 * Suppliers:
 *  - Diet / Mayordiet  (ARCA/Jazz format, 8+ pages, ~200 items)
 *  - Ankas del Sur     (custom 1-page format, ~13 items, no codes)
 *  - EPN / Mayorista   (Tango format, 4 pages, mixed EAN + internal codes)
 */

import type { InvoiceLineItem, ParsedFactura, ProveedorType } from './types'

// ─── helpers ────────────────────────────────────────────────────────

/** "1.234,56" → 1234.56 */
function parseArgNum(s: string): number {
  const cleaned = s.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

/** Is a string a numeric Argentine-format number? e.g. "1.234,56" or "10,00" */
function isArgNum(s: string): boolean {
  return /^\d{1,3}(\.\d{3})*(,\d{1,4})?$/.test(s) || /^\d+(,\d{1,4})?$/.test(s)
}

/** Is this an EAN barcode? (13-digit all-numeric) */
function isEAN13(s: string): boolean {
  return /^\d{13}$/.test(s)
}

/** Is this a Diet internal code? (4–6 digit numeric) */
function isDietCode(s: string): boolean {
  return /^\d{4,6}$/.test(s)
}

/** Is this an EPN internal code? (alphanumeric with dashes, e.g. GEO-VIT-C, Ultratech-XXX) */
function isEPNCode(s: string): boolean {
  return /^[A-Za-z][A-Za-z0-9\-_]{2,}$/.test(s)
}

function makeBlankItem(override?: Partial<InvoiceLineItem>): InvoiceLineItem {
  return {
    sku_proveedor         : '',
    descripcion_proveedor : '',
    cantidad              : 0,
    costo_unitario        : 0,
    iva_porcentaje        : 21,
    precio_venta_sugerido : 0,
    match_confidence      : 'sin_match',
    cantidad_recibida     : 0,
    fecha_vencimiento     : '',
    estado_recepcion      : 'ok',
    es_blister            : false,
    unidades_por_blister  : 1,
    es_granel             : false,
    lotes                 : [],
    ...override,
  }
}

function detectBlister(nombre: string): boolean {
  return /^BLISTER\s/i.test(nombre.trim())
}

// ─── AUTO-DETECT supplier ────────────────────────────────────────

/**
 * Tries to detect which supplier format the text belongs to.
 * Returns 'otro' if it can't decide.
 */
export function detectProveedorType(text: string): ProveedorType {
  const upper = text.toUpperCase()
  if (upper.includes('MAYORDIET') || upper.includes('JAZZ') || upper.includes('ARCA SA')) return 'diet'
  if (upper.includes('ANKAS DEL SUR') || upper.includes('ANKAS')) return 'ankas'
  if (upper.includes('MAYORISTA') && (upper.includes('EPN') || upper.includes('EUROFARMA') || upper.includes('TANGO'))) return 'epn'
  // Tango format signature: presence of "REMITO" or "Artículo" column header
  if (upper.includes('ARTÍCULO') || upper.includes('ARTICULO') && upper.includes('BONIF')) return 'epn'
  return 'otro'
}

// ─── DIET / MAYORDIET PARSER ─────────────────────────────────────
/**
 * ARCA/Jazz format.
 * Line format (approx):
 *   CODIGO  [**]DESCRIPCION        BON_PCT  CANT  P.UNIT  IMPORTE
 *   12345   PRODUCTO NORMAL        00,00    10    100,00  1.000,00
 *   12346   **PRODUCTO IVA 10.5   00,00     5    200,00  1.000,00
 *
 * Rules:
 *  - Line starts with a 4–6 digit code
 *  - If description starts with ** → IVA 10.5%, else 21%
 *  - BON column: e.g. "05,00" = 5% bonif (already in IMPORTE, so we just use IMPORTE/CANT)
 *  - Net cost = IMPORTE / CANT
 */
export function parseDiet(text: string): ParsedFactura {
  const lines = text.split('\n')
  let comprobante = ''
  let fecha = ''
  let proveedor = 'MAYORDIET'
  const items: InvoiceLineItem[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    // Comprobante
    if (!comprobante) {
      const m = line.match(/(?:factura|comprobante)[:\s]+[A-Z]\s+(\d{4,5}-\d{6,10})/i)
             ?? line.match(/N[°º]\s*[A-Z]?\s*(\d{4,5}[-–]\d{6,10})/i)
      if (m) { comprobante = m[1]; continue }
    }

    // Fecha
    if (!fecha) {
      const m = line.match(/(\d{2}\/\d{2}\/\d{4})/)
      if (m) { fecha = m[1] }
    }

    // Proveedor
    if (line.match(/mayordiet|dietmar|jazz/i)) {
      const m = line.match(/(?:proveedor|razón social)[:\s]+(.+)/i)
      if (m) proveedor = m[1].trim()
    }

    // Skip obvious header lines
    if (/^(c[oó]d|descripci|cant|precio|importe|bon|subtotal|total|iva|p\.unit|art[íi]culo)/i.test(line)) continue
    if (/^(factura|fecha|razón|razón|cuit|cliente|vendedor|orden)/i.test(line)) continue

    // Parse item line
    const parts = line.split(/\s+/)
    if (parts.length < 4) continue

    // Must start with a numeric Diet code
    if (!isDietCode(parts[0])) continue

    const code = parts[0]
    const rest = parts.slice(1)

    // Try to extract last 3 numeric fields: BON, CANT, P.UNIT (or CANT, P.UNIT, IMPORTE)
    // Then IMPORTE is always last
    // Pattern: [...desc...] [BON?] [CANT] [P.UNIT] [IMPORTE]
    // We read from right: IMPORTE, P.UNIT, CANT, then maybe BON

    // Find trailing numbers
    const trailingNums: string[] = []
    let descEnd = rest.length
    for (let i = rest.length - 1; i >= 0; i--) {
      if (isArgNum(rest[i])) {
        trailingNums.unshift(rest[i])
        descEnd = i
      } else {
        break
      }
    }

    // Need at least 3 trailing nums: CANT, P.UNIT, IMPORTE (BON is optional)
    if (trailingNums.length < 3) continue

    const importe  = parseArgNum(trailingNums[trailingNums.length - 1])
    const punit    = parseArgNum(trailingNums[trailingNums.length - 2])
    const cant     = Math.round(parseArgNum(trailingNums[trailingNums.length - 3]))

    if (cant <= 0 || importe <= 0) continue

    let descParts = rest.slice(0, descEnd)

    // Check ** IVA indicator (can appear at start of desc or as separate token)
    let iva = 21
    let descStr = descParts.join(' ').trim()

    // Diet uses ** at start of description for 10.5% IVA
    if (descStr.startsWith('**') || descStr.startsWith('* *')) {
      iva = 10.5
      descStr = descStr.replace(/^\*+\s*/, '').trim()
    }

    if (!descStr) continue

    const costoUnitario = importe / cant

    items.push(makeBlankItem({
      sku_proveedor         : code,
      descripcion_proveedor : descStr,
      cantidad              : cant,
      costo_unitario        : costoUnitario,
      iva_porcentaje        : iva,
      cantidad_recibida     : cant,
      es_blister            : detectBlister(descStr),
    }))
  }

  return { proveedor_nombre: proveedor, proveedor_type: 'diet', nro_comprobante: comprobante, fecha, items }
}

// ─── ANKAS DEL SUR PARSER ────────────────────────────────────────
/**
 * Custom 1-page format. No product codes.
 * Line format (approx):
 *   DESCRIPCION                CANT    PRECIO    IMPORTE    IVA%
 *   PRODUCTO A                 10      100,00    1.000,00   21.00
 *   PRODUCTO B                  5      200,00    1.000,00   10.50
 *
 * Rules:
 *  - No codes — matching is by name only
 *  - IVA column is the last field (21.00 or 10.50)
 *  - Net cost = IMPORTE / CANT (no bonif)
 */
export function parseAnkas(text: string): ParsedFactura {
  const lines = text.split('\n')
  let comprobante = ''
  let fecha = ''
  const proveedor = 'ANKAS DEL SUR'
  const items: InvoiceLineItem[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (!comprobante) {
      const m = line.match(/(?:factura|comprobante)[:\s]+[A-Z]\s*(\d{4,5}[-–]\d{6,10})/i)
             ?? line.match(/N[°º]\s*[A-Z]?\s*(\d{4,5}[-–]\d{6,10})/i)
      if (m) { comprobante = m[1]; continue }
    }

    if (!fecha) {
      const m = line.match(/(\d{2}\/\d{2}\/\d{4})/)
      if (m) { fecha = m[1] }
    }

    if (/^(descripci|cant|precio|importe|iva|subtotal|total|fecha|factura|cuit|razón|cliente)/i.test(line)) continue

    const parts = line.split(/\s+/)
    if (parts.length < 4) continue

    // The first token must NOT be a number (no code column in Ankas)
    if (/^\d/.test(parts[0]) && parts[0].length < 4) continue

    // Read trailing nums from right: IVA%, IMPORTE, PRECIO, CANT
    const trailingNums: string[] = []
    let descEnd = parts.length
    for (let i = parts.length - 1; i >= 0; i--) {
      const tok = parts[i]
      // IVA% may appear as "21.00" or "21,00" or "10.50" or "10,50"
      if (isArgNum(tok) || /^\d+[.,]\d{1,2}$/.test(tok)) {
        trailingNums.unshift(tok)
        descEnd = i
      } else {
        break
      }
    }

    // Need at least 4: CANT, PRECIO, IMPORTE, IVA
    if (trailingNums.length < 4) continue

    // Last is IVA%, then IMPORTE, P.UNIT, CANT
    const ivaStr   = trailingNums[trailingNums.length - 1]
    const importe  = parseArgNum(trailingNums[trailingNums.length - 2])
    // const punit = parseArgNum(trailingNums[trailingNums.length - 3]) // unused
    const cant     = Math.round(parseArgNum(trailingNums[trailingNums.length - 4]))

    if (cant <= 0 || importe <= 0) continue

    const descStr = parts.slice(0, descEnd).join(' ').trim()
    if (!descStr || descStr.length < 3) continue

    // Parse IVA — "21.00" or "21,00" → 21; "10.50" or "10,50" → 10.5
    const ivaN = parseFloat(ivaStr.replace(',', '.'))
    const iva  = (ivaN > 15) ? 21 : 10.5

    items.push(makeBlankItem({
      sku_proveedor         : '',                   // no code
      descripcion_proveedor : descStr,
      cantidad              : cant,
      costo_unitario        : importe / cant,
      iva_porcentaje        : iva,
      cantidad_recibida     : cant,
      es_blister            : detectBlister(descStr),
    }))
  }

  return { proveedor_nombre: proveedor, proveedor_type: 'ankas', nro_comprobante: comprobante, fecha, items }
}

// ─── EPN / MAYORISTA PARSER ──────────────────────────────────────
/**
 * Tango ERP format.
 * Line format (approx):
 *   ARTICULO        DESCRIPCION               CANT  P.UNIT   BONIF%   NETO       IVA%
 *   GEO-VIT-C       VITAMINA C 60 CAPS         12   100,00   0,26%    1.196,81   21%
 *   7798357570125   PRODUCTO CON BARCODE         5    50,00   0,26%      249,35   21%
 *
 * Rules:
 *  - Code is alphanumeric (internal) or 13-digit EAN
 *  - All items IVA 21% (Ankas-style mixing is not present here)
 *  - 0.26% bonif already embedded in NETO column → use NETO / CANT as cost
 */
export function parseEPN(text: string): ParsedFactura {
  const lines = text.split('\n')
  let comprobante = ''
  let fecha = ''
  let proveedor = 'EPN MAYORISTA'
  const items: InvoiceLineItem[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (!comprobante) {
      const m = line.match(/(?:factura|comprobante)[:\s]+[A-Z]?\s*(\d{4,5}[-–]\d{6,10})/i)
             ?? line.match(/N[°º]\s*[A-Z]?\s*(\d{4,5}[-–]\d{6,10})/i)
      if (m) { comprobante = m[1]; continue }
    }

    if (!fecha) {
      const m = line.match(/(\d{2}\/\d{2}\/\d{4})/)
      if (m) { fecha = m[1] }
    }

    // Detect proveedor name from header
    if (line.match(/mayorista|epn/i) && !line.match(/^(total|subtotal|iva)/i)) {
      const m = line.match(/(?:proveedor|razón social|empresa)[:\s]+(.+)/i)
      if (m) proveedor = m[1].trim()
    }

    // Skip header/footer lines
    if (/^(art[íi]culo|descripci|cant|precio|bonif|neto|iva|subtotal|total|fecha|factura|cuit|razón|cliente)/i.test(line)) continue

    const parts = line.split(/\s+/)
    if (parts.length < 4) continue

    // First token must be a code: either EAN13 or alphanumeric
    const codeCandidate = parts[0]
    if (!isEAN13(codeCandidate) && !isEPNCode(codeCandidate)) continue

    // Read trailing nums: IVA%, NETO, BONIF%, P.UNIT, CANT (right to left)
    const trailingNums: string[] = []
    let descEnd = parts.length
    for (let i = parts.length - 1; i >= 1; i--) {
      const tok = parts[i].replace('%', '')
      if (isArgNum(tok)) {
        trailingNums.unshift(parts[i])
        descEnd = i
      } else {
        break
      }
    }

    // Need at least 5: CANT, P.UNIT, BONIF%, NETO, IVA%
    if (trailingNums.length < 4) continue

    // From right: [IVA%?, NETO, BONIF%?, P.UNIT?, CANT?]
    // Flexible: last is IVA (may end with %), second last is NETO
    const netoStr  = trailingNums[trailingNums.length - 2].replace('%', '')
    const cantStr  = trailingNums[0].replace('%', '')

    const neto = parseArgNum(netoStr)
    const cant = Math.round(parseArgNum(cantStr))

    if (cant <= 0 || neto <= 0) continue

    const descStr = parts.slice(1, descEnd).join(' ').trim()
    if (!descStr) continue

    items.push(makeBlankItem({
      sku_proveedor         : codeCandidate,
      descripcion_proveedor : descStr,
      cantidad              : cant,
      costo_unitario        : neto / cant,
      iva_porcentaje        : 21,
      cantidad_recibida     : cant,
      es_blister            : detectBlister(descStr),
    }))
  }

  return { proveedor_nombre: proveedor, proveedor_type: 'epn', nro_comprobante: comprobante, fecha, items }
}

// ─── MAIN ENTRY POINT ────────────────────────────────────────────

/**
 * Parse invoice text for the given supplier type.
 * Pass 'auto' to auto-detect the supplier from the text.
 */
export function parseFactura(text: string, tipo?: ProveedorType | 'auto'): ParsedFactura {
  const resolvedTipo = (!tipo || tipo === 'auto') ? detectProveedorType(text) : tipo

  switch (resolvedTipo) {
    case 'diet' : return parseDiet(text)
    case 'ankas': return parseAnkas(text)
    case 'epn'  : return parseEPN(text)
    default:
      // Generic fallback: try Diet parser (it's the most structured)
      return parseDiet(text)
  }
}

/** Apply margin to calculate suggested sale price */
export function calcPrecioVenta(costo: number, margen: number): number {
  if (!margen || margen <= 0) return 0
  return Math.round(costo * (1 + margen) * 100) / 100
}

/**
 * Simple word-overlap score for fuzzy name matching.
 * Returns a value 0–1. Higher = better match.
 */
export function nameMatchScore(a: string, b: string): number {
  const tokenize = (s: string) =>
    s.toUpperCase()
     .replace(/[^A-Z0-9\s]/g, ' ')
     .split(/\s+/)
     .filter(t => t.length > 2)

  const ta = new Set(tokenize(a))
  const tb = new Set(tokenize(b))
  if (ta.size === 0 || tb.size === 0) return 0

  let overlap = 0
  for (const t of ta) if (tb.has(t)) overlap++
  return overlap / Math.max(ta.size, tb.size)
}
