'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { ProductoCompra } from '@/lib/types'
import { matchesQuery } from '@/lib/search'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { KpiCard } from '@/components/ui/kpi-card'
import { SkeletonCard, SkeletonTable } from '@/components/ui/skeleton'
import { Pagination } from '@/components/ui/pagination'
import { useOutsideClick } from '@/lib/hooks/use-outside-click'
import { usePagination } from '@/lib/hooks/use-pagination'
import { fetchAllFromView } from '@/lib/hooks/use-fetch-all'
import { INVERSION_ALERTA_PESOS } from '@/lib/constants'
import {
  Download, FileText, ChevronUp, ChevronDown, ChevronsUpDown, AlertTriangle,
  X, Settings2, Info, TrendingDown, Bell, ShoppingCart, PackageX, RefreshCw, Search,
} from 'lucide-react'
import Link from 'next/link'
import { exportTablaXlsx, type ColumnaExport } from '@/lib/export-xlsx'
import { OrdenEditorModal, type ProductoCatalogo, type ProveedorConfigHeader } from '@/components/shared/orden-editor-modal'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'

type SortKey = 'sku' | 'nombre' | 'proveedor_nombre' | 'location_nombre' | 'categoria' | 'stock_actual' |
               'ventas_7d' | 'ventas_30d' | 'vel_diaria' | 'dias_cobertura' | 'sugerencia_efectiva' | 'inversion_sugerida'

function sugerenciaEfectiva(p: ProductoCompra): number {
  if (p.es_granel) return p.sugerencia_kg ?? 0
  if (p.sugerencia_compra > 0) return p.sugerencia_compra
  if (p.ventas_30d === 0 && p.stock_actual === 0) return 4
  return 0
}

function sugerenciaLabel(p: ProductoCompra): string {
  const cant = sugerenciaEfectiva(p)
  if (cant === 0) return '—'
  if (p.es_granel) return `${cant} kg`
  return String(cant)
}

const fmt = (n: number | null | undefined, decimals = 0) =>
  n == null ? '—' : n.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

const fmtPeso = (n: number | null | undefined) =>
  n == null || n === 0 ? '—' : `$${fmt(n, 0)}`

function CoberturaTag({ dias, quiebre }: { dias: number; quiebre?: boolean }) {
  if (dias >= 999) return <Badge variant="outline" className="text-zinc-400">Sin ventas</Badge>
  const base =
    dias <= 7  ? 'bg-red-100 text-red-700 border-red-200' :
    dias <= 30 ? 'bg-orange-100 text-orange-700 border-orange-200' :
    dias <= 60 ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                 'bg-green-100 text-green-700 border-green-200'
  return (
    <Badge className={base}>
      {dias}d{quiebre && <span className="ml-0.5 opacity-70">⚡</span>}
    </Badge>
  )
}

function ConfianzaBadge({ nivel }: { nivel: ProductoCompra['nivel_confianza'] }) {
  if (nivel === 'alto')  return <span className="text-[9px] text-green-600 font-medium uppercase tracking-wide">▲ alto</span>
  if (nivel === 'medio') return <span className="text-[9px] text-yellow-600 font-medium uppercase tracking-wide">◆ medio</span>
  if (nivel === 'bajo')  return <span className="text-[9px] text-orange-500 font-medium uppercase tracking-wide">▼ bajo</span>
  return <span className="text-[9px] text-zinc-400 font-medium uppercase tracking-wide">— s/d</span>
}

function AbcBadge({ clase }: { clase: 'A' | 'B' | 'C' | null | undefined }) {
  if (!clase) return null
  const styles =
    clase === 'A' ? 'bg-green-100 text-green-700 border-green-200' :
    clase === 'B' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                    'bg-zinc-100 text-zinc-600 border-zinc-200'
  const title =
    clase === 'A' ? 'Clase A — top 70% de facturación (12m)' :
    clase === 'B' ? 'Clase B — siguiente 20% de facturación (12m)' :
                    'Clase C — 10% restante de facturación (12m)'
  return (
    <Badge className={`${styles} text-[10px] px-1.5 py-0 leading-4`} title={title}>{clase}</Badge>
  )
}

function SortHeader({
  label, sk, current, dir, onSort, className,
}: {
  label: string; sk: SortKey; current: SortKey; dir: 'asc' | 'desc'
  onSort: (k: SortKey) => void; className?: string
}) {
  const active = current === sk
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <TableHead
      className={`cursor-pointer select-none hover:bg-zinc-100 transition-colors ${className ?? ''}`}
      onClick={() => onSort(sk)}
    >
      <div className="flex items-center gap-1 whitespace-nowrap">
        {label}
        <Icon size={12} className={active ? 'text-zinc-700' : 'text-zinc-300'} />
      </div>
    </TableHead>
  )
}

function ProviderCombobox({
  proveedores, selected, onToggle, onClear,
}: {
  proveedores: string[]; selected: Set<string>
  onToggle: (p: string) => void; onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const close = useCallback(() => { setOpen(false); setSearch('') }, [])
  useOutsideClick(ref, close)

  const filteredList = search
    ? proveedores.filter(p => matchesQuery(search, p))
    : proveedores

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 h-8 w-52 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none hover:bg-zinc-50">
        <span className="flex-1 text-left truncate">
          {selected.size === 0
            ? <span className="text-muted-foreground">Todos los proveedores</span>
            : [...selected].join(', ')}
        </span>
        {selected.size > 0
          ? <X size={14} className="text-zinc-400 hover:text-zinc-700 shrink-0" onClick={e => { e.stopPropagation(); onClear() }} />
          : <ChevronDown size={14} className="text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-72 rounded-lg bg-popover shadow-md ring-1 ring-foreground/10 text-popover-foreground">
          <div className="p-1.5 border-b border-foreground/10">
            <Input autoFocus placeholder="Buscar proveedor..." value={search} onChange={e => setSearch(e.target.value)} className="h-7 text-sm" />
          </div>
          {selected.size > 0 && (
            <div className="px-2 py-1.5 flex flex-wrap gap-1 border-b border-foreground/10">
              {[...selected].map(p => (
                <span key={p} className="inline-flex items-center gap-1 text-xs bg-zinc-100 rounded-full px-2 py-0.5">
                  <span className="truncate max-w-[110px]">{p}</span>
                  <X size={10} className="cursor-pointer text-zinc-400 hover:text-zinc-700 shrink-0" onClick={() => onToggle(p)} />
                </span>
              ))}
            </div>
          )}
          <div className="max-h-52 overflow-y-auto py-1">
            {filteredList.length === 0
              ? <p className="text-xs text-zinc-400 px-3 py-2">Sin resultados</p>
              : filteredList.map(p => {
                const checked = selected.has(p)
                return (
                  <button key={p} type="button" onClick={() => onToggle(p)}
                    className={`w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors truncate ${
                      checked ? 'bg-zinc-900 text-white' : 'hover:bg-zinc-50'
                    }`}>{p}
                  </button>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

function CategoryCombobox({
  categorias, value, onChange,
}: {
  categorias: string[]; value: string; onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const close = useCallback(() => { setOpen(false); setSearch('') }, [])
  useOutsideClick(ref, close)

  const filteredList = search
    ? categorias.filter(c => matchesQuery(search, c))
    : categorias

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 h-8 w-44 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none hover:bg-zinc-50">
        <span className="flex-1 text-left truncate">
          {value === 'todas'
            ? <span className="text-muted-foreground">Todas las categorías</span>
            : value}
        </span>
        {value !== 'todas'
          ? <X size={14} className="text-zinc-400 hover:text-zinc-700 shrink-0"
              onClick={e => { e.stopPropagation(); onChange('todas'); setSearch('') }} />
          : <ChevronDown size={14} className="text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-56 rounded-lg bg-popover shadow-md ring-1 ring-foreground/10 text-popover-foreground">
          <div className="p-1.5 border-b border-foreground/10">
            <Input autoFocus placeholder="Buscar categoría..." value={search} onChange={e => setSearch(e.target.value)} className="h-7 text-sm" />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            <button type="button" onClick={() => { onChange('todas'); setSearch(''); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors ${value === 'todas' ? 'bg-zinc-900 text-white' : 'hover:bg-zinc-50'}`}>
              Todas las categorías
            </button>
            {filteredList.length === 0
              ? <p className="text-xs text-zinc-400 px-3 py-2">Sin resultados</p>
              : filteredList.map(c => (
                <button key={c} type="button" onClick={() => { onChange(c); setSearch(''); setOpen(false) }}
                  className={`w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors truncate ${value === c ? 'bg-zinc-900 text-white' : 'hover:bg-zinc-50'}`}>
                  {c}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ComprasPage() {
  const [data, setData] = useState<ProductoCompra[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('todas')
  const [cobertura, setCobertura] = useState('urgente')
  const [lastSync, setLastSync] = useState<string | null | undefined>(undefined)
  const [sortKey, setSortKey] = useState<SortKey>('dias_cobertura')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set())
  const [sucursal, setSucursal] = useState<'todas' | 'soho1' | 'soho2'>('todas')
  const [barcodeMap, setBarcodeMap] = useState<Map<string, string>>(new Map())
  const [scanHighlight, setScanHighlight] = useState<string | null>(null)
  const [scanMiss, setScanMiss] = useState(false)
  const [alertasHoy, setAlertasHoy] = useState<string[]>([])
  const [abcMap, setAbcMap] = useState<Map<string, 'A' | 'B' | 'C'>>(new Map())
  const [proveedoresConfig, setProveedoresConfig] = useState<ProveedorConfigHeader[]>([])
  const [productosCatalogo, setProductosCatalogo] = useState<ProductoCatalogo[]>([])
  const [ordenOpen, setOrdenOpen] = useState(false)

  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const missTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
      if (missTimerRef.current) clearTimeout(missTimerRef.current)
    }
  }, [])

  function toggleProvider(p: string) {
    setSelectedProviders(prev => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }

  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const term = search.trim()
    if (!term) return
    const sku = barcodeMap.get(term) ?? term
    const found = data.find(p => p.sku === sku)
    if (found) {
      setSearch(found.nombre ?? found.sku)
      setScanHighlight(found.id)
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
      scanTimerRef.current = setTimeout(() => setScanHighlight(null), 3000)
    } else {
      setScanMiss(true)
      if (missTimerRef.current) clearTimeout(missTimerRef.current)
      missTimerRef.current = setTimeout(() => setScanMiss(false), 1500)
    }
  }

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(k)
      setSortDir(k === 'sugerencia_efectiva' || k === 'inversion_sugerida' ? 'desc' : 'asc')
    }
  }

  const entregaFiltro = sucursal === 'soho1' ? 'SOHO 1' : sucursal === 'soho2' ? 'SOHO 2' : null

  function handleExportExcel() {
    const cols: ColumnaExport<ProductoCompra>[] = [
      { header: 'SKU',            value: p => p.sku },
      { header: 'Producto',       value: p => p.nombre ?? '' },
      { header: 'Proveedor',      value: p => p.proveedor_nombre ?? '' },
      { header: 'Sucursal',       value: p => p.location_nombre ?? 'Global' },
      { header: 'Categoría',      value: p => p.categoria ?? '' },
      { header: 'Stock actual',   value: p => p.stock_actual ?? 0 },
      { header: 'Ventas 30d',     value: p => p.ventas_30d ?? 0 },
      { header: 'Vel. diaria',    value: p => p.vel_diaria ?? 0 },
      { header: 'Días cobertura', value: p => p.dias_cobertura ?? 0 },
      { header: 'Sugerencia',     value: p => sugerenciaEfectiva(p) },
      { header: 'Sug. kg (granel)', value: p => p.es_granel ? (p.sugerencia_kg ?? 0) : '' },
      { header: 'Costo unit.',    value: p => p.costo ?? 0 },
      { header: 'Inversión',      value: p => p.inversion_sugerida ?? 0 },
      { header: 'Confianza',      value: p => p.nivel_confianza ?? '' },
      { header: 'Motivos',        value: p => p.motivos ?? '' },
    ]
    exportTablaXlsx('compras', cols, filtered, 'Compras')
  }

  useEffect(() => {
    const todayIso = new Date().getDay() === 0 ? 7 : new Date().getDay()

    const load = async () => {
      try {
        // productos tiene >3000 filas: leer SIEMPRE con fetchAllFromView (PostgREST corta en 1000)
        const [alertasRes, syncRes, catalogoData, abcData, provConfigRes, comprasData] = await Promise.all([
          supabase.from('proveedores_config').select('nombre, dia_pedido').eq('dia_pedido', todayIso),
          supabase.from('productos').select('dux_sync_at').not('dux_sync_at', 'is', null).limit(1),
          fetchAllFromView<{
            id: string; sku: string; nombre: string | null; categoria: string | null
            codigo_barras: string | null; stock_dux: number | null
            costo: number | null; iva_porcentaje: number | null; unidad_medida: string | null
          }>('productos', { select: 'id,sku,nombre,categoria,codigo_barras,stock_dux,costo,iva_porcentaje,unidad_medida' }),
          fetchAllFromView<{ id: string; clasificacion_abc: 'A' | 'B' | 'C' }>('productos', {
            select: 'id,clasificacion_abc',
            filters: [{ column: 'clasificacion_abc', operator: 'not.is', value: null }],
          }),
          supabase.from('proveedores_config').select('nombre,cuit,direccion,telefono,localidad,provincia,iva_condicion,condicion_pago,condiciones_entrega'),
          fetchAllFromView<ProductoCompra>('v_compras_inteligentes_v4'),
        ])
        if (alertasRes.data && alertasRes.data.length > 0) {
          setAlertasHoy((alertasRes.data as { nombre: string }[]).map(r => r.nombre))
        }
        setLastSync(
          syncRes.data && syncRes.data.length > 0
            ? (syncRes.data[0] as { dux_sync_at: string }).dux_sync_at
            : null
        )
        setBarcodeMap(new Map(
          catalogoData.filter(p => p.codigo_barras).map(p => [p.codigo_barras!, p.sku])
        ))
        setProductosCatalogo(catalogoData.map<ProductoCatalogo>(p => ({
          id: p.id,
          sku: p.sku,
          nombre: p.nombre,
          categoria: p.categoria,
          codigo_barras: p.codigo_barras,
          stock_dux: p.stock_dux ?? 0,
          costo: p.costo,
          iva_porcentaje: p.iva_porcentaje,
          es_granel: p.unidad_medida === 'kg',
        })))
        setAbcMap(new Map(abcData.map(p => [p.id, p.clasificacion_abc])))
        if (provConfigRes.data) {
          setProveedoresConfig(provConfigRes.data as ProveedorConfigHeader[])
        }
        setData(comprasData)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const categorias = useMemo(() => {
    const cats = [...new Set(data.map(d => d.categoria).filter(Boolean))] as string[]
    return cats.sort()
  }, [data])

  const proveedores = useMemo(() => {
    const provs = [...new Set(data.map(d => d.proveedor_nombre).filter(Boolean))] as string[]
    return provs.sort((a, b) => a.localeCompare(b, 'es'))
  }, [data])

  const filtered = useMemo(() => {
    const result = data.filter(p => {
      if (search && !matchesQuery(search, p.nombre, p.sku, p.marca)) return false
      if (categoria !== 'todas' && p.categoria !== categoria) return false
      if (selectedProviders.size > 0 && !selectedProviders.has(p.proveedor_nombre ?? '')) return false
      if (sucursal === 'soho1' && p.location_id != null && p.location_nombre !== 'SOHO 1') return false
      if (sucursal === 'soho2' && p.location_id != null && p.location_nombre !== 'SOHO 2') return false
      if (cobertura === 'urgente' && p.dias_cobertura > 30) return false
      if (cobertura === 'sinventa' && !(p.ventas_30d === 0 && p.stock_actual === 0)) return false
      if (cobertura === 'negativo' && p.stock_actual >= 0) return false
      if (cobertura === 'quiebre' && !p.tiene_quiebre) return false
      return true
    })

    result.sort((a, b) => {
      let av: number | string | null
      let bv: number | string | null
      if (sortKey === 'sugerencia_efectiva') {
        av = sugerenciaEfectiva(a); bv = sugerenciaEfectiva(b)
      } else {
        av = (a[sortKey as keyof ProductoCompra] ?? null) as number | string | null
        bv = (b[sortKey as keyof ProductoCompra] ?? null) as number | string | null
      }
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      const cmp = typeof av === 'string' && typeof bv === 'string'
        ? av.localeCompare(bv, 'es')
        : (Number(av) || 0) - (Number(bv) || 0)
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [data, search, categoria, selectedProviders, sucursal, cobertura, sortKey, sortDir])

  const { paged, page, setPage, total, pageSize } = usePagination(filtered)

  useEffect(() => {
    setPage(1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered])

  const hasSucursalRows = useMemo(() => filtered.some(p => p.location_id != null), [filtered])

  const urgentes  = useMemo(() => data.filter(p => p.dias_cobertura < 30 && p.ventas_30d > 0).length, [data])
  const sinStock  = useMemo(() => data.filter(p => p.stock_actual === 0 && p.ventas_30d > 0).length, [data])
  const sinVenta  = useMemo(() => data.filter(p => p.ventas_30d === 0 && p.stock_actual === 0).length, [data])
  const quiebres  = useMemo(() => data.filter(p => p.tiene_quiebre).length, [data])
  const negativos = useMemo(() => data.filter(p => p.stock_actual < 0), [data])
  const inversion = useMemo(() =>
    filtered
      .filter(p => (p.inversion_sugerida ?? 0) <= INVERSION_ALERTA_PESOS)
      .reduce((s, p) => s + (p.inversion_sugerida ?? 0), 0)
  , [filtered])
  const unidades = useMemo(() => filtered.reduce((s, p) => s + sugerenciaEfectiva(p), 0), [filtered])
  const alertas  = useMemo(() => filtered.filter(p => (p.inversion_sugerida ?? 0) > INVERSION_ALERTA_PESOS).length, [filtered])

  const colSpanBase = hasSucursalRows ? 13 : 12

  return (
    <TooltipProvider>
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Dashboard de Compras</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Comprador Inteligente — demanda estacional + quiebres + vencimientos</p>
        </div>
        <Link href="/compras/proveedores">
          <Button variant="outline" size="sm" className="flex items-center gap-1.5">
            <Settings2 size={14} />
            Configurar proveedores
          </Button>
        </Link>
      </div>

      {/* Alerts */}
      {alertasHoy.length > 0 && (
        <div className="rounded-md bg-indigo-50 border border-indigo-200 px-4 py-3 text-sm text-indigo-800 flex items-start gap-2">
          <Bell size={15} className="mt-0.5 shrink-0 text-indigo-500" />
          <div>
            <span className="font-semibold">Pedidos a realizar hoy · </span>
            {alertasHoy.join(' · ')}
          </div>
        </div>
      )}

      {lastSync === null && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Stock pendiente de sincronización con Dux — los datos se actualizarán en la próxima ventana automática.
        </div>
      )}

      {!loading && negativos.length > 0 && (
        <button type="button"
          onClick={() => setCobertura(c => c === 'negativo' ? 'urgente' : 'negativo')}
          className={`w-full text-left rounded-md border px-4 py-3 text-sm transition-colors ${
            cobertura === 'negativo'
              ? 'bg-red-100 border-red-400 text-red-900'
              : 'bg-red-50 border-red-300 text-red-800 hover:bg-red-100'
          }`}>
          <strong>⚠ {negativos.length} producto{negativos.length > 1 ? 's' : ''} con stock negativo</strong>
          {' '}— posible error de conteo en Dux. SKUs:{' '}
          <span className="font-mono text-xs">
            {negativos.slice(0, 12).map(p => p.sku).join(', ')}
            {negativos.length > 12 && ` y ${negativos.length - 12} más`}
          </span>
          {cobertura !== 'negativo' && <span className="ml-2 underline text-xs">→ Ver informe</span>}
          {cobertura === 'negativo' && <span className="ml-2 underline text-xs">→ Volver a urgentes</span>}
        </button>
      )}

      {!loading && alertas > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            <strong>{alertas} producto{alertas > 1 ? 's' : ''} con inversión &gt;${(INVERSION_ALERTA_PESOS / 1000).toFixed(0)}k</strong> — probable inconsistencia en costo unitario. Excluidos del total. Marcados con ⚠ en la tabla.
          </span>
        </div>
      )}

      {/* KPIs */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <KpiCard label="Urgentes (<30d)"      value={urgentes}         variant="danger"  icon={ShoppingCart} />
          <KpiCard label="Sin stock activo"     value={sinStock}         variant="danger"  icon={PackageX} />
          <KpiCard
            label="Quiebres detectados"
            value={quiebres}
            variant="warning"
            icon={TrendingDown}
            active={cobertura === 'quiebre'}
            onClick={() => setCobertura(c => c === 'quiebre' ? 'urgente' : 'quiebre')}
          />
          <KpiCard
            label="Sin ventas (reactivar)"
            value={sinVenta}
            variant="default"
            icon={RefreshCw}
            active={cobertura === 'sinventa'}
            onClick={() => setCobertura(c => c === 'sinventa' ? 'urgente' : 'sinventa')}
          />
          <KpiCard label="Inversión sugerida"   value={fmtPeso(inversion)} variant="indigo" />
          <KpiCard label="Unidades a comprar"   value={fmt(unidades)}    variant="default" />
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
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
        <Select value={cobertura} onValueChange={v => setCobertura(v ?? 'urgente')}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Filtro cobertura">
              {cobertura === 'urgente'  ? 'Urgentes (<30 días)' :
               cobertura === 'sinventa' ? 'Sin ventas (reactivar)' :
               cobertura === 'negativo' ? `Stock negativo (${negativos.length})` :
               cobertura === 'quiebre'  ? `Quiebres (${quiebres})` :
               'Todos los productos'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="urgente">Urgentes (&lt;30 días)</SelectItem>
            <SelectItem value="quiebre">Quiebres de stock detectados</SelectItem>
            <SelectItem value="sinventa">Sin ventas — reactivar (2 ud)</SelectItem>
            <SelectItem value="negativo">Stock negativo</SelectItem>
            <SelectItem value="todas">Todos los productos</SelectItem>
          </SelectContent>
        </Select>
        <CategoryCombobox categorias={categorias} value={categoria} onChange={setCategoria} />
        <ProviderCombobox
          proveedores={proveedores}
          selected={selectedProviders}
          onToggle={toggleProvider}
          onClear={() => setSelectedProviders(new Set())}
        />
        <Select value={sucursal} onValueChange={v => setSucursal(v as 'todas' | 'soho1' | 'soho2')}>
          <SelectTrigger className="w-36">
            <SelectValue>
              {sucursal === 'todas' ? 'Todas las suc.' : sucursal === 'soho1' ? 'SOHO 1' : 'SOHO 2'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las suc.</SelectItem>
            <SelectItem value="soho1">SOHO 1</SelectItem>
            <SelectItem value="soho2">SOHO 2</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-zinc-400 self-center">{loading ? '—' : `${total} productos`}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="flex items-center gap-1.5"
            onClick={handleExportExcel} disabled={filtered.length === 0 || loading}>
            <Download size={14} />
            Excel
          </Button>
          <Button size="sm" className="flex items-center gap-1.5"
            onClick={() => setOrdenOpen(true)} disabled={filtered.length === 0 || loading}>
            <FileText size={14} />
            Generar orden
          </Button>
        </div>
      </div>

      {cobertura === 'sinventa' && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-800">
          Productos sin stock y sin ventas en 30 días. Se sugieren <strong>2 unidades</strong> como pedido mínimo de reactivación.
        </div>
      )}
      {cobertura === 'negativo' && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-800">
          Productos con stock negativo en Dux. Revisá el conteo físico y corregí en el ERP antes de comprar.
        </div>
      )}
      {cobertura === 'quiebre' && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800 flex items-start gap-2">
          <TrendingDown size={15} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            Productos con <strong>menos de 20 días con ventas</strong> en los últimos 30 días. La demanda se calculó usando el período alternativo (días 30-60). El ⚡ en la cobertura indica quiebre.
          </span>
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50">
                <SortHeader label="SKU"       sk="sku"               current={sortKey} dir={sortDir} onSort={toggleSort} className="w-20" />
                <SortHeader label="Nombre"    sk="nombre"            current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortHeader label="Proveedor" sk="proveedor_nombre"  current={sortKey} dir={sortDir} onSort={toggleSort} />
                {hasSucursalRows && (
                  <SortHeader label="Suc." sk="location_nombre"  current={sortKey} dir={sortDir} onSort={toggleSort} className="w-20" />
                )}
                <SortHeader label="Stock"     sk="stock_actual"      current={sortKey} dir={sortDir} onSort={toggleSort} className="text-right" />
                <TableHead
                  className="text-right whitespace-nowrap cursor-pointer select-none hover:bg-zinc-100 transition-colors"
                  onClick={() => toggleSort('sugerencia_efectiva')}>
                  <div className="flex items-center justify-end gap-1">
                    Comprar
                    {sortKey === 'sugerencia_efectiva'
                      ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
                      : <ChevronsUpDown size={12} className="text-zinc-300" />}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info size={11} className="text-zinc-300 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-xs text-xs">
                        <p className="font-semibold mb-1">Comprador Inteligente</p>
                        <p>Demanda = 50% últimos 30d + 30% días 30-60 + 20% mismo mes año anterior</p>
                        <p className="mt-1">+ stock de seguridad por lead time · limitado por vencimiento · MOQ · múltiplo</p>
                        <p className="mt-1 text-zinc-400">⚡ = quiebre detectado (demanda ajustada)</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </TableHead>
                <SortHeader label="Inversión"  sk="inversion_sugerida" current={sortKey} dir={sortDir} onSort={toggleSort} className="text-right" />
                <SortHeader label="Vtas 7d"   sk="ventas_7d"         current={sortKey} dir={sortDir} onSort={toggleSort} className="text-right" />
                <SortHeader label="Vtas 30d"  sk="ventas_30d"        current={sortKey} dir={sortDir} onSort={toggleSort} className="text-right" />
                <SortHeader label="Vel./día"  sk="vel_diaria"        current={sortKey} dir={sortDir} onSort={toggleSort} className="text-right" />
                <SortHeader label="Cobertura" sk="dias_cobertura"    current={sortKey} dir={sortDir} onSort={toggleSort} className="text-center" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <SkeletonTable rows={10} cols={colSpanBase} />
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colSpanBase} className="text-center text-zinc-400 py-12">
                    No hay productos con ese filtro
                  </TableCell>
                </TableRow>
              ) : (
                paged.map(p => {
                  const rowKey = p.location_id ? `${p.id}-${p.location_id}` : p.id
                  const sug = sugerenciaEfectiva(p)
                  const isDeadStock = p.ventas_30d === 0 && p.stock_actual === 0
                  const highInversion = (p.inversion_sugerida ?? 0) > INVERSION_ALERTA_PESOS
                  return (
                    <TableRow
                      key={rowKey}
                      className={`hover:bg-zinc-50 ${isDeadStock ? 'opacity-70' : ''} ${scanHighlight === p.id ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : ''}`}
                    >
                      <TableCell className="font-mono text-xs text-zinc-500">{p.sku}</TableCell>
                      <TableCell className="max-w-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <AbcBadge clase={abcMap.get(p.id)} />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="font-medium text-sm truncate cursor-help">{p.nombre ?? '—'}</div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-[520px] break-words whitespace-normal">
                              {p.nombre}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        {p.marca && <div className="text-xs text-zinc-400">{p.marca}</div>}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-500">
                        {p.proveedor_nombre ?? <span className="text-zinc-300">—</span>}
                      </TableCell>
                      {hasSucursalRows && (
                        <TableCell className="text-xs">
                          {p.location_nombre
                            ? <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-zinc-600">{p.location_nombre}</Badge>
                            : <span className="text-zinc-300">—</span>}
                        </TableCell>
                      )}
                      <TableCell className="text-right tabular-nums">
                        <span className={
                          p.stock_actual < 0   ? 'text-red-700 font-bold' :
                          p.stock_actual === 0 ? 'text-red-600 font-semibold' : ''
                        }>{fmt(p.stock_actual)}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {sug > 0 ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <div className="flex items-center gap-1">
                              {p.motivos ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Info size={11} className="text-zinc-300 cursor-help shrink-0" />
                                  </TooltipTrigger>
                                  <TooltipContent side="left" className="max-w-xs text-xs leading-relaxed">
                                    <p className="font-semibold mb-1 text-zinc-700">Cómo se calculó</p>
                                    {p.motivos.split(' · ').map((m, i) => (
                                      <p key={i} className="text-zinc-500">· {m}</p>
                                    ))}
                                    {p.demanda_estimada != null && (
                                      <div className="mt-2 pt-2 border-t border-zinc-100 text-zinc-400 space-y-0.5">
                                        <p>Demanda est.: {p.demanda_estimada} ud</p>
                                        <p>Necesidad base: {p.necesidad_base} ud</p>
                                        {p.vida_util_promedio && <p>Vida útil prom.: {p.vida_util_promedio} días</p>}
                                        {p.qty_max_vencimiento && <p>Máx. por venc.: {p.qty_max_vencimiento} ud</p>}
                                        {p.es_granel && sug > 0 && <p>Pedido en kg: {sug} kg</p>}
                                      </div>
                                    )}
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                              <span className={isDeadStock ? 'text-blue-600' : ''}>{sugerenciaLabel(p)}</span>
                            </div>
                            <ConfianzaBadge nivel={p.nivel_confianza} />
                          </div>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {highInversion ? (
                          <span className="text-amber-600 flex items-center justify-end gap-1 text-xs">
                            <AlertTriangle size={11} />
                            {fmtPeso(p.inversion_sugerida)}
                          </span>
                        ) : sug > 0 ? (
                          <div>
                            <div>{fmtPeso(p.inversion_sugerida)}</div>
                            {!p.costo && p.costo_estimado && (
                              <div className="text-[10px] text-zinc-400 leading-none mt-0.5">costo estimado</div>
                            )}
                          </div>
                        ) : <span className="text-zinc-300">—</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmt(p.ventas_7d)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{fmt(p.ventas_30d)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-zinc-500">{fmt(p.vel_diaria, 1)}</TableCell>
                      <TableCell className="text-center">
                        {isDeadStock
                          ? <Badge variant="outline" className="text-zinc-400 text-xs">Sin movimiento</Badge>
                          : <CoberturaTag dias={p.dias_cobertura} quiebre={p.tiene_quiebre} />
                        }
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {!loading && total > pageSize && (
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} />
      )}

      <OrdenEditorModal
        open={ordenOpen}
        rows={filtered}
        entregaDefault={entregaFiltro}
        proveedoresConfig={proveedoresConfig}
        productosCatalogo={productosCatalogo}
        onClose={() => setOrdenOpen(false)}
      />

    </div>
    </TooltipProvider>
  )
}
