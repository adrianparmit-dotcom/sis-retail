'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Recepcion } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertCircle } from 'lucide-react'

const ESTADO_CONFIG: Record<string, { label: string; className: string }> = {
  borrador   : { label: 'Borrador',   className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  pendiente  : { label: 'Pendiente',  className: 'bg-blue-100 text-blue-700 border-blue-200' },
  confirmada : { label: 'Confirmada', className: 'bg-green-100 text-green-700 border-green-200' },
  cancelada  : { label: 'Cancelada',  className: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
}

const fmtFecha = (s: string | null) => {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function RecepcionesPage() {
  const [data, setData]       = useState<Recepcion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('recepciones')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setData((data ?? []) as Recepcion[])
        setLoading(false)
      })
  }, [])

  const borradores   = useMemo(() => data.filter(r => r.estado === 'borrador'),   [data])
  const confirmadas  = useMemo(() => data.filter(r => r.estado !== 'borrador'),   [data])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Recepciones</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Registro de mercadería recibida con fechas de vencimiento</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/instrucciones">
            <Button size="sm" variant="outline">📖 Instructivo</Button>
          </Link>
          <Link href="/recepciones/factura">
            <Button size="sm">📄 Desde factura PDF</Button>
          </Link>
          <Link href="/recepciones/nueva">
            <Button size="sm" variant="outline">Desde Dux</Button>
          </Link>
        </div>
      </div>

      {/* ── Borradores abiertos — prominente ───────────────────── */}
      {!loading && borradores.length > 0 && (
        <div className="rounded-xl border-2 border-yellow-300 bg-yellow-50 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-yellow-100 border-b border-yellow-200">
            <AlertCircle size={16} className="text-yellow-600 shrink-0" />
            <span className="text-sm font-semibold text-yellow-800">
              {borradores.length} recepción{borradores.length > 1 ? 'es' : ''} en borrador — pendiente de completar
            </span>
            <span className="text-xs text-yellow-600 ml-1">
              (Retomá para actualizar cantidades de granel o completar vencimientos)
            </span>
          </div>
          <div className="divide-y divide-yellow-200">
            {borradores.map(r => (
              <div key={r.id} className="flex items-center gap-4 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-sm text-zinc-800 truncate">
                      {r.proveedor_nombre ?? '—'}
                    </span>
                    <span className="font-mono text-xs text-zinc-500 shrink-0">
                      {r.numero_comprobante ?? r.dux_compra_id ?? 'S/N'}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Factura: {fmtFecha(r.fecha_factura)} · Guardado: {fmtFecha(r.fecha_recepcion)}
                  </div>
                </div>
                <Link href={`/recepciones/factura?borrador=${r.id}`}>
                  <Button size="sm" className="bg-yellow-600 hover:bg-yellow-700 text-white shrink-0">
                    Retomar →
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Historial ─────────────────────────────────────────── */}
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
              <TableRow>
                <TableCell colSpan={6} className="text-center text-zinc-400 py-12">Cargando...</TableCell>
              </TableRow>
            ) : confirmadas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-16">
                  <p className="text-zinc-400">No hay recepciones confirmadas</p>
                  <p className="text-xs text-zinc-400 mt-1">Cuando llegue mercadería, procesá la factura PDF desde el botón de arriba</p>
                </TableCell>
              </TableRow>
            ) : (
              confirmadas.map(r => {
                const cfg = ESTADO_CONFIG[r.estado] ?? ESTADO_CONFIG.pendiente
                return (
                  <TableRow key={r.id} className="hover:bg-zinc-50">
                    <TableCell className="font-mono text-sm">{r.numero_comprobante ?? r.dux_compra_id ?? '—'}</TableCell>
                    <TableCell className="text-sm">{r.proveedor_nombre ?? '—'}</TableCell>
                    <TableCell className="text-sm tabular-nums">{fmtFecha(r.fecha_factura)}</TableCell>
                    <TableCell className="text-sm tabular-nums">{fmtFecha(r.fecha_recepcion)}</TableCell>
                    <TableCell className="text-center">
                      <Badge className={cfg.className}>{cfg.label}</Badge>
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
