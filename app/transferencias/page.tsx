'use client'

/**
 * /transferencias
 * Lista de transferencias internas pendientes / finalizadas.
 * Generadas automáticamente al confirmar una recepción con ítems → S1.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, Clock, ArrowRight } from 'lucide-react'

interface TransfItem {
  id              : string
  producto_sku    : string | null
  producto_nombre : string | null
  cantidad        : number
}

interface Transf {
  id                  : string
  recepcion_id        : string | null
  sucursal_origen_id  : string | null
  sucursal_destino_id : string | null
  estado              : 'pendiente' | 'finalizado'
  created_at          : string
  finalizado_at       : string | null
  finalizado_por      : string | null
  notas               : string | null
  // joined
  recepcion           : { proveedor_nombre: string | null; numero_comprobante: string | null } | null
  items               : TransfItem[]
}

const SUCURSAL_NOMBRES: Record<string, string> = {
  'a0000000-0000-0000-0000-000000000001': 'SOHO 1 - Local',
  'a0000000-0000-0000-0000-000000000002': 'SOHO 1 - La Pieza',
  'a0000000-0000-0000-0000-000000000003': 'SOHO 2 - Local',
  'a0000000-0000-0000-0000-000000000004': 'SOHO 2 - Depósito',
}

export default function TransferenciasPage() {
  const [transferencias, setTransferencias] = useState<Transf[]>([])
  const [loading, setLoading]               = useState(true)
  const [finalizando, setFinalizando]       = useState<string | null>(null)
  const [filtro, setFiltro]                 = useState<'pendiente' | 'finalizado' | 'todas'>('pendiente')

  async function load() {
    setLoading(true)
    const { data: transfRows } = await supabase
      .from('transferencias_recepcion')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (!transfRows || transfRows.length === 0) {
      setTransferencias([])
      setLoading(false)
      return
    }

    const ids = (transfRows as Transf[]).map(t => t.id)
    const recIds = (transfRows as Transf[]).map(t => t.recepcion_id).filter(Boolean) as string[]

    const [{ data: itemsRows }, { data: recRows }] = await Promise.all([
      supabase.from('transferencias_recepcion_items')
        .select('id, transferencia_id, producto_sku, producto_nombre, cantidad')
        .in('transferencia_id', ids),
      recIds.length > 0
        ? supabase.from('recepciones')
            .select('id, proveedor_nombre, numero_comprobante')
            .in('id', recIds)
        : Promise.resolve({ data: [] }),
    ])

    const itemsByTransf = new Map<string, TransfItem[]>()
    for (const it of (itemsRows ?? []) as Array<TransfItem & { transferencia_id: string }>) {
      const list = itemsByTransf.get(it.transferencia_id) ?? []
      list.push(it)
      itemsByTransf.set(it.transferencia_id, list)
    }

    const recById = new Map<string, { proveedor_nombre: string | null; numero_comprobante: string | null }>()
    for (const r of (recRows ?? []) as Array<{ id: string; proveedor_nombre: string | null; numero_comprobante: string | null }>) {
      recById.set(r.id, r)
    }

    const enriched: Transf[] = (transfRows as Transf[]).map(t => ({
      ...t,
      items    : itemsByTransf.get(t.id) ?? [],
      recepcion: t.recepcion_id ? (recById.get(t.recepcion_id) ?? null) : null,
    }))

    setTransferencias(enriched)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function marcarFinalizado(id: string) {
    setFinalizando(id)
    await supabase.from('transferencias_recepcion').update({
      estado        : 'finalizado',
      finalizado_at : new Date().toISOString(),
    }).eq('id', id)
    setTransferencias(prev => prev.map(t =>
      t.id === id ? { ...t, estado: 'finalizado', finalizado_at: new Date().toISOString() } : t
    ))
    setFinalizando(null)
  }

  const filtradas = transferencias.filter(t => filtro === 'todas' ? true : t.estado === filtro)
  const pendientes = transferencias.filter(t => t.estado === 'pendiente').length

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Transferencias internas</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Generadas en recepciones · Ejecutar en Dux: Movimientos → Transferencia interna
          </p>
        </div>
        {pendientes > 0 && (
          <Badge className="bg-indigo-100 text-indigo-700 border-indigo-300 text-sm px-3 py-1">
            {pendientes} pendiente{pendientes > 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {/* Filtro */}
      <div className="flex gap-2">
        {(['pendiente', 'finalizado', 'todas'] as const).map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filtro === f
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'
            }`}>
            {f === 'pendiente' ? 'Pendientes' : f === 'finalizado' ? 'Finalizadas' : 'Todas'}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center gap-2 text-zinc-400 py-8 justify-center">
          <Loader2 className="animate-spin" size={18} />Cargando...
        </div>
      ) : filtradas.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 py-12 text-center">
          <p className="text-sm text-zinc-400">
            {filtro === 'pendiente' ? 'Sin transferencias pendientes 🎉' : 'Sin transferencias en este filtro'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtradas.map(t => {
            const origen  = SUCURSAL_NOMBRES[t.sucursal_origen_id  ?? ''] ?? t.sucursal_origen_id  ?? '—'
            const destino = SUCURSAL_NOMBRES[t.sucursal_destino_id ?? ''] ?? t.sucursal_destino_id ?? '—'
            const total   = t.items.reduce((s, i) => s + i.cantidad, 0)
            const fecha   = new Date(t.created_at).toLocaleDateString('es-AR')

            return (
              <div key={t.id}
                className={`rounded-xl border p-4 space-y-3 ${
                  t.estado === 'pendiente'
                    ? 'border-indigo-200 bg-indigo-50/40'
                    : 'border-zinc-200 bg-white opacity-70'
                }`}
              >
                {/* Cabecera */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      {t.estado === 'pendiente'
                        ? <Clock size={14} className="text-indigo-500" />
                        : <CheckCircle2 size={14} className="text-green-500" />}
                      <span className="text-sm font-semibold text-zinc-800">
                        {origen} <ArrowRight size={12} className="inline mx-0.5" /> {destino}
                      </span>
                      <Badge className={t.estado === 'pendiente'
                        ? 'bg-indigo-100 text-indigo-700 border-indigo-200 text-[10px]'
                        : 'bg-green-100 text-green-700 border-green-200 text-[10px]'}>
                        {t.estado === 'pendiente' ? 'Pendiente' : 'Finalizado'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <span>📅 {fecha}</span>
                      {t.recepcion && (
                        <>
                          <span>·</span>
                          <span>
                            {t.recepcion.proveedor_nombre ?? '—'}
                            {t.recepcion.numero_comprobante && ` · ${t.recepcion.numero_comprobante}`}
                          </span>
                        </>
                      )}
                      <span>·</span>
                      <span>{t.items.length} productos · {total} unidades</span>
                    </div>
                    {t.finalizado_at && (
                      <p className="text-[10px] text-green-600">
                        Finalizado el {new Date(t.finalizado_at).toLocaleDateString('es-AR')}
                        {t.finalizado_por ? ` por ${t.finalizado_por}` : ''}
                      </p>
                    )}
                  </div>

                  {t.recepcion_id && (
                    <Link href={`/recepciones/${t.recepcion_id}`} className="text-[11px] text-zinc-400 underline hover:text-zinc-600">
                      Ver recepción
                    </Link>
                  )}
                </div>

                {/* Items */}
                <div className="bg-white border border-indigo-100 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-50 border-b border-zinc-100">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-medium text-zinc-500">SKU</th>
                        <th className="text-left px-3 py-1.5 font-medium text-zinc-500">Producto</th>
                        <th className="text-right px-3 py-1.5 font-medium text-zinc-500">Unidades</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.items.map((it, idx) => (
                        <tr key={idx} className="border-b border-zinc-50 last:border-0">
                          <td className="px-3 py-1.5 font-mono text-zinc-400">{it.producto_sku ?? '—'}</td>
                          <td className="px-3 py-1.5 text-zinc-700">{it.producto_nombre ?? '—'}</td>
                          <td className="px-3 py-1.5 font-semibold text-indigo-700 text-right">{it.cantidad}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Acción */}
                {t.estado === 'pendiente' && (
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <p className="text-xs text-indigo-700">
                      Dux → Movimientos → Transferencia interna → De <strong>{origen}</strong> → A <strong>{destino}</strong>
                    </p>
                    <Button
                      size="sm"
                      className="bg-indigo-600 hover:bg-indigo-700"
                      disabled={finalizando === t.id}
                      onClick={() => marcarFinalizado(t.id)}
                    >
                      {finalizando === t.id
                        ? <><Loader2 size={12} className="animate-spin mr-1" />Guardando...</>
                        : <><CheckCircle2 size={13} className="mr-1" />Marcar como cargada en Dux</>}
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
