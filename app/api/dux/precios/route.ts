/**
 * POST /api/dux/precios
 * Actualiza precios de venta en Dux por API, en lote.
 *
 * Reemplaza el paso manual de bajar un Excel e importarlo a mano en el ERP.
 * Dux procesa esto de forma ASINCRÓNICA: responde con un ID de proceso, no con
 * el resultado. Por eso devolvemos ese id para poder consultarlo después.
 *
 * Endpoint real: POST /item/nuevoItem (API v1 → token crudo, sin "Bearer").
 * El campo `item` (nombre) solo es obligatorio al crear; para actualizar
 * un precio existente se puede omitir.
 *
 * Body:
 *   { items: [{ codigo: string, importe: number }], id_lista?: number }
 */

import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const DUX_BASE  = 'https://erp.duxsoftware.com.ar/WSERP/rest/services'
const DUX_TOKEN = process.env.DUX_API_TOKEN ?? ''

// Listas de precio activas en Dux (las demás figuran como eliminadas):
//   19458 CONSUMIDOR FINAL — la de mostrador
//   39898 ECOM             — la de ecommerce
const LISTA_DEFAULT = parseInt(process.env.DUX_ID_LISTA_PRECIO || '19458')
// Moneda peso. Configurable por si el ERP usa otro id.
const ID_MONEDA     = parseInt(process.env.DUX_ID_MONEDA || '1')

// Tope por request. La doc no declara un máximo; se corta para no mandar
// payloads gigantes que Dux pueda rechazar entero.
const MAX_ITEMS = 200

interface PriceItem { codigo: string; importe: number }

export async function POST(req: NextRequest) {
  if (!DUX_TOKEN) {
    return NextResponse.json({ error: 'DUX_API_TOKEN no configurado' }, { status: 503 })
  }

  let body: { items?: PriceItem[]; id_lista?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const idLista = Number(body.id_lista) || LISTA_DEFAULT
  const items   = Array.isArray(body.items) ? body.items : []

  // Solo precios positivos: un 0 borraría el precio de venta en el ERP.
  const validos = items.filter(i => i.codigo && Number.isFinite(i.importe) && i.importe > 0)

  if (validos.length === 0) {
    return NextResponse.json({ error: 'No hay precios válidos para enviar' }, { status: 400 })
  }
  if (validos.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `Demasiados ítems (${validos.length}). Máximo ${MAX_ITEMS} por envío.` },
      { status: 400 },
    )
  }

  // Un solo precio por código: si viene repetido, gana el último.
  const porCodigo = new Map<string, number>()
  for (const i of validos) porCodigo.set(String(i.codigo), i.importe)

  const payload = {
    productos: Array.from(porCodigo.entries()).map(([cod_item, importe]) => ({
      cod_item,
      precios: [{
        importe               : Math.round(importe * 100) / 100,
        id_lista_precio_venta : idLista,
        id_moneda             : ID_MONEDA,
      }],
    })),
  }

  try {
    const duxRes = await fetch(`${DUX_BASE}/item/nuevoItem`, {
      method : 'POST',
      headers: {
        'Authorization': DUX_TOKEN,
        'Content-Type' : 'application/json',
        'Accept'       : 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    })

    const text = await duxRes.text()
    let data: unknown
    try { data = JSON.parse(text) } catch { data = { raw: text } }

    if (!duxRes.ok) {
      console.error('[dux/precios] Dux respondió', duxRes.status, text.slice(0, 1000))
      return NextResponse.json(
        { error: `Dux respondió ${duxRes.status}`, dux_response: data },
        { status: duxRes.status >= 500 ? 502 : duxRes.status },
      )
    }

    // Dux devuelve algo como: "Peticion ingresada con exito, ID de proceso: 1".
    // Es asincrónico: que haya aceptado la petición NO significa que los precios
    // ya estén aplicados.
    const msg = (data as { message?: string } | null)?.message ?? ''
    const idProceso = msg.match(/ID de proceso:\s*(\d+)/i)?.[1] ?? null

    return NextResponse.json({
      ok            : true,
      enviados      : payload.productos.length,
      id_lista      : idLista,
      id_proceso    : idProceso,
      mensaje_dux   : msg || null,
      dux_response  : data,
    })
  } catch (err) {
    console.error('[dux/precios] Error de red:', err)
    return NextResponse.json({ error: 'No se pudo contactar a Dux' }, { status: 502 })
  }
}
