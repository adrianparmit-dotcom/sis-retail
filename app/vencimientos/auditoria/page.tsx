'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, AlertTriangle, ShieldAlert, History, PackageX } from 'lucide-react'
import type {
  VencimientoDrift,
  VencidoConStock,
  VencimientoMovimiento,
} from '@/lib/types'
import { exportTablaXlsx, type ColumnaExport } from '@/lib/export-xlsx'
import { matchesQuery } from '@/lib/search'
import { fetchAllFromView } from '@/lib/hooks/use-fetch-all'
import { usePagination } from '@/lib/hooks/use-pagination'
import { formatDate, formatDateTime, formatNum } from '@/lib/format'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { KpiCard } from '@/components/ui/kpi-card'
import { SkeletonCard, SkeletonTable } from '@/components/ui/skeleton'
import { Pagination } from '@/components/ui/pagination'
import { ErrorBanner } from '@/components/ui/error-banner'

type Tab = 'drift' | 'vencidos' | 'historial'
type TipoMov = 'todos' | 'alta' | 'update' | 'delete'

const TIPO_BADGE: Record<'alta' | 'update' | 'delete', string> = {
  alta:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  update: 'bg-sky-100 text-sky-700 border-sky-200',
  delete: 'bg-red-100 text-red-700 border-red-200',
}

export default function AuditoriaVencimientosPage() {
  const [drift, setDrift] = useState<VencimientoDrift[]>([])
  const [vencidos, setVencidos] = useState<VencidoConStock[]>([])
  const [movs, setMovs] = useState<VencimientoMovimiento[]>([])
  const [loading, setLoading] = useState(true)

  const [tab, setTab] = useState<Tab>('drift')
  const [search, setSearch] = useState('')
  const [sucursalFiltro, setSucursalFiltro] = useState('todas')
  const [tipoDriftFiltro, setTipoDriftFiltro] = useState<'todos' | 'exceso' | 'falta'>('todos')
  const [tipoMovFiltro, setTipoMovFiltro] = useState<TipoMov>('todos')

  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const load = async () => {
      setLoadError(false)
      try {
        const [d, v, m] = await Promise.all([
          fetchAllFromView<VencimientoDrift>('v_vencimientos_drift', {
            order: { column: 'diferencia', ascending: false },
          }),
          fetchAllFromView<VencidoConStock>('v_vencidos_con_stock'),
          fetchAllFromView<VencimientoMovimiento>('v_vencimientos_movimientos_enriquecida', {
            order: { column: 'created_at', ascending: false },
          }),
        ])
        setDrift(d)
        setVencidos(v)
        setMovs(m)
      } catch (err) {
        console.error('[auditoria-fefo] Error al cargar datos:', err)
        setLoadError(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [reloadKey])

  const sucursales = useMemo(() => {
    const s = new Set<string>()
    drift.forEach(d => s.add(d.sucursal))
    vencidos.forEach(d => s.add(d.sucursal))
    movs.forEach(d => s.add(d.sucursal))
    return [...s].sort()
  }, [drift, vencidos, movs])

  const driftFiltered = useMemo(() => drift.filter(d => {
    if (search && !matchesQuery(search, d.nombre, d.sku)) return false
    if (sucursalFiltro !== 'todas' && d.sucursal !== sucursalFiltro) return false
    if (tipoDriftFiltro === 'exceso' && d.diferencia <= 0) return false
    if (tipoDriftFiltro === 'falta' && d.diferencia >= 0) return false
    return true
  }), [drift, search, sucursalFiltro, tipoDriftFiltro])

  const vencidosFiltered = useMemo(() => vencidos.filter(v => {
    if (search && !matchesQuery(search, v.nombre, v.sku)) return false
    if (sucursalFiltro !== 'todas' && v.sucursal !== sucursalFiltro) return false
    return true
  }), [vencidos, search, sucursalFiltro])

  const movsFiltered = useMemo(() => movs.filter(m => {
    if (search && !matchesQuery(search, m.nombre, m.sku)) return false
    if (sucursalFiltro !== 'todas' && m.sucursal !== sucursalFiltro) return false
    if (tipoMovFiltro !== 'todos' && m.tipo !== tipoMovFiltro) return false
    return true
  }), [movs, search, sucursalFiltro, tipoMovFiltro])

  // KPIs
  const kpis = useMemo(() => {
    const exceso = drift.filter(d => d.diferencia > 0)
    const falta = drift.filter(d => d.diferencia < 0)
    const ahora = Date.now()
    const movs24h = movs.filter(m => ahora - new Date(m.created_at).getTime() < 86_400_000)
    return {
      combosExceso: exceso.length,
      unidadesExceso: exceso.reduce((s, d) => s + d.diferencia, 0),
      combosFalta: falta.length,
      unidadesFalta: falta.reduce((s, d) => s + Math.abs(d.diferencia), 0),
      vencidosCount: vencidos.length,
      vencidosUnidades: vencidos.reduce((s, v) => s + v.cantidad_vencida, 0),
      mov24h: movs24h.length,
    }
  }, [drift, vencidos, movs])

  const { paged: pagedDrift, page: pageDrift, setPage: setPageDrift, total: totalDrift, pageSize } =
    usePagination(driftFiltered)
  const { paged: pagedVenc, page: pageVenc, setPage: setPageVenc, total: totalVenc } =
    usePagination(vencidosFiltered)
  const { paged: pagedMovs, page: pageMovs, setPage: setPageMovs, total: totalMovs } =
    usePagination(movsFiltered)

  useEffect(() => { setPageDrift(1) }, [driftFiltered]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPageVenc(1) }, [vencidosFiltered]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPageMovs(1) }, [movsFiltered]) // eslint-disable-line react-hooks/exhaustive-deps

  function exportDrift() {
    const cols: ColumnaExport<VencimientoDrift>[] = [
      { header: 'SKU',        value: d => d.sku },
      { header: 'Producto',   value: d => d.nombre ?? '' },
      { header: 'Categoría',  value: d => d.categoria ?? '' },
      { header: 'Sucursal',   value: d => d.sucursal },
      { header: 'Stock Dux',  value: d => d.stock_dux },
      { header: 'Venc total', value: d => d.venc_total },
      { header: 'Diferencia', value: d => d.diferencia },
      { header: 'Lotes venc', value: d => d.n_lotes_venc },
      { header: 'Tipo',       value: d => d.tipo_drift },
    ]
    exportTablaXlsx('drift_vencimientos', cols, driftFiltered, 'Drift')
  }

  function exportVencidos() {
    const cols: ColumnaExport<VencidoConStock>[] = [
      { header: 'SKU',        value: v => v.sku },
      { header: 'Producto',   value: v => v.nombre ?? '' },
      { header: 'Categoría',  value: v => v.categoria ?? '' },
      { header: 'Sucursal',   value: v => v.sucursal },
      { header: 'Vencimiento',value: v => v.fecha_vencimiento },
      { header: 'Días vencido', value: v => v.dias_vencido },
      { header: 'Cant vencida',  value: v => v.cantidad_vencida },
      { header: 'Stock Dux actual', value: v => v.stock_dux_actual },
    ]
    exportTablaXlsx('vencidos_con_stock', cols, vencidosFiltered, 'Vencidos con stock')
  }

  function exportMovs() {
    const cols: ColumnaExport<VencimientoMovimiento>[] = [
      { header: 'Fecha/hora', value: m => formatDateTime(m.created_at) },
      { header: 'SKU',        value: m => m.sku },
      { header: 'Producto',   value: m => m.nombre ?? '' },
      { header: 'Sucursal',   value: m => m.sucursal },
      { header: 'Tipo',       value: m => m.tipo },
      { header: 'Vence',      value: m => m.fecha_vencimiento ?? '' },
      { header: 'Cant anterior', value: m => m.cantidad_anterior },
      { header: 'Cant nueva',    value: m => m.cantidad_nueva },
      { header: 'Delta',         value: m => m.delta },
      { header: 'Origen',     value: m => m.origen ?? '' },
      { header: 'Actor',      value: m => m.actor },
    ]
    exportTablaXlsx('historial_vencimientos', cols, movsFiltered, 'Historial')
  }

  function abrirHistorial(sku: string) {
    setTab('historial')
    setSearch(sku)
    setTipoMovFiltro('todos')
  }

  return (
    <div className="p-6 space-y-6">
      {loadError && <ErrorBanner onRetry={() => { setLoading(true); setReloadKey(k => k + 1) }} />}
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link href="/vencimientos" className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 mb-1">
            <ArrowLeft size={12} /> Volver a Vencimientos
          </Link>
          <h1 className="text-xl font-semibold text-zinc-900">Auditoría de vencimientos</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Diagnóstico FEFO en vivo: drift, vencidos con stock, e historial de cambios
          </p>
        </div>
      </div>

      {/* KPIs */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Sobre-conteo FEFO"
            value={kpis.combosExceso}
            sublabel={`${formatNum(kpis.unidadesExceso)} unidades fantasma`}
            variant="danger"
            icon={ShieldAlert}
            active={tab === 'drift' && tipoDriftFiltro === 'exceso'}
            onClick={() => { setTab('drift'); setTipoDriftFiltro(tipoDriftFiltro === 'exceso' ? 'todos' : 'exceso') }}
          />
          <KpiCard
            label="Sin vencimiento cargado"
            value={kpis.combosFalta}
            sublabel={`${formatNum(kpis.unidadesFalta)} unidades sin fecha`}
            variant="warning"
            icon={AlertTriangle}
            active={tab === 'drift' && tipoDriftFiltro === 'falta'}
            onClick={() => { setTab('drift'); setTipoDriftFiltro(tipoDriftFiltro === 'falta' ? 'todos' : 'falta') }}
          />
          <KpiCard
            label="Vencidos con stock"
            value={kpis.vencidosCount}
            sublabel={`${formatNum(kpis.vencidosUnidades)} u — dar de baja en Dux`}
            variant="danger"
            icon={PackageX}
            active={tab === 'vencidos'}
            onClick={() => setTab('vencidos')}
          />
          <KpiCard
            label="Cambios últimas 24h"
            value={kpis.mov24h}
            sublabel="movimientos registrados"
            variant="info"
            icon={History}
            active={tab === 'historial'}
            onClick={() => setTab('historial')}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-200">
        <button
          onClick={() => setTab('drift')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'drift' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}
        >
          Drift ({loading ? '…' : drift.length})
        </button>
        <button
          onClick={() => setTab('vencidos')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'vencidos' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}
        >
          Vencidos con stock ({loading ? '…' : vencidos.length})
        </button>
        <button
          onClick={() => setTab('historial')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'historial' ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}
        >
          Historial ({loading ? '…' : movs.length})
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <Input
          placeholder="Buscar producto o SKU..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-72"
        />
        <Select value={sucursalFiltro} onValueChange={v => setSucursalFiltro(v ?? 'todas')}>
          <SelectTrigger className="w-40"><SelectValue>{sucursalFiltro === 'todas' ? 'Todas las sucursales' : sucursalFiltro}</SelectValue></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las sucursales</SelectItem>
            {sucursales.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        {tab === 'drift' && (
          <Select value={tipoDriftFiltro} onValueChange={v => setTipoDriftFiltro((v as 'todos' | 'exceso' | 'falta') ?? 'todos')}>
            <SelectTrigger className="w-44"><SelectValue>
              {tipoDriftFiltro === 'todos' ? 'Todos los tipos'
                : tipoDriftFiltro === 'exceso' ? 'Sobre-conteo FEFO'
                : 'Sin venc cargado'}
            </SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los tipos</SelectItem>
              <SelectItem value="exceso">Sobre-conteo FEFO</SelectItem>
              <SelectItem value="falta">Sin venc cargado</SelectItem>
            </SelectContent>
          </Select>
        )}

        {tab === 'historial' && (
          <Select value={tipoMovFiltro} onValueChange={v => setTipoMovFiltro((v as TipoMov) ?? 'todos')}>
            <SelectTrigger className="w-40"><SelectValue>
              {tipoMovFiltro === 'todos' ? 'Todos los movs'
                : tipoMovFiltro === 'alta' ? 'Alta'
                : tipoMovFiltro === 'update' ? 'Update'
                : 'Delete'}
            </SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los movs</SelectItem>
              <SelectItem value="alta">Alta</SelectItem>
              <SelectItem value="update">Update</SelectItem>
              <SelectItem value="delete">Delete</SelectItem>
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5"
            onClick={tab === 'drift' ? exportDrift : tab === 'vencidos' ? exportVencidos : exportMovs}
            disabled={loading || (tab === 'drift' ? driftFiltered : tab === 'vencidos' ? vencidosFiltered : movsFiltered).length === 0}
          >
            <Download size={14} /> Excel
          </Button>
        </div>
      </div>

      {/* Tab: Drift */}
      {tab === 'drift' && (
        <>
          <div className="bg-white rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50">
                  <TableHead>Producto</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead className="text-right">Stock Dux</TableHead>
                  <TableHead className="text-right">Venc total</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                  <TableHead className="text-right">Lotes</TableHead>
                  <TableHead className="text-center">Tipo</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonTable rows={10} cols={8} />
                ) : pagedDrift.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-12 text-zinc-400">No hay drift detectado</TableCell></TableRow>
                ) : (
                  pagedDrift.map(d => (
                    <TableRow key={`${d.producto_id}-${d.sucursal_id}`} className="hover:bg-zinc-50">
                      <TableCell>
                        <div className="font-medium text-sm">{d.nombre ?? d.sku}</div>
                        <div className="text-xs text-zinc-400 font-mono">{d.sku}</div>
                      </TableCell>
                      <TableCell className="text-sm">{d.sucursal}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.stock_dux}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.venc_total}</TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${d.diferencia > 0 ? 'text-red-600' : 'text-amber-700'}`}>
                        {d.diferencia > 0 ? `+${d.diferencia}` : d.diferencia}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-zinc-500">{d.n_lotes_venc}</TableCell>
                      <TableCell className="text-center">
                        {d.diferencia > 0
                          ? <Badge className="bg-red-100 text-red-700 border-red-200">Sobre-conteo</Badge>
                          : <Badge className="bg-amber-100 text-amber-700 border-amber-200">Sin cargar</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <button onClick={() => abrirHistorial(d.sku)} className="text-xs text-sky-600 hover:underline">
                          Historial
                        </button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {!loading && totalDrift > pageSize && (
            <Pagination page={pageDrift} pageSize={pageSize} total={totalDrift} onPage={setPageDrift} />
          )}
          {!loading && drift.length > 0 && (
            <p className="text-xs text-zinc-500">
              <strong>Sobre-conteo</strong>: hay más vencimientos cargados que stock en Dux (el FEFO no descontó o alguien editó).{' '}
              <strong>Sin cargar</strong>: hay stock en Dux pero no se cargó la fecha de vencimiento.
            </p>
          )}
        </>
      )}

      {/* Tab: Vencidos con stock */}
      {tab === 'vencidos' && (
        <>
          <div className="bg-white rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50">
                  <TableHead>Producto</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead className="text-right">Vencimiento</TableHead>
                  <TableHead className="text-center">Vencido hace</TableHead>
                  <TableHead className="text-right">Cant vencida</TableHead>
                  <TableHead className="text-right">Stock Dux</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonTable rows={10} cols={7} />
                ) : pagedVenc.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-12 text-zinc-400">No hay vencidos con stock</TableCell></TableRow>
                ) : (
                  pagedVenc.map(v => (
                    <TableRow key={v.vencimiento_id} className="hover:bg-zinc-50">
                      <TableCell>
                        <div className="font-medium text-sm">{v.nombre ?? v.sku}</div>
                        <div className="text-xs text-zinc-400 font-mono">{v.sku}</div>
                      </TableCell>
                      <TableCell className="text-sm">{v.sucursal}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{formatDate(v.fecha_vencimiento)}</TableCell>
                      <TableCell className="text-center">
                        <span className={v.dias_vencido > 30 ? 'text-red-700 font-bold' : v.dias_vencido > 7 ? 'text-red-600 font-semibold' : 'text-amber-700'}>
                          {v.dias_vencido} d
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{v.cantidad_vencida}</TableCell>
                      <TableCell className="text-right tabular-nums text-zinc-500">{v.stock_dux_actual}</TableCell>
                      <TableCell className="text-right">
                        <button onClick={() => abrirHistorial(v.sku)} className="text-xs text-sky-600 hover:underline">
                          Historial
                        </button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {!loading && totalVenc > pageSize && (
            <Pagination page={pageVenc} pageSize={pageSize} total={totalVenc} onPage={setPageVenc} />
          )}
          {!loading && vencidos.length > 0 && (
            <p className="text-xs text-zinc-500">
              Estos productos tienen fecha de vencimiento pasada pero todavía hay stock en Dux. Revisar
              si la mercadería fue dada de baja físicamente y, en ese caso, descargarla en Dux para que el
              FEFO refleje la realidad.
            </p>
          )}
        </>
      )}

      {/* Tab: Historial */}
      {tab === 'historial' && (
        <>
          <div className="bg-white rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50">
                  <TableHead className="w-36">Fecha / hora</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead className="text-center">Tipo</TableHead>
                  <TableHead className="text-right">Vence</TableHead>
                  <TableHead className="text-right">Antes → Después</TableHead>
                  <TableHead className="text-right">Δ</TableHead>
                  <TableHead className="text-xs">Origen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonTable rows={10} cols={8} />
                ) : pagedMovs.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-12 text-zinc-400">No hay movimientos registrados aún</TableCell></TableRow>
                ) : (
                  pagedMovs.map(m => (
                    <TableRow key={m.id} className="hover:bg-zinc-50">
                      <TableCell className="text-xs text-zinc-600 tabular-nums">{formatDateTime(m.created_at)}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{m.nombre ?? m.sku}</div>
                        <div className="text-xs text-zinc-400 font-mono">{m.sku}</div>
                      </TableCell>
                      <TableCell className="text-sm">{m.sucursal}</TableCell>
                      <TableCell className="text-center">
                        <Badge className={TIPO_BADGE[m.tipo]}>{m.tipo}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{formatDate(m.fecha_vencimiento)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-zinc-600">
                        {m.cantidad_anterior} → <span className="font-semibold text-zinc-900">{m.cantidad_nueva}</span>
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${m.delta > 0 ? 'text-emerald-600' : m.delta < 0 ? 'text-red-600' : 'text-zinc-400'}`}>
                        {m.delta > 0 ? `+${m.delta}` : m.delta}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-500">{m.origen ?? '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {!loading && totalMovs > pageSize && (
            <Pagination page={pageMovs} pageSize={pageSize} total={totalMovs} onPage={setPageMovs} />
          )}
          {!loading && movs.length > 0 && (
            <p className="text-xs text-zinc-500">
              Cada cambio en la tabla de vencimientos queda registrado acá. El log empezó hoy: se va a poblar a medida que
              haya altas (recepción/carga rápida), descuentos (FEFO automático) o ediciones manuales.
            </p>
          )}
        </>
      )}
    </div>
  )
}
