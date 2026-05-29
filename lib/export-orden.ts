import type { ProductoCompra } from './types'

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function sugerenciaEfectiva(p: ProductoCompra): number {
  if (p.es_granel) {
    // Para granel usamos sugerencia_kg (ya tiene ceil y mínimo 1kg desde 500g)
    return p.sugerencia_kg ?? 0
  }
  if (p.sugerencia_compra > 0) return p.sugerencia_compra
  if (p.ventas_30d === 0 && p.stock_actual === 0) return 4
  return 0
}

function unidadMedida(p: ProductoCompra): string {
  if (p.es_granel) return 'KG'
  return 'UNIDAD'
}

function calcIVA(p: ProductoCompra, cant: number): number {
  if (!p.costo || !p.iva_porcentaje) return 0
  const subtotal = cant * p.costo
  return Math.round(subtotal * (p.iva_porcentaje / 100) * 100) / 100
}

// Group rows by provider, only those with a suggestion
function groupByProvider(rows: ProductoCompra[]): Map<string, ProductoCompra[]> {
  const map = new Map<string, ProductoCompra[]>()
  const sorted = [...rows].sort((a, b) => {
    const pa = a.proveedor_nombre ?? 'ZZZ'
    const pb = b.proveedor_nombre ?? 'ZZZ'
    return pa.localeCompare(pb, 'es') || a.sku.localeCompare(b.sku)
  })
  for (const p of sorted) {
    const sug = sugerenciaEfectiva(p)
    if (sug <= 0) continue
    const prov = p.proveedor_nombre ?? 'Sin proveedor'
    if (!map.has(prov)) map.set(prov, [])
    map.get(prov)!.push(p)
  }
  return map
}

// ─────────────────────────────────────────────────────
// CSV Export — Orden de Compra format
// ─────────────────────────────────────────────────────

function esc(val: string | number): string {
  const s = String(val)
  if (s.includes(';') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function exportOrdenCSV(rows: ProductoCompra[]) {
  const groups = groupByProvider(rows)
  const fecha = todayStr()
  const lines: string[] = ['sep=;']

  lines.push(esc('ORDEN DE COMPRA — SOHO') + ';' + esc(`FECHA: ${fecha}`) + ';' + ';'.repeat(7))
  lines.push(';'.repeat(9))

  for (const [proveedor, items] of groups) {
    // Provider header
    lines.push(esc(`PROVEEDOR: ${proveedor}`) + ';' + ';'.repeat(8))
    lines.push('')

    // Column headers
    lines.push(['Código', 'Descripción', 'Cant.', 'Unidad medida', 'Precio unitario', '% desc.', 'Subtotal', 'IVA', 'Subt. c/IVA']
      .map(esc).join(';'))

    let subtotal = 0
    let totalIVA = 0

    for (const p of items) {
      const cant = sugerenciaEfectiva(p)
      const precioUnit = p.costo ?? 0
      const sub = cant * precioUnit
      const iva = calcIVA(p, cant)
      const subConIVA = sub + iva
      subtotal += sub
      totalIVA += iva

      lines.push([
        p.sku,
        p.nombre ?? '',
        cant,
        unidadMedida(p),
        precioUnit.toFixed(2),
        '0',
        sub.toFixed(2),
        iva.toFixed(2),
        subConIVA.toFixed(2),
      ].map(esc).join(';'))
    }

    // Totals
    lines.push(';'.repeat(9))
    lines.push(`;SUBTOTAL;;;;;;${subtotal.toFixed(2)};;${subtotal.toFixed(2)}`)
    lines.push(`;MONTO IVA;;;;;;${totalIVA.toFixed(2)};;${totalIVA.toFixed(2)}`)
    lines.push(`;TOTAL;;;;;;${(subtotal + totalIVA).toFixed(2)};;${(subtotal + totalIVA).toFixed(2)}`)
    lines.push(';'.repeat(9))
    lines.push('')
  }

  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `orden-compra-soho-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─────────────────────────────────────────────────────
// PDF Export — Orden de Compra per provider
// ─────────────────────────────────────────────────────

export async function exportOrdenPDF(rows: ProductoCompra[]) {
  // Dynamic import so the 300KB bundle only loads when clicked
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const groups = groupByProvider(rows)
  const fecha = todayStr()

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let firstPage = true

  for (const [proveedor, items] of groups) {
    if (!firstPage) doc.addPage()
    firstPage = false

    const pageW = doc.internal.pageSize.getWidth()

    // ── Header bar ──────────────────────────────────
    doc.setFillColor(245, 245, 245)
    doc.rect(0, 0, pageW, 28, 'F')

    // Left: company name
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.setTextColor(30, 30, 30)
    doc.text('SOHO', 14, 12)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text('SHUK SRL', 14, 18)
    doc.text('NATURAL CENTER', 14, 22)

    // Center: "X" box (comprobante type)
    doc.setDrawColor(180)
    doc.setLineWidth(0.5)
    doc.rect(pageW / 2 - 8, 4, 16, 16)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(30)
    doc.text('X', pageW / 2, 14, { align: 'center' })

    // Right: title + N° + fecha
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(20)
    doc.text('ORDEN DE COMPRA', pageW - 14, 9, { align: 'right' })
    doc.setFontSize(10)
    doc.text(`FECHA: ${fecha}`, pageW - 14, 16, { align: 'right' })

    // ── Provider info section ────────────────────────
    const y = 34

    doc.setDrawColor(200)
    doc.setLineWidth(0.3)
    doc.rect(10, y - 3, pageW - 20, 38)

    const leftX = 14
    const rightX = pageW / 2 + 4
    const lineH = 6

    const infoLeft = [
      ['PROVEEDOR:', proveedor],
      ['DIRECCIÓN:', ''],
      ['TELÉFONO:', ''],
      ['MONEDA:', 'PESOS'],
      ['FECHA ENTREGA:', ''],
      ['LUGAR ENTREGA:', 'SOHO 1'],
    ]
    const infoRight = [
      ['IVA:', 'RESPONSABLE INSCRIPTO'],
      ['CUIT:', ''],
      ['LOCALIDAD:', ''],
      ['PROVINCIA:', ''],
      ['CONDICIÓN PAGO:', ''],
      ['CONDICIONES ENTREGA:', ''],
    ]

    doc.setFontSize(8)
    infoLeft.forEach(([label, value], i) => {
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(30)
      doc.text(label, leftX, y + i * lineH)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(60)
      doc.text(value, leftX + doc.getTextWidth(label) + 2, y + i * lineH)
    })
    infoRight.forEach(([label, value], i) => {
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(30)
      doc.text(label, rightX, y + i * lineH)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(60)
      doc.text(value, rightX + doc.getTextWidth(label) + 2, y + i * lineH)
    })

    // ── Items table ──────────────────────────────────
    const tableY = y + 40

    let subtotal = 0
    let totalIVA = 0

    const tableRows = items.map(p => {
      const cant = sugerenciaEfectiva(p)
      const precioUnit = p.costo ?? 0
      const sub = cant * precioUnit
      const iva = calcIVA(p, cant)
      const subConIVA = sub + iva
      subtotal += sub
      totalIVA += iva

      return [
        p.sku,
        p.nombre ?? '',
        String(cant),
        unidadMedida(p),
        `$${precioUnit.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
        '0',
        `$${sub.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
        String(p.iva_porcentaje ?? 0),
        `$${subConIVA.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
      ]
    })

    autoTable(doc, {
      startY: tableY,
      head: [['Código', 'Descripción', 'Cant.', 'Unidad\nmedida', 'Precio\nunitario', '%\ndesc.', 'Subtotal', 'IVA', 'Subt. c/\nIVA']],
      body: tableRows,
      margin: { left: 10, right: 10 },
      styles: { fontSize: 8, cellPadding: 2, textColor: [30, 30, 30] },
      headStyles: { fillColor: [240, 240, 240], textColor: [30, 30, 30], fontStyle: 'bold', halign: 'center' },
      columnStyles: {
        0: { cellWidth: 18, halign: 'center' },  // Código
        1: { cellWidth: 'auto' },                 // Descripción
        2: { cellWidth: 14, halign: 'center' },   // Cant.
        3: { cellWidth: 18, halign: 'center' },   // Unidad
        4: { cellWidth: 24, halign: 'right' },    // Precio unit
        5: { cellWidth: 12, halign: 'center' },   // % desc
        6: { cellWidth: 24, halign: 'right' },    // Subtotal
        7: { cellWidth: 12, halign: 'center' },   // IVA
        8: { cellWidth: 24, halign: 'right' },    // Subt c/IVA
      },
      didDrawPage: () => {
        // Footer watermark
        doc.setFontSize(7)
        doc.setTextColor(160)
        const pw = doc.internal.pageSize.getWidth()
        const ph = doc.internal.pageSize.getHeight()
        doc.text('Generado por SOHO Retail OS', pw / 2, ph - 8, { align: 'center' })
      },
    })

    // ── Totals ───────────────────────────────────────
    const finalY = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? tableY + 40
    const totalsY = finalY + 4
    const totW = 80
    const totX = pageW - 10 - totW

    doc.setDrawColor(200)
    doc.setLineWidth(0.3)
    doc.rect(totX, totalsY, totW, 22)

    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60)
    doc.text('SUBTOTAL:', totX + 4, totalsY + 6)
    doc.text(`$${subtotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, pageW - 14, totalsY + 6, { align: 'right' })

    doc.text('MONTO IVA:', totX + 4, totalsY + 12)
    doc.text(`$${totalIVA.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, pageW - 14, totalsY + 12, { align: 'right' })

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(20)
    doc.text('TOTAL:', totX + 4, totalsY + 20)
    doc.text(`$${(subtotal + totalIVA).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, pageW - 14, totalsY + 20, { align: 'right' })
  }

  doc.save(`orden-compra-soho-${new Date().toISOString().slice(0, 10)}.pdf`)
}
