/**
 * POST /api/dux/exportar-precios
 * Generates an Excel file with the Dux bulk price import format.
 *
 * Sheet: "Hoja Principal"
 * Columns: CODIGO | IMPORTE
 *
 * Request body:
 * {
 *   items: Array<{ codigo: string; importe: number }>
 * }
 *
 * Response: .xlsx file binary
 */

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

interface PriceItem {
  codigo : string
  importe: number
}

export async function POST(req: NextRequest) {
  let body: { items?: PriceItem[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const items = body.items ?? []
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'No items to export' }, { status: 400 })
  }

  // Build worksheet rows
  const rows: [string, number][] = [['CODIGO', 0], ...items.map(i => [i.codigo, i.importe] as [string, number])]

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)

  // Style header row (row 0 = A1:B1)
  if (!ws['!cols']) ws['!cols'] = []
  ws['!cols'] = [{ wch: 18 }, { wch: 14 }]

  // Overwrite header with proper labels (SheetJS puts values in as-is)
  ws['A1'] = { v: 'CODIGO',  t: 's' }
  ws['B1'] = { v: 'IMPORTE', t: 's' }

  // Format IMPORTE column as number
  for (let r = 1; r < rows.length; r++) {
    const cellAddr = XLSX.utils.encode_cell({ r, c: 1 })
    if (ws[cellAddr]) {
      ws[cellAddr].t = 'n'
      ws[cellAddr].z = '#,##0.00'
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Hoja Principal')

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer

  const fecha = new Date().toISOString().split('T')[0]
  const filename = `dux_precios_${fecha}.xlsx`

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type'       : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
