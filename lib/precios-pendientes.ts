/**
 * Precios que salieron de una recepción y todavía no se mandaron a Dux.
 *
 * Antes el set de precios vivía solo en el estado de React de la pantalla que
 * aparece después de confirmar. Si esa pestaña se cerraba —o simplemente nadie
 * apretaba el botón— el trabajo se perdía sin dejar rastro: no quedaba registro
 * de qué precios había que actualizar ni de si se habían mandado alguna vez.
 * Pasó con la factura 00001-00003853 de Shuk.
 *
 * Ahora los precios se persisten al confirmar y quedan visibles en
 * `/recepciones` hasta que alguien los mande. `exportado_at` deja el historial
 * de qué se envió y cuándo.
 *
 * La tabla `precios_pendientes` también prevé un origen `'familia'` (subir de
 * precio a todo un grupo de productos cuando se mueve uno). Eso todavía no está
 * implementado; acá solo se usa `'factura'`.
 */

import { supabase } from './supabase'

/** Una fila tal como vive en la base. */
export interface PrecioPendiente {
  id             : string
  sku            : string
  producto_id    : string | null
  recepcion_id   : string | null
  sku_disparador : string | null
  precio_anterior: number | null
  precio_nuevo   : number
  estado         : string
  created_at     : string
}

/**
 * Un precio a registrar. `sku_disparador` es el SKU del renglón de factura que
 * lo originó: en los precios derivados de blister el SKU que cambia no es el
 * que vino en la factura, y sin esto no hay manera de explicar de dónde salió.
 */
export interface PrecioACargar {
  sku             : string
  producto_id    ?: string | null
  precio_anterior?: number | null
  precio_nuevo    : number
  sku_disparador ?: string | null
}

export type ResultadoEnvio =
  | { ok: true; enviados: number; idProceso: string | null }
  | { ok: false; motivo: string }

/**
 * Guarda el set de precios de una recepción, reemplazando lo que hubiera
 * pendiente de una confirmación anterior.
 *
 * Solo borra lo que sigue en `pendiente`: lo ya exportado es historial y no se
 * toca, así que reconfirmar no borra la evidencia de un envío previo.
 */
export async function registrarPreciosPendientes(
  recepcionId: string,
  precios    : PrecioACargar[],
): Promise<number> {
  await supabase.from('precios_pendientes')
    .delete()
    .eq('recepcion_id', recepcionId)
    .eq('estado', 'pendiente')

  const filas = precios.filter(p => p.sku && p.precio_nuevo > 0)
  if (filas.length === 0) return 0

  const { error } = await supabase.from('precios_pendientes').insert(
    filas.map(p => ({
      sku            : p.sku,
      producto_id    : p.producto_id ?? null,
      recepcion_id   : recepcionId,
      origen         : 'factura',
      sku_disparador : p.sku_disparador ?? null,
      precio_anterior: p.precio_anterior ?? null,
      precio_nuevo   : p.precio_nuevo,
      estado         : 'pendiente',
    })),
  )
  if (error) {
    console.error('No se pudieron registrar los precios pendientes:', error)
    return 0
  }
  return filas.length
}

/** Cuántos precios sin mandar tiene cada recepción. Solo las que tienen alguno. */
export async function contarPendientesPorRecepcion(): Promise<Map<string, number>> {
  const { data } = await supabase.from('precios_pendientes')
    .select('recepcion_id')
    .eq('estado', 'pendiente')

  const porRec = new Map<string, number>()
  for (const row of (data ?? []) as { recepcion_id: string | null }[]) {
    if (!row.recepcion_id) continue
    porRec.set(row.recepcion_id, (porRec.get(row.recepcion_id) ?? 0) + 1)
  }
  return porRec
}

/** Los precios sin mandar de una recepción, para mostrarlos antes de enviar. */
export async function listarPendientes(recepcionId: string): Promise<PrecioPendiente[]> {
  const { data } = await supabase.from('precios_pendientes')
    .select('id,sku,producto_id,recepcion_id,sku_disparador,precio_anterior,precio_nuevo,estado,created_at')
    .eq('recepcion_id', recepcionId)
    .eq('estado', 'pendiente')
    .order('created_at')
  return (data ?? []) as PrecioPendiente[]
}

/** Marca como exportadas las filas que quedaban pendientes de una recepción. */
export async function marcarExportados(recepcionId: string): Promise<void> {
  await supabase.from('precios_pendientes')
    .update({ estado: 'exportado', exportado_at: new Date().toISOString() })
    .eq('recepcion_id', recepcionId)
    .eq('estado', 'pendiente')
}

/**
 * Manda a Dux los precios pendientes de una recepción y los marca exportados.
 *
 * El payload se rearma desde la base, así que funciona aunque la recepción se
 * haya confirmado hace días y en otra sesión — igual que el reenvío de la
 * compra en `reenviarCompraADux`.
 *
 * Solo se marcan exportados si Dux aceptó la petición. Si falla, las filas
 * siguen pendientes y el botón queda disponible para reintentar.
 */
export async function enviarPreciosPendientes(recepcionId: string): Promise<ResultadoEnvio> {
  const filas = await listarPendientes(recepcionId)
  if (filas.length === 0) {
    return { ok: false, motivo: 'No quedan precios pendientes en esta recepción.' }
  }

  let res: Response
  try {
    res = await fetch('/api/dux/precios', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        items: filas.map(f => ({ codigo: f.sku, importe: f.precio_nuevo })),
      }),
    })
  } catch {
    return { ok: false, motivo: 'No se pudo contactar a Dux. Probá de nuevo en un rato.' }
  }

  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    return { ok: false, motivo: (data.error as string) ?? 'Dux rechazó la actualización de precios.' }
  }

  await marcarExportados(recepcionId)
  return {
    ok       : true,
    enviados : (data.enviados as number) ?? filas.length,
    idProceso: (data.id_proceso as string) ?? null,
  }
}
