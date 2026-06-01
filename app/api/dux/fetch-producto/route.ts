/**
 * GET /api/dux/fetch-producto?q=<sku-o-codigo-barras>
 *
 * Trae un único producto de Dux on-demand (por código o código de barras) y lo
 * upsertea en la tabla `productos`. Sirve para el flujo de recepción cuando se
 * crea un producto nuevo en Dux y se necesita verlo en la app sin esperar al
 * próximo dux-sync (que tarda horas).
 *
 * Estrategia:
 *   1. Probar filtro por cod_item
 *   2. Si no aparece, probar filtro por codigos_barra
 *   3. Si tampoco, 404
 *
 * Devuelve el producto upserteado para que el cliente lo agregue al estado local.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const DUX_BASE  = 'https://erp.duxsoftware.com.ar/WSERP/rest/services'
const DUX_TOKEN = process.env.DUX_API_TOKEN ?? ''

const toFloat = (v: unknown) => { const n = parseFloat(String(v ?? 0)); return isNaN(n) ? 0 : n }
const toInt   = (v: unknown) => { const n = parseInt(String(v ?? 0));   return isNaN(n) ? 0 : n }
const now     = () => new Date().toISOString()

interface DuxItem {
  cod_item       ?: string
  codigo         ?: string
  codigo_externo ?: string
  codigos_barra  ?: string
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

function extractItems(data: unknown): DuxItem[] {
  if (Array.isArray(data)) return data as DuxItem[]
  const d = data as Record<string, unknown>
  if (Array.isArray(d?.results)) return d.results as DuxItem[]
  if (Array.isArray(d?.data))    return d.data    as DuxItem[]
  if (Array.isArray(d?.items))   return d.items   as DuxItem[]
  return []
}

async function duxItemsQuery(params: Record<string, string | number>): Promise<DuxItem[]> {
  const url = new URL(`${DUX_BASE}/items`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${DUX_TOKEN}`, 'Accept': 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Dux ${res.status}: ${body.slice(0, 200)}`)
  }
  return extractItems(await res.json())
}

export async function GET(req: NextRequest) {
  if (!DUX_TOKEN) {
    return NextResponse.json({ error: 'DUX_API_TOKEN no configurada' }, { status: 503 })
  }

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  if (!q) return NextResponse.json({ error: 'Falta el parámetro q' }, { status: 400 })

  // ── Buscar en Dux con varias estrategias ──────────────────────
  let match: DuxItem | null = null

  // 1) Por código de item
  try {
    const items = await duxItemsQuery({ cod_item: q, habilitado: 'SI', limit: 20 })
    match = items.find(i => String(i.cod_item ?? '').trim() === q)
         ?? items.find(i => String(i.codigo ?? '').trim() === q)
         ?? null
  } catch (e) {
    console.error('[fetch-producto] cod_item query failed:', (e as Error).message)
  }

  // 2) Por código de barras
  if (!match) {
    try {
      const items = await duxItemsQuery({ codigos_barra: q, habilitado: 'SI', limit: 20 })
      match = items.find(i => String(i.codigos_barra ?? '').trim() === q) ?? items[0] ?? null
    } catch (e) {
      console.error('[fetch-producto] codigos_barra query failed:', (e as Error).message)
    }
  }

  // 3) Por código externo (a veces el SKU del proveedor)
  if (!match) {
    try {
      const items = await duxItemsQuery({ codigo_externo: q, habilitado: 'SI', limit: 20 })
      match = items.find(i => String(i.codigo_externo ?? '').trim() === q) ?? items[0] ?? null
    } catch (e) {
      console.error('[fetch-producto] codigo_externo query failed:', (e as Error).message)
    }
  }

  if (!match) {
    return NextResponse.json({ error: `Producto "${q}" no encontrado en Dux` }, { status: 404 })
  }

  // ── Upsert en productos ───────────────────────────────────────
  const item = match
  const sku  = String(item.cod_item ?? item.codigo ?? '').trim()
  if (!sku) return NextResponse.json({ error: 'Producto de Dux sin cod_item' }, { status: 500 })

  const precios     = Array.isArray(item.precios) ? item.precios : []
  const precRow     = precios.find(p => String(p.nombre ?? '').toUpperCase().includes('CONSUMIDOR')) ?? precios[0]
  const precioVenta = precRow ? toFloat(precRow.precio) : null
  const stockArr    = Array.isArray(item.stock) ? item.stock : []
  const stockTotal  = stockArr.reduce((s, d) => s + toInt(d.stock_disponible ?? d.ctd_disponible ?? d.stock_real ?? 0), 0)

  const patch: Record<string, unknown> = { sku, stock_dux: stockTotal, dux_sync_at: now(), estado: 'activo' }
  if (item.item)               patch.nombre          = String(item.item).trim()
  if (item.costo)              patch.costo           = toFloat(item.costo)
  if (precioVenta)             patch.precio_venta    = precioVenta
  if (item.porc_iva)           patch.iva_porcentaje  = toFloat(item.porc_iva)
  if (item.rubro?.nombre)      patch.categoria       = String(item.rubro.nombre).trim()
  if (item.sub_rubro?.nombre)  patch.sub_categoria   = String(item.sub_rubro.nombre).trim()
  if (item.marca?.marca)       patch.marca           = String(item.marca.marca).trim()
  if (item.proveedor?.proveedor)   patch.proveedor_nombre  = String(item.proveedor.proveedor).trim()
  if (item.proveedor?.id_proveedor) patch.proveedor_id_dux = toInt(item.proveedor.id_proveedor)
  const ce = String(item.codigo_externo ?? '').trim(); if (ce) patch.codigo_externo = ce
  const cb = String(item.codigos_barra  ?? '').trim(); if (cb) patch.codigo_barras  = cb

  const { data: prod, error: upErr } = await supabase
    .from('productos')
    .upsert(patch, { onConflict: 'sku' })
    .select('id, sku, nombre, codigo_barras, codigo_externo, precio_venta, costo, proveedor_id_dux, categoria')
    .single()

  if (upErr || !prod) {
    console.error('[fetch-producto] upsert failed:', upErr)
    return NextResponse.json({ error: upErr?.message ?? 'Error al guardar el producto' }, { status: 500 })
  }

  return NextResponse.json({ producto: prod })
}
