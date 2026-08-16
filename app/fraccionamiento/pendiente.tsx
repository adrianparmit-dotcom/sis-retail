'use client'

/**
 * Trabajo pendiente de fraccionar.
 *
 * El bulto madre se declara en la recepción (qué SKUs finales salen de él y
 * cuántas unidades de cada uno). Pero fraccionarlo lleva 10-15 días, así que
 * durante ese tiempo el ERP ya tiene los paquetes cargados y el depósito tiene
 * mercadería a medio embolsar. Esta pantalla es ese pendiente.
 *
 * NO mueve stock: Dux ya recibió los paquetes en la compra de la recepción.
 * Descontar acá los contaría dos veces. Es un registro de trabajo.
 */

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatDate } from '@/lib/format'
import { toTitleCase } from '@/lib/format'

interface FilaPendiente {
  id                  : string
  cantidad_objetivo   : number
  cantidad_fraccionada: number
  estado              : string
  recepcion_item_id   : string
  producto_final_id   : string
  // resueltos aparte
  sku                 : string
  nombre              : string
  bulto               : string
  fecha_recepcion     : string | null
  proveedor           : string | null
}

interface Bulto {
  recepcionItemId: string
  descripcion    : string
  proveedor      : string | null
  fecha          : string | null
  filas          : FilaPendiente[]
}

export function TrabajoPendiente() {
  const [bultos, setBultos]   = useState<Bulto[]>([])
  const [loading, setLoading] = useState(true)
  const [borrador, setBorrador] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data: frac } = await supabase
      .from('recepcion_item_fraccionamiento')
      .select('id, cantidad_objetivo, cantidad_fraccionada, estado, recepcion_item_id, producto_final_id')
      .order('created_at', { ascending: true })

    const filasRaw = (frac ?? []) as Omit<FilaPendiente, 'sku'|'nombre'|'bulto'|'fecha_recepcion'|'proveedor'>[]
    if (filasRaw.length === 0) { setBultos([]); setLoading(false); return }

    const itemIds = [...new Set(filasRaw.map(f => f.recepcion_item_id))]
    const prodIds = [...new Set(filasRaw.map(f => f.producto_final_id))]

    const [{ data: itemsDb }, { data: prodsDb }] = await Promise.all([
      supabase.from('recepcion_items')
        .select('id, descripcion_proveedor, recepcion_id, recepciones(fecha_recepcion, proveedor_nombre)')
        .in('id', itemIds),
      supabase.from('productos').select('id, sku, nombre').in('id', prodIds),
    ])

    type ItemDb = {
      id: string; descripcion_proveedor: string | null
      recepciones: { fecha_recepcion: string | null; proveedor_nombre: string | null } | null
    }
    const itemMap = new Map((itemsDb as unknown as ItemDb[] ?? []).map(i => [i.id, i]))
    const prodMap = new Map(((prodsDb ?? []) as { id: string; sku: string; nombre: string | null }[]).map(p => [p.id, p]))

    const porBulto = new Map<string, Bulto>()
    for (const f of filasRaw) {
      const it = itemMap.get(f.recepcion_item_id)
      const pr = prodMap.get(f.producto_final_id)
      const fila: FilaPendiente = {
        ...f,
        sku            : pr?.sku ?? '—',
        nombre         : pr?.nombre ? toTitleCase(pr.nombre) : '—',
        bulto          : it?.descripcion_proveedor ?? 'Bulto sin descripción',
        fecha_recepcion: it?.recepciones?.fecha_recepcion ?? null,
        proveedor      : it?.recepciones?.proveedor_nombre ?? null,
      }
      const b = porBulto.get(f.recepcion_item_id) ?? {
        recepcionItemId: f.recepcion_item_id,
        descripcion    : fila.bulto,
        proveedor      : fila.proveedor,
        fecha          : fila.fecha_recepcion,
        filas          : [],
      }
      b.filas.push(fila)
      porBulto.set(f.recepcion_item_id, b)
    }

    // Los bultos con trabajo pendiente van primero, y dentro de esos el más viejo
    // arriba: es el que lleva más días a medio fraccionar.
    const lista = [...porBulto.values()].sort((a, b) => {
      const pa = a.filas.some(f => f.cantidad_fraccionada < f.cantidad_objetivo)
      const pb = b.filas.some(f => f.cantidad_fraccionada < f.cantidad_objetivo)
      if (pa !== pb) return pa ? -1 : 1
      return (a.fecha ?? '').localeCompare(b.fecha ?? '')
    })
    setBultos(lista)
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function registrar(fila: FilaPendiente) {
    const suma = Number(borrador[fila.id])
    if (!Number.isFinite(suma) || suma <= 0) {
      toast.error('Poné cuántas unidades embolsaste')
      return
    }
    const nuevo = fila.cantidad_fraccionada + suma
    if (nuevo > fila.cantidad_objetivo) {
      const ok = window.confirm(
        `Estarías registrando ${nuevo} de ${fila.cantidad_objetivo} previstas para ${fila.nombre}.\n\n` +
        '¿Salieron más unidades de las declaradas en la recepción?'
      )
      if (!ok) return
    }
    setGuardando(fila.id)
    const { error } = await supabase.from('recepcion_item_fraccionamiento')
      .update({
        cantidad_fraccionada: nuevo,
        estado              : nuevo >= fila.cantidad_objetivo ? 'completo' : 'pendiente',
        updated_at          : new Date().toISOString(),
      })
      .eq('id', fila.id)
    setGuardando(null)
    if (error) { toast.error('No se pudo guardar: ' + error.message); return }
    setBorrador(b => ({ ...b, [fila.id]: '' }))
    toast.success(`${suma} × ${fila.nombre}`)
    cargar()
  }

  if (loading) return <p className="text-sm text-zinc-400 py-8">Cargando trabajo pendiente...</p>

  if (bultos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 py-14 text-center">
        <p className="text-sm text-zinc-500">No hay bultos para fraccionar</p>
        <p className="text-xs text-zinc-400 mt-1">
          Aparecen acá cuando en una recepción marcás un ítem como granel y le asignás los productos finales.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {bultos.map(b => {
        const objetivo   = b.filas.reduce((s, f) => s + f.cantidad_objetivo, 0)
        const hecho      = b.filas.reduce((s, f) => s + Math.min(f.cantidad_fraccionada, f.cantidad_objetivo), 0)
        const pct        = objetivo > 0 ? Math.round(100 * hecho / objetivo) : 0
        const terminado  = hecho >= objetivo
        const dias       = b.fecha ? Math.floor((Date.now() - new Date(b.fecha).getTime()) / 86400000) : null

        return (
          <div key={b.recepcionItemId} className={`rounded-xl border bg-white overflow-hidden ${terminado ? 'border-emerald-200' : 'border-zinc-200'}`}>
            <div className={`px-4 py-3 border-b ${terminado ? 'bg-emerald-50 border-emerald-100' : 'bg-zinc-50 border-zinc-100'}`}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-zinc-900 leading-snug">{b.descripcion}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {b.proveedor ? toTitleCase(b.proveedor) : 'Sin proveedor'}
                    {b.fecha && <> · recibido {formatDate(b.fecha)}</>}
                    {dias !== null && dias > 0 && <> · hace {dias} día{dias === 1 ? '' : 's'}</>}
                  </p>
                </div>
                <span className={`text-xs font-semibold shrink-0 ${terminado ? 'text-emerald-700' : 'text-zinc-600'}`}>
                  {terminado ? '✓ Fraccionado completo' : `${hecho} de ${objetivo} unidades`}
                </span>
              </div>
              <Progress value={pct} className="mt-2 h-1.5" />
            </div>

            <div className="divide-y divide-zinc-100">
              {b.filas.map(f => {
                const falta = Math.max(0, f.cantidad_objetivo - f.cantidad_fraccionada)
                return (
                  <div key={f.id} className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
                    <div className="flex-1 min-w-[180px]">
                      <p className="text-sm text-zinc-800 leading-snug">{f.nombre}</p>
                      <p className="text-xs text-zinc-400 font-mono">{f.sku}</p>
                    </div>
                    <div className="text-xs tabular-nums text-zinc-600 shrink-0 w-28">
                      {f.cantidad_fraccionada} / {f.cantidad_objetivo}
                      {falta > 0 && <span className="text-amber-700"> · faltan {falta}</span>}
                    </div>
                    {falta > 0 ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <Input
                          type="number"
                          min={1}
                          placeholder="Embolsé..."
                          className="w-28 h-8"
                          value={borrador[f.id] ?? ''}
                          onChange={e => setBorrador(b2 => ({ ...b2, [f.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') registrar(f) }}
                        />
                        <Button size="sm" disabled={guardando === f.id} onClick={() => registrar(f)}>
                          {guardando === f.id ? 'Guardando...' : 'Registrar'}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs font-medium text-emerald-700 shrink-0">✓ Listo</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
