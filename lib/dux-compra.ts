/**
 * Reenvío de una recepción ya confirmada a Dux.
 *
 * La pantalla de carga de factura arma el payload desde su estado en memoria y
 * ofrece un "Reintentar" que solo vive mientras no salgas de esa pantalla. Si la
 * operaria cerraba la página, la recepción quedaba marcada "Falló Dux" para
 * siempre y no había forma de reenviarla (ago-2026: 10 recepciones así).
 *
 * Acá el payload se reconstruye desde la base, así que se puede reintentar
 * cuando sea y desde donde sea. El schema exacto que espera Dux (nombre completo
 * del comprobante, formato del número, campos de cada línea) lo resuelve
 * /api/dux/compras, que es el punto único: este módulo solo junta los datos.
 */

import { supabase } from '@/lib/supabase'
import { SUCURSALES_DUX } from '@/lib/constants'

export type LetraComprobante = 'A' | 'B' | 'C'

export type ReenvioResultado =
  | { ok: true }
  | { ok: false; motivo: string; detalle?: string }

interface RecepcionRow {
  id: string
  sucursal_id: string | null
  proveedor_nombre: string | null
  numero_comprobante: string | null
  fecha_factura: string | null
  comprobante_letra: string | null
}

interface ItemRow {
  producto_id: string | null
  sku: string | null
  es_granel: boolean | null
  cantidad_esperada: number | null
  cantidad_recibida: number | null
  costo_unitario: number | null
  iva_porcentaje: number | null
}

/** Deja constancia del intento en la recepción, igual que la pantalla de carga. */
async function marcarSync(
  recepcionId: string,
  estado: 'ok' | 'error' | 'omitida',
  detalle?: string,
): Promise<void> {
  await supabase.from('recepciones').update({
    dux_sync_estado : estado,
    dux_sync_at     : new Date().toISOString(),
    dux_sync_detalle: detalle ?? null,
  }).eq('id', recepcionId)
}

/**
 * Resuelve el proveedor de Dux con la misma prioridad que usa la pantalla de
 * carga: primero el ID configurado a mano en /compras/proveedores, y si no hay,
 * el proveedor_id_dux más frecuente entre los productos de la factura (cubre a
 * los distribuidores que traen varias marcas).
 */
async function resolverProveedorDux(
  proveedorNombre: string | null,
  productoIds: string[],
): Promise<number | null> {
  if (proveedorNombre) {
    const { data } = await supabase.from('proveedores_config')
      .select('dux_proveedor_id')
      .ilike('nombre', `%${proveedorNombre}%`)
      .not('dux_proveedor_id', 'is', null)
      .limit(1)
      .maybeSingle()
    const id = (data as { dux_proveedor_id: number } | null)?.dux_proveedor_id
    if (id) return id
  }

  if (productoIds.length === 0) return null
  const { data: prods } = await supabase.from('productos')
    .select('proveedor_id_dux')
    .in('id', productoIds)
    .not('proveedor_id_dux', 'is', null)

  const freq = new Map<number, number>()
  for (const p of (prods ?? []) as { proveedor_id_dux: number }[]) {
    freq.set(p.proveedor_id_dux, (freq.get(p.proveedor_id_dux) ?? 0) + 1)
  }
  if (freq.size === 0) return null
  return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

/**
 * Rearma la compra desde la base y la manda a Dux. Marca el resultado en la
 * recepción, así que el estado de la lista queda al día sin recargar nada.
 *
 * `letra` pisa la guardada en la recepción; sirve para las recepciones viejas,
 * anteriores a que se persistiera comprobante_letra.
 */
export async function reenviarCompraADux(
  recepcionId: string,
  letra?: LetraComprobante,
): Promise<ReenvioResultado> {
  const { data: recRaw, error: recErr } = await supabase.from('recepciones')
    .select('id,sucursal_id,proveedor_nombre,numero_comprobante,fecha_factura,comprobante_letra')
    .eq('id', recepcionId)
    .maybeSingle()

  if (recErr || !recRaw) {
    return { ok: false, motivo: 'No se pudo leer la recepción.' }
  }
  const rec = recRaw as RecepcionRow

  const sucursal = SUCURSALES_DUX.find(s => s.id === rec.sucursal_id)
  if (!sucursal) {
    return { ok: false, motivo: 'La recepción no tiene una sucursal válida asignada.' }
  }
  if (!rec.fecha_factura) {
    return { ok: false, motivo: 'La recepción no tiene fecha de factura.' }
  }

  const { data: itemsRaw } = await supabase.from('recepcion_items')
    .select('producto_id,sku,es_granel,cantidad_esperada,cantidad_recibida,costo_unitario,iva_porcentaje')
    .eq('recepcion_id', recepcionId)

  const items = (itemsRaw ?? []) as ItemRow[]

  // El granel queda afuera igual que en la carga: el bulto madre no existe como
  // producto en el ERP y en qué se fracciona se decide días después.
  const lineas = items.filter(i =>
    !i.es_granel && i.sku && Number(i.cantidad_esperada) > 0 && Number(i.costo_unitario) > 0
  )

  if (lineas.length === 0) {
    const motivo = 'Ningún ítem sirve para Dux: hacen falta SKU, cantidad y costo mayores a cero.'
    await marcarSync(recepcionId, 'omitida', motivo)
    return { ok: false, motivo }
  }

  const provId = await resolverProveedorDux(
    rec.proveedor_nombre,
    items.map(i => i.producto_id).filter((id): id is string => Boolean(id)),
  )
  if (!provId) {
    const motivo = 'No se pudo determinar el proveedor en Dux. Configuralo en Compras → Proveedores, campo "ID Dux".'
    await marcarSync(recepcionId, 'omitida', motivo)
    return { ok: false, motivo }
  }

  const letraFinal = letra ?? (rec.comprobante_letra as LetraComprobante | null) ?? 'A'

  const payload = {
    id_sucursal     : sucursal.dux_sucursal_id,
    id_proveedor    : provId,
    id_deposito     : sucursal.dux_deposito,
    fecha           : rec.fecha_factura,
    nro_comprobante : rec.numero_comprobante || 'S/N',
    tipo_comprobante: `FACTURA ${letraFinal}`,
    productos: lineas.map(i => ({
      id_item          : i.sku!,
      cantidad         : Number(i.cantidad_esperada),
      precio_unitario  : Number(i.costo_unitario),
      iva_porcentaje   : Number(i.iva_porcentaje),
      cantidad_recibida: Number(i.cantidad_recibida ?? i.cantidad_esperada),
    })),
  }

  let res: Response
  try {
    res = await fetch('/api/dux/compras', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(payload),
    })
  } catch {
    // Sin respuesta de Dux no sabemos si la compra entró o no, así que no se
    // toca dux_sync_estado: pisarlo con 'error' podría tapar un envío que sí
    // llegó y llevar a cargarla dos veces.
    return { ok: false, motivo: 'No se pudo contactar a Dux. Probá de nuevo en un rato.' }
  }

  if (res.ok) {
    await marcarSync(recepcionId, 'ok')
    return { ok: true }
  }

  const e = await res.json().catch(() => ({})) as Record<string, unknown>
  const duxResp = e.dux_response as Record<string, unknown> | null | undefined
  const mensaje = (duxResp?.error as Record<string, unknown>)?.mensaje as string
               ?? (duxResp?.mensaje as string)
               ?? (e.error as string)
               ?? 'error desconocido'
  const motivo = `Dux ${res.status}: ${mensaje}`

  const enviados = (e.payload_sent as { productos?: unknown[] } | undefined)?.productos
  const detalle = Array.isArray(enviados)
    ? `${enviados.length} ítems enviados · comprobante ${payload.nro_comprobante} · ${payload.tipo_comprobante}`
    : undefined

  await marcarSync(recepcionId, 'error', motivo)
  return { ok: false, motivo, detalle }
}
