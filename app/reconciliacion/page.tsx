'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { ReconciliacionItem } from '@/lib/types'
import { matchesQuery } from '@/lib/search'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { exportTablaXlsx, type ColumnaExport } from '@/lib/export-xlsx'
import { Download } from 'lucide-react'

const ESTADO_CONFIG: Record<ReconciliacionItem['estado_reconciliacion'], { label: string; className: string }> = {
  ok:        { label: 'OK',        className: 'bg-green-100 text-green-700 border-green-200' },
  sin_carga: { label: 'Sin carga', className: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  faltante:  { label: 'Faltante',  className: 'bg-red-100 text-red-700 border-red-200' },
  exceso:    { label: 'Exceso',    className: 'bg-blue-100 text-blue-700 border-blue-200' },
}

export default function ReconciliacionPage() {
  const [data, setData] = useState<ReconciliacionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<string>('todos')
  const [filtroCategoria, setFiltroCategoria] = useState<string>('todas')

  const categorias = useMemo(
    () => [...new Set(data.map(d => d.categoria).filter(Boolean))].sort() as string[],
    [data],
  )

  useEffect(() => {
    async function fetchAll() {
      const PAGE = 1000
      let all: ReconciliacionItem[] = []
      let from = 0
      while (true) {
        const { data: page } = await supabase
          .from('v_reconciliacion')
          .select('*')
          .range(from, from + PAGE - 1)
        if (!page || page.length === 0) break
        all = all.concat(page as ReconciliacionItem[])
        if (page.length < PAGE) break
        from += PAGE
      }
      setData(all)
      setLoading(false)
    }
    fetchAll()
  }, [])

  const stats = useMemo(() => {
    const total = data.length
    const ok = data.filter(d => d.estado_reconciliacion === 'ok').length
    const sinCarga = data.filter(d => d.estado_reconciliacion === 'sin_carga').length
    const faltante = data.filter(d => d.estado_reconciliacion === 'faltante').length
    const exceso = data.filter(d => d.estado_reconciliacion === 'exceso').length
    return { total, ok, sinCarga, faltante, exceso }
  }, [data])

  const filtered = useMemo(() => {
    return data.filter(d => {
      if (search && !matchesQuery(search, d.nombre, d.sku)) return false
      if (filtroEstado !== 'todos' && d.estado_reconciliacion !== filtroEstado) return false
      if (filtroCategoria !== 'todas' && d.categoria !== filtroCategoria) return false
      return true
    })
  }, [data, search, filtroEstado, filtroCategoria])

  function handleExportExcel() {
    const cols: ColumnaExport<ReconciliacionItem>[] = [
      { header: 'SKU',             value: d => d.sku },
      { header: 'Producto',        value: d => d.nombre ?? '' },
      { header: 'Categoría',       value: d => d.categoria ?? '' },
      { header: 'Stock Dux',       value: d => d.stock_dux },
      { header: 'Con vencimiento', value: d => d.cantidad_vencimientos },
      { header: 'Diferencia',      value: d => d.diferencia },
      { header: 'Estado',          value: d => ESTADO_CONFIG[d.estado_reconciliacion].label },
    ]
    exportTablaXlsx('reconciliacion', cols, filtered, 'Reconciliación')
  }

  const pct = (n: number, total: number) => total === 0 ? 0 : Math.round((n / total) * 100)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Reconciliación</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Comparación entre stock Dux y fechas de vencimiento cargadas</p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Con stock (total)',  value: stats.total,    sub: '100%',                    ring: filtroEstado === 'todos' },
          { label: 'OK — match exacto', value: stats.ok,       sub: `${pct(stats.ok, stats.total)}%`, ring: filtroEstado === 'ok', onClick: () => setFiltroEstado(filtroEstado === 'ok' ? 'todos' : 'ok') },
          { label: 'Sin carga',         value: stats.sinCarga, sub: `${pct(stats.sinCarga, stats.total)}%`, ring: filtroEstado === 'sin_carga', onClick: () => setFiltroEstado(filtroEstado === 'sin_carga' ? 'todos' : 'sin_carga') },
          { label: 'Diferencias',       value: stats.faltante + stats.exceso, sub: `${pct(stats.faltante + stats.exceso, stats.total)}%`, ring: filtroEstado === 'faltante' || filtroEstado === 'exceso', onClick: () => setFiltroEstado(filtroEstado === 'faltante' ? 'todos' : 'faltante') },
        ].map((kpi, i) => (
          <button
            key={i}
            onClick={kpi.onClick}
            className={`text-left rounded-lg border p-3 transition-all hover:shadow-sm ${kpi.ring ? 'ring-2 ring-zinc-900' : ''} ${kpi.onClick ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">{kpi.label}</p>
            <p className="text-2xl font-bold text-zinc-900">{loading ? '—' : kpi.value}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{kpi.sub}</p>
          </button>
        ))}
      </div>

      {/* Progress bar */}
      {!loading && stats.total > 0 && (
        <div>
          <div className="flex justify-between text-xs text-zinc-500 mb-1">
            <span>Progreso de carga de fechas</span>
            <span>{stats.ok} / {stats.total} ({pct(stats.ok, stats.total)}%)</span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-zinc-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all"
              style={{ width: `${pct(stats.ok + stats.faltante, stats.total)}%` }}
            />
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Verde = con fecha cargada ({stats.ok + stats.faltante} productos). Gris = sin carga ({stats.sinCarga} productos).
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Buscar SKU o producto..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
        <div className="flex gap-1">
          {(['todos', 'sin_carga', 'faltante', 'exceso', 'ok'] as const).map(est => (
            <button
              key={est}
              onClick={() => setFiltroEstado(est)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${filtroEstado === est ? 'bg-zinc-900 text-white border-zinc-900' : 'text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}
            >
              {est === 'todos' ? 'Todos' : ESTADO_CONFIG[est].label}
            </button>
          ))}
        </div>
        <select
          value={filtroCategoria}
          onChange={e => setFiltroCategoria(e.target.value)}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none hover:bg-zinc-50"
        >
          <option value="todas">Todas las categorías</option>
          {categorias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-sm text-zinc-400 self-center">{filtered.length} productos</span>
        <Button variant="outline" size="sm" className="ml-auto flex items-center gap-1.5"
          onClick={handleExportExcel} disabled={filtered.length === 0 || loading}>
          <Download size={14} />
          Excel
        </Button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50">
                <TableHead>Producto</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Stock Dux</TableHead>
                <TableHead className="text-right">Con vencimiento</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
                <TableHead className="text-center">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-zinc-400 py-12">Cargando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-zinc-400 py-12">No hay productos</TableCell></TableRow>
              ) : (
                filtered.map(d => {
                  const cfg = ESTADO_CONFIG[d.estado_reconciliacion]
                  return (
                    <TableRow key={d.producto_id} className="hover:bg-zinc-50">
                      <TableCell>
                        <div className="font-medium text-sm">{d.nombre ?? d.sku}</div>
                        <div className="text-xs text-zinc-400 font-mono">{d.sku}</div>
                      </TableCell>
                      <TableCell className="text-xs text-zinc-500">{d.categoria ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{d.stock_dux.toLocaleString('es-AR')}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.cantidad_vencimientos.toLocaleString('es-AR')}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {d.diferencia === 0 ? (
                          <span className="text-zinc-300">—</span>
                        ) : (
                          <span className={d.diferencia > 0 ? 'text-red-600 font-semibold' : 'text-blue-600 font-semibold'}>
                            {d.diferencia > 0 ? `−${d.diferencia}` : `+${Math.abs(d.diferencia)}`}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className={cfg.className}>{cfg.label}</Badge>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
