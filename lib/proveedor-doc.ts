import type { InvoiceLineItem } from './types'

// ── Types ──────────────────────────────────────────────────────────

export interface ProveedorDocItem {
  sku                : string
  nombre             : string
  cantidad_esperada  : number
  cantidad_recibida  : number
  cantidad          ?: number       // for vencidos / proximos — qty affected
  fecha_vencimiento ?: string       // for vencidos / proximos
  diferencia        ?: number       // for faltantes (faltan X) / sobrantes (sobran X)
}

export interface DocumentoProveedor {
  proveedor       : string
  nroComprobante  : string
  fechaFactura    : string          // DD/MM/YYYY
  fechaRecepcion  : string          // DD/MM/YYYY
  sucursal        : string
  vencidos        : ProveedorDocItem[]
  proximosAVencer : ProveedorDocItem[]
  faltantes       : ProveedorDocItem[]
  sobrantes       : ProveedorDocItem[]
}

// ── Builder ────────────────────────────────────────────────────────

const DIAS_PROXIMO_VENCIMIENTO = 10

export function buildDocumentoProveedor(
  items     : InvoiceLineItem[],
  meta      : { proveedor: string; nroComprobante: string; fechaFactura: string; sucursal: string },
): DocumentoProveedor {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const limit = new Date(today.getTime() + DIAS_PROXIMO_VENCIMIENTO * 24 * 60 * 60 * 1000)
  const limitISO = limit.toISOString().split('T')[0]

  const vencidos        : ProveedorDocItem[] = []
  const proximosAVencer : ProveedorDocItem[] = []
  const faltantes       : ProveedorDocItem[] = []
  const sobrantes       : ProveedorDocItem[] = []

  for (const item of items) {
    const sku    = item.producto_sku ?? item.sku_proveedor ?? '—'
    const nombre = item.producto_nombre ?? item.descripcion_proveedor ?? '(sin nombre)'

    // 1. Vencidos al llegar
    if (item.estado_recepcion === 'vencido_llegada') {
      const qty = item.cantidad_recibida > 0 ? item.cantidad_recibida : item.cantidad
      vencidos.push({
        sku, nombre,
        cantidad_esperada : item.cantidad,
        cantidad_recibida : item.cantidad_recibida,
        cantidad          : qty,
        fecha_vencimiento : item.fecha_vencimiento || undefined,
      })
    }

    // 2. Próximos a vencer (excluyendo los ya marcados vencidos al llegar)
    if (item.estado_recepcion !== 'vencido_llegada') {
      const fechas: { fecha: string; cantidad: number }[] =
        item.lotes.length > 0
          ? item.lotes
              .filter(l => l.fecha_vencimiento)
              .map(l => ({ fecha: l.fecha_vencimiento, cantidad: l.cantidad }))
          : (item.fecha_vencimiento
              ? [{ fecha: item.fecha_vencimiento, cantidad: item.cantidad_recibida }]
              : [])

      const proximas = fechas.filter(f => f.fecha <= limitISO)
      if (proximas.length > 0) {
        const earliest = proximas.reduce((a, b) => (a.fecha < b.fecha ? a : b))
        const totalProxima = proximas.reduce((s, p) => s + p.cantidad, 0)
        proximosAVencer.push({
          sku, nombre,
          cantidad_esperada : item.cantidad,
          cantidad_recibida : item.cantidad_recibida,
          cantidad          : totalProxima,
          fecha_vencimiento : earliest.fecha,
        })
      }
    }

    // 3. Faltantes
    if (item.cantidad_recibida < item.cantidad) {
      faltantes.push({
        sku, nombre,
        cantidad_esperada : item.cantidad,
        cantidad_recibida : item.cantidad_recibida,
        diferencia        : item.cantidad - item.cantidad_recibida,
      })
    }

    // 4. Sobrantes
    if (item.cantidad_recibida > item.cantidad) {
      sobrantes.push({
        sku, nombre,
        cantidad_esperada : item.cantidad,
        cantidad_recibida : item.cantidad_recibida,
        diferencia        : item.cantidad_recibida - item.cantidad,
      })
    }
  }

  return {
    proveedor       : meta.proveedor,
    nroComprobante  : meta.nroComprobante,
    fechaFactura    : meta.fechaFactura,
    fechaRecepcion  : new Date().toLocaleDateString('es-AR'),
    sucursal        : meta.sucursal,
    vencidos,
    proximosAVencer,
    faltantes,
    sobrantes,
  }
}

// ── Plain-text export (email / WhatsApp) ───────────────────────────

function formatDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

export function documentoProveedorToText(doc: DocumentoProveedor): string {
  const lines: string[] = []
  lines.push(`DOCUMENTO PARA PROVEEDOR — ${doc.proveedor || '(sin nombre)'}`)
  lines.push(`Factura: ${doc.nroComprobante || '—'}  |  Fecha factura: ${doc.fechaFactura || '—'}`)
  lines.push(`Sucursal: ${doc.sucursal}  |  Recepcionado: ${doc.fechaRecepcion}`)
  lines.push('')

  const totalNovedades =
    doc.vencidos.length + doc.proximosAVencer.length + doc.faltantes.length + doc.sobrantes.length

  if (totalNovedades === 0) {
    lines.push('Sin novedades — la recepción coincide con la factura.')
    return lines.join('\n')
  }

  if (doc.vencidos.length > 0) {
    lines.push(`PRODUCTOS VENCIDOS AL LLEGAR (${doc.vencidos.length}):`)
    for (const it of doc.vencidos) {
      const fechaTxt = it.fecha_vencimiento ? ` (venc. ${formatDate(it.fecha_vencimiento)})` : ''
      lines.push(`  · ${it.sku} — ${it.nombre} — ${it.cantidad ?? it.cantidad_recibida} ud${fechaTxt}`)
    }
    lines.push('')
  }

  if (doc.proximosAVencer.length > 0) {
    lines.push(`PRODUCTOS PRÓXIMOS A VENCER (${doc.proximosAVencer.length}):`)
    for (const it of doc.proximosAVencer) {
      const fechaTxt = it.fecha_vencimiento ? ` — vencen ${formatDate(it.fecha_vencimiento)}` : ''
      lines.push(`  · ${it.sku} — ${it.nombre} — ${it.cantidad ?? it.cantidad_recibida} ud${fechaTxt}`)
    }
    lines.push('')
  }

  if (doc.faltantes.length > 0) {
    lines.push(`PRODUCTOS FALTANTES (${doc.faltantes.length}):`)
    for (const it of doc.faltantes) {
      lines.push(`  · ${it.sku} — ${it.nombre} — esperado: ${it.cantidad_esperada}, recibido: ${it.cantidad_recibida} (faltan ${it.diferencia})`)
    }
    lines.push('')
  }

  if (doc.sobrantes.length > 0) {
    lines.push(`PRODUCTOS SOBRANTES (${doc.sobrantes.length}):`)
    for (const it of doc.sobrantes) {
      lines.push(`  · ${it.sku} — ${it.nombre} — esperado: ${it.cantidad_esperada}, recibido: ${it.cantidad_recibida} (sobran ${it.diferencia})`)
    }
    lines.push('')
  }

  lines.push('Quedamos a la espera de su respuesta para coordinar reposición / nota de crédito.')

  return lines.join('\n').trimEnd()
}

// ── PDF export ─────────────────────────────────────────────────────

export async function documentoProveedorToPDF(doc: DocumentoProveedor): Promise<void> {
  // Dynamic import so the bundle only loads when clicked
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()

  // ── Header ──────────────────────────────────
  pdf.setFillColor(245, 245, 245)
  pdf.rect(0, 0, pageW, 28, 'F')

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.setTextColor(30)
  pdf.text('SOHO', 14, 12)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(100)
  pdf.text('SHUK SRL', 14, 18)
  pdf.text('NATURAL CENTER', 14, 22)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(13)
  pdf.setTextColor(20)
  pdf.text('DOCUMENTO PARA PROVEEDOR', pageW - 14, 10, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.text(`Recepción: ${doc.fechaRecepcion}`, pageW - 14, 17, { align: 'right' })
  pdf.text(`Sucursal: ${doc.sucursal}`, pageW - 14, 22, { align: 'right' })

  // ── Provider info ───────────────────────────
  let y = 36
  pdf.setDrawColor(200)
  pdf.setLineWidth(0.3)
  pdf.rect(10, y - 4, pageW - 20, 16)

  pdf.setFontSize(9)
  pdf.setTextColor(30)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Proveedor:', 14, y)
  pdf.setFont('helvetica', 'normal')
  pdf.text(doc.proveedor || '—', 36, y)

  pdf.setFont('helvetica', 'bold')
  pdf.text('Factura:', 14, y + 6)
  pdf.setFont('helvetica', 'normal')
  pdf.text(doc.nroComprobante || '—', 36, y + 6)

  pdf.setFont('helvetica', 'bold')
  pdf.text('Fecha factura:', pageW / 2 + 10, y + 6)
  pdf.setFont('helvetica', 'normal')
  pdf.text(doc.fechaFactura || '—', pageW / 2 + 40, y + 6)

  y = 58

  const totalNovedades =
    doc.vencidos.length + doc.proximosAVencer.length + doc.faltantes.length + doc.sobrantes.length

  if (totalNovedades === 0) {
    pdf.setFontSize(11)
    pdf.setTextColor(80)
    pdf.text('Sin novedades — la recepción coincide con la factura.', 14, y)
    pdf.save(`documento-proveedor-${(doc.proveedor || 'sin-nombre').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`)
    return
  }

  function drawSection(
    title       : string,
    rows        : ProveedorDocItem[],
    columns     : string[],
    rowMapper   : (it: ProveedorDocItem) => string[],
    color       : [number, number, number],
  ) {
    if (rows.length === 0) return
    if (y > 250) { pdf.addPage(); y = 20 }

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.setTextColor(color[0], color[1], color[2])
    pdf.text(`${title} (${rows.length})`, 10, y)
    y += 3

    autoTable(pdf, {
      startY: y,
      head  : [columns],
      body  : rows.map(rowMapper),
      margin: { left: 10, right: 10 },
      styles: { fontSize: 8, cellPadding: 1.8, textColor: [30, 30, 30] },
      headStyles: { fillColor: color, textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 50, halign: 'right' },
      },
    })
    const last = (pdf as { lastAutoTable?: { finalY: number } }).lastAutoTable
    y = (last?.finalY ?? y) + 6
  }

  drawSection(
    'Vencidos al llegar',
    doc.vencidos,
    ['SKU', 'Producto', 'Cantidad / Vencimiento'],
    it => [
      it.sku,
      it.nombre,
      `${it.cantidad ?? it.cantidad_recibida} ud${it.fecha_vencimiento ? ` · venc. ${formatDate(it.fecha_vencimiento)}` : ''}`,
    ],
    [192, 57, 43],
  )

  drawSection(
    'Próximos a vencer',
    doc.proximosAVencer,
    ['SKU', 'Producto', 'Cantidad / Vencimiento'],
    it => [
      it.sku,
      it.nombre,
      `${it.cantidad ?? it.cantidad_recibida} ud${it.fecha_vencimiento ? ` · vencen ${formatDate(it.fecha_vencimiento)}` : ''}`,
    ],
    [211, 130, 30],
  )

  drawSection(
    'Faltantes',
    doc.faltantes,
    ['SKU', 'Producto', 'Esperado / Recibido (faltan)'],
    it => [
      it.sku,
      it.nombre,
      `${it.cantidad_esperada} / ${it.cantidad_recibida}  (faltan ${it.diferencia})`,
    ],
    [142, 68, 173],
  )

  drawSection(
    'Sobrantes',
    doc.sobrantes,
    ['SKU', 'Producto', 'Esperado / Recibido (sobran)'],
    it => [
      it.sku,
      it.nombre,
      `${it.cantidad_esperada} / ${it.cantidad_recibida}  (sobran ${it.diferencia})`,
    ],
    [39, 119, 75],
  )

  // Footer note
  if (y > 260) { pdf.addPage(); y = 20 }
  pdf.setFont('helvetica', 'italic')
  pdf.setFontSize(8)
  pdf.setTextColor(120)
  pdf.text(
    'Quedamos a la espera de su respuesta para coordinar reposición o nota de crédito.',
    10, y + 4,
  )

  pdf.save(`documento-proveedor-${(doc.proveedor || 'sin-nombre').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`)
}
