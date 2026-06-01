/**
 * Live multi-user collaboration for recepción de facturas.
 *
 * Each browser session generates a CLIENT_ID. Every write to the recepción tables
 * tags `last_edited_by` with that ID. The Realtime subscription ignores echoes
 * whose `last_edited_by` matches our own CLIENT_ID, so we only apply changes
 * made by other users.
 *
 * Items, lotes and fraccionamiento changes are saved per-item (upsert) instead
 * of the legacy wholesale delete+reinsert. That removes the conflict between
 * concurrent borrador editors.
 */

import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { InvoiceLineItem, Lote, GranelDerivado } from '@/lib/types'

// ── Client identity ─────────────────────────────────────────────────

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // Fallback for older environments — sufficient for echo-suppression scoping
  return 'c-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Per-tab client ID. Re-generated on each module load (each browser tab). */
export const CLIENT_ID = randomId()

// ── DB row shapes (subset of columns we care about) ────────────────

export interface RecepcionItemRow {
  id                   : string
  recepcion_id         : string
  producto_id          : string | null
  sku                  : string
  nombre_producto      : string | null
  cantidad_esperada    : number | null
  cantidad_recibida    : number | null
  fecha_vencimiento    : string | null
  estado               : string | null
  es_granel            : boolean | null
  iva_porcentaje       : number | null
  costo_unitario       : number | null
  sku_proveedor        : string | null
  descripcion_proveedor: string | null
  precio_venta_sugerido: number | null
  last_edited_by       : string | null
}

interface LoteRow {
  recepcion_item_id: string
  cantidad         : number
  fecha_vencimiento: string | null
  numero_lote      : string | null
  last_edited_by   : string | null
}

interface FracRow {
  recepcion_item_id: string
  producto_final_id: string
  cantidad_objetivo: number | null
}

interface ProductoMin {
  id              : string
  sku             : string
  nombre          : string | null
  codigo_barras   : string | null
  precio_venta    : number | null
  proveedor_id_dux: number | null
  categoria       : string | null
}

// ── Conversion helpers ─────────────────────────────────────────────

/** Convert an in-memory item to the recepcion_items DB row shape. */
function itemToRow(item: InvoiceLineItem, recepcionId: string): Omit<RecepcionItemRow, 'id'> & { updated_at: string } {
  return {
    recepcion_id          : recepcionId,
    producto_id           : item.es_granel ? null : (item.producto_id ?? null),
    sku                   : item.producto_sku ?? item.sku_proveedor,
    nombre_producto       : item.producto_nombre ?? item.descripcion_proveedor,
    cantidad_esperada     : item.cantidad,
    cantidad_recibida     : item.cantidad_recibida,
    fecha_vencimiento     : item.fecha_vencimiento || null,
    estado                : item.estado_recepcion,
    es_granel             : item.es_granel,
    iva_porcentaje        : item.iva_porcentaje,
    costo_unitario        : item.costo_unitario,
    sku_proveedor         : item.sku_proveedor,
    descripcion_proveedor : item.descripcion_proveedor,
    precio_venta_sugerido : item.precio_venta_sugerido,
    last_edited_by        : CLIENT_ID,
    updated_at            : new Date().toISOString(),
  }
}

/** Build an InvoiceLineItem from a DB row + its lotes + derivados + productos catalog. */
export function rowToItem(
  row     : RecepcionItemRow,
  lotes   : Lote[],
  derivs  : GranelDerivado[],
  prodById: Map<string, ProductoMin>,
): InvoiceLineItem {
  const prod = row.producto_id ? prodById.get(row.producto_id) : undefined
  const cantidadRecibida = lotes.length > 0
    ? lotes.reduce((s, l) => s + l.cantidad, 0)
    : (row.cantidad_recibida ?? 0)

  return {
    recepcion_item_id     : row.id,
    sku_proveedor         : row.sku_proveedor ?? row.sku ?? '',
    descripcion_proveedor : row.descripcion_proveedor ?? row.nombre_producto ?? row.sku ?? '',
    cantidad              : row.cantidad_esperada ?? 0,
    costo_unitario        : row.costo_unitario ?? 0,
    iva_porcentaje        : row.iva_porcentaje ?? 21,
    precio_venta_sugerido : row.precio_venta_sugerido ?? 0,
    match_confidence      : row.producto_id ? 'sku_map' : 'sin_match',
    producto_id           : row.producto_id ?? undefined,
    producto_sku          : prod?.sku,
    producto_nombre       : prod?.nombre ?? undefined,
    producto_precio_actual: prod?.precio_venta ?? undefined,
    producto_id_dux       : prod?.proveedor_id_dux ?? undefined,
    cantidad_recibida     : cantidadRecibida,
    fecha_vencimiento     : row.fecha_vencimiento ?? '',
    estado_recepcion      : (row.estado as InvoiceLineItem['estado_recepcion']) ?? 'ok',
    es_blister            : /^BLISTER\s/i.test(row.nombre_producto ?? ''),
    unidades_por_blister  : 1,
    es_granel             : !!row.es_granel,
    derivados             : row.es_granel ? derivs : undefined,
    lotes,
  }
}

// ── Persistence: upsert a single item + its child collections ──────

/**
 * Upsert an item row, then replace its lotes and derivados.
 * Returns the item ID (assigning one if it was a new item).
 *
 * The "replace" pattern for lotes/derivados is fine here because those
 * sub-collections are conceptually atomic to the parent item — when one
 * user edits item X, the whole set of lotes for X is what they're managing.
 * The parent item is touched (updated_at + last_edited_by) so the realtime
 * subscription on recepcion_items can detect the change and refetch.
 */
export async function persistItem(
  recepcionId: string,
  item       : InvoiceLineItem,
): Promise<string | null> {
  let itemId = item.recepcion_item_id ?? null
  const row = itemToRow(item, recepcionId)

  if (itemId) {
    await supabase.from('recepcion_items').update(row).eq('id', itemId)
  } else {
    const { data, error } = await supabase
      .from('recepcion_items')
      .insert(row)
      .select('id')
      .single()
    if (error || !data) return null
    itemId = (data as { id: string }).id
  }
  if (!itemId) return null

  // Replace lotes (only for non-granel items)
  await supabase.from('recepcion_item_lotes').delete().eq('recepcion_item_id', itemId)
  if (!item.es_granel) {
    const validLotes = item.lotes.filter(l => l.cantidad > 0)
    if (validLotes.length > 0) {
      await supabase.from('recepcion_item_lotes').insert(
        validLotes.map(l => ({
          recepcion_item_id : itemId!,
          cantidad          : l.cantidad,
          fecha_vencimiento : l.fecha_vencimiento || null,
          numero_lote       : l.numero_lote ?? null,
          last_edited_by    : CLIENT_ID,
        })),
      )
    }
  }

  // Replace derivados (only for granel items)
  await supabase.from('recepcion_item_fraccionamiento').delete().eq('recepcion_item_id', itemId)
  if (item.es_granel && item.derivados && item.derivados.length > 0) {
    await supabase.from('recepcion_item_fraccionamiento').insert(
      item.derivados.map(d => ({
        recepcion_item_id : itemId!,
        producto_final_id : d.producto_id,
        cantidad_objetivo : d.cantidad_objetivo ?? null,
        last_edited_by    : CLIENT_ID,
      })),
    )
  }

  return itemId
}

// ── Fetch a single item from DB (used for realtime merge) ──────────

export async function fetchItem(
  itemId  : string,
  prodById: Map<string, ProductoMin>,
): Promise<InvoiceLineItem | null> {
  const { data: itemRow } = await supabase
    .from('recepcion_items')
    .select('*')
    .eq('id', itemId)
    .maybeSingle()
  if (!itemRow) return null

  const [{ data: lotesRows }, { data: fracRows }] = await Promise.all([
    supabase.from('recepcion_item_lotes')
      .select('cantidad,fecha_vencimiento,numero_lote')
      .eq('recepcion_item_id', itemId)
      .order('fecha_vencimiento', { ascending: true }),
    supabase.from('recepcion_item_fraccionamiento')
      .select('producto_final_id,cantidad_objetivo')
      .eq('recepcion_item_id', itemId),
  ])

  const lotes: Lote[] = ((lotesRows ?? []) as Array<{ cantidad: number; fecha_vencimiento: string | null; numero_lote: string | null }>).map(l => ({
    cantidad         : l.cantidad,
    fecha_vencimiento: l.fecha_vencimiento ?? '',
    numero_lote      : l.numero_lote ?? undefined,
  }))

  const derivs: GranelDerivado[] = ((fracRows ?? []) as Array<{ producto_final_id: string; cantidad_objetivo: number | null }>).map(d => {
    const p = prodById.get(d.producto_final_id)
    return {
      producto_id      : d.producto_final_id,
      producto_sku     : p?.sku ?? '',
      producto_nombre  : p?.nombre ?? null,
      cantidad_objetivo: d.cantidad_objetivo ?? undefined,
    }
  })

  return rowToItem(itemRow as RecepcionItemRow, lotes, derivs, prodById)
}

// ── Realtime hook: subscribe & merge remote changes ────────────────

export interface PresenceInfo {
  clientId   : string
  joinedAt   : number
}

/**
 * Subscribe to recepcion_items and recepcion_item_lotes for a given borrador.
 * When a change arrives with a different CLIENT_ID, refetch the affected item
 * and merge it into local state.
 *
 * Also tracks presence (how many tabs are connected to the same borrador).
 */
export function useRecepcionRealtime(
  borradorId : string | null,
  productos  : ProductoMin[],
  setItems   : (updater: (prev: InvoiceLineItem[]) => InvoiceLineItem[]) => void,
  onPresence?: (count: number) => void,
): void {
  // Keep a live ref of productos so subscription handlers always see the current catalog
  const prodRef = useRef(productos)
  prodRef.current = productos

  useEffect(() => {
    if (!borradorId) return
    const channel = supabase
      .channel(`recepcion:${borradorId}`, { config: { presence: { key: CLIENT_ID } } })
      .on('postgres_changes', {
        event : '*',
        schema: 'public',
        table : 'recepcion_items',
        filter: `recepcion_id=eq.${borradorId}`,
      }, async (payload) => {
        const newRow = (payload.new ?? null) as Partial<RecepcionItemRow> | null
        const oldRow = (payload.old ?? null) as Partial<RecepcionItemRow> | null
        const itemId = newRow?.id ?? oldRow?.id
        if (!itemId) return
        if (newRow?.last_edited_by === CLIENT_ID) return

        if (payload.eventType === 'DELETE') {
          setItems(prev => prev.filter(it => it.recepcion_item_id !== itemId))
          return
        }

        const prodById = new Map(prodRef.current.map(p => [p.id, p]))
        const fresh = await fetchItem(itemId, prodById)
        if (!fresh) return
        setItems(prev => {
          const idx = prev.findIndex(it => it.recepcion_item_id === itemId)
          if (idx === -1) return [...prev, fresh]
          const next = [...prev]
          next[idx] = fresh
          return next
        })
      })
      .on('postgres_changes', {
        event : '*',
        schema: 'public',
        table : 'recepcion_item_lotes',
      }, async (payload) => {
        const newRow = (payload.new ?? null) as Partial<LoteRow> | null
        const oldRow = (payload.old ?? null) as Partial<LoteRow> | null
        const itemId = newRow?.recepcion_item_id ?? oldRow?.recepcion_item_id
        if (!itemId) return
        if (newRow?.last_edited_by === CLIENT_ID) return

        // Refetch lotes for that item and re-merge
        const { data: lotesRows } = await supabase
          .from('recepcion_item_lotes')
          .select('cantidad,fecha_vencimiento,numero_lote')
          .eq('recepcion_item_id', itemId)
          .order('fecha_vencimiento', { ascending: true })
        const lotes: Lote[] = ((lotesRows ?? []) as Array<{ cantidad: number; fecha_vencimiento: string | null; numero_lote: string | null }>).map(l => ({
          cantidad         : l.cantidad,
          fecha_vencimiento: l.fecha_vencimiento ?? '',
          numero_lote      : l.numero_lote ?? undefined,
        }))
        setItems(prev => prev.map(it => {
          if (it.recepcion_item_id !== itemId) return it
          const cantidad_recibida = lotes.length > 0
            ? lotes.reduce((s, l) => s + l.cantidad, 0)
            : it.cantidad_recibida
          return { ...it, lotes, cantidad_recibida }
        }))
      })
      .on('postgres_changes', {
        event : '*',
        schema: 'public',
        table : 'recepcion_item_fraccionamiento',
      }, async (payload) => {
        const newRow = (payload.new ?? null) as Partial<FracRow & { last_edited_by: string | null }> | null
        const oldRow = (payload.old ?? null) as Partial<FracRow> | null
        const itemId = newRow?.recepcion_item_id ?? oldRow?.recepcion_item_id
        if (!itemId) return
        if (newRow?.last_edited_by === CLIENT_ID) return

        const { data: fracRows } = await supabase
          .from('recepcion_item_fraccionamiento')
          .select('producto_final_id,cantidad_objetivo')
          .eq('recepcion_item_id', itemId)
        const prodById = new Map(prodRef.current.map(p => [p.id, p]))
        const derivs: GranelDerivado[] = ((fracRows ?? []) as Array<{ producto_final_id: string; cantidad_objetivo: number | null }>).map(d => {
          const p = prodById.get(d.producto_final_id)
          return {
            producto_id      : d.producto_final_id,
            producto_sku     : p?.sku ?? '',
            producto_nombre  : p?.nombre ?? null,
            cantidad_objetivo: d.cantidad_objetivo ?? undefined,
          }
        })
        setItems(prev => prev.map(it => it.recepcion_item_id === itemId ? { ...it, derivados: derivs } : it))
      })
      .on('presence', { event: 'sync' }, () => {
        if (!onPresence) return
        const state = channel.presenceState()
        onPresence(Object.keys(state).length)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ joinedAt: Date.now(), clientId: CLIENT_ID })
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [borradorId])
}
