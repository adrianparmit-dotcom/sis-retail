'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { Vencimiento, ProductoCompra } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fetchAllFromView } from '@/lib/hooks/use-fetch-all'
import { matchesQuery } from '@/lib/search'
import { PROMO_ESTADOS, type PromoEstado } from '@/lib/constants'
import { Printer, Search, X, Star } from 'lucide-react'
import Link from 'next/link'

type PromoTipo = '10%' | '20%' | '30%' | '2x1' | '3x2'

interface Sugerencia {
  producto_id: string
  sku: string
  nombre: string | null
  categoria: string | null
  tipo: PromoTipo
  motivo: string
  dias_al_vencimiento: number | null
  velocidad_venta_diaria: number
  stock: number
  costo: number | null
  precio_venta: number | null
  // computed
  margen_resultante: number | null
  perdida_estimada: number | null
}

interface PromoGuardada {
  id: string
  producto_id: string
  tipo: string
  estado: PromoEstado
  motivo: string | null
  descuento: number
  dias_al_vencimiento: number | null
  velocidad_venta_diaria: number
  fecha_desde: string
  fecha_hasta: string | null
  created_at: string
  updated_at?: string | null
  // joined
  sku?: string
  nombre?: string | null
  categoria?: string | null
}

const TIPO_CONFIG: Record<PromoTipo, { label: string; sublabel: string; className: string; descuento: number }> = {
  '10%': { label: '10% OFF', sublabel: 'Descuento suave',    className: 'bg-blue-100 text-blue-700 border-blue-200',     descuento: 10 },
  '20%': { label: '20% OFF', sublabel: 'Descuento moderado', className: 'bg-amber-100 text-amber-700 border-amber-200',  descuento: 20 },
  '30%': { label: '30% OFF', sublabel: 'Descuento fuerte',   className: 'bg-orange-100 text-orange-700 border-orange-200', descuento: 30 },
  '2x1': { label: '2×1',    sublabel: 'Llevá 2, pagá 1',    className: 'bg-red-100 text-red-700 border-red-200',         descuento: 50 },
  '3x2': { label: '3×2',    sublabel: 'Llevá 3, pagá 2',    className: 'bg-purple-100 text-purple-700 border-purple-200', descuento: 33 },
}

const ESTADO_CONFIG: Record<PromoEstado, { label: string; className: string }> = {
  propuesta:       { label: 'Propuesta',       className: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  preaprobada:     { label: 'Preaprobada',     className: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  impacta_compras: { label: 'Impacta Compras', className: 'bg-sky-100 text-sky-700 border-sky-200' },
  stock_recibido:  { label: 'Stock Recibido',  className: 'bg-violet-100 text-violet-700 border-violet-200' },
  activa:          { label: 'Activa',          className: 'bg-green-100 text-green-700 border-green-200' },
  finalizada:      { label: 'Finalizada',      className: 'bg-blue-100 text-blue-700 border-blue-200' },
  descartada:      { label: 'Descartada',      className: 'bg-red-100 text-red-600 border-red-200' },
}

// State machine: what transitions are allowed from each state
const NEXT_STATES: Partial<Record<PromoEstado, PromoEstado[]>> = {
  propuesta:       ['preaprobada', 'descartada'],
  preaprobada:     ['impacta_compras', 'descartada'],
  impacta_compras: ['stock_recibido', 'descartada'],
  stock_recibido:  ['activa', 'descartada'],
  activa:          ['finalizada'],
}

// ─── Reglas comerciales de asignación de tipo ────────────────────────────────
// Vencimientos: urgencia = días que quedan
function tipoDesdeVencimiento(dias: number): PromoTipo {
  if (dias < 7)  return '2x1'   // Crítico: limpiar YA — llevá 2 pagá 1
  if (dias < 15) return '30%'   // Muy urgente: descuento fuerte
  if (dias < 22) return '20%'   // Moderado: descuento visible
  return '10%'                  // Preventivo: leve empuje
}

// Ventas mensuales: objetivo = generar ticket + rotar stock
function tipoDesdeVentas(c: ProductoCompra): PromoTipo {
  const margen = c.costo && c.precio_venta
    ? ((c.precio_venta - c.costo) / c.precio_venta) * 100
    : null
  if (c.dias_cobertura > 90) return '30%'               // Demasiado stock: reducir fuerte
  if (c.dias_cobertura > 60) return margen && margen > 35 ? '3x2' : '20%' // 3x2 si margen aguanta
  return '10%'                                           // Exceso moderado: empuje suave
}

function computeSugerencias(
  vencimientos: Vencimiento[],
  compras: ProductoCompra[],
): Sugerencia[] {
  const sugs: Sugerencia[] = []
  const seen = new Set<string>()

  // Group vencimientos by producto — pick the soonest expiry per product
  const vByProd = new Map<string, Vencimiento>()
  for (const v of vencimientos) {
    if (!['critico', 'alerta', 'proximo'].includes(v.estado)) continue
    const existing = vByProd.get(v.producto_id)
    if (!existing || (v.dias_para_vencer ?? 999) < (existing.dias_para_vencer ?? 999)) {
      vByProd.set(v.producto_id, v)
    }
  }

  // Sugerencias por vencimiento — urgencia determina el tipo
  for (const [prodId, v] of vByProd) {
    const dias = v.dias_para_vencer ?? 999
    const tipo = tipoDesdeVencimiento(dias)
    const c = compras.find(p => p.id === prodId)
    const margenBase = c?.costo && c?.precio_venta
      ? ((c.precio_venta - c.costo) / c.precio_venta) * 100 : null
    const desc = TIPO_CONFIG[tipo].descuento
    const margenResultante = margenBase !== null ? margenBase - desc : null
    const perdidaEstimada = c?.costo && c?.precio_venta
      ? (c.precio_venta * desc / 100) * v.cantidad : null

    sugs.push({
      producto_id: prodId,
      sku: v.sku,
      nombre: v.nombre,
      categoria: v.categoria,
      tipo,
      motivo: `Vence en ${dias}d (${v.cantidad} ud) — ${TIPO_CONFIG[tipo].sublabel}`,
      dias_al_vencimiento: dias,
      velocidad_venta_diaria: c?.vel_diaria ?? 0,
      stock: v.cantidad,
      costo: c?.costo ?? null,
      precio_venta: c?.precio_venta ?? null,
      margen_resultante: margenResultante,
      perdida_estimada: perdidaEstimada,
    })
    seen.add(prodId)
  }

  // Sugerencias por ventas mensuales — exceso de stock + objetivo de ticket
  for (const c of compras) {
    if (seen.has(c.id)) continue
    if (!c.vel_diaria || c.vel_diaria <= 0) continue
    if (c.dias_cobertura <= 45) continue

    const tipo = tipoDesdeVentas(c)
    const margenBase = c.costo && c.precio_venta
      ? ((c.precio_venta - c.costo) / c.precio_venta) * 100 : null
    const desc = TIPO_CONFIG[tipo].descuento
    const margenResultante = margenBase !== null ? margenBase - desc : null

    sugs.push({
      producto_id: c.id,
      sku: c.sku,
      nombre: c.nombre,
      categoria: c.categoria,
      tipo,
      motivo: `${Math.round(c.dias_cobertura)}d de stock, ${c.vel_diaria.toFixed(2)} ud/día — ${TIPO_CONFIG[tipo].sublabel}`,
      dias_al_vencimiento: null,
      velocidad_venta_diaria: c.vel_diaria,
      stock: c.stock_actual,
      costo: c.costo ?? null,
      precio_venta: c.precio_venta ?? null,
      margen_resultante: margenResultante,
      perdida_estimada: null,
    })
    seen.add(c.id)
  }

  // Sort: near-expiry first, then by dias_al_vencimiento asc
  return sugs.sort((a, b) => {
    if (a.dias_al_vencimiento !== null && b.dias_al_vencimiento !== null)
      return a.dias_al_vencimiento - b.dias_al_vencimiento
    if (a.dias_al_vencimiento !== null) return -1
    if (b.dias_al_vencimiento !== null) return 1
    return 0
  })
}

export default function PromocionesPage() {
  const [tab, setTab] = useState<'sugerencias' | 'guardadas'>('sugerencias')
  const [loading, setLoading] = useState(true)
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([])
  const [guardadas, setGuardadas] = useState<PromoGuardada[]>([])
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<Set<string>>(new Set()) // product_ids already saved this session
  const [search, setSearch] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<string>('todos')
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
    // productos tiene >3000 filas: sin paginar, el mapa de códigos de barras quedaba incompleto
    fetchAllFromView<{ sku: string; codigo_barras: string | null }>('productos', {
      select: 'sku,codigo_barras',
      filters: [{ column: 'codigo_barras', operator: 'not.is', value: null }],
    }).then(rows => {
      setBarcodeMap(new Map(
        rows.filter(p => p.codigo_barras).map(p => [p.codigo_barras!, p.sku])
      ))
    })

    async function load() {
      const [vencRes, comprasData, promoRes] = await Promise.all([
        supabase
          .from('v_vencimientos_fefo')
          .select('*')
          .in('estado', ['critico', 'alerta', 'proximo'])
          .gt('cantidad', 0),
        fetchAllFromView<ProductoCompra>('v_compras_inteligentes', {
          filters: [{ column: 'stock_actual', operator: 'gt', value: 0 }],
        }),
        supabase
          .from('promociones')
          .select('id, producto_id, tipo, estado, motivo, descuento, dias_al_vencimiento, velocidad_venta_diaria, fecha_desde, fecha_hasta, created_at, updated_at')
          .order('created_at', { ascending: false })
          .limit(500),
      ])

      const venc = (vencRes.data ?? []) as Vencimiento[]
      const compras = comprasData
      const promos = (promoRes.data ?? []) as PromoGuardada[]

      // Enrich guardadas with product info from compras
      const compraById = new Map(compras.map(c => [c.id, c]))
      const enrichedPromos = promos.map(p => {
        const c = compraById.get(p.producto_id)
        return { ...p, sku: c?.sku, nombre: c?.nombre, categoria: c?.categoria }
      })

      const sug = computeSugerencias(venc, compras)
      // Mark already-saved ones
      const savedIds = new Set(promos.map(p => p.producto_id))

      setSugerencias(sug)
      setGuardadas(enrichedPromos)
      setSaved(savedIds)
      setLoading(false)
    }
    load()
  }, [])

  const guardarPromo = useCallback(async (s: Sugerencia) => {
    setSaving(prev => new Set(prev).add(s.producto_id))
    const cfg = TIPO_CONFIG[s.tipo]
    const { error } = await supabase.from('promociones').insert({
      producto_id: s.producto_id,
      tipo: s.tipo,
      descuento: cfg.descuento,
      motivo: s.motivo,
      dias_al_vencimiento: s.dias_al_vencimiento,
      velocidad_venta_diaria: s.velocidad_venta_diaria,
      margen_resultante: s.margen_resultante,
      perdida_estimada: s.perdida_estimada,
      estado: 'propuesta',
    })
    if (!error) {
      setSaved(prev => new Set(prev).add(s.producto_id))
    }
    setSaving(prev => { const n = new Set(prev); n.delete(s.producto_id); return n })
  }, [])

  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const term = search.trim()
    if (!term) return
    const sku = barcodeMap.get(term) ?? term
    const foundSug = sugerencias.find(s => s.sku === sku)
    const foundGuard = guardadas.find(p => p.sku === sku)
    const found = foundSug ?? foundGuard
    if (found) {
      setSearch(('nombre' in found ? found.nombre : null) ?? found.sku ?? term)
      setScanHighlight(found.producto_id)
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
      scanTimerRef.current = setTimeout(() => setScanHighlight(null), 3000)
    } else {
      setScanMiss(true)
      if (missTimerRef.current) clearTimeout(missTimerRef.current)
      missTimerRef.current = setTimeout(() => setScanMiss(false), 1500)
    }
  }

  const cambiarEstado = useCallback(async (id: string, estado: PromoEstado) => {
    await supabase.from('promociones').update({ estado, updated_at: new Date().toISOString() }).eq('id', id)
    setGuardadas(prev => prev.map(p => p.id === id ? { ...p, estado } : p))
  }, [])

  const filteredSugs = useMemo(() =>
    sugerencias.filter(s => !search || matchesQuery(search, s.nombre, s.sku)),
    [sugerencias, search]
  )

  const filteredGuardadas = useMemo(() =>
    guardadas.filter(p => {
      if (search && !matchesQuery(search, p.nombre, p.sku)) return false
      if (filtroEstado !== 'todos' && p.estado !== filtroEstado) return false
      return true
    }),
    [guardadas, search, filtroEstado]
  )

  const statsGuardadas = useMemo(() => ({
    activas:    guardadas.filter(p => p.estado === 'activa').length,
    propuestas: guardadas.filter(p => p.estado === 'propuesta').length,
  }), [guardadas])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Promociones Inteligentes</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Motor de sugerencias — 5 tipos estándar asignados automáticamente por stock y vencimiento
          </p>
        </div>
        {!loading && (
          <div className="flex gap-4 text-sm text-right">
            <div>
              <p className="font-bold text-zinc-900">{statsGuardadas.activas}</p>
              <p className="text-zinc-400">activas</p>
            </div>
            <div>
              <p className="font-bold text-zinc-900">{statsGuardadas.propuestas}</p>
              <p className="text-zinc-400">propuestas</p>
            </div>
            <div>
              <p className="font-bold text-zinc-900">{sugerencias.length}</p>
              <p className="text-zinc-400">sugerencias</p>
            </div>
          </div>
        )}
      </div>

      {/* Panel 5 tipos estándar */}
      <div className="grid grid-cols-5 gap-2">
        {(Object.entries(TIPO_CONFIG) as [PromoTipo, typeof TIPO_CONFIG[PromoTipo]][]).map(([tipo, cfg]) => (
          <div key={tipo} className={`rounded-lg border px-3 py-2.5 ${cfg.className}`}>
            <p className="text-sm font-bold leading-none">{cfg.label}</p>
            <p className="text-[11px] mt-1 opacity-80">{cfg.sublabel}</p>
            <p className="text-[10px] mt-1 opacity-60">
              {tipo === '2x1' ? '50% equiv.' : tipo === '3x2' ? '33% equiv.' : `${cfg.descuento}% descuento`}
            </p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-200">
        {([['sugerencias', `Sugerencias del motor (${sugerencias.length})`], ['guardadas', `Guardadas (${guardadas.length})`]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-zinc-900 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex gap-3 flex-wrap items-center">
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
        {tab === 'guardadas' && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setFiltroEstado('todos')}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                filtroEstado === 'todos' ? 'bg-zinc-900 text-white border-zinc-900' : 'text-zinc-600 border-zinc-200 hover:bg-zinc-50'
              }`}
            >Todos</button>
            {PROMO_ESTADOS.map(est => (
              <button
                key={est}
                onClick={() => setFiltroEstado(est)}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  filtroEstado === est
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                }`}
              >
                {ESTADO_CONFIG[est].label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-12 text-center text-zinc-400">Cargando...</div>
      ) : tab === 'sugerencias' ? (
        <>
          <PromosMes
            sugerencias={sugerencias}
            saving={saving}
            saved={saved}
            onGuardar={guardarPromo}
          />
          <SugerenciasTable
            rows={filteredSugs}
            saving={saving}
            saved={saved}
            onGuardar={guardarPromo}
            scanHighlight={scanHighlight}
          />
        </>
      ) : (
        <GuardadasTable
          rows={filteredGuardadas}
          onCambiarEstado={cambiarEstado}
          scanHighlight={scanHighlight}
        />
      )}
    </div>
  )
}

// ─── 5 del mes ───────────────────────────────────────────────────────────────
function PromosMes({
  sugerencias, saving, saved, onGuardar,
}: {
  sugerencias: Sugerencia[]
  saving: Set<string>
  saved: Set<string>
  onGuardar: (s: Sugerencia) => void
}) {
  // Top 5: first 2 near-expiry (if any), rest slow-movers with best stock×vel score
  const nearExpiry  = sugerencias.filter(s => s.dias_al_vencimiento !== null).slice(0, 2)
  const slowMovers  = sugerencias.filter(s => s.dias_al_vencimiento === null)
    .sort((a, b) => (b.stock * b.velocidad_venta_diaria) - (a.stock * a.velocidad_venta_diaria))
    .slice(0, 5 - nearExpiry.length)
  const top5 = [...nearExpiry, ...slowMovers].slice(0, 5)

  if (top5.length === 0) return null

  const mes = new Date().toLocaleString('es-AR', { month: 'long', year: 'numeric' })

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-200">
        <Star size={14} className="text-amber-500" />
        <p className="text-sm font-semibold text-amber-800">5 promociones del mes · {mes.charAt(0).toUpperCase() + mes.slice(1)}</p>
        <p className="text-xs text-amber-600 ml-auto">Selección automática por ventas y stock</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-amber-200">
        {top5.map((s, i) => {
          const cfg = TIPO_CONFIG[s.tipo]
          const isSaving = saving.has(s.producto_id)
          const isSaved = saved.has(s.producto_id)
          return (
            <div key={s.producto_id} className="p-3 flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-1">
                <span className="text-[10px] font-bold text-amber-400">#{i + 1}</span>
                <Badge className={`${cfg.className} text-[10px] px-1.5 py-0`}>{cfg.label}</Badge>
              </div>
              <p className="text-xs font-medium text-zinc-800 leading-snug line-clamp-2">{s.nombre ?? s.sku}</p>
              <p className="text-[10px] text-zinc-500 leading-snug">{s.motivo}</p>
              <button
                disabled={isSaving || isSaved}
                onClick={() => onGuardar(s)}
                className={`mt-auto w-full text-[11px] py-1 rounded-md border font-medium transition-colors ${
                  isSaved
                    ? 'bg-zinc-50 text-zinc-400 border-zinc-200 cursor-not-allowed'
                    : 'bg-white text-zinc-700 border-zinc-300 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700'
                }`}
              >
                {isSaving ? '...' : isSaved ? 'Guardada ✓' : 'Proponer'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SugerenciasTable({
  rows, saving, saved, onGuardar, scanHighlight,
}: {
  rows: Sugerencia[]
  saving: Set<string>
  saved: Set<string>
  onGuardar: (s: Sugerencia) => void
  scanHighlight: string | null
}) {
  if (rows.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-zinc-500 font-medium">Sin sugerencias disponibles</p>
        <p className="text-zinc-400 text-sm mt-1">
          Las sugerencias aparecen cuando hay productos próximos a vencer o con stock
          de rotación lenta. Cargá fechas de vencimiento en Recepciones o Carga Rápida.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50">
              <TableHead>Producto</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="text-right">Vel/día</TableHead>
              <TableHead className="text-right">Margen result.</TableHead>
              <TableHead className="text-right">Pérdida est.</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(s => {
              const cfg = TIPO_CONFIG[s.tipo]
              const isSaving = saving.has(s.producto_id)
              const isSaved = saved.has(s.producto_id)
              return (
                <TableRow key={s.producto_id} className={`hover:bg-zinc-50 ${scanHighlight === s.producto_id ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : ''}`}>
                  <TableCell>
                    <div className="font-medium text-sm">{s.nombre ?? s.sku}</div>
                    <div className="text-xs text-zinc-400 font-mono">{s.sku}</div>
                    {s.categoria && <div className="text-xs text-zinc-400">{s.categoria}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge className={`${cfg.className} text-xs`}>{cfg.label}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-zinc-600 max-w-xs">{s.motivo}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.stock}</TableCell>
                  <TableCell className="text-right tabular-nums text-zinc-400 text-xs">
                    {s.velocidad_venta_diaria > 0 ? s.velocidad_venta_diaria.toFixed(2) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {s.margen_resultante !== null ? (
                      <span className={s.margen_resultante < 0 ? 'text-red-600 font-semibold' : 'text-zinc-700'}>
                        {s.margen_resultante.toFixed(1)}%
                      </span>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-zinc-500">
                    {s.perdida_estimada !== null
                      ? `$${s.perdida_estimada.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant={isSaved ? 'outline' : 'default'}
                      disabled={isSaving || isSaved}
                      onClick={() => onGuardar(s)}
                      className="h-7 text-xs"
                    >
                      {isSaving ? 'Guardando...' : isSaved ? 'Guardada ✓' : 'Guardar'}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function GuardadasTable({
  rows,
  onCambiarEstado,
  scanHighlight,
}: {
  rows: PromoGuardada[]
  onCambiarEstado: (id: string, estado: PromoEstado) => void
  scanHighlight: string | null
}) {
  if (rows.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-zinc-500 font-medium">No hay promociones guardadas</p>
        <p className="text-zinc-400 text-sm mt-1">Guardá sugerencias desde la pestaña anterior.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50">
              <TableHead>Producto</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Descuento</TableHead>
              <TableHead className="text-right">Creada</TableHead>
              <TableHead>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(p => {
              const tipoCfg = (TIPO_CONFIG as Record<string, typeof TIPO_CONFIG[PromoTipo]>)[p.tipo] ??
                { label: p.tipo, className: 'bg-zinc-100 text-zinc-600', descuento: 0 }
              const estadoCfg = ESTADO_CONFIG[p.estado]
              return (
                <TableRow key={p.id} className={`hover:bg-zinc-50 ${scanHighlight === p.producto_id ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : ''}`}>
                  <TableCell>
                    <div className="font-medium text-sm">{p.nombre ?? p.sku ?? p.producto_id.slice(0, 8)}</div>
                    <div className="text-xs text-zinc-400 font-mono">{p.sku}</div>
                    {p.categoria && <div className="text-xs text-zinc-400">{p.categoria}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge className={`${tipoCfg.className} text-xs`}>{tipoCfg.label}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-zinc-500 max-w-xs">{p.motivo ?? '—'}</TableCell>
                  <TableCell>
                    <Badge className={`${estadoCfg.className} text-xs`}>{estadoCfg.label}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {p.descuento > 0 ? `${p.descuento}%` : '—'}
                  </TableCell>
                  <TableCell className="text-right text-xs text-zinc-400 tabular-nums">
                    {new Date(p.created_at).toLocaleDateString('es-AR')}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {(NEXT_STATES[p.estado] ?? []).map(next => (
                        <Button
                          key={next}
                          size="sm"
                          variant="outline"
                          className={`h-7 text-xs ${
                            next === 'descartada' ? 'text-red-600 border-red-200 hover:bg-red-50' :
                            next === 'activa'     ? 'text-green-700 border-green-300 hover:bg-green-50' :
                            ''
                          }`}
                          onClick={() => onCambiarEstado(p.id, next)}
                        >
                          {ESTADO_CONFIG[next].label}
                        </Button>
                      ))}
                      {p.estado === 'activa' && (
                        <Link href="/precios">
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-indigo-600 border-indigo-200 hover:bg-indigo-50">
                            <Printer size={11} /> Etiqueta
                          </Button>
                        </Link>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
