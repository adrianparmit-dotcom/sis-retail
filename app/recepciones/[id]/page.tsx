'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Recepcion, RecepcionItem } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import { exportTablaXlsx } from '@/lib/export-xlsx'
import { SUCURSAL_LABELS } from '@/lib/constants'
import { faltante, sobrante } from '@/lib/recepcion-cantidades'

/** Nombre legible de una sucursal a partir de su UUID. */
const nombreSucursal = (id: string | null) => (id ? SUCURSAL_LABELS[id] ?? '—' : '—')

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

/** Transferencia generada al confirmar, con sus renglones. */
interface TransferenciaDetalle {
  id                 : string
  estado             : string
  sucursal_origen_id : string | null
  sucursal_destino_id: string | null
  created_at         : string | null
  finalizado_at      : string | null
  items              : Array<{ producto_sku: string | null; producto_nombre: string | null; cantidad: number }>
}

export default function RecepcionDetallePage() {
  const { id } = useParams<{ id: string }>()
  const [recepcion, setRecepcion] = useState<Recepcion | null>(null)
  const [items, setItems] = useState<RecepcionItem[]>([])
  const [transf, setTransf] = useState<TransferenciaDetalle | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function load() {
      const [recRes, itemsRes, transfRes] = await Promise.all([
        supabase.from('recepciones').select('*').eq('id', id).single(),
        supabase
          .from('recepcion_items')
          .select('*')
          .eq('recepcion_id', id)
          .order('sku'),
        // La transferencia se guarda al confirmar, así que se puede consultar
        // cuando sea. Antes el reparto solo se veía en la pantalla de carga:
        // si se cerraba la página, no quedaba forma de saber qué se había
        // mandado ni de volver a bajar el listado.
        supabase.from('transferencias_recepcion')
          .select('id, estado, sucursal_origen_id, sucursal_destino_id, created_at, finalizado_at')
          .eq('recepcion_id', id)
          .maybeSingle(),
      ])
      if (!recRes.data) { setNotFound(true); setLoading(false); return }
      setRecepcion(recRes.data as Recepcion)
      setItems((itemsRes.data ?? []) as RecepcionItem[])

      const t = transfRes.data as Omit<TransferenciaDetalle, 'items'> | null
      if (t) {
        const { data: tItems } = await supabase.from('transferencias_recepcion_items')
          .select('producto_sku, producto_nombre, cantidad')
          .eq('transferencia_id', t.id)
          .order('producto_nombre')
        setTransf({ ...t, items: (tItems ?? []) as TransferenciaDetalle['items'] })
      }
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

  const totalTransferido = transf?.items.reduce((s, t) => s + Number(t.cantidad), 0) ?? 0

  /** Baja el listado de lo transferido, para cargarlo a mano en Dux. */
  function bajarTransferencia() {
    if (!transf) return
    exportTablaXlsx(
      `Transferencia ${r.numero_comprobante ?? r.id.slice(0, 8)} - ${nombreSucursal(transf.sucursal_destino_id)}`,
      [
        { header: 'SKU',      value: t => t.producto_sku ?? '' },
        { header: 'Producto', value: t => t.producto_nombre ?? '' },
        { header: 'Unidades', value: t => Number(t.cantidad) },
      ],
      transf.items,
    )
  }

  // Faltantes y extras se calculan acá y no se lee el estado guardado: lo que
  // se repartió a la otra sucursal también llegó, y las recepciones cargadas
  // antes del reparto quedaron con "faltante" grabado sobre esos renglones.
  const cantidades = (i: RecepcionItem) => ({
    cantidad           : i.cantidad_esperada,
    cantidad_recibida  : i.cantidad_recibida ?? 0,
    transferir_cantidad: i.transferir_cantidad ?? 0,
  })
  const totalItems = items.length
  const vencidos   = items.filter(i => i.estado === 'vencido_llegada').length
  const vivos      = items.filter(i => i.estado !== 'vencido_llegada')
  const faltantes  = vivos.filter(i => faltante(cantidades(i)) > 0).length
  const extras     = vivos.filter(i => sobrante(cantidades(i)) > 0).length
  const ok         = vivos.length - faltantes - extras

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

      {/* Reparto a la otra sucursal */}
      {transf && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-indigo-900">
                🔄 Se transfirieron {totalTransferido} unidades a {nombreSucursal(transf.sucursal_destino_id)}
              </p>
              <p className="text-xs text-indigo-700 mt-0.5">
                {transf.items.length} producto{transf.items.length !== 1 ? 's' : ''} ·
                {' '}De {nombreSucursal(transf.sucursal_origen_id)} → {nombreSucursal(transf.sucursal_destino_id)} ·
                {' '}{transf.estado === 'finalizado'
                  ? `Cargada en Dux${transf.finalizado_at ? ` el ${new Date(transf.finalizado_at).toLocaleDateString('es-AR')}` : ''}`
                  : 'Pendiente de cargar en Dux'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={bajarTransferencia} className="gap-1.5">
                <Download size={14} /> Bajar Excel
              </Button>
              <Link href="/transferencias">
                <Button size="sm" variant="outline">Ver transferencias →</Button>
              </Link>
            </div>
          </div>
          <ul className="mt-3 space-y-0.5 text-xs text-indigo-900 max-h-52 overflow-y-auto">
            {transf.items.map((t, i) => (
              <li key={i}>
                · <span className="tabular-nums text-indigo-500">{t.producto_sku ?? '—'}</span>{' '}
                {t.producto_nombre ?? '(sin nombre)'} — <strong>{t.cantidad}</strong> ud
              </li>
            ))}
          </ul>
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
                    <TableCell className="text-sm min-w-[220px] max-w-sm whitespace-normal">
                      <span className="leading-snug line-clamp-2" title={item.nombre_producto ?? undefined}>
                        {item.nombre_producto ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{item.cantidad_esperada}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {item.cantidad_recibida ?? '—'}
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">{fmtFecha(item.fecha_vencimiento)}</TableCell>
                    <TableCell className="text-center">
                      <Badge className={`${cfg.className} text-xs`}>{cfg.label}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-400 max-w-xs whitespace-normal">
                      <span className="leading-snug line-clamp-2" title={item.observacion ?? undefined}>
                        {item.observacion ?? '—'}
                      </span>
                    </TableCell>
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
