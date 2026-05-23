'use client'

import { supabase } from '@/lib/supabase'

/**
 * Fetches all rows from a Supabase view/table using range pagination.
 * Replaces the ad-hoc while(true) loops scattered across pages.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllFromView<T = any>(
  viewName: string,
  options?: {
    select?: string
    filters?: Array<{ column: string; operator: string; value: unknown }>
    order?: { column: string; ascending?: boolean }
    batchSize?: number
  },
): Promise<T[]> {
  const {
    select = '*',
    filters = [],
    order,
    batchSize = 1000,
  } = options ?? {}

  const results: T[] = []
  let from = 0

  while (true) {
    let q = supabase.from(viewName).select(select)

    for (const f of filters) {
      if (f.operator === 'eq') q = q.eq(f.column, f.value)
      else if (f.operator === 'gt') q = q.gt(f.column, f.value)
      else if (f.operator === 'gte') q = q.gte(f.column, f.value)
      else if (f.operator === 'in') q = q.in(f.column, f.value as string[])
    }

    if (order) q = q.order(order.column, { ascending: order.ascending ?? true })
    q = q.range(from, from + batchSize - 1)

    const { data, error } = await q
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    results.push(...(data as unknown as T[]))
    if (data.length < batchSize) break
    from += batchSize
  }

  return results
}
