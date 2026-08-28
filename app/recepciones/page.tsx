'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { reenviarCompraADux } from '@/lib/dux-compra'
import type { Recepcion } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { AlertCircle, Trash2 } from 'lucide-react'

const ESTADO_CONFIG: Record<string, { label: string; className: string }> = {
  borrador   : { label: 'Borrador',   className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  pendiente  : { label: 'Pendiente',  className: 'bg-blue-100 text-blue-700 border-blue-200' },
  confirmada : { label: 'Confirmada', className: 'bg-green-100 text-green-700 border-green-200' },
  cancelada  : { label: 'Cancelada',  className: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
}

// Cómo le fue a la compra en Dux al confirmar. Sin esto no había manera de
// saber después si el ERP la recibió: el error solo aparecía en pantalla.
const DUX_SYNC_CONFIG: Record<string, { label: string; className: string; title: string }> = {
  ok      : { label: 'En Dux',      className: 'bg-emerald-50 text-emerald-700 border-emerald-200', title: 'La compra se registró en Dux' },
  error   : { label: 'Falló Dux',   className: 'bg-red-50 text-red-700 border-red-200',             title: 'Dux rechazó la compra — hay que cargarla a mano' },
  omitida : { label: 'No enviada',  className: 'bg-amber-50 text-amber-700 border-amber-200',       title: 'No se intentó enviar: faltaba el SKU o el proveedor de Dux' },
}

const fmtFecha = (s: string | null) => {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

// Recepción + cuántos ítems tiene cargados, para poder avisar qué se pierde
// al descartar un borrador.
type RecepcionConItems = Recepcion & { recepcion_items?: { count: number }[] }

function contarItems(r: RecepcionConItems): number {
  return r.recepcion_items?.[0]?.count ?? 0
}

interface ItemEtapa {
  recepcion_id: string
  producto_id: string | null
  fecha_vencimiento: string | null
  es_granel: boolean | null
}

interface EtapaBorrador { total: number; sinAsignar: number; sinFecha: number }

/** En qué se quedó trabado el borrador, en el orden en que hay que resolverlo. */
function describirEtapa(e: EtapaBorrador | undefined): { texto: string; className: string } {
  if (!e || e.total === 0) return { texto: 'Vacío — sin ítems', className: 'text-zinc-500' }
  if (e.sinAsignar > 0)   return { texto: `Falta asignar ${e.sinAsignar} de ${e.total} ítems`, className: 'text-red-700' }
  if (e.sinFecha > 0)     return { texto: `Faltan ${e.sinFecha} fechas de vencimiento`, className: 'text-amber-700' }
  return { texto: 'Listo para confirmar', className: 'text-emerald-700' }
}

export default function RecepcionesPage() {
  const [data, setData]       = useState<RecepcionConItems[]>([])
  const [loading, setLoading] = useState(true)
  const [aDescartar, setADescartar] = useState<RecepcionConItems | null>(null)
  const [borrando, setBorrando] = useState(false)
  const [etapas, setEtapas] = useState<Map<string, EtapaBorrador>>(new Map())
  const [reintentando, setReintentando] = useState<string | null>(null)

  useEffect(() => {
    const cargar = async () => {
      const { data } = await supabase.from('recepciones')
        .select('*, recepcion_items(count)')
        .order('created_at', { ascending: false })
        .limit(100)
      const filas = (data ?? []) as RecepcionConItems[]
      setData(filas)
      setLoading(false)

      // Para los borradores, mirar sus ítems y decir en qué etapa quedaron.
      // Antes todos decían lo mismo ("pendiente de completar") y había que
      // entrar a cada uno para saber qué faltaba.
      const ids = filas.filter(r => r.estado === 'borrador').map(r => r.id)
      if (ids.length === 0) return
      const { data: its } = await supabase.from('recepcion_items')
        .select('recepcion_id, producto_id, fecha_vencimiento, es_granel')
        .in('recepcion_id', ids)
      const porRec = new Map<string, EtapaBorrador>()
      for (const id of ids) porRec.set(id, { total: 0, sinAsignar: 0, sinFecha: 0 })
      for (const it of (its ?? []) as ItemEtapa[]) {
        const e = porRec.get(it.recepcion_id)
        if (!e) continue
        e.total++
        if (!it.producto_id && !it.es_granel) e.sinAsignar++
        else if (!it.es_granel && it.producto_id && !it.fecha_vencimiento) e.sinFecha++
      }
      setEtapas(porRec)
    }
    cargar()
  }, [])

  async function descartarBorrador() {
    if (!aDescartar) return
    setBorrando(true)
    // Solo borradores: una recepción confirmada ya generó vencimientos y la FK
    // (NO ACTION) impide borrarla, que es justamente la protección que queremos.
    const { error } = await supabase.from('recepciones')
      .delete()
      .eq('id', aDescartar.id)
      .eq('estado', 'borrador')
    setBorrando(false)
    if (error) {
      toast.error('No se pudo descartar: ' + error.message)
      return
    }
    setData(prev => prev.filter(r => r.id !== aDescartar.id))
    toast.success(`Borrador descartado${aDescartar.proveedor_nombre ? ` — ${aDescartar.proveedor_nombre}` : ''}`)
    setADescartar(null)
  }

  // Reenvía a Dux una recepción que quedó en "Falló Dux" o "No enviada".
  // El payload se rearma desde la base, así que funciona aunque la recepción se
  // haya cargado hace días y en otra sesión.
  async function reintentarDux(r: RecepcionConItems) {
    setReintentando(r.id)
    const res = await reenviarCompraADux(r.id)
    setReintentando(null)

    // Refleja el resultado en la fila sin recargar toda la lista.
    setData(prev => prev.map(x => x.id === r.id ? {
      ...x,
      dux_sync_estado : res.ok ? 'ok' : (x.dux_sync_estado ?? 'error'),
      dux_sync_at     : new Date().toISOString(),
      dux_sync_detalle: res.ok ? null : res.motivo,
    } as RecepcionConItems : x))

    if (res.ok) {
      toast.success(`Compra registrada en Dux${r.numero_comprobante ? ` — ${r.numero_comprobante}` : ''}`)
    } else {
      toast.error(res.motivo + (res.detalle ? `\n${res.detalle}` : ''), { duration: 10000 })
    }
  }

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
                    <span className="font-medium text-sm text-zinc-800 line-clamp-2 leading-snug" title={r.proveedor_nombre ?? undefined}>
                      {r.proveedor_nombre ?? '—'}
                    </span>
                    <span className="font-mono text-xs text-zinc-500 shrink-0">
                      {r.numero_comprobante ?? r.dux_compra_id ?? 'S/N'}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Factura: {fmtFecha(r.fecha_factura)} · Guardado: {fmtFecha(r.fecha_recepcion)}
                    {' · '}{contarItems(r)} ítem{contarItems(r) === 1 ? '' : 's'}
                  </div>
                  {(() => {
                    const et = describirEtapa(etapas.get(r.id))
                    return <div className={`text-xs font-medium mt-1 ${et.className}`}>{et.texto}</div>
                  })()}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link href={`/recepciones/factura?borrador=${r.id}`}>
                    <Button size="sm" className="bg-yellow-600 hover:bg-yellow-700 text-white">
                      Retomar →
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                    onClick={() => setADescartar(r)}
                    aria-label={`Descartar borrador de ${r.proveedor_nombre ?? 'sin proveedor'}`}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
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
              <TableHead className="text-center">Dux</TableHead>
              <TableHead className="text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-zinc-400 py-12">Cargando...</TableCell>
              </TableRow>
            ) : confirmadas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-16">
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
                    <TableCell className="text-center">
                      {r.dux_sync_estado && DUX_SYNC_CONFIG[r.dux_sync_estado] ? (
                        <Badge
                          className={DUX_SYNC_CONFIG[r.dux_sync_estado].className}
                          title={r.dux_sync_detalle ?? DUX_SYNC_CONFIG[r.dux_sync_estado].title}
                        >
                          {DUX_SYNC_CONFIG[r.dux_sync_estado].label}
                        </Badge>
                      ) : (
                        <span className="text-zinc-300 text-xs" title="Recepción anterior al registro de envíos a Dux">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(r.dux_sync_estado === 'error' || r.dux_sync_estado === 'omitida') && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7"
                            disabled={reintentando !== null}
                            onClick={() => reintentarDux(r)}
                            title="Rearmar la compra desde la recepción y volver a enviarla a Dux"
                          >
                            {reintentando === r.id ? 'Enviando...' : 'Reintentar Dux'}
                          </Button>
                        )}
                        <Link href={`/recepciones/${r.id}`}>
                          <Button variant="outline" size="sm" className="text-xs h-7">Ver detalle</Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={aDescartar !== null}
        variant="danger"
        title="¿Descartar este borrador?"
        description={aDescartar
          ? `${aDescartar.proveedor_nombre ?? 'Sin proveedor'}${aDescartar.numero_comprobante ? ` · ${aDescartar.numero_comprobante}` : ''}. ` +
            `Se pierden ${contarItems(aDescartar)} ítem${contarItems(aDescartar) === 1 ? '' : 's'} cargados. ` +
            'No se tocan vencimientos ni stock — este borrador nunca se confirmó. No se puede deshacer.'
          : undefined}
        confirmLabel="Descartar"
        cancelLabel="Volver"
        loading={borrando}
        onConfirm={descartarBorrador}
        onCancel={() => setADescartar(null)}
      />
    </div>
  )
}
