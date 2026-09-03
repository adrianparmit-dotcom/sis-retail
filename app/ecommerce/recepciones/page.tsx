'use client'

/**
 * Recepción de facturas de la línea de granel.
 *
 * La factura se carga en La Pyme, que la parsea con su IA. Acá se traen esas
 * compras y se les pone lo que el ERP no sabe: cuándo vence lo que entró.
 *
 * Mientras una línea no tenga su vencimiento cargado, esa mercadería NO se
 * habilita para la venta. No es una alerta que se pueda ignorar: es la
 * condición para publicar.
 */

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatNum, formatDate, hoyISO, toTitleCase } from '@/lib/format'
import {
  lapymeGet, LapymeApiError, centavosAPesos,
  type LapymeLista, type Compra, type CompraDetalle, type CompraItem,
} from '@/lib/lapyme'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'

interface Vencimiento {
  id: string
  lapyme_purchase_id: string
  lapyme_item_id: string
  descripcion: string
  cantidad: number
  fecha_vencimiento: string
  numero_lote: string | null
  estado: string
}

/** Borrador de la fecha que se está cargando para una línea. */
interface Borrador { cantidad: string; vence: string; lote: string }

const BORRADOR_VACIO: Borrador = { cantidad: '', vence: '', lote: '' }

export default function RecepcionesEcommercePage() {
  const [compras, setCompras] = useState<Compra[]>([])
  const [vencimientos, setVencimientos] = useState<Vencimiento[]>([])
  const [detalles, setDetalles] = useState<Map<string, CompraItem[]>>(new Map())
  const [abierta, setAbierta] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [borradores, setBorradores] = useState<Record<string, Borrador>>({})

  const cargar = useCallback(async () => {
    try {
      const [lista, vencRes] = await Promise.all([
        lapymeGet<LapymeLista<Compra>>('purchases', { limit: 30 }),
        supabase.from('ecom_vencimientos').select('*').order('created_at', { ascending: false }),
      ])
      setCompras(lista.data ?? [])
      setVencimientos((vencRes.data ?? []) as Vencimiento[])
      setError(null)
    } catch (err) {
      setError((err as LapymeApiError).message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  /** El detalle con las líneas solo viene por compra: se pide al desplegar. */
  async function abrir(compraId: string) {
    if (abierta === compraId) { setAbierta(null); return }
    setAbierta(compraId)
    if (detalles.has(compraId)) return

    setCargandoDetalle(true)
    try {
      const det = await lapymeGet<{ data: CompraDetalle }>(`purchases/${compraId}`)
      setDetalles(prev => new Map(prev).set(compraId, det.data?.items ?? []))
    } catch (err) {
      toast.error((err as LapymeApiError).message)
    } finally {
      setCargandoDetalle(false)
    }
  }

  function borrador(itemId: string): Borrador {
    return borradores[itemId] ?? BORRADOR_VACIO
  }

  function editarBorrador(itemId: string, campo: keyof Borrador, valor: string) {
    setBorradores(prev => ({ ...prev, [itemId]: { ...borrador(itemId), [campo]: valor } }))
  }

  async function agregarFecha(compraId: string, item: CompraItem) {
    const b = borrador(item.id)
    const cant = Number(b.cantidad.replace(',', '.'))

    if (!Number.isFinite(cant) || cant <= 0) { toast.error('Poné cuánto vence en esa fecha'); return }
    if (!b.vence)                            { toast.error('Falta la fecha de vencimiento'); return }

    // Aviso, no bloqueo: la factura puede decir 4 y haber llegado 5, o quedar
    // una parte por cargar en otra fecha. Lo sabe quien está recibiendo.
    const yaCargado = cargadoDe(compraId, item.id)
    if (yaCargado + cant > item.quantity) {
      const ok = window.confirm(
        `La factura dice ${formatNum(item.quantity, 2)} y con esto llegarías a ` +
        `${formatNum(yaCargado + cant, 2)}.\n\n¿Cargar igual?`
      )
      if (!ok) return
    }

    setGuardando(true)
    try {
      const { data, error: e } = await supabase.from('ecom_vencimientos').insert({
        lapyme_purchase_id: compraId,
        lapyme_item_id    : item.id,
        lapyme_product_id : item.product?.id ?? null,
        descripcion       : item.name,
        cantidad          : cant,
        fecha_vencimiento : b.vence,
        numero_lote       : b.lote.trim() || null,
      }).select('*').single()
      if (e) throw new Error(e.message)

      setVencimientos(prev => [data as Vencimiento, ...prev])
      setBorradores(prev => ({ ...prev, [item.id]: BORRADOR_VACIO }))
      toast.success(`${formatNum(cant, 2)} vence el ${formatDate(b.vence)}`)
    } catch (err) {
      toast.error('No se pudo guardar: ' + (err as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  async function borrarFecha(v: Vencimiento) {
    if (v.estado === 'habilitado') {
      toast.error('Ese vencimiento ya está habilitado para la venta. Deshabilitalo primero.')
      return
    }
    const { error: e } = await supabase.from('ecom_vencimientos').delete().eq('id', v.id)
    if (e) { toast.error('No se pudo borrar: ' + e.message); return }
    setVencimientos(prev => prev.filter(x => x.id !== v.id))
  }

  /** Habilita para la venta todo lo cargado de una compra. */
  async function habilitarCompra(compraId: string) {
    const pendientes = vencimientos.filter(v => v.lapyme_purchase_id === compraId && v.estado === 'pendiente')
    if (pendientes.length === 0) return

    // Habilitar con líneas a medio cargar es válido —se puede recibir en dos
    // tandas— pero conviene decirlo: lo que no tiene fecha no se habilita, y
    // esa parte de la factura queda sin poder venderse hasta que se cargue.
    const items = detalles.get(compraId) ?? []
    const incompletas = items.filter(i => cargadoDe(compraId, i.id) < i.quantity)
    if (incompletas.length > 0) {
      const ok = window.confirm(
        `${incompletas.length} de ${items.length} líneas todavía no tienen todo el vencimiento cargado.\n\n` +
        'Se habilita solo lo que tiene fecha. El resto no se va a poder vender hasta que lo completes.\n\n' +
        '¿Habilitar igual?'
      )
      if (!ok) return
    }

    setGuardando(true)
    const ahora = new Date().toISOString()
    const { error: e } = await supabase.from('ecom_vencimientos')
      .update({ estado: 'habilitado', habilitado_at: ahora, updated_at: ahora })
      .eq('lapyme_purchase_id', compraId)
      .eq('estado', 'pendiente')
    setGuardando(false)

    if (e) { toast.error('No se pudo habilitar: ' + e.message); return }
    setVencimientos(prev => prev.map(v =>
      v.lapyme_purchase_id === compraId && v.estado === 'pendiente'
        ? { ...v, estado: 'habilitado' } : v
    ))
    toast.success(`${pendientes.length} vencimiento${pendientes.length === 1 ? '' : 's'} habilitado${pendientes.length === 1 ? '' : 's'} para la venta`)
  }

  // ── Derivados ──────────────────────────────────────────────────────
  function cargadoDe(compraId: string, itemId: string): number {
    return vencimientos
      .filter(v => v.lapyme_purchase_id === compraId && v.lapyme_item_id === itemId)
      .reduce((s, v) => s + Number(v.cantidad), 0)
  }

  function vencimientosDe(compraId: string, itemId: string): Vencimiento[] {
    return vencimientos
      .filter(v => v.lapyme_purchase_id === compraId && v.lapyme_item_id === itemId)
      .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))
  }

  /** Qué le falta a una compra. Sin el detalle abierto solo se sabe si tiene algo. */
  function estadoCompra(compraId: string): { texto: string; clase: string } {
    const items = detalles.get(compraId)
    const propios = vencimientos.filter(v => v.lapyme_purchase_id === compraId)

    if (!items) {
      return propios.length === 0
        ? { texto: 'Sin cargar', clase: 'bg-zinc-100 text-zinc-500 border-zinc-200' }
        : { texto: `${propios.length} fecha${propios.length === 1 ? '' : 's'}`, clase: 'bg-blue-50 text-blue-700 border-blue-200' }
    }

    const incompletos = items.filter(i => cargadoDe(compraId, i.id) < i.quantity).length
    if (incompletos > 0) {
      return { texto: `Faltan ${incompletos} de ${items.length}`, clase: 'bg-amber-50 text-amber-700 border-amber-200' }
    }
    const pendientes = propios.filter(v => v.estado === 'pendiente').length
    if (pendientes > 0) {
      return { texto: 'Listo para habilitar', clase: 'bg-indigo-50 text-indigo-700 border-indigo-200' }
    }
    return { texto: 'Habilitada', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  }

  const totalPendientes = vencimientos.filter(v => v.estado === 'pendiente').length

  return (
    <div className="p-6 space-y-5 max-w-5xl">

      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Recepciones</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Facturas cargadas en La Pyme · acá se les pone el vencimiento
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">{error}</p>
          <Button variant="outline" size="sm" className="mt-3 text-xs h-7" onClick={cargar}>Reintentar</Button>
        </div>
      )}

      {totalPendientes > 0 && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
          <p className="text-sm text-indigo-900">
            <strong>{totalPendientes}</strong> vencimiento{totalPendientes === 1 ? '' : 's'} cargado
            {totalPendientes === 1 ? '' : 's'} sin habilitar.
          </p>
          <p className="text-xs text-indigo-700 mt-0.5">
            Esa mercadería todavía no se puede vender. Revisá la compra y habilitala.
          </p>
        </div>
      )}

      {cargando ? (
        <p className="text-sm text-zinc-400 py-12 text-center">Cargando facturas de La Pyme...</p>
      ) : compras.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 bg-white p-12 text-center">
          <p className="text-sm text-zinc-500">No hay facturas cargadas en La Pyme</p>
        </div>
      ) : (
        <div className="space-y-2">
          {compras.map(c => {
            const est = estadoCompra(c.id)
            const items = detalles.get(c.id)
            const expandida = abierta === c.id
            const puedeHabilitar = vencimientos.some(v => v.lapyme_purchase_id === c.id && v.estado === 'pendiente')

            return (
              <div key={c.id} className="bg-white rounded-lg border overflow-hidden">
                <button
                  onClick={() => abrir(c.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 text-left"
                >
                  {expandida ? <ChevronDown size={15} className="text-zinc-400 shrink-0" />
                             : <ChevronRight size={15} className="text-zinc-400 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-900 truncate">
                      {toTitleCase(c.supplier?.name ?? 'Sin proveedor')}
                    </p>
                    <p className="text-xs text-zinc-500 font-mono mt-0.5">
                      {c.supplier_invoice_number ?? '—'} · {formatDate(c.invoice_date)}
                    </p>
                  </div>
                  <span className="text-sm tabular-nums text-zinc-500 shrink-0">
                    ${formatNum(centavosAPesos(c.total), 0)}
                  </span>
                  <Badge className={`${est.clase} shrink-0`}>{est.texto}</Badge>
                </button>

                {expandida && (
                  <div className="border-t bg-zinc-50/60 px-4 py-3 space-y-3">
                    {cargandoDetalle && !items ? (
                      <p className="text-xs text-zinc-400 py-4 text-center">Trayendo las líneas...</p>
                    ) : !items || items.length === 0 ? (
                      <p className="text-xs text-zinc-400 py-4 text-center">La factura no tiene líneas</p>
                    ) : (
                      <>
                        {items.map(it => {
                          const cargado = cargadoDe(c.id, it.id)
                          const falta = it.quantity - cargado
                          const b = borrador(it.id)
                          const fechas = vencimientosDe(c.id, it.id)

                          return (
                            <div key={it.id} className="bg-white rounded-lg border p-3 space-y-2">
                              <div className="flex items-start justify-between gap-3 flex-wrap">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm text-zinc-800">{it.name}</p>
                                  <p className="text-xs text-zinc-500 mt-0.5">
                                    Factura: {formatNum(it.quantity, 2)} ·{' '}
                                    cargado {formatNum(cargado, 2)}
                                    {falta > 0 && <span className="text-amber-700"> · falta {formatNum(falta, 2)}</span>}
                                    {falta <= 0 && <span className="text-emerald-700"> · completo</span>}
                                  </p>
                                </div>
                                <span className="text-xs text-zinc-400 tabular-nums shrink-0">
                                  ${formatNum(centavosAPesos(it.unit_cost), 0)} c/u
                                </span>
                              </div>

                              {fechas.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {fechas.map(v => (
                                    <span key={v.id}
                                      className={`inline-flex items-center gap-1.5 text-xs rounded px-2 py-1 border ${
                                        v.estado === 'habilitado'
                                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                          : 'bg-zinc-50 border-zinc-200 text-zinc-700'
                                      }`}>
                                      <span className="tabular-nums font-medium">{formatNum(v.cantidad, 2)}</span>
                                      <span>vence {formatDate(v.fecha_vencimiento)}</span>
                                      {v.numero_lote && <span className="text-zinc-400 font-mono">{v.numero_lote}</span>}
                                      {v.estado === 'pendiente' && (
                                        <button onClick={() => borrarFecha(v)}
                                          className="text-zinc-300 hover:text-red-500 ml-0.5" title="Quitar">
                                          <Trash2 size={11} />
                                        </button>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {falta > 0 && (
                                <div className="grid grid-cols-2 sm:grid-cols-[90px_150px_1fr_auto] gap-2 items-end pt-1">
                                  <div>
                                    <label className="text-[10px] text-zinc-500 block mb-0.5">Cantidad</label>
                                    <Input type="number" min={0} step="0.01" value={b.cantidad}
                                      onChange={e => editarBorrador(it.id, 'cantidad', e.target.value)}
                                      placeholder={formatNum(falta, 2)} className="h-8 text-sm" />
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-zinc-500 block mb-0.5">Vence</label>
                                    <Input type="date" value={b.vence} min={hoyISO()}
                                      onChange={e => editarBorrador(it.id, 'vence', e.target.value)}
                                      className="h-8 text-sm" />
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-zinc-500 block mb-0.5">Lote</label>
                                    <Input value={b.lote}
                                      onChange={e => editarBorrador(it.id, 'lote', e.target.value)}
                                      placeholder="opcional" className="h-8 text-sm" />
                                  </div>
                                  <Button size="sm" className="h-8 text-xs" disabled={guardando}
                                    onClick={() => agregarFecha(c.id, it)}>
                                    Agregar
                                  </Button>
                                </div>
                              )}
                            </div>
                          )
                        })}

                        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                          <p className="text-[11px] text-zinc-500">
                            Hasta que no se habilite, esta mercadería no se puede vender.
                          </p>
                          <Button size="sm" className="h-8 text-xs"
                            disabled={!puedeHabilitar || guardando}
                            onClick={() => habilitarCompra(c.id)}>
                            Habilitar para la venta
                          </Button>
                        </div>
                      </>
                    )}
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
