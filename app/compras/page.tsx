'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { ProductoCompra } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const fmt = (n: number | null | undefined, decimals = 0) =>
  n == null ? '—' : n.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

const fmtPeso = (n: number | null | undefined) =>
  n == null || n === 0 ? '—' : `$${fmt(n, 0)}`

function CoberturaTag({ dias }: { dias: number }) {
  if (dias >= 999) return <Badge variant="outline" className="text-zinc-400">Sin ventas</Badge>
  if (dias <= 7)   return <Badge className="bg-red-100 text-red-700 border-red-200">{dias}d</Badge>
  if (dias <= 30)  return <Badge className="bg-orange-100 text-orange-700 border-orange-200">{dias}d</Badge>
  if (dias <= 60)  return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">{dias}d</Badge>
  return <Badge className="bg-green-100 text-green-700 border-green-200">{dias}d</Badge>
}

export default function ComprasPage() {
  const [data, setData] = useState<ProductoCompra[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('todas')
  const [cobertura, setCobertura] = useState('urgente') // urgente=<30d, todas

  useEffect(() => {
    async function fetchAll() {
      const PAGE = 1000
      let all: ProductoCompra[] = []
      let from = 0
      while (true) {
        const { data: page, error } = await supabase
          .from('v_compras_inteligentes')
          .select('*')
          .order('dias_cobertura', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error || !page || page.length === 0) break
        all = all.concat(page as ProductoCompra[])
        if (page.length < PAGE) break
        from += PAGE
      }
      setData(all)
      setLoading(false)
    }
    fetchAll()
  }, [])

  const categorias = useMemo(() => {
    const cats = [...new Set(data.map(d => d.categoria).filter(Boolean))] as string[]
    return cats.sort()
  }, [data])

  const filtered = useMemo(() => {
    return data.filter(p => {
      if (search && !`${p.nombre} ${p.sku} ${p.marca}`.toLowerCase().includes(search.toLowerCase())) return false
      if (categoria !== 'todas' && p.categoria !== categoria) return false
      if (cobertura === 'urgente' && p.dias_cobertura > 30) return false
      if (cobertura === 'bajo' && p.dias_cobertura > 60) return false
      return true
    })
  }, [data, search, categoria, cobertura])

  // KPIs
  const urgentes   = data.filter(p => p.dias_cobertura < 30 && p.ventas_30d > 0).length
  const sinStock   = data.filter(p => p.stock_actual === 0 && p.ventas_30d > 0).length
  const inversion  = filtered.reduce((s, p) => s + (p.inversion_sugerida ?? 0), 0)
  const unidades   = filtered.reduce((s, p) => s + (p.sugerencia_compra ?? 0), 0)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Dashboard de Compras</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Reposición inteligente basada en velocidad de venta</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4"><CardTitle className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Urgentes (&lt;30d)</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4"><p className="text-2xl font-bold text-red-600">{urgentes}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4"><CardTitle className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Sin stock activo</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4"><p className="text-2xl font-bold text-orange-600">{sinStock}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4"><CardTitle className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Inversión sugerida</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4"><p className="text-2xl font-bold text-zinc-900">{fmtPeso(inversion)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4"><CardTitle className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Unidades a comprar</CardTitle></CardHeader>
          <CardContent className="px-4 pb-4"><p className="text-2xl font-bold text-zinc-900">{fmt(unidades)}</p></CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Buscar producto, SKU o marca..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={cobertura} onValueChange={v => setCobertura(v ?? 'urgente')}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filtro cobertura">
              {cobertura === 'urgente' ? 'Urgentes (<30 días)' : cobertura === 'bajo' ? 'Stock bajo (<60 días)' : 'Todos los productos'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="urgente">Urgentes (&lt;30 días)</SelectItem>
            <SelectItem value="bajo">Stock bajo (&lt;60 días)</SelectItem>
            <SelectItem value="todas">Todos los productos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoria} onValueChange={v => setCategoria(v ?? 'todas')}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Categoría">
              {categoria === 'todas' ? 'Todas las categorías' : categoria}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las categorías</SelectItem>
            {categorias.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-zinc-400 self-center">{filtered.length} productos</span>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50">
                <TableHead className="w-24">SKU</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Vtas 7d</TableHead>
                <TableHead className="text-right">Vtas 30d</TableHead>
                <TableHead className="text-right">Vel./día</TableHead>
                <TableHead className="text-center">Cobertura</TableHead>
                <TableHead className="text-right">Comprar</TableHead>
                <TableHead className="text-right">Inversión</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={10} className="text-center text-zinc-400 py-12">Cargando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center text-zinc-400 py-12">No hay productos con ese filtro</TableCell></TableRow>
              ) : (
                filtered.map(p => (
                  <TableRow key={p.id} className="hover:bg-zinc-50">
                    <TableCell className="font-mono text-xs text-zinc-500">{p.sku}</TableCell>
                    <TableCell className="max-w-xs">
                      <div className="font-medium text-sm truncate">{p.nombre ?? '—'}</div>
                      {p.marca && <div className="text-xs text-zinc-400">{p.marca}</div>}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500">{p.categoria ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={p.stock_actual === 0 ? 'text-red-600 font-semibold' : ''}>{fmt(p.stock_actual)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{fmt(p.ventas_7d)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{fmt(p.ventas_30d)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-zinc-500">{fmt(p.vel_diaria, 1)}</TableCell>
                    <TableCell className="text-center"><CoberturaTag dias={p.dias_cobertura} /></TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {p.sugerencia_compra > 0 ? fmt(p.sugerencia_compra) : <span className="text-zinc-300">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {p.inversion_sugerida > 0 ? fmtPeso(p.inversion_sugerida) : <span className="text-zinc-300">—</span>}
                    </TableCell>
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
