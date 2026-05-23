'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Recepcion, RecepcionItem } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const ESTADO_CONFIG: Record<string, { label: string; className: string }> = {
  pendiente:  { label: 'Pendiente',  className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  confirmada: { label: 'Confirmada', className: 'bg-green-100 text-green-700 border-green-200' },
  cancelada:  { label: 'Cancelada',  className: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
}

const ITEM_ESTADO_CONFIG: Record<string, { label: string; className: string }> = {
  ok:             { label: 'OK',              className: 'bg-green-100 text-green-700 border-green-200' },
  faltante:       { label: 'Faltante',        className: 'bg-red-100 text-red-600 border-red-200' },
  extra:          { label: 'Extra',           className: 'bg-blue-100 text-blue-700 border-blue-200' },
  vencido_llegada:{ label: 'Vencido llegada', className: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
}

const fmtFecha = (s: string | null) => {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function RecepcionDetallePage() {
  const { id } = useParams<{ id: string }>()
  const [recepcion, setRecepcion] = useState<Recepcion | null>(null)
  const [items, setItems] = useState<RecepcionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function load() {
      const [recRes, itemsRes] = await Promise.all([
        supabase.from('recepciones').select('*').eq('id', id).single(),
        supabase
          .from('recepcion_items')
          .select('*')
          .eq('recepcion_id', id)
          .order('sku'),
      ])
      if (!recRes.data) { setNotFound(true); setLoading(false); return }
      setRecepcion(recRes.data as Recepcion)
      setItems((itemsRes.data ?? []) as RecepcionItem[])
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) {
    return <div className="p-6 text-zinc-400">Cargando...</div>
  }

  if (notFound) {
    return (
      <div className="p-6">
        <p className="text-zinc-500">Recepción no encontrada.</p>
        <Link href="/recepciones" className="text-sm text-zinc-900 underline mt-2 block">← Volver a Recepciones</Link>
      </div>
    )
  }

  const r = recepcion!
  const estadoCfg = ESTADO_CONFIG[r.estado] ?? ESTADO_CONFIG.pendiente

  const totalItems = items.length
  const ok        = items.filter(i => i.estado === 'ok').length
  const faltantes = items.filter(i => i.estado === 'faltante').length
  const extras    = items.filter(i => i.estado === 'extra').length
  const vencidos  = items.filter(i => i.estado === 'vencido_llegada').length

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/recepciones" className="text-zinc-400 hover:text-zinc-700 text-sm mt-1">← Recepciones</Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-zinc-900">
              Recepción {r.numero_comprobante ?? r.dux_compra_id ?? r.id.slice(0, 8)}
            </h1>
            <Badge className={estadoCfg.className}>{estadoCfg.label}</Badge>
          </div>
          {r.proveedor_nombre && (
            <p className="text-sm text-zinc-500 mt-0.5">{r.proveedor_nombre}</p>
          )}
        </div>
      </div>

      {/* Meta info */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Fecha factura',   value: fmtFecha(r.fecha_factura) },
          { label: 'Fecha recepción', value: fmtFecha(r.fecha_recepcion) },
          { label: 'Operador',        value: r.operador ?? '—' },
          { label: 'Observaciones',   value: r.observaciones ?? '—' },
        ].map(m => (
          <div key={m.label} className="rounded-lg border p-3">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1">{m.label}</p>
            <p className="text-sm font-medium text-zinc-700">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total ítems', value: totalItems, cls: 'text-zinc-900' },
          { label: 'OK',          value: ok,         cls: 'text-green-700' },
          { label: 'Faltantes',   value: faltantes,  cls: 'text-red-600' },
          { label: 'Extras',      value: extras,      cls: 'text-blue-700' },
        ].map(s => (
          <div key={s.label} className="rounded-lg border p-3">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {vencidos > 0 && (
        <div className="rounded-md bg-zinc-50 border px-4 py-2 text-sm text-zinc-500">
          {vencidos} ítem{vencidos !== 1 ? 's' : ''} llegaron vencidos — no se cargaron a vencimientos.
        </div>
      )}

      {/* Items table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50">
              <TableHead>SKU</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Esperado</TableHead>
              <TableHead className="text-right">Recibido</TableHead>
              <TableHead>Vencimiento</TableHead>
              <TableHead className="text-center">Estado</TableHead>
              <TableHead>Obs.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-zinc-400 py-12">Sin ítems registrados</TableCell>
              </TableRow>
            ) : (
              items.map(item => {
                const cfg = ITEM_ESTADO_CONFIG[item.estado] ?? ITEM_ESTADO_CONFIG.ok
                return (
                  <TableRow key={item.id} className="hover:bg-zinc-50">
                    <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                    <TableCell className="text-sm">{item.nombre_producto ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{item.cantidad_esperada}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {item.cantidad_recibida ?? '—'}
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">{fmtFecha(item.fecha_vencimiento)}</TableCell>
                    <TableCell className="text-center">
                      <Badge className={`${cfg.className} text-xs`}>{cfg.label}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-400 max-w-xs truncate">{item.observacion ?? '—'}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Original invoice text */}
      {r.texto_original && (
        <div>
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Texto original pegado</p>
          <pre className="rounded-lg border bg-zinc-50 p-4 text-xs text-zinc-600 overflow-x-auto whitespace-pre-wrap font-mono max-h-64">
            {r.texto_original}
          </pre>
        </div>
      )}
    </div>
  )
}
