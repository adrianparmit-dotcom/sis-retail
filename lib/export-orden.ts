import type { ProductoCompra } from './types'

// ─────────────────────────────────────────────────────
// Public types — usados por el editor de orden y los exports
// ─────────────────────────────────────────────────────

export interface OrdenItemEditado {
  sku            : string
  nombre         : string
  cantidad       : number   // En kg si es_granel; en unidades si no
  costo          : number   // Por unidad (o por kg si es_granel)
  iva_porcentaje : number
  es_granel      : boolean
}

export interface OrdenHeader {
  cuit               : string
  direccion          : string
  telefono           : string
  localidad          : string
  provincia          : string
  iva_condicion      : string
  condicion_pago     : string
  condiciones_entrega: string
  fecha_entrega      : string
}

export interface OrdenGrupoEditado {
  proveedor : string
  sucursal  : string | null   // Lugar de entrega cuando el proveedor es por-sucursal
  header    : OrdenHeader
  items     : OrdenItemEditado[]
}

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

function unidadMedida(item: { es_granel: boolean }): string {
  return item.es_granel ? 'KG' : 'UNIDAD'
}

function calcIVA(item: OrdenItemEditado): number {
  const subtotal = item.cantidad * item.costo
  return Math.round(subtotal * (item.iva_porcentaje / 100) * 100) / 100
}

// One order block per (provider, sucursal). For global providers `sucursal` is
// null and there's a single block; for per-sucursal providers (e.g. Karen
// Previotto) the view returns 2 rows per SKU, so we split into "SOHO 1" /
// "SOHO 2" blocks — each gets delivered to its own store.
interface OrdenGrupoCrudo {
  proveedor: string
  sucursal: string | null
  items: ProductoCompra[]
}

function groupForOrden(rows: ProductoCompra[]): OrdenGrupoCrudo[] {
  const map = new Map<string, OrdenGrupoCrudo>()
  const sorted = [...rows].sort((a, b) => {
    const pa = a.proveedor_nombre ?? 'ZZZ'
    const pb = b.proveedor_nombre ?? 'ZZZ'
    const sa = a.location_nombre ?? ''
    const sb = b.location_nombre ?? ''
    return pa.localeCompare(pb, 'es') || sa.localeCompare(sb, 'es') || a.sku.localeCompare(b.sku)
  })
  for (const p of sorted) {
    const sug = sugerenciaEfectiva(p)
    if (sug <= 0) continue
    const prov = p.proveedor_nombre ?? 'Sin proveedor'
    const suc = p.location_nombre ?? null
    const key = suc ? `${prov}__${suc}` : prov
    if (!map.has(key)) map.set(key, { proveedor: prov, sucursal: suc, items: [] })
    map.get(key)!.items.push(p)
  }
  return [...map.values()]
}

export function emptyHeader(): OrdenHeader {
  return {
    cuit: '',
    direccion: '',
    telefono: '',
    localidad: '',
    provincia: '',
    iva_condicion: 'RESPONSABLE INSCRIPTO',
    condicion_pago: '',
    condiciones_entrega: '',
    fecha_entrega: '',
  }
}

/**
 * Construye los grupos editables desde las filas crudas de la vista de compras.
 * El editor llama a esto al abrir; luego el usuario ajusta cantidades, agrega/quita
 * productos y completa el header antes de exportar.
 */
export function buildGruposFromRows(rows: ProductoCompra[]): OrdenGrupoEditado[] {
  return groupForOrden(rows).map(g => ({
    proveedor: g.proveedor,
    sucursal: g.sucursal,
    header: emptyHeader(),
    items: g.items.map<OrdenItemEditado>(p => ({
      sku: p.sku,
      nombre: p.nombre ?? '',
      cantidad: sugerenciaEfectiva(p),
      costo: p.costo ?? 0,
      iva_porcentaje: p.iva_porcentaje ?? 0,
      es_granel: p.es_granel,
    })),
  }))
}

// ─────────────────────────────────────────────────────
// CSV Export — Orden de Compra format
// ─────────────────────────────────────────────────────

function esc(val: string | number): string {
  const s = String(val)
  if (s.includes(';') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function exportOrdenCSVFromGrupos(grupos: OrdenGrupoEditado[], entregaDefault: string | null = null) {
  const fecha = todayStr()
  const lines: string[] = ['sep=;']

  lines.push(esc('ORDEN DE COMPRA — SOHO') + ';' + esc(`FECHA: ${fecha}`) + ';' + ';'.repeat(7))
  lines.push(';'.repeat(9))

  for (const { proveedor, sucursal, header, items } of grupos) {
    const visibles = items.filter(i => i.cantidad > 0)
    if (visibles.length === 0) continue

    const lugar = sucursal ?? entregaDefault
    const titulo = lugar ? `PROVEEDOR: ${proveedor} — ${lugar}` : `PROVEEDOR: ${proveedor}`
    lines.push(esc(titulo) + ';' + ';'.repeat(8))

    // Datos del proveedor (solo si hay algo cargado)
    const headerLines: string[] = []
    if (header.cuit)                headerLines.push(`CUIT: ${header.cuit}`)
    if (header.direccion)           headerLines.push(`DIRECCIÓN: ${header.direccion}`)
    if (header.telefono)            headerLines.push(`TELÉFONO: ${header.telefono}`)
    if (header.localidad)           headerLines.push(`LOCALIDAD: ${header.localidad}`)
    if (header.provincia)           headerLines.push(`PROVINCIA: ${header.provincia}`)
    if (header.iva_condicion)       headerLines.push(`IVA: ${header.iva_condicion}`)
    if (header.condicion_pago)      headerLines.push(`COND. PAGO: ${header.condicion_pago}`)
    if (header.fecha_entrega)       headerLines.push(`FECHA ENTREGA: ${header.fecha_entrega}`)
    if (header.condiciones_entrega) headerLines.push(`COND. ENTREGA: ${header.condiciones_entrega}`)
    for (const h of headerLines) lines.push(esc(h) + ';' + ';'.repeat(8))
    lines.push('')

    // Column headers
    lines.push(['Código', 'Descripción', 'Cant.', 'Unidad medida', 'Precio unitario', '% desc.', 'Subtotal', 'IVA', 'Subt. c/IVA']
      .map(esc).join(';'))

    let subtotal = 0
    let totalIVA = 0

    for (const item of visibles) {
      const sub = item.cantidad * item.costo
      const iva = calcIVA(item)
      const subConIVA = sub + iva
      subtotal += sub
      totalIVA += iva

      lines.push([
        item.sku,
        item.nombre,
        item.cantidad,
        unidadMedida(item),
        item.costo.toFixed(2),
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

export async function exportOrdenPDFFromGrupos(grupos: OrdenGrupoEditado[], entregaDefault: string | null = null) {
  // Dynamic import so the 300KB bundle only loads when clicked
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const fecha = todayStr()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let firstPage = true

  for (const { proveedor, sucursal, header, items } of grupos) {
    const visibles = items.filter(i => i.cantidad > 0)
    if (visibles.length === 0) continue

    if (!firstPage) doc.addPage()
    const lugarEntrega = sucursal ?? entregaDefault ?? 'SOHO 1'
    firstPage = false

    const pageW = doc.internal.pageSize.getWidth()

    // ── Header bar ──────────────────────────────────
    doc.setFillColor(245, 245, 245)
    doc.rect(0, 0, pageW, 28, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.setTextColor(30, 30, 30)
    doc.text('SOHO', 14, 12)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text('SHUK SRL', 14, 18)
    doc.text('NATURAL CENTER', 14, 22)

    doc.setDrawColor(180)
    doc.setLineWidth(0.5)
    doc.rect(pageW / 2 - 8, 4, 16, 16)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(30)
    doc.text('X', pageW / 2, 14, { align: 'center' })

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

    const infoLeft: [string, string][] = [
      ['PROVEEDOR:', proveedor],
      ['DIRECCIÓN:', header.direccion],
      ['TELÉFONO:', header.telefono],
      ['MONEDA:', 'PESOS'],
      ['FECHA ENTREGA:', header.fecha_entrega],
      ['LUGAR ENTREGA:', lugarEntrega],
    ]
    const infoRight: [string, string][] = [
      ['IVA:', header.iva_condicion],
      ['CUIT:', header.cuit],
      ['LOCALIDAD:', header.localidad],
      ['PROVINCIA:', header.provincia],
      ['CONDICIÓN PAGO:', header.condicion_pago],
      ['CONDICIONES ENTREGA:', header.condiciones_entrega],
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

    const tableRows = visibles.map(item => {
      const sub = item.cantidad * item.costo
      const iva = calcIVA(item)
      const subConIVA = sub + iva
      subtotal += sub
      totalIVA += iva

      return [
        item.sku,
        item.nombre,
        String(item.cantidad),
        unidadMedida(item),
        `$${item.costo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
        '0',
        `$${sub.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
        String(item.iva_porcentaje),
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
        0: { cellWidth: 18, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 14, halign: 'center' },
        3: { cellWidth: 18, halign: 'center' },
        4: { cellWidth: 24, halign: 'right' },
        5: { cellWidth: 12, halign: 'center' },
        6: { cellWidth: 24, halign: 'right' },
        7: { cellWidth: 12, halign: 'center' },
        8: { cellWidth: 24, halign: 'right' },
      },
      didDrawPage: () => {
        doc.setFontSize(7)
        doc.setTextColor(160)
        const pw = doc.internal.pageSize.getWidth()
        const ph = doc.internal.pageSize.getHeight()
        doc.text('Generado por SOHO Retail OS', pw / 2, ph - 8, { align: 'center' })
      },
    })

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
