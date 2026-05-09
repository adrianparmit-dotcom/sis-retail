'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Recepcion } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const ESTADO_CONFIG: Record<string, { label: string; className: string }> = {
  pendiente:   { label: 'Pendiente',   className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  confirmada:  { label: 'Confirmada',  className: 'bg-green-100 text-green-700 border-green-200' },
  cancelada:   { label: 'Cancelada',   className: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
}

const fmtFecha = (s: string | null) => {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function RecepcionesPage() {
  const [data, setData] = useState<Recepcion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('recepciones')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setData((data ?? []) as Recepcion[])
        setLoading(false)
      })
  }, [])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Recepciones</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Registro de mercadería recibida con fechas de vencimiento</p>
        </div>
        <Link href="/recepciones/nueva">
          <Button size="sm">+ Nueva recepción</Button>
        </Link>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50">
              <TableHead>Comprobante</TableHead>
              <TableHead>Proveedor</TableHead>
              <TableHead>Fecha factura</TableHead>
              <TableHead>Fecha recepción</TableHead>
              <TableHead className="text-center">Estado</TableHead>
              <TableHead className="text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-zinc-400 py-12">Cargando...</TableCell></TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-16">
                  <p className="text-zinc-400">No hay recepciones registradas</p>
                  <p className="text-xs text-zinc-400 mt-1">Cuando llegue mercadería, creá una nueva recepción para cargar las fechas de vencimiento</p>
                </TableCell>
              </TableRow>
            ) : (
              data.map(r => {
                const estadoCfg = ESTADO_CONFIG[r.estado] ?? ESTADO_CONFIG.pendiente
                return (
                  <TableRow key={r.id} className="hover:bg-zinc-50">
                    <TableCell className="font-mono text-sm">{r.numero_comprobante ?? r.dux_compra_id ?? '—'}</TableCell>
                    <TableCell className="text-sm">{r.proveedor_nombre ?? '—'}</TableCell>
                    <TableCell className="text-sm tabular-nums">{fmtFecha(r.fecha_factura)}</TableCell>
                    <TableCell className="text-sm tabular-nums">{fmtFecha(r.fecha_recepcion)}</TableCell>
                    <TableCell className="text-center">
                      <Badge className={estadoCfg.className}>{estadoCfg.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/recepciones/${r.id}`}>
                        <Button variant="outline" size="sm" className="text-xs h-7">Ver detalle</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
