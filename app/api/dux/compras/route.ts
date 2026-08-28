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

export const maxDuration = 60

const DUX_BASE    = 'https://erp.duxsoftware.com.ar/WSERP/rest/services'
const DUX_TOKEN   = process.env.DUX_API_TOKEN ?? ''
const ID_PERSONAL = parseInt(process.env.DUX_ID_PERSONAL ?? '1')

/**
 * Dux nombra los comprobantes completos: "FACTURA A", no "A".
 *
 * Solo se reescribe el caso "letra suelta" (y sus variantes de tipeo). Todo lo
 * demás pasa tal cual, salvo trim y mayúsculas: puede ser un tipo válido que
 * acá no listamos —COMPROBANTE_COMPRA para los documentos X, NOTA DE CREDITO
 * A…— y tocarlo lo romperia. En particular NO se tocan los guiones bajos:
 * Dux usa COMPROBANTE_COMPRA con guion bajo, y convertirlo a espacio lo
 * invalidaba.
 */
function normalizarTipoComprobante(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/\s+/g, ' ')
  if (/^[ABCEM]$/.test(t)) return `FACTURA ${t}`
  const m = /^FACTURA[ _]?([ABCEM])$/.exec(t)
  if (m) return `FACTURA ${m[1]}`
  return t
}

/**
 * El número se manda tal cual viene de la factura; solo se limpian espacios.
 *
 * Se probó repadear a PPPP-NNNNNNNN siguiendo el ejemplo de la documentación
 * ("0001-00001234"), pero las compras reales del ERP muestran el punto de venta
 * con CINCO dígitos —"A-00007-00015420", "A-00001-00005119"—, así que recortar
 * a cuatro rompía justo los comprobantes que ya estaban bien. Dux acepta los
 * dos anchos y arma él la cadena final con la letra adelante.
 */
function normalizarNroComprobante(raw: string): string {
  return raw.trim().replace(/\s+/g, '')
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

  // Merge server-side constants.
  // id_empresa: DUX_ID_EMPRESA en Vercel; default 4065 = SHUK SRL.
  // id_personal: must match the employee linked to the API token.
  const { productos, skip_empresa: _skip, ...rest } = body as {
    productos?: unknown; skip_empresa?: unknown; [k: string]: unknown
  }
  const duxIdEmpresa = parseInt(process.env.DUX_ID_EMPRESA || '4065')
  const payload: Record<string, unknown> = {
    id_empresa : duxIdEmpresa,
    ...(ID_PERSONAL ? { id_personal: ID_PERSONAL } : {}),
    ...rest,
  }

  // Validate required fields (except productos which we handle separately)
  const required = ['id_sucursal', 'id_proveedor', 'id_deposito', 'fecha', 'nro_comprobante', 'tipo_comprobante']
  for (const f of required) {
    if (payload[f] === undefined || payload[f] === null || payload[f] === '') {
      return NextResponse.json({ error: `Missing required field: ${f}` }, { status: 400 })
    }
  }

  // tipo_comprobante: Dux espera el nombre completo del comprobante ("FACTURA A"),
  // no la letra sola. Mandar "A" devuelve 400 "Comprobante no reconocido" —
  // que es lo que rompió todas las recepciones desde ago-2026.
  // Se normaliza acá y no solo en el cliente para que los reintentos de payloads
  // viejos (que guardaron la letra suelta) también salgan bien.
  payload['tipo_comprobante'] = normalizarTipoComprobante(String(payload['tipo_comprobante']))

  // nro_comprobante: Dux espera PPPP-NNNNNNNN (4 dígitos de punto de venta,
  // 8 de número). Las facturas llegan con anchos variables — "00007-00015420"
  // — y el ERP las rechaza. Se re-padea cuando el número entra en el formato.
  payload['nro_comprobante'] = normalizarNroComprobante(String(payload['nro_comprobante']))

  // Sanitize y convertir al schema real de Dux v2:
  //   - Array root key: "productos"
  //   - cod_item (no id_item)
  //   - ctd (no cantidad)
  //   - precio_unitario (igual)
  //   - porc_iva: alícuota de la línea. Si se omite, Dux aplica la del maestro
  //     del ítem e ignora la que cargó la operaria en la factura.
  //   - Filtrar cant=0 o precio=0
  //   - Mergear duplicados por (cod_item + alícuota): agrupar solo por cod_item
  //     mezclaría líneas de 21% y 10.5% en una sola con IVA equivocado.
  type ClientItem = {
    id_item: string; cantidad: number; precio_unitario: number
    iva_porcentaje?: number; cantidad_recibida?: number
  }
  type DuxItem = {
    cod_item: string; ctd: number; precio_unitario: number; porc_descuento: number
    porc_iva?: number; observaciones?: string
  }

  // Alícuotas que acepta Dux. Cualquier otra se omite y el ERP usa la del maestro.
  const IVA_VALIDAS = new Set([0, 2.5, 10.5, 21, 27])

  const productosRaw = (Array.isArray(productos) ? productos : []) as ClientItem[]

  if (productosRaw.length === 0) {
    return NextResponse.json({ error: 'productos array must be non-empty' }, { status: 400 })
  }

  const validos = productosRaw.filter(p => p.cantidad > 0 && p.precio_unitario > 0)

  // Merge duplicates by cod_item + IVA: sum ctd, weighted-average price
  const merged = new Map<string, {
    cod_item: string; iva: number | null; ctd: number; total_valor: number
    recibida: number; hayRecibida: boolean
  }>()
  for (const p of validos) {
    const iva = typeof p.iva_porcentaje === 'number' && IVA_VALIDAS.has(p.iva_porcentaje)
      ? p.iva_porcentaje
      : null
    const cod = String(p.id_item)
    const key = `${cod}__${iva ?? 'maestro'}`
    const tieneRec = Number.isFinite(p.cantidad_recibida)
    const rec = tieneRec ? Number(p.cantidad_recibida) : p.cantidad
    const ex  = merged.get(key)
    if (ex) {
      ex.total_valor += p.precio_unitario * p.cantidad
      ex.ctd         += p.cantidad
      ex.recibida    += rec
      ex.hayRecibida  = ex.hayRecibida || tieneRec
    } else {
      merged.set(key, {
        cod_item: cod, iva, ctd: p.cantidad, total_valor: p.precio_unitario * p.cantidad,
        recibida: rec, hayRecibida: tieneRec,
      })
    }
  }

  const productosFinal: DuxItem[] = Array.from(merged.values()).map(v => ({
    cod_item       : v.cod_item,
    ctd            : v.ctd,
    precio_unitario: Math.round(v.total_valor / v.ctd * 100) / 100,
    porc_descuento : 0,
    ...(v.iva !== null ? { porc_iva: v.iva } : {}),
    // El alta de compras de Dux (V2CompraProducto) no tiene campo para la
    // cantidad realmente recepcionada — ctd_recepcionada solo existe del lado
    // de lectura. Se mandaba igual y el ERP lo descartaba en silencio, así que
    // el faltante nunca llegaba a Dux. Va como observación de la línea, que sí
    // es un campo del alta, para que quede a la vista al reclamarle al proveedor.
    ...(v.hayRecibida && v.recibida !== v.ctd
      ? { observaciones: `Recepcionado ${v.recibida} de ${v.ctd} facturados` }
      : {}),
  }))

  if (productosFinal.length === 0) {
    return NextResponse.json({
      error: 'Todos los ítems tienen cantidad=0 o precio=0 — nada para registrar en Dux',
    }, { status: 400 })
  }

  payload['productos'] = productosFinal

  console.log('[dux/compras] Sending to Dux v2/compras:', JSON.stringify({
    ...payload,
    items_count  : productosFinal.length,
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

    // Dux sometimes returns 200 with a business-logic error message
    // (e.g. {"message":"Empresa no encontrada."}) — detect and treat as error.
    const dataObj = data as Record<string, unknown> | null
    if (dataObj && typeof dataObj.message === 'string' && !dataObj.id && !dataObj.ok) {
      console.error('[dux/compras] Dux 200 with error message:', dataObj.message)
      return NextResponse.json(
        { error: `Dux respondió OK pero: ${dataObj.message}`, dux_response: data, payload_sent: payload },
        { status: 400 }
      )
    }
    return NextResponse.json({ ok: true, dux_response: data }, { status: 200 })
  } catch (err) {
    console.error('[dux/compras] Network error:', err)
    return NextResponse.json({ error: 'Network error reaching Dux' }, { status: 502 })
  }
}
