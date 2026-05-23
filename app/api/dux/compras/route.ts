/**
 * POST /api/dux/compras
 * Server-side proxy for Dux v2 /compras endpoint.
 * Keeps the DUX_API_TOKEN out of the browser.
 *
 * Request body: same as Dux v2 schema:
 * {
 *   id_empresa        : 4065,
 *   id_sucursal       : number,
 *   id_proveedor      : number,
 *   id_deposito       : number,
 *   id_personal       : 1,
 *   fecha             : "YYYY-MM-DD",
 *   nro_comprobante   : string,
 *   tipo_comprobante  : "FACTURA",
 *   productos         : [{ id_item: string, cantidad: number, precio_unitario: number }]
 * }
 */

import { NextRequest, NextResponse } from 'next/server'

const DUX_BASE    = 'https://erp.duxsoftware.com.ar/WSERP/rest/services'
const DUX_TOKEN   = process.env.DUX_API_TOKEN ?? ''
const ID_EMPRESA  = parseInt(process.env.DUX_ID_EMPRESA ?? '4065')
const ID_PERSONAL = parseInt(process.env.DUX_ID_PERSONAL ?? '1')

// Dux deposit IDs per SOHO sucursal
export const DUX_DEPOSITO_MAP: Record<string, number> = {
  'a0000000-0000-0000-0000-000000000001': 7951,   // SOHO 1 - Local
  'a0000000-0000-0000-0000-000000000002': 8545,   // SOHO 1 - La Pieza
  'a0000000-0000-0000-0000-000000000003': 15289,  // SOHO 2 - Local
  'a0000000-0000-0000-0000-000000000004': 15513,  // SOHO 2 - Depósito
}

export async function POST(req: NextRequest) {
  if (!DUX_TOKEN) {
    return NextResponse.json({ error: 'DUX_API_TOKEN not configured' }, { status: 503 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Merge server-side constants
  const payload: Record<string, unknown> = {
    id_empresa  : ID_EMPRESA,
    id_personal : ID_PERSONAL,
    ...body,
  }

  // Validate required fields
  const required = ['id_sucursal', 'id_proveedor', 'id_deposito', 'fecha', 'nro_comprobante', 'tipo_comprobante', 'productos']
  for (const f of required) {
    if (payload[f] === undefined || payload[f] === null || payload[f] === '') {
      return NextResponse.json({ error: `Missing required field: ${f}` }, { status: 400 })
    }
  }

  if (!Array.isArray(payload['productos']) || (payload['productos'] as unknown[]).length === 0) {
    return NextResponse.json({ error: 'productos array must be non-empty' }, { status: 400 })
  }

  try {
    const duxRes = await fetch(`${DUX_BASE}/v2/compras`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DUX_TOKEN}`,
        'Content-Type' : 'application/json',
        'Accept'       : 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const text = await duxRes.text()
    let data: unknown
    try { data = JSON.parse(text) } catch { data = { raw: text } }

    if (!duxRes.ok) {
      console.error('[dux/compras] Error from Dux:', duxRes.status, text.slice(0, 500))
      return NextResponse.json(
        { error: `Dux responded ${duxRes.status}`, dux_response: data },
        { status: duxRes.status >= 500 ? 502 : duxRes.status }
      )
    }

    return NextResponse.json({ ok: true, dux_response: data }, { status: 200 })
  } catch (err) {
    console.error('[dux/compras] Network error:', err)
    return NextResponse.json({ error: 'Network error reaching Dux' }, { status: 502 })
  }
}
