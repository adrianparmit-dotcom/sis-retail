'use client'

import { supabase } from '@/lib/supabase'

/**
 * Fetches all rows from a Supabase view/table using range pagination.
 * Replaces the ad-hoc while(true) loops scattered across pages.
 *
 * IMPORTANTE: PostgREST corta cada request en ~1000 filas, así que cualquier
 * tabla/vista que pueda superar eso (productos ~3200, vistas de compras ~3800)
 * DEBE leerse con este helper y no con un .select() directo.
 *
 * ⚠️ SIEMPRE pasar `order` por una columna ÚNICA cuando el resultado pueda
 * superar las 1000 filas. Cada página es un query independiente: si el orden
 * no es determinístico, Postgres puede devolver las filas empatadas en distinto
 * orden en cada pedido, y entonces algunas aparecen DUPLICADAS y otras se
 * PIERDEN. No alcanza con que la vista traiga su propio ORDER BY: si ese orden
 * empata (ej. v_compras_inteligentes_v4 empata 3188 filas en ventas_30d=0),
 * el problema aparece igual. Ordenar por PK (`id`) o por `sku`, o agregar una
 * columna de desempate al final (ej. `[{sku}, {location_id}]`).
 */

export interface FetchAllFilter {
  column: string
  /**
   * eq/neq/gt/gte/lt/lte/in: filtros estándar.
   * not.is: `.not(column, 'is', value)` — ej. excluir NULL con value=null.
   * or: `.or(value)` — `column` se ignora; value es la expresión PostgREST
   *     (ej. "proveedor_nombre.is.null,proveedor_nombre.eq.").
   */
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not.is' | 'or'
  value: unknown
}

export interface FetchAllOrder {
  column: string
  ascending?: boolean
  nullsFirst?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllFromView<T = any>(
  viewName: string,
  options?: {
    select?: string
    filters?: FetchAllFilter[]
    order?: FetchAllOrder | FetchAllOrder[]
    batchSize?: number
  },
): Promise<T[]> {
  const {
    select = '*',
    filters = [],
    order,
    batchSize = 1000,
  } = options ?? {}

  const orders = order ? (Array.isArray(order) ? order : [order]) : []
  const results: T[] = []
  let from = 0

  while (true) {
    let q = supabase.from(viewName).select(select)

    for (const f of filters) {
      if (f.operator === 'eq') q = q.eq(f.column, f.value)
      else if (f.operator === 'neq') q = q.neq(f.column, f.value)
      else if (f.operator === 'gt') q = q.gt(f.column, f.value)
      else if (f.operator === 'gte') q = q.gte(f.column, f.value)
      else if (f.operator === 'lt') q = q.lt(f.column, f.value)
      else if (f.operator === 'lte') q = q.lte(f.column, f.value)
      else if (f.operator === 'in') q = q.in(f.column, f.value as string[])
      else if (f.operator === 'not.is') q = q.not(f.column, 'is', f.value)
      else if (f.operator === 'or') q = q.or(String(f.value))
    }

    for (const o of orders) {
      q = q.order(o.column, { ascending: o.ascending ?? true, nullsFirst: o.nullsFirst })
    }
    q = q.range(from, from + batchSize - 1)

    const { data, error } = await q
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    results.push(...(data as unknown as T[]))
    if (data.length < batchSize) break

    // Se necesita más de una página: sin orden determinístico el resultado
    // vendría con filas repetidas y otras faltantes. Avisar en desarrollo.
    if (orders.length === 0 && process.env.NODE_ENV === 'development') {
      console.warn(
        `[fetchAllFromView] "${viewName}" supera ${batchSize} filas y se está ` +
        'paginando SIN "order". El resultado puede traer duplicados y perder ' +
        'filas. Pasar order por una columna única (id/sku).',
      )
    }

    from += batchSize
  }

  return results
}
