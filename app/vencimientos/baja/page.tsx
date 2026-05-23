'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface ProductoBaja {
  id: string
  sku: string
  nombre: string | null
  categoria: string | null
  proveedor_nombre: string | null
  precio_venta: number | null
  lotes_vencidos: number
  unidades_vencidas: number
  primer_venc: string | null
  ultimo_venc: string | null
  meses_distintos: number
}

function fmtFecha(s: string | null) {
  if (!s) return '—'
  return s.slice(0, 10).split('-').reverse().join('/')
}

function exportCSV(rows: ProductoBaja[]) {
  const headers = ['SKU', 'Nombre', 'Categoría', 'Proveedor', 'Precio venta', 'Lotes vencidos', 'Unidades vencidas', 'Primer venc.', 'Último venc.', 'Meses distintos']
  const csvRows = rows.map(r => [
    r.sku, r.nombre ?? '', r.categoria ?? '', r.proveedor_nombre ?? '',
    r.precio_venta ?? '', r.lotes_vencidos, r.unidades_vencidas,
    fmtFecha(r.primer_venc), fmtFecha(r.ultimo_venc), r.meses_distintos,
  ])
  const csv = [headers, ...csvRows]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `productos-baja-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function ProductosBajaPage() {
  const [data, setData] = useState<ProductoBaja[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('v_productos_baja').select('*').then(({ data }) => {
      setData((data ?? []) as ProductoBaja[])
      setLoading(false)
    })
  }, [])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/vencimientos" className="text-zinc-400 hover:text-zinc-700 text-sm">← Vencimientos</Link>
          </div>
          <h1 className="text-xl font-semibold text-zinc-900">Productos a dar de baja</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Sin ventas en los últimos 30 días y con stock vencido en 2 o más meses consecutivos
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportCSV(data)} disabled={data.length === 0} className="flex items-center gap-1.5">
          <Download size={14} /> Exportar CSV
        </Button>
      </div>

      {!loading && data.length === 0 && (
        <div className="rounded-lg border p-12 text-center text-zinc-400">
          <p className="font-medium text-zinc-500">Sin productos a dar de baja</p>
          <p className="text-sm mt-1">No hay productos con vencimientos en 2+ meses y sin ventas recientes.</p>
        </div>
      )}

      {(loading || data.length > 0) && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50">
                  <TableHead className="w-24">SKU</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="text-center">Meses vencidos</TableHead>
                  <TableHead className="text-right">Unidades vencidas</TableHead>
                  <TableHead className="text-center">Primer venc.</TableHead>
                  <TableHead className="text-center">Último venc.</TableHead>
                  <TableHead className="text-right">Precio venta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-zinc-400 py-12">Cargando...</TableCell></TableRow>
                ) : data.map(r => (
                  <TableRow key={r.id} className="hover:bg-zinc-50">
                    <TableCell className="font-mono text-xs text-zinc-500">{r.sku}</TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{r.nombre ?? '—'}</div>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500">{r.proveedor_nombre ?? '—'}</TableCell>
                    <TableCell className="text-xs text-zinc-500">{r.categoria ?? '—'}</TableCell>
                    <TableCell className="text-center">
                      <Badge className={
                        r.meses_distintos >= 3 ? 'bg-red-100 text-red-700 border-red-200' :
                        'bg-orange-100 text-orange-700 border-orange-200'
                      }>
                        {r.meses_distintos} mes{r.meses_distintos > 1 ? 'es' : ''}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-red-600">
                      {r.unidades_vencidas}
                    </TableCell>
                    <TableCell className="text-center text-xs text-zinc-500">{fmtFecha(r.primer_venc)}</TableCell>
                    <TableCell className="text-center text-xs text-zinc-500">{fmtFecha(r.ultimo_venc)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-zinc-500">
                      {r.precio_venta ? `$${r.precio_venta.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {!loading && data.length > 0 && (
        <p className="text-xs text-zinc-400">
          {data.length} producto{data.length > 1 ? 's' : ''} identificado{data.length > 1 ? 's' : ''} para revisión de baja.
          Exportá el CSV y coordiná con proveedores antes de dar de baja en Dux.
        </p>
      )}
    </div>
  )
}
