/**
 * GET /api/dux/fetch-producto?q=<query>
 *
 * Busca un producto en Dux paginando todo el catálogo y filtrando localmente
 * porque la API de Dux v1 /items NO soporta filtros (los ignora silenciosamente).
 *
 * Streams progress as NDJSON (one JSON object per line) so the UI can show
 * "página 15/54". Stops as soon as a match is found (early exit).
 *
 * Match criteria (case-insensitive):
 *   - cod_item exacto
 *   - codigos_barra exacto (cualquiera del array)
 *   - codigo_externo exacto
 *   - item contiene TODOS los tokens del query (palabras de >=2 chars)
 *
 * Bonus: cada página escaneada hace upsert a la tabla `productos` para que
 * la próxima búsqueda sea más rápida.
 */

import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 min — Dux rate-limit forces this floor

const DUX_BASE  = 'https://erp.duxsoftware.com.ar/WSERP/rest/services'
const DUX_TOKEN = process.env.DUX_API_TOKEN ?? ''

const PAGE_SIZE      = 50
const MAX_PAGES      = 60 // 60 × 50 = 3000 items, safety cap above catalog size
const RATE_LIMIT_MS  = 5100

const toFloat = (v: unknown) => { const n = parseFloat(String(v ?? 0)); return isNaN(n) ? 0 : n }
const toInt   = (v: unknown) => { const n = parseInt(String(v ?? 0));   return isNaN(n) ? 0 : n }
const now     = () => new Date().toISOString()
const sleep   = (ms: number) => new Promise(r => setTimeout(r, ms))

interface DuxItem {
  cod_item       ?: string
  codigo         ?: string
  codigo_externo ?: string
  codigos_barra  ?: string | string[]
  item           ?: string
  costo          ?: number | string
  porc_iva       ?: number | string
  precios        ?: Array<{ nombre?: string; precio?: number | string }>
  stock          ?: Array<{ nombre?: string; stock_disponible?: number; ctd_disponible?: number; stock_real?: number }>
  rubro          ?: { nombre?: string } | null
  sub_rubro      ?: { nombre?: string } | null
  marca          ?: { marca?: string }  | null
  proveedor      ?: { proveedor?: string; id_proveedor?: number | string } | null
}

interface DuxPage {
  paging  ?: { total: number; offset: number; limit: number }
  results ?: DuxItem[]
}

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, ' ').split(/\s+/).filter(t => t.length >= 2)
}

function itemMatchesQuery(item: DuxItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  // Identifier exact match
  if (String(item.cod_item ?? '').toLowerCase() === q) return true
  if (String(item.codigo ?? '').toLowerCase() === q) return true
  if (String(item.codigo_externo ?? '').toLowerCase() === q) return true
  const barras = Array.isArray(item.codigos_barra) ? item.codigos_barra : (item.codigos_barra ? [item.codigos_barra] : [])
  if (barras.some(b => String(b).toLowerCase() === q)) return true
  // Name match: all query tokens (>= 2 chars) must appear in item name
  const tokens = tokenize(q)
  if (tokens.length > 0) {
    const name = (item.item ?? '').toLowerCase()
    if (tokens.every(t => name.includes(t))) return true
  }
  return false
}

function itemToPatch(item: DuxItem): { sku: string; patch: Record<string, unknown> } | null {
  const sku = String(item.cod_item ?? item.codigo ?? '').trim()
  if (!sku) return null
  const precios     = Array.isArray(item.precios) ? item.precios : []
  const precRow     = precios.find(p => String(p.nombre ?? '').toUpperCase().includes('CONSUMIDOR')) ?? precios[0]
  const precioVenta = precRow ? toFloat(precRow.precio) : null
  const stockArr    = Array.isArray(item.stock) ? item.stock : []
  const stockTotal  = stockArr.reduce((s, d) => s + toInt(d.stock_disponible ?? d.ctd_disponible ?? d.stock_real ?? 0), 0)

  const patch: Record<string, unknown> = { sku, stock_dux: stockTotal, dux_sync_at: now(), estado: 'activo' }
  if (item.item)                   patch.nombre           = String(item.item).trim()
  if (item.costo)                  patch.costo            = toFloat(item.costo)
  if (precioVenta)                 patch.precio_venta     = precioVenta
  if (item.porc_iva)               patch.iva_porcentaje   = toFloat(item.porc_iva)
  if (item.rubro?.nombre)          patch.categoria        = String(item.rubro.nombre).trim()
  if (item.sub_rubro?.nombre)      patch.sub_categoria    = String(item.sub_rubro.nombre).trim()
  if (item.marca?.marca)           patch.marca            = String(item.marca.marca).trim()
  if (item.proveedor?.proveedor)   patch.proveedor_nombre = String(item.proveedor.proveedor).trim()
  if (item.proveedor?.id_proveedor) patch.proveedor_id_dux = toInt(item.proveedor.id_proveedor)
  const ce = String(item.codigo_externo ?? '').trim(); if (ce) patch.codigo_externo = ce
  const barras = Array.isArray(item.codigos_barra) ? item.codigos_barra : (item.codigos_barra ? [item.codigos_barra] : [])
  const cb = String(barras[0] ?? '').trim(); if (cb) patch.codigo_barras = cb
  return { sku, patch }
}

async function duxPage(offset: number): Promise<DuxPage> {
  const url = new URL(`${DUX_BASE}/items`)
  url.searchParams.set('offset', String(offset))
  url.searchParams.set('limit', String(PAGE_SIZE))
  url.searchParams.set('habilitado', 'SI')
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': DUX_TOKEN, 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`Dux ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return await res.json() as DuxPage
}

export async function GET(req: NextRequest) {
  if (!DUX_TOKEN) return new Response(JSON.stringify({ error: 'DUX_API_TOKEN no configurada' }), { status: 503 })

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (!q) return new Response(JSON.stringify({ error: 'Falta el parámetro q' }), { status: 400 })

  // Stream NDJSON so the UI can show "page X of Y" progress while the scan runs
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      try {
        // Fetch first page to learn total
        let firstPage: DuxPage
        try {
          firstPage = await duxPage(0)
        } catch (e) {
          send({ type: 'error', error: (e as Error).message })
          controller.close()
          return
        }
        const total = firstPage.paging?.total ?? 0
        const totalPages = Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE))
        send({ type: 'start', total_items: total, total_pages: totalPages })

        const processPage = async (page: DuxPage, pageIdx: number): Promise<{ done: boolean }> => {
          const items = page.results ?? []
          if (items.length === 0) return { done: true }

          // Batch upsert all items to productos for future-cache benefit
          const patches = items.map(itemToPatch).filter((x): x is { sku: string; patch: Record<string, unknown> } => x !== null)
          if (patches.length > 0) {
            await supabase.from('productos').upsert(patches.map(p => p.patch), { onConflict: 'sku' })
          }

          // Look for match in this page
          const match = items.find(it => itemMatchesQuery(it, q))
          if (match) {
            const patchInfo = itemToPatch(match)
            if (patchInfo) {
              const { data: prod, error } = await supabase
                .from('productos')
                .upsert(patchInfo.patch, { onConflict: 'sku' })
                .select('id, sku, nombre, codigo_barras, codigo_externo, precio_venta, costo, proveedor_id_dux, categoria')
                .single()
              if (error || !prod) {
                send({ type: 'error', error: error?.message ?? 'Error al guardar producto' })
              } else {
                send({ type: 'found', producto: prod, page: pageIdx + 1 })
              }
            }
            return { done: true }
          }
          send({ type: 'progress', page: pageIdx + 1, total_pages: totalPages })
          return { done: false }
        }

        // Process first page
        const r0 = await processPage(firstPage, 0)
        if (r0.done) { controller.close(); return }

        // Iterate remaining pages with rate limit
        for (let pageIdx = 1; pageIdx < totalPages; pageIdx++) {
          await sleep(RATE_LIMIT_MS)
          let page: DuxPage
          try {
            page = await duxPage(pageIdx * PAGE_SIZE)
          } catch (e) {
            send({ type: 'error', error: (e as Error).message, page: pageIdx + 1 })
            controller.close()
            return
          }
          const r = await processPage(page, pageIdx)
          if (r.done) { controller.close(); return }
        }
        // No match after scanning all pages
        send({ type: 'notFound' })
        controller.close()
      } catch (e) {
        send({ type: 'error', error: (e as Error).message })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  })
}
