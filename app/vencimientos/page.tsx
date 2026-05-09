'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { LoteVencimiento } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Estado = LoteVencimiento['estado']

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
  const [data, setData] = useState<LoteVencimiento[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState('todos')
  const [sucursal, setSucursal] = useState('todas')

  useEffect(() => {
    async function fetchAll() {
      const PAGE = 1000
      let all: LoteVencimiento[] = []
      let from = 0
      while (true) {
        const { data: page, error } = await supabase
          .from('v_vencimientos_fefo')
          .select('*')
          .range(from, from + PAGE - 1)
        if (error || !page || page.length === 0) break
        all = all.concat(page as LoteVencimiento[])
        if (page.length < PAGE) break
        from += PAGE
      }
      setData(all)
      setLoading(false)
    }
    fetchAll()
  }, [])

  const sucursales = useMemo(() => [...new Set(data.map(d => d.sucursal))].sort(), [data])

  const filtered = useMemo(() => {
    return data.filter(l => {
      if (search && !`${l.nombre} ${l.sku} ${l.numero_lote}`.toLowerCase().includes(search.toLowerCase())) return false
      if (estado !== 'todos' && l.estado !== estado) return false
      if (sucursal !== 'todas' && l.sucursal !== sucursal) return false
      return true
    })
  }, [data, search, estado, sucursal])

  // Conteos por estado
  const counts = useMemo(() => {
    const c: Partial<Record<Estado, number>> = {}
    data.forEach(l => { c[l.estado] = (c[l.estado] ?? 0) + 1 })
    return c
  }, [data])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Vencimientos FEFO</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Gestión de lotes por fecha — primero en vencer, primero en salir</p>
      </div>

      {/* KPIs por estado */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {(['vencido', 'critico', 'alerta', 'proximo', 'ok'] as Estado[]).map(e => (
          <button
            key={e}
            onClick={() => setEstado(estado === e ? 'todos' : e)}
            className={`text-left rounded-lg border p-3 transition-all hover:shadow-sm ${estado === e ? 'ring-2 ring-zinc-900' : ''}`}
          >
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">{ESTADO_CONFIG[e].label}</p>
            <p className="text-2xl font-bold text-zinc-900">{counts[e] ?? 0}</p>
            <p className="text-xs text-zinc-400 mt-0.5">lotes</p>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Buscar producto, SKU o lote..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={estado} onValueChange={v => setEstado(v ?? 'todos')}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Estado">
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
            <SelectValue placeholder="Sucursal">
              {sucursal === 'todas' ? 'Todas' : sucursal}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            {sucursales.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-zinc-400 self-center">{filtered.length} lotes</span>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50">
                <TableHead>Producto</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead>Sucursal</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Vence</TableHead>
                <TableHead className="text-center">Días</TableHead>
                <TableHead className="text-center">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center text-zinc-400 py-12">Cargando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-zinc-400 py-12">No hay lotes con ese filtro</TableCell></TableRow>
              ) : (
                filtered.map(l => (
                  <TableRow key={l.lote_id} className="hover:bg-zinc-50">
                    <TableCell>
                      <div className="font-medium text-sm">{l.nombre ?? l.sku}</div>
                      <div className="text-xs text-zinc-400 font-mono">{l.sku}</div>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500">{l.categoria ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-zinc-600">{l.numero_lote}</TableCell>
                    <TableCell className="text-sm">{l.sucursal}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{l.cantidad.toLocaleString('es-AR')}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{fmtFecha(l.fecha_vencimiento)}</TableCell>
                    <TableCell className="text-center">
                      {l.dias_para_vencer == null ? (
                        <span className="text-zinc-300">—</span>
                      ) : (
                        <span className={l.dias_para_vencer < 0 ? 'text-red-600 font-bold' : l.dias_para_vencer <= 7 ? 'text-red-500 font-semibold' : 'text-zinc-600'}>
                          {l.dias_para_vencer < 0 ? `+${Math.abs(l.dias_para_vencer)}d` : `${l.dias_para_vencer}d`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center"><EstadoBadge estado={l.estado} /></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
