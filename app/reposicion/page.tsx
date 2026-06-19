'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { ReposicionItem } from '@/lib/types'
import { matchesQuery } from '@/lib/search'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { KpiCard } from '@/components/ui/kpi-card'
import { SkeletonCard, SkeletonTable } from '@/components/ui/skeleton'
import { Pagination } from '@/components/ui/pagination'
import { fetchAllFromView } from '@/lib/hooks/use-fetch-all'
import { usePagination } from '@/lib/hooks/use-pagination'
import { exportTablaXlsx, type ColumnaExport } from '@/lib/export-xlsx'
import { GONDOLA_MAX_UNITS } from '@/lib/constants'
import { ArrowRight, ShoppingCart, Shuffle, MoveHorizontal, CheckCircle, Download, Search, X } from 'lucide-react'

type Accion = 'ok' | 'redistribuir_s1' | 'redistribuir_s2' | 'traslado_entre_tiendas' | 'comprar'

interface Recomendacion {
  accion: Accion
  detalle: string
  urgencia: 0 | 1 | 2 | 3
}

const ACCION_CONFIG: Record<Accion, { label: string; className: string }> = {
  ok:                     { label: 'OK',              className: 'bg-green-100 text-green-700 border-green-200' },
  redistribuir_s1:        { label: 'Redistribuir S1', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  redistribuir_s2:        { label: 'Redistribuir S2', className: 'bg-sky-100 text-sky-700 border-sky-200' },
  traslado_entre_tiendas: { label: 'Traslado',        className: 'bg-amber-100 text-amber-700 border-amber-200' },
  comprar:                { label: 'Comprar',          className: 'bg-red-100 text-red-700 border-red-200' },
}

const FILTROS = [
  { key: 'todos',                  label: 'Todos' },
  { key: 'comprar',                label: 'Comprar' },
  { key: 'redistribuir_s1',        label: 'Redistribuir S1' },
  { key: 'redistribuir_s2',        label: 'Redistribuir S2' },
  { key: 'traslado_entre_tiendas', label: 'Traslado' },
  { key: 'ok',                     label: 'OK' },
] as const

// How many units to move from source to fill target up to GONDOLA_MAX_UNITS,
// taking at most 60% of source and always leaving at least 2 in source.
function transferQty(sourceStock: number, targetStock = 0): number {
  const needed = GONDOLA_MAX_UNITS - targetStock
  const canSend = Math.floor(sourceStock * 0.6)
  return Math.max(0, Math.min(needed, canSend, sourceStock - 2))
}

function computeRecomendacion(r: ReposicionItem): Recomendacion {
  const isLow = (stock: number) => stock <= 2
  const isGranel = r.categoria === 'GRANEL'

  const s1Low = isLow(r.soho1_local)
  const s2Low = isLow(r.soho2_local)

  if (s1Low) {
    if (r.soho1_pieza > 2) {
      const qty = transferQty(r.soho1_pieza, r.soho1_local)
      return { accion: 'redistribuir_s1', detalle: `Pasar ${qty}ud Pieza → Local`, urgencia: 1 }
    }
    if (r.soho2_local > 2) {
      const qty = transferQty(r.soho2_local, r.soho1_local)
      return { accion: 'traslado_entre_tiendas', detalle: `Trasladar ${qty}ud Local S2 → S1`, urgencia: 2 }
    }
    if (isGranel && r.soho2_deposito > 2) {
      const qty = transferQty(r.soho2_deposito, r.soho1_local)
      return { accion: 'traslado_entre_tiendas', detalle: `Trasladar ${qty}ud Depósito S2 → S1`, urgencia: 2 }
    }
    if (isGranel)
      return { accion: 'comprar', detalle: 'Comprar — sin stock para redistribuir', urgencia: 3 }
    return { accion: 'ok', detalle: 'Sin depósito — ver Compras', urgencia: 0 }
  }

  if (s2Low) {
    if (isGranel && r.soho2_deposito > 2) {
      const qty = transferQty(r.soho2_deposito, r.soho2_local)
      return { accion: 'redistribuir_s2', detalle: `Pasar ${qty}ud Depósito → Local S2`, urgencia: 1 }
    }
    if (isGranel)
      return { accion: 'comprar', detalle: 'Comprar — sin stock en depósito', urgencia: 3 }
    return { accion: 'ok', detalle: 'Sin depósito — ver Compras', urgencia: 0 }
  }

  return { accion: 'ok', detalle: 'Góndola OK', urgencia: 0 }
}

function StockCell({ value, isSource = false }: { value: number; isSource?: boolean }) {
  const cls =
    value < 0   ? 'text-red-700 font-bold' :
    value === 0 ? 'text-red-500 font-semibold' :
    isSource && value <= 2 ? 'text-amber-600' :
    !isSource && value <= GONDOLA_MAX_UNITS ? 'text-amber-600' :
    'text-zinc-700'
  return <span className={`tabular-nums ${cls}`}>{value}</span>
}

function CoberturaCell({ stock, vel }: { stock: number; vel: number }) {
  if (vel <= 0) return <span className="text-zinc-300">—</span>
  const dias = Math.round(stock / vel)
  const cls =
    dias === 0 ? 'text-red-600 font-bold' :
    dias < 3   ? 'text-red-500 font-semibold' :
    dias < 7   ? 'text-amber-600' :
    'text-green-700'
  return <span className={cls}>{dias}d</span>
}

export default function ReposicionPage() {
  const [data, setData] = useState<ReposicionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filtro, setFiltro] = useState<string>('todos')
  const [syncedOnce, setSyncedOnce] = useState<boolean | undefined>(undefined)
  const [barcodeMap, setBarcodeMap] = useState<Map<string, string>>(new Map())
  const [scanHighlight, setScanHighlight] = useState<string | null>(null)
  const [scanMiss, setScanMiss] = useState(false)

  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const missTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
      if (missTimerRef.current) clearTimeout(missTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        // productos tiene >3000 filas: sin paginar, el mapa de códigos de barras quedaba incompleto
        const [syncRes, barcodes, reposData] = await Promise.all([
          supabase.from('productos').select('dux_sync_at').not('dux_sync_at', 'is', null).limit(1),
          fetchAllFromView<{ sku: string; codigo_barras: string | null }>('productos', {
            select: 'sku,codigo_barras',
            filters: [{ column: 'codigo_barras', operator: 'not.is', value: null }],
          }),
          fetchAllFromView<ReposicionItem>('v_reposicion_dashboard'),
        ])
        setSyncedOnce(syncRes.data != null && syncRes.data.length > 0)
        setBarcodeMap(new Map(
          barcodes.filter(p => p.codigo_barras).map(p => [p.codigo_barras!, p.sku])
        ))
        setData(reposData)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const enriched = useMemo(() =>
    data.map(r => ({ ...r, rec: computeRecomendacion(r) })),
    [data]
  )

  const stats = useMemo(() => ({
    ok:       enriched.filter(r => r.rec.accion === 'ok').length,
    redist:   enriched.filter(r => r.rec.accion === 'redistribuir_s1' || r.rec.accion === 'redistribuir_s2').length,
    traslado: enriched.filter(r => r.rec.accion === 'traslado_entre_tiendas').length,
    comprar:  enriched.filter(r => r.rec.accion === 'comprar').length,
  }), [enriched])

  const negativeStocks = useMemo(() =>
    enriched.filter(r => r.soho1_local < 0 || r.soho1_pieza < 0 || r.soho2_local < 0 || r.soho2_deposito < 0),
    [enriched]
  )

  const filtered = useMemo(() =>
    enriched
      .filter(r => {
        if (search && !matchesQuery(search, r.nombre, r.sku)) return false
        if (filtro !== 'todos' && r.rec.accion !== filtro) return false
        return true
      })
      .sort((a, b) => b.rec.urgencia - a.rec.urgencia),
    [enriched, search, filtro]
  )

  const { paged, page, setPage, total, pageSize } = usePagination(filtered)
  useEffect(() => { setPage(1) }, [filtered]) // eslint-disable-line react-hooks/exhaustive-deps

  function exportarExcel() {
    type EnrichedRow = (typeof enriched)[number]
    const cols: ColumnaExport<EnrichedRow>[] = [
      { header: 'SKU',           value: r => r.sku },
      { header: 'Nombre',        value: r => r.nombre ?? r.sku },
      { header: 'S1 Local',      value: r => r.soho1_local },
      { header: 'S1 Pieza',      value: r => r.soho1_pieza },
      { header: 'S2 Local',      value: r => r.soho2_local },
      { header: 'S2 Depósito',   value: r => r.soho2_deposito },
      { header: 'Vel/día',       value: r => r.ventas_prom_dia > 0 ? Number(r.ventas_prom_dia.toFixed(2)) : 0 },
      { header: 'Cob S1 (días)', value: r => r.ventas_prom_dia > 0 ? Math.round(r.soho1_local / r.ventas_prom_dia) : '' },
      { header: 'Acción',        value: r => ACCION_CONFIG[r.rec.accion].label },
      { header: 'Instrucción',   value: r => r.rec.detalle },
    ]
    exportTablaXlsx('reposicion', cols, filtered, 'Reposición')
  }

  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const term = search.trim()
    if (!term) return
    const sku = barcodeMap.get(term) ?? term
    const found = data.find(r => r.sku === sku)
    if (found) {
      setSearch(found.nombre ?? found.sku)
      setScanHighlight(found.producto_id)
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
      scanTimerRef.current = setTimeout(() => setScanHighlight(null), 3000)
    } else {
      setScanMiss(true)
      if (missTimerRef.current) clearTimeout(missTimerRef.current)
      missTimerRef.current = setTimeout(() => setScanMiss(false), 1500)
    }
  }

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Reposición en Cascada</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Algoritmo: La Pieza → LOCAL S1 → SOHO 2 → Comprar · Góndola máx. {GONDOLA_MAX_UNITS} unidades
        </p>
      </div>

      {syncedOnce === false && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Stock pendiente de sincronización con Dux — los datos se actualizarán en la próxima ventana automática.
        </div>
      )}

      {!loading && negativeStocks.length > 0 && (
        <div className="rounded-md bg-red-50 border border-red-300 px-4 py-3 text-sm text-red-800">
          <strong>⚠ Stock negativo detectado</strong> — revisá estos SKUs en Dux:{' '}
          <span className="font-mono">
            {negativeStocks.slice(0, 10).map(r => r.sku).join(', ')}
            {negativeStocks.length > 10 && ` y ${negativeStocks.length - 10} más`}
          </span>
        </div>
      )}

      {/* KPIs */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Comprar urgente"
            value={stats.comprar}
            variant="danger"
            icon={ShoppingCart}
            active={filtro === 'comprar'}
            onClick={() => setFiltro(f => f === 'comprar' ? 'todos' : 'comprar')}
          />
          <KpiCard
            label="Trasladar entre locales"
            value={stats.traslado}
            variant="warning"
            icon={MoveHorizontal}
            active={filtro === 'traslado_entre_tiendas'}
            onClick={() => setFiltro(f => f === 'traslado_entre_tiendas' ? 'todos' : 'traslado_entre_tiendas')}
          />
          <KpiCard
            label="Redistribuir"
            value={stats.redist}
            variant="info"
            icon={Shuffle}
            active={filtro === 'redistribuir_s1'}
            onClick={() => setFiltro(f => f === 'redistribuir_s1' ? 'todos' : 'redistribuir_s1')}
          />
          <KpiCard
            label="OK"
            value={stats.ok}
            variant="success"
            icon={CheckCircle}
            active={filtro === 'ok'}
            onClick={() => setFiltro(f => f === 'ok' ? 'todos' : 'ok')}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <Input
            placeholder="Buscar, SKU o código de barras..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleSearchKey}
            className="w-64 pl-8"
          />
          {search && (
            <button onClick={() => setSearch('')} type="button" tabIndex={-1}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-300 hover:text-zinc-500">
              <X size={13} />
            </button>
          )}
          {scanMiss && (
            <span className="absolute -bottom-5 left-0 text-xs text-red-500 whitespace-nowrap">Código no encontrado</span>
          )}
        </div>
        <div className="flex gap-1 flex-wrap">
          {FILTROS.map(f => (
            <button
              key={f.key}
              onClick={() => setFiltro(f.key)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                filtro === f.key
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'text-zinc-600 border-zinc-200 hover:bg-zinc-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-zinc-400">{loading ? '—' : `${total} productos`}</span>
        <button
          onClick={exportarExcel}
          disabled={loading || filtered.length === 0}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 transition-colors"
        >
          <Download size={13} />
          Exportar Excel
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        {loading ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50">
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">S1 Local</TableHead>
                  <TableHead className="text-right">S1 Pieza</TableHead>
                  <TableHead className="text-right">S2 Local</TableHead>
                  <TableHead className="text-right">S2 Depósito</TableHead>
                  <TableHead className="text-right">Vel/día</TableHead>
                  <TableHead className="text-right">Cob S1</TableHead>
                  <TableHead>Recomendación</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <SkeletonTable rows={10} cols={8} />
              </TableBody>
            </Table>
          </div>
        ) : data.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-zinc-500 font-medium">Sin datos de stock</p>
            <p className="text-zinc-400 text-sm mt-1">
              El stock se actualizará en la próxima ventana de sincronización con Dux
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50">
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">S1 Local</TableHead>
                  <TableHead className="text-right">S1 Pieza</TableHead>
                  <TableHead className="text-right">S2 Local</TableHead>
                  <TableHead className="text-right">S2 Depósito</TableHead>
                  <TableHead className="text-right">Vel/día</TableHead>
                  <TableHead className="text-right">Cob S1</TableHead>
                  <TableHead>Recomendación</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-zinc-400 py-12">
                      No hay productos con este filtro
                    </TableCell>
                  </TableRow>
                ) : (
                  paged.map(r => {
                    const cfg = ACCION_CONFIG[r.rec.accion]
                    return (
                      <TableRow
                        key={r.producto_id}
                        className={`hover:bg-zinc-50 ${scanHighlight === r.producto_id ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : ''}`}
                      >
                        <TableCell>
                          <div className="font-medium text-sm">{r.nombre ?? r.sku}</div>
                          <div className="text-xs text-zinc-400 font-mono">{r.sku}</div>
                          {r.categoria && <div className="text-xs text-zinc-400">{r.categoria}</div>}
                        </TableCell>
                        <TableCell className="text-right">
                          <StockCell value={r.soho1_local} />
                        </TableCell>
                        <TableCell className="text-right">
                          <StockCell value={r.soho1_pieza} isSource />
                        </TableCell>
                        <TableCell className="text-right">
                          <StockCell value={r.soho2_local} />
                        </TableCell>
                        <TableCell className="text-right">
                          <StockCell value={r.soho2_deposito} isSource />
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-zinc-400 text-xs">
                          {r.ventas_prom_dia > 0 ? r.ventas_prom_dia.toFixed(2) : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <CoberturaCell stock={r.soho1_local} vel={r.ventas_prom_dia} />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <Badge className={`${cfg.className} text-xs w-fit`}>{cfg.label}</Badge>
                            <span className="text-xs text-zinc-500 flex items-center gap-1">
                              {r.rec.accion !== 'ok' && r.rec.accion !== 'comprar' && <ArrowRight size={10} className="shrink-0" />}
                              {r.rec.detalle}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {!loading && total > pageSize && (
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
      )}

      {!loading && stats.comprar > 0 && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span>{stats.comprar} productos necesitan compra.</span>
          <Link href="/compras" className="text-zinc-900 underline font-medium">
            Ver en Compras →
          </Link>
        </div>
      )}

    </div>
  )
}
