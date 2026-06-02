/**
 * POST /api/dux/compras
 * Server-side proxy for Dux v2 /compras endpoint.
 * Keeps the DUX_API_TOKEN out of the browser.
 *
 * Client sends `productos` array; this route sanitizes it and sends
 * it to Dux as `items` (the field name Dux v2 actually expects).
 *
 * Request body:
 * {
 *   id_sucursal       : number,
 *   id_proveedor      : number,
 *   id_deposito       : number,
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

  // Merge server-side constants (id_empresa / id_personal stay server-side)
  const { productos, ...rest } = body as { productos?: unknown; [k: string]: unknown }
  const payload: Record<string, unknown> = {
    id_empresa  : ID_EMPRESA,
    id_personal : ID_PERSONAL,
    ...rest,
  }

  // Validate required fields (except productos which we handle separately)
  const required = ['id_sucursal', 'id_proveedor', 'id_deposito', 'fecha', 'nro_comprobante', 'tipo_comprobante']
  for (const f of required) {
    if (payload[f] === undefined || payload[f] === null || payload[f] === '') {
      return NextResponse.json({ error: `Missing required field: ${f}` }, { status: 400 })
    }
  }

  // Sanitize items:
  // 1) Remove items with quantity <= 0 or price <= 0 (Dux rejects these)
  // 2) Merge duplicate id_item entries (Dux rejects arrays with repeated id_item)
  type DuxItem = { id_item: string; cantidad: number; precio_unitario: number }
  const productosRaw = (Array.isArray(productos) ? productos : []) as DuxItem[]

  if (productosRaw.length === 0) {
    return NextResponse.json({ error: 'productos array must be non-empty' }, { status: 400 })
  }

  const validos = productosRaw.filter(p => p.cantidad > 0 && p.precio_unitario > 0)

  // Merge duplicates by id_item: sum quantities, weighted-average price
  const merged = new Map<string, { cantidad: number; total_valor: number }>()
  for (const p of validos) {
    const key = String(p.id_item)
    const existing = merged.get(key)
    if (existing) {
      existing.total_valor += p.precio_unitario * p.cantidad
      existing.cantidad    += p.cantidad
    } else {
      merged.set(key, { cantidad: p.cantidad, total_valor: p.precio_unitario * p.cantidad })
    }
  }
  const itemsFinal: DuxItem[] = Array.from(merged.entries()).map(([id_item, v]) => ({
    id_item,
    cantidad        : v.cantidad,
    precio_unitario : Math.round(v.total_valor / v.cantidad * 100) / 100,
  }))

  if (itemsFinal.length === 0) {
    return NextResponse.json({
      error: 'Todos los ítems tienen cantidad=0 o precio=0 — nada para registrar en Dux',
    }, { status: 400 })
  }

  // Dux v2 /compras expects the array under the key "items", not "productos"
  payload['items'] = itemsFinal

  console.log('[dux/compras] Sending to Dux v2/compras:', JSON.stringify({
    ...payload,
    items_count  : itemsFinal.length,
    items_omitted: productosRaw.length - validos.length,
  }))

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
      console.error('[dux/compras] Error from Dux:', duxRes.status, text.slice(0, 2000))
      return NextResponse.json(
        { error: `Dux responded ${duxRes.status}`, dux_response: data, payload_sent: payload },
        { status: duxRes.status >= 500 ? 502 : duxRes.status }
      )
    }

    return NextResponse.json({ ok: true, dux_response: data }, { status: 200 })
  } catch (err) {
    console.error('[dux/compras] Network error:', err)
    return NextResponse.json({ error: 'Network error reaching Dux' }, { status: 502 })
  }
}
