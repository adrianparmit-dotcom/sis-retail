'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Pencil, X, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Vencimiento, ProductoStock } from '@/lib/types'
import { exportTablaXlsx, type ColumnaExport } from '@/lib/export-xlsx'
import { matchesQuery } from '@/lib/search'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { KpiCard } from '@/components/ui/kpi-card'
import { SkeletonCard, SkeletonTable } from '@/components/ui/skeleton'
import { Pagination } from '@/components/ui/pagination'
import { fetchAllFromView } from '@/lib/hooks/use-fetch-all'
import { usePagination } from '@/lib/hooks/use-pagination'
import { hoyISO } from '@/lib/format'

type Estado = Vencimiento['estado']

const ESTADO_CONFIG: Record<Estado, { label: string; className: string }> = {
  vencido:   { label: 'Vencido',   className: 'bg-red-100 text-red-700 border-red-200' },
  critico:   { label: 'Crítico',   className: 'bg-red-50 text-red-600 border-red-100' },
  alerta:    { label: 'Alerta',    className: 'bg-orange-100 text-orange-700 border-orange-200' },
  proximo:   { label: 'Próximo',   className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  ok:        { label: 'OK',        className: 'bg-green-100 text-green-700 border-green-200' },
  sin_fecha: { label: 'Sin fecha', className: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
}

const ESTADO_VARIANT: Partial<Record<Estado, 'danger' | 'warning' | 'default'>> = {
  vencido: 'danger',
  critico: 'danger',
  alerta:  'warning',
  proximo: 'warning',
  ok:      'default',
}

function EstadoBadge({ estado }: { estado: Estado }) {
  const cfg = ESTADO_CONFIG[estado]
  return <Badge className={cfg.className}>{cfg.label}</Badge>
}

const fmtFecha = (s: string | null) => {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function VencimientosPage() {
  const [vencimientos, setVencimientos] = useState<Vencimiento[]>([])
  const [productos, setProductos] = useState<ProductoStock[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'cargados' | 'pendientes'>('cargados')
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState('todos')
  const [sucursal, setSucursal] = useState('todas')
  const [barcodeMap, setBarcodeMap] = useState<Map<string, string>>(new Map())
  const [scanHighlight, setScanHighlight] = useState<string | null>(null)
  const [scanMiss, setScanMiss] = useState(false)

  const [editingVenc, setEditingVenc] = useState<Vencimiento | null>(null)
  const [editFecha, setEditFecha] = useState('')
  const [editCantidad, setEditCantidad] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

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
        const [vencData, prodData] = await Promise.all([
          fetchAllFromView<Vencimiento>('v_vencimientos_fefo'),
          fetchAllFromView<ProductoStock>('productos', {
            select: 'id,sku,nombre,categoria,stock_dux,codigo_barras',
            filters: [{ column: 'stock_dux', operator: 'gt', value: 0 }],
            order: { column: 'nombre', ascending: true },
          }),
        ])
        setBarcodeMap(new Map(
          prodData.filter(p => p.codigo_barras).map(p => [p.codigo_barras!, p.sku])
        ))
        setVencimientos(vencData)
        setProductos(prodData)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const productosConFecha = useMemo(
    () => new Set(vencimientos.map(v => v.producto_id)),
    [vencimientos]
  )

  const pendientes = useMemo(
    () => productos.filter(p => !productosConFecha.has(p.id)),
    [productos, productosConFecha]
  )

  const sucursales = useMemo(
    () => [...new Set(vencimientos.map(v => v.sucursal))].sort(),
    [vencimientos]
  )

  const filteredVenc = useMemo(() => {
    return vencimientos.filter(v => {
      if (search && !matchesQuery(search, v.nombre, v.sku)) return false
      if (estado !== 'todos' && v.estado !== estado) return false
      if (sucursal !== 'todas' && v.sucursal !== sucursal) return false
      return true
    })
  }, [vencimientos, search, estado, sucursal])

  const filteredPend = useMemo(() => {
    if (!search) return pendientes
    return pendientes.filter(p => matchesQuery(search, p.nombre, p.sku))
  }, [pendientes, search])

  const counts = useMemo(() => {
    const c: Partial<Record<Estado, number>> = {}
    vencimientos.forEach(v => { c[v.estado] = (c[v.estado] ?? 0) + 1 })
    return c
  }, [vencimientos])

  const { paged: pagedVenc, page: pageVenc, setPage: setPageVenc, total: totalVenc, pageSize } = usePagination(filteredVenc)
  const { paged: pagedPend, page: pagePend, setPage: setPagePend, total: totalPend } = usePagination(filteredPend)

  function handleExportExcel() {
    const cols: ColumnaExport<Vencimiento>[] = [
      { header: 'SKU',              value: v => v.sku },
      { header: 'Producto',         value: v => v.nombre ?? '' },
      { header: 'Categoría',        value: v => v.categoria ?? '' },
      { header: 'Sucursal',         value: v => v.sucursal },
      { header: 'Fecha vencimiento', value: v => v.fecha_vencimiento ?? '' },
      { header: 'Cantidad',         value: v => v.cantidad },
      { header: 'Días para vencer', value: v => v.dias_para_vencer ?? '' },
      { header: 'Estado',           value: v => ESTADO_CONFIG[v.estado].label },
    ]
    exportTablaXlsx('vencimientos', cols, filteredVenc, 'Vencimientos')
  }

  useEffect(() => { setPageVenc(1) }, [filteredVenc]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPagePend(1) }, [filteredPend]) // eslint-disable-line react-hooks/exhaustive-deps

  function openEdit(v: Vencimiento) {
    setEditingVenc(v)
    setEditFecha(v.fecha_vencimiento ?? '')
    setEditCantidad(String(v.cantidad))
    setEditError('')
  }

  function closeEdit() {
    setEditingVenc(null)
    setEditError('')
  }

  async function saveEdit() {
    if (!editingVenc) return
    const cant = parseInt(editCantidad)
    if (isNaN(cant) || cant < 0) { setEditError('Cantidad inválida'); return }
    if (!editFecha) { setEditError('La fecha es requerida'); return }
    setEditSaving(true)
    setEditError('')
    try {
      const { error } = await supabase
        .from('vencimientos')
        .update({ cantidad: cant, fecha_vencimiento: editFecha, updated_at: new Date().toISOString() })
        .eq('id', editingVenc.lote_id)
      if (error) throw error
      const today = hoyISO()
      const dias = Math.floor((new Date(editFecha).getTime() - new Date(today).getTime()) / 86400000)
      const nuevoEstado: Estado =
        dias < 0 ? 'vencido' : dias <= 7 ? 'critico' : dias <= 30 ? 'alerta' : dias <= 90 ? 'proximo' : 'ok'
      setVencimientos(prev => prev.map(v =>
        v.lote_id === editingVenc.lote_id
          ? { ...v, cantidad: cant, fecha_vencimiento: editFecha, dias_para_vencer: dias, estado: nuevoEstado }
          : v
      ))
      closeEdit()
    } catch {
      setEditError('Error al guardar, intentá de nuevo')
    } finally {
      setEditSaving(false)
    }
  }

  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const term = search.trim()
    if (!term) return
    const sku = barcodeMap.get(term) ?? term
    if (tab === 'cargados') {
      const found = vencimientos.find(v => v.sku === sku)
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
    } else {
      const found = productos.find(p => p.sku === sku)
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
  }

  return (
    <>
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Vencimientos FEFO</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Gestión de fechas — primero en vencer, primero en salir</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportExcel} disabled={filteredVenc.length === 0}>
            <Download size={14} /> Excel
          </Button>
          <Link href="/vencimientos/carga-rapida">
            <Button variant="outline" size="sm">Carga rápida</Button>
          </Link>
          <Link href="/vencimientos/baja">
            <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50">Productos a dar de baja</Button>
          </Link>
          <Link href="/vencimientos/auditoria">
            <Button variant="outline" size="sm">Auditoría FEFO</Button>
          </Link>
          <Link href="/recepciones/nueva">
            <Button size="sm">+ Nueva recepción</Button>
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Sin fecha"
            value={pendientes.length}
            sublabel="pendientes"
            variant="default"
            active={tab === 'pendientes'}
            onClick={() => setTab('pendientes')}
          />
          {(['vencido', 'critico', 'alerta', 'proximo', 'ok'] as Estado[]).map(e => (
            <KpiCard
              key={e}
              label={ESTADO_CONFIG[e].label}
              value={counts[e] ?? 0}
              sublabel="lotes"
              variant={ESTADO_VARIANT[e] ?? 'default'}
              active={tab === 'cargados' && estado === e}
              onClick={() => { setTab('cargados'); setEstado(estado === e ? 'todos' : e) }}
            />
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-200">
        <button
          onClick={() => setTab('cargados')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'cargados' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}
        >
          Con fecha cargada ({vencimientos.length})
        </button>
        <button
          onClick={() => setTab('pendientes')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'pendientes' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}
        >
          Pendientes de carga ({loading ? '…' : pendientes.length})
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Input
            placeholder="Buscar, SKU o escanear código..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleSearchKey}
            className="w-72"
          />
          {scanMiss && (
            <span className="absolute -bottom-5 left-0 text-xs text-red-500 whitespace-nowrap">Código no encontrado</span>
          )}
        </div>
        {tab === 'cargados' && (
          <>
            <Select value={estado} onValueChange={v => setEstado(v ?? 'todos')}>
              <SelectTrigger className="w-36">
                <SelectValue>
                  {estado === 'todos' ? 'Todos' : ESTADO_CONFIG[estado as Estado]?.label ?? estado}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {(Object.keys(ESTADO_CONFIG) as Estado[]).map(e => (
                  <SelectItem key={e} value={e}>{ESTADO_CONFIG[e].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sucursal} onValueChange={v => setSucursal(v ?? 'todas')}>
              <SelectTrigger className="w-40">
                <SelectValue>
                  {sucursal === 'todas' ? 'Todas' : sucursal}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {sucursales.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-sm text-zinc-400 self-center">{loading ? '—' : `${totalVenc} lotes`}</span>
          </>
        )}
        {tab === 'pendientes' && (
          <span className="text-sm text-zinc-400 self-center">{loading ? '—' : `${totalPend} productos`}</span>
        )}
      </div>

      {/* Table: Con fecha cargada */}
      {tab === 'cargados' && (
        <>
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-zinc-50">
                    <TableHead>Producto</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Vence</TableHead>
                    <TableHead className="text-center">Días</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <SkeletonTable rows={10} cols={7} />
                  ) : filteredVenc.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12">
                        <p className="text-zinc-400">No hay lotes con fecha cargada</p>
                        <p className="text-xs text-zinc-400 mt-1">Usá Carga Rápida o Nueva Recepción para agregar fechas</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedVenc.map(v => (
                      <TableRow
                        key={v.lote_id}
                        className={`hover:bg-zinc-50 ${scanHighlight === v.producto_id ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : ''}`}
                      >
                        <TableCell>
                          <div className="font-medium text-sm">{v.nombre ?? v.sku}</div>
                          <div className="text-xs text-zinc-400 font-mono">{v.sku}</div>
                        </TableCell>
                        <TableCell className="text-xs text-zinc-500">{v.categoria ?? '—'}</TableCell>
                        <TableCell className="text-sm">{v.sucursal}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{v.cantidad.toLocaleString('es-AR')}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{fmtFecha(v.fecha_vencimiento)}</TableCell>
                        <TableCell className="text-center">
                          {v.dias_para_vencer == null ? (
                            <span className="text-zinc-300">—</span>
                          ) : (
                            <span className={
                              v.dias_para_vencer < 0 ? 'text-red-600 font-bold' :
                              v.dias_para_vencer <= 7 ? 'text-red-500 font-semibold' :
                              'text-zinc-600'
                            }>
                              {v.dias_para_vencer < 0 ? `+${Math.abs(v.dias_para_vencer)}d` : `${v.dias_para_vencer}d`}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center"><EstadoBadge estado={v.estado} /></TableCell>
                        <TableCell className="text-center">
                          <button
                            onClick={() => openEdit(v)}
                            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                            title="Editar"
                          >
                            <Pencil size={14} />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          {!loading && totalVenc > pageSize && (
            <Pagination page={pageVenc} pageSize={pageSize} total={totalVenc} onPage={setPageVenc} />
          )}
        </>
      )}

      {/* Table: Pendientes */}
      {tab === 'pendientes' && (
        <>
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-zinc-50">
                    <TableHead>Producto</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <SkeletonTable rows={10} cols={4} />
                  ) : filteredPend.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-zinc-400 py-12">
                        Todos los productos tienen fecha cargada
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedPend.map(p => (
                      <TableRow
                        key={p.id}
                        className={`hover:bg-zinc-50 ${scanHighlight === p.id ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : ''}`}
                      >
                        <TableCell>
                          <div className="font-medium text-sm">{p.nombre ?? p.sku}</div>
                          <div className="text-xs text-zinc-400 font-mono">{p.sku}</div>
                        </TableCell>
                        <TableCell className="text-xs text-zinc-500">{p.categoria ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-zinc-500">
                          {(p.stock_dux ?? 0).toLocaleString('es-AR')}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/vencimientos/carga-rapida?sku=${p.sku}`}>
                            <Button variant="outline" size="sm" className="text-xs h-7">Cargar fecha</Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          {!loading && totalPend > pageSize && (
            <Pagination page={pagePend} pageSize={pageSize} total={totalPend} onPage={setPagePend} />
          )}
        </>
      )}

    </div>

      {/* Edit dialog */}
      {editingVenc && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px]" onClick={closeEdit} aria-hidden />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-zinc-200 overflow-hidden">
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold text-zinc-900">Editar vencimiento</h2>
                  <p className="text-sm text-zinc-500 mt-0.5">{editingVenc.nombre ?? editingVenc.sku}</p>
                  <p className="text-xs text-zinc-400">{editingVenc.sucursal}</p>
                </div>
                <button onClick={closeEdit} className="text-zinc-400 hover:text-zinc-600 transition-colors" aria-label="Cerrar">
                  <X size={16} />
                </button>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Fecha de vencimiento</label>
                <input
                  type="date"
                  value={editFecha}
                  onChange={e => setEditFecha(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Cantidad</label>
                <Input
                  type="number"
                  min="0"
                  value={editCantidad}
                  onChange={e => setEditCantidad(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit() }}
                  className="h-10"
                />
              </div>

              {editError && <p className="text-sm text-red-600">{editError}</p>}
            </div>

            <div className="flex items-center justify-end gap-2.5 px-6 py-4 bg-zinc-50 border-t border-zinc-100">
              <button
                onClick={closeEdit}
                disabled={editSaving}
                className="px-4 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors disabled:opacity-60"
              >
                {editSaving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
