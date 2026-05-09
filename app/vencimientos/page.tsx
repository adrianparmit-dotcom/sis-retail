'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Vencimiento, ProductoStock } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Estado = Vencimiento['estado']

const ESTADO_CONFIG: Record<Estado, { label: string; className: string }> = {
  vencido:   { label: 'Vencido',   className: 'bg-red-100 text-red-700 border-red-200' },
  critico:   { label: 'Crítico',   className: 'bg-red-50 text-red-600 border-red-100' },
  alerta:    { label: 'Alerta',    className: 'bg-orange-100 text-orange-700 border-orange-200' },
  proximo:   { label: 'Próximo',   className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  ok:        { label: 'OK',        className: 'bg-green-100 text-green-700 border-green-200' },
  sin_fecha: { label: 'Sin fecha', className: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
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

  useEffect(() => {
    async function fetchAll() {
      // Fetch vencimientos (with dates)
      const PAGE = 1000
      let allVenc: Vencimiento[] = []
      let from = 0
      while (true) {
        const { data: page } = await supabase
          .from('v_vencimientos_fefo')
          .select('*')
          .range(from, from + PAGE - 1)
        if (!page || page.length === 0) break
        allVenc = allVenc.concat(page as Vencimiento[])
        if (page.length < PAGE) break
        from += PAGE
      }

      // Fetch all products with stock > 0
      let allProd: ProductoStock[] = []
      from = 0
      while (true) {
        const { data: page } = await supabase
          .from('productos')
          .select('id,sku,nombre,categoria,stock_dux,codigo_barras')
          .gt('stock_dux', 0)
          .order('nombre')
          .range(from, from + PAGE - 1)
        if (!page || page.length === 0) break
        allProd = allProd.concat(page as ProductoStock[])
        if (page.length < PAGE) break
        from += PAGE
      }

      setVencimientos(allVenc)
      setProductos(allProd)
      setLoading(false)
    }
    fetchAll()
  }, [])

  // Products that already have at least one vencimiento entry
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
      if (search && !`${v.nombre} ${v.sku}`.toLowerCase().includes(search.toLowerCase())) return false
      if (estado !== 'todos' && v.estado !== estado) return false
      if (sucursal !== 'todas' && v.sucursal !== sucursal) return false
      return true
    })
  }, [vencimientos, search, estado, sucursal])

  const filteredPend = useMemo(() => {
    if (!search) return pendientes
    return pendientes.filter(p =>
      `${p.nombre} ${p.sku}`.toLowerCase().includes(search.toLowerCase())
    )
  }, [pendientes, search])

  const counts = useMemo(() => {
    const c: Partial<Record<Estado, number>> = {}
    vencimientos.forEach(v => { c[v.estado] = (c[v.estado] ?? 0) + 1 })
    return c
  }, [vencimientos])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Vencimientos FEFO</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Gestión de fechas — primero en vencer, primero en salir</p>
        </div>
        <div className="flex gap-2">
          <Link href="/vencimientos/carga-rapida">
            <Button variant="outline" size="sm">Carga rápida</Button>
          </Link>
          <Link href="/recepciones/nueva">
            <Button size="sm">+ Nueva recepción</Button>
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Pendientes de carga */}
        <button
          onClick={() => setTab('pendientes')}
          className={`text-left rounded-lg border p-3 transition-all hover:shadow-sm ${tab === 'pendientes' ? 'ring-2 ring-zinc-900' : ''}`}
        >
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">Pendientes</p>
          <p className="text-2xl font-bold text-zinc-400">{loading ? '—' : pendientes.length}</p>
          <p className="text-xs text-zinc-400 mt-0.5">sin fecha</p>
        </button>
        {/* By estado */}
        {(['vencido', 'critico', 'alerta', 'proximo', 'ok'] as Estado[]).map(e => (
          <button
            key={e}
            onClick={() => { setTab('cargados'); setEstado(estado === e ? 'todos' : e) }}
            className={`text-left rounded-lg border p-3 transition-all hover:shadow-sm ${tab === 'cargados' && estado === e ? 'ring-2 ring-zinc-900' : ''}`}
          >
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">{ESTADO_CONFIG[e].label}</p>
            <p className="text-2xl font-bold text-zinc-900">{counts[e] ?? 0}</p>
            <p className="text-xs text-zinc-400 mt-0.5">lotes</p>
          </button>
        ))}
      </div>

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
        <Input
          placeholder={tab === 'cargados' ? 'Buscar producto o SKU...' : 'Buscar...'}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
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
            <span className="text-sm text-zinc-400 self-center">{filteredVenc.length} lotes</span>
          </>
        )}
        {tab === 'pendientes' && (
          <span className="text-sm text-zinc-400 self-center">{filteredPend.length} productos</span>
        )}
      </div>

      {/* Table: Con fecha cargada */}
      {tab === 'cargados' && (
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-zinc-400 py-12">Cargando...</TableCell></TableRow>
                ) : filteredVenc.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12">
                      <p className="text-zinc-400">No hay lotes con fecha cargada</p>
                      <p className="text-xs text-zinc-400 mt-1">Usá Carga Rápida o Nueva Recepción para agregar fechas</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredVenc.map(v => (
                    <TableRow key={v.lote_id} className="hover:bg-zinc-50">
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
                          <span className={v.dias_para_vencer < 0 ? 'text-red-600 font-bold' : v.dias_para_vencer <= 7 ? 'text-red-500 font-semibold' : 'text-zinc-600'}>
                            {v.dias_para_vencer < 0 ? `+${Math.abs(v.dias_para_vencer)}d` : `${v.dias_para_vencer}d`}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center"><EstadoBadge estado={v.estado} /></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Table: Pendientes */}
      {tab === 'pendientes' && (
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
                  <TableRow><TableCell colSpan={4} className="text-center text-zinc-400 py-12">Cargando...</TableCell></TableRow>
                ) : filteredPend.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-zinc-400 py-12">Todos los productos tienen fecha cargada</TableCell></TableRow>
                ) : (
                  filteredPend.map(p => (
                    <TableRow key={p.id} className="hover:bg-zinc-50">
                      <TableCell>
                        <div className="font-medium text-sm">{p.nombre ?? p.sku}</div>
                        <div className="text-xs text-zinc-400 font-mono">{p.sku}</div>
                      </TableCell>
                      <TableCell className="text-xs text-zinc-500">{p.categoria ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-zinc-500">{(p.stock_dux ?? 0).toLocaleString('es-AR')}</TableCell>
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
      )}
    </div>
  )
}
