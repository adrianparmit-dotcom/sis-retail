'use client'

/**
 * Requerimientos de granel que manda Shuk Pedidos.
 *
 * El circuito: el pedido cae en Tienda Nube, lo levanta Shuk Pedidos y hace el
 * picking de todo lo que está en su depósito — el 80% del ecommerce. Lo único
 * que administra SOHO es el granel, así que Shuk Pedidos manda acá las líneas
 * de granel; SOHO fracciona, rotula y avisa para el traslado interno.
 *
 * SOHO NO descuenta stock: La Pyme descarga los kilos del producto padre cuando
 * factura la venta. Acá solo se lleva el trabajo de armado y el vencimiento, que
 * es lo que el ERP no sabe.
 *
 * El SKU que manda Shuk Pedidos es el del COMBO ('GRA-009-3KG'): de ahí salen
 * el producto, los kilos del paquete y el nombre que va en la etiqueta.
 * `cantidad` va en PAQUETES, no en kilos.
 */

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { BotonAvisos } from '@/app/components/boton-avisos'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatNum, formatDate, formatDateTime, hoyISO } from '@/lib/format'
import { catalogoGranel, type CatalogoGranel } from '@/lib/lapyme'
import { generarEtiquetasGranel } from '@/lib/etiqueta-granel'
import { Printer, PackageCheck, Loader2 } from 'lucide-react'

interface ItemReq {
  id: string
  sku: string
  cantidad: number
  descripcion: string | null
  vencimiento: string | null
}

interface Requerimiento {
  id: string
  id_externo: string
  pedido: string
  /** A nombre de quién. Null si Shuk Pedidos no lo manda. */
  cliente: string | null
  fecha_pedido: string | null
  estado: string
  armado_at: string | null
  created_at: string
  items: ItemReq[]
}

export default function RequerimientosPage() {
  const [reqs, setReqs] = useState<Requerimiento[]>([])
  const [cat, setCat] = useState<CatalogoGranel | null>(null)
  const [fefo, setFefo] = useState<Map<string, string>>(new Map())
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [{ data: rows }, catalogo, { data: vencs }] = await Promise.all([
        supabase
          .from('shuk_requerimientos')
          .select('id, id_externo, pedido, cliente, fecha_pedido, estado, armado_at, created_at, shuk_requerimiento_items(id, sku, cantidad, descripcion, vencimiento)')
          .order('created_at', { ascending: false })
          .limit(50),
        catalogoGranel(),
        supabase
          .from('ecom_vencimientos')
          .select('lapyme_product_id, fecha_vencimiento')
          .eq('estado', 'habilitado')
          .not('lapyme_product_id', 'is', null)
          .order('fecha_vencimiento'),
      ])

      type Fila = Omit<Requerimiento, 'items'> & { shuk_requerimiento_items: ItemReq[] }
      setCat(catalogo)

      // El vencimiento más próximo habilitado de cada producto padre.
      const mapa = new Map<string, string>()
      for (const v of (vencs ?? []) as { lapyme_product_id: string; fecha_vencimiento: string }[]) {
        if (!mapa.has(v.lapyme_product_id)) mapa.set(v.lapyme_product_id, v.fecha_vencimiento)
      }
      setFefo(mapa)

      // El vencimiento viene PUESTO, no sugerido.
      //
      // Antes el FEFO era un link de "usar tal fecha" que había que apretar
      // renglón por renglón, y el pedido quedaba trabado en "Faltan 2
      // vencimientos" aunque el sistema supiera perfectamente cuál era.
      // FEFO no es una opinión: lo que vence primero sale primero, así que es
      // el valor correcto por defecto. Igual queda editable, que es lo que
      // importa el día que agarren un bulto de otra partida.
      const listas = ((rows ?? []) as Fila[]).map(r => ({ ...r, items: r.shuk_requerimiento_items ?? [] }))
      const aGuardar: { id: string; vencimiento: string }[] = []
      for (const r of listas) {
        if (r.estado !== 'pendiente') continue
        for (const i of r.items) {
          if (i.vencimiento) continue
          const sug = catalogo.porSkuCombo.get(i.sku)?.padreId
          const fecha = sug ? mapa.get(sug) : undefined
          if (!fecha) continue
          i.vencimiento = fecha
          aGuardar.push({ id: i.id, vencimiento: fecha })
        }
      }
      setReqs(listas)

      // Se persiste para que el próximo que abra la pantalla vea lo mismo y
      // para que el aviso de "faltan vencimientos" diga la verdad. Si falla, la
      // pantalla ya muestra la fecha igual: se vuelve a intentar al recargar.
      await Promise.all(aGuardar.map(v =>
        supabase.from('shuk_requerimiento_items')
          .update({ vencimiento: v.vencimiento }).eq('id', v.id),
      ))
    } catch (err) {
      toast.error('No se pudo cargar: ' + (err as Error).message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  /** Guarda el vencimiento de un renglón. Es lo único que pone SOHO. */
  async function guardarVencimiento(reqId: string, itemId: string, fecha: string) {
    setReqs(prev => prev.map(r => r.id !== reqId ? r : {
      ...r, items: r.items.map(i => i.id === itemId ? { ...i, vencimiento: fecha || null } : i),
    }))
    await supabase.from('shuk_requerimiento_items')
      .update({ vencimiento: fecha || null }).eq('id', itemId)
  }

  async function imprimir(item: ItemReq) {
    const combo = cat?.porSkuCombo.get(item.sku)
    if (!combo) { toast.error(`El SKU ${item.sku} no está en el catálogo de granel.`); return }
    if (!item.vencimiento) { toast.error('Cargá el vencimiento antes de imprimir.'); return }

    await generarEtiquetasGranel([{
      nombre     : combo.padreNombre,
      formato    : combo.formato.etiqueta === 'Bulto cerrado'
        ? `Bulto ${formatNum(combo.formato.kg, 2)} kg`
        : combo.formato.etiqueta,
      vencimiento: item.vencimiento,
      sku        : item.sku,
    }], Math.round(item.cantidad))
    toast.success(`${Math.round(item.cantidad)} etiqueta(s) de ${item.sku}`)
  }

  async function marcarArmado(r: Requerimiento) {
    const sinVenc = r.items.filter(i => !i.vencimiento)
    if (sinVenc.length > 0) {
      toast.error(`Faltan ${sinVenc.length} vencimiento(s). Sin eso la etiqueta no sale.`)
      return
    }
    setGuardando(r.id)
    const { error } = await supabase.from('shuk_requerimientos')
      .update({ estado: 'armado', armado_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', r.id)
    setGuardando(null)

    if (error) { toast.error('No se pudo marcar: ' + error.message); return }
    setReqs(prev => prev.map(x => x.id === r.id
      ? { ...x, estado: 'armado', armado_at: new Date().toISOString() } : x))
    toast.success(`Pedido ${r.pedido} marcado como armado.`)

    // Aviso a David y Adrián para el traslado de SOHO al depósito de Shuk.
    //
    // Va DESPUÉS de marcar y sin bloquear: si el WhatsApp falla, el armado no
    // se pierde. El resultado queda guardado en la recepción, así que un aviso
    // que no salió se puede ver y reintentar.
    try {
      const res = await fetch('/api/shuk-pedidos/aviso', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ requerimiento_id: r.id }),
      })
      const j = await res.json().catch(() => ({})) as { ok?: boolean; envios?: Array<{ ok: boolean; info: string }> }
      if (res.ok && j.ok) toast.success('Avisado por WhatsApp para el traslado')
      else {
        const motivo = j.envios?.find(e => !e.ok)?.info ?? 'no se pudo enviar'
        toast.error(`El pedido quedó armado, pero el aviso de WhatsApp falló: ${motivo}`, { duration: 9000 })
      }
    } catch {
      toast.error('El pedido quedó armado, pero no se pudo mandar el aviso de WhatsApp.', { duration: 9000 })
    }
  }

  const pendientes = reqs.filter(r => r.estado === 'pendiente')
  const armados    = reqs.filter(r => r.estado !== 'pendiente')

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Requerimientos de granel</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Lo que Shuk Pedidos manda a armar · el resto del ecommerce lo despacha Shuk
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* El permiso va por PC, así que el estado se muestra acá y no en un
              lugar global: quien abre esta pantalla es quien arma los pedidos. */}
          <BotonAvisos />
          <Button variant="outline" size="sm" onClick={cargar} disabled={cargando}>
            {cargando ? <Loader2 size={13} className="mr-1 animate-spin" /> : null}
            Actualizar
          </Button>
        </div>
      </div>

      {cargando && reqs.length === 0 && (
        <p className="text-sm text-zinc-400 py-12 text-center">Cargando...</p>
      )}

      {!cargando && reqs.length === 0 && (
        <div className="rounded-lg border bg-white p-12 text-center">
          <p className="text-zinc-500">Todavía no entró ningún requerimiento</p>
          <p className="text-xs text-zinc-400 mt-1">
            Cuando Shuk Pedidos mande un pedido con líneas de granel, aparece acá.
          </p>
        </div>
      )}

      {pendientes.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
            Para armar ({pendientes.length})
          </h2>
          {pendientes.map(r => (
            <Tarjeta key={r.id} r={r} cat={cat} fefo={fefo}
              onVenc={guardarVencimiento} onImprimir={imprimir}
              onArmado={marcarArmado} guardando={guardando === r.id} />
          ))}
        </div>
      )}

      {armados.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
            Ya armados
          </h2>
          {armados.map(r => (
            <Tarjeta key={r.id} r={r} cat={cat} fefo={fefo}
              onVenc={guardarVencimiento} onImprimir={imprimir}
              onArmado={marcarArmado} guardando={false} />
          ))}
        </div>
      )}
    </div>
  )
}

function Tarjeta({ r, cat, fefo, onVenc, onImprimir, onArmado, guardando }: {
  r: Requerimiento
  cat: CatalogoGranel | null
  fefo: Map<string, string>
  onVenc: (reqId: string, itemId: string, fecha: string) => void
  onImprimir: (item: ItemReq) => void
  onArmado: (r: Requerimiento) => void
  guardando: boolean
}) {
  const armado = r.estado === 'armado'
  const faltan = r.items.filter(i => !i.vencimiento).length

  return (
    <div className={`rounded-lg border overflow-hidden ${armado ? 'bg-zinc-50 border-zinc-200' : 'bg-white border-indigo-200'}`}>
      <div className={`flex items-center gap-3 px-4 py-2.5 border-b ${armado ? 'bg-zinc-100 border-zinc-200' : 'bg-indigo-50 border-indigo-200'}`}>
        <span className="font-mono text-sm font-medium text-zinc-800">{r.pedido}</span>
        {r.cliente && (
          <span className="text-sm text-zinc-700 font-medium truncate max-w-[220px]" title={r.cliente}>
            {r.cliente}
          </span>
        )}
        {armado
          ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-[10px]">Armado</Badge>
          : <Badge className="bg-amber-100 text-amber-700 border-amber-300 text-[10px]">Pendiente</Badge>}
        <span className="text-xs text-zinc-500">
          {formatDateTime(r.fecha_pedido ?? r.created_at)}
        </span>
        {armado && r.armado_at && (
          <span className="text-xs text-zinc-400 ml-auto">armado {formatDateTime(r.armado_at)}</span>
        )}
      </div>

      <div className="divide-y">
        {r.items.map(i => {
          const combo = cat?.porSkuCombo.get(i.sku)
          const sugerido = combo ? fefo.get(combo.padreId) : undefined
          const paquetes = Math.round(i.cantidad)
          return (
            <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-[220px]">
                <p className="text-sm font-medium text-zinc-800">
                  {combo?.padreNombre ?? i.descripcion ?? i.sku}
                </p>
                <p className="text-xs text-zinc-500 font-mono">
                  {i.sku}
                  {combo && <> · {combo.formato.etiqueta} · {formatNum(combo.formato.kg * paquetes, 2)} kg en total</>}
                  {!combo && <span className="text-red-600"> · SKU desconocido</span>}
                </p>
              </div>

              <div className="text-center">
                <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Paquetes</p>
                <p className="text-lg font-semibold tabular-nums text-zinc-800">{paquetes}</p>
              </div>

              <div>
                <p className="text-[10px] text-zinc-400 uppercase tracking-wide mb-0.5">Vencimiento</p>
                <input
                  type="date"
                  value={i.vencimiento ?? ''}
                  min={hoyISO()}
                  disabled={armado}
                  onChange={e => onVenc(r.id, i.id, e.target.value)}
                  className={`border rounded px-2 py-1 text-sm bg-white disabled:bg-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-400 ${
                    i.vencimiento ? 'border-zinc-300' : 'border-amber-500'
                  }`}
                />
                {/* Viene puesto por FEFO, pero se dice de dónde salió: la fecha
                    la eligió el sistema, no la leyó nadie del bulto. */}
                {i.vencimiento && sugerido === i.vencimiento && (
                  <span className="block text-[10px] text-zinc-400 mt-0.5">por FEFO</span>
                )}
                {i.vencimiento && sugerido && sugerido !== i.vencimiento && (
                  <button onClick={() => onVenc(r.id, i.id, sugerido)}
                    className="block text-[10px] text-indigo-600 underline mt-0.5">
                    volver a {formatDate(sugerido)}
                  </button>
                )}
                {!i.vencimiento && (
                  <span className="block text-[10px] text-amber-600 mt-0.5">
                    {sugerido ? 'cargalo a mano' : 'sin stock con fecha'}
                  </span>
                )}
              </div>

              <Button variant="outline" size="sm" className="h-8"
                disabled={!combo || !i.vencimiento}
                onClick={() => onImprimir(i)}>
                <Printer size={13} className="mr-1" />
                {paquetes} etiqueta{paquetes === 1 ? '' : 's'}
              </Button>
            </div>
          )
        })}
      </div>

      {!armado && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-50 border-t">
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white"
            disabled={guardando || faltan > 0}
            onClick={() => onArmado(r)}>
            <PackageCheck size={14} className="mr-1" />
            {guardando ? 'Guardando...' : 'Marcar armado'}
          </Button>
          <span className="text-xs text-zinc-500">
            {faltan > 0
              ? `Faltan ${faltan} vencimiento${faltan === 1 ? '' : 's'}`
              : 'Al marcarlo se avisa para el traslado de SOHO a Shuk'}
          </span>
        </div>
      )}
    </div>
  )
}
