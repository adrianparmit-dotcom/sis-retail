'use client'

/**
 * Bultos a fraccionar.
 *
 * Al recibir solo se marca que un renglón es un bulto (y cuántos kilos entraron).
 * En qué variedades sale, cuántos paquetes, con qué vencimiento y qué lote se
 * decide acá, al embolsar — y eso pasa a lo largo de 10-15 días, en tandas.
 *
 * Cada tanda que se registra crea los vencimientos de esos paquetes. El progreso
 * se calcula en gramos: se sabe cuántos kilos entraron y cuántos gramos tiene
 * cada variedad, así que el sistema muestra cuánto del bulto ya se embolsó sin
 * que haya que declarar un objetivo por adelantado.
 *
 * NO mueve stock: las cantidades las maneja Dux.
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate, hoyISO, toTitleCase, formatNum } from '@/lib/format'
import { matchesQuery } from '@/lib/search'
import { SUCURSALES_OPERATIVAS } from '@/lib/constants'

interface ProductoFrac {
  id: string
  sku: string
  nombre: string | null
  unidad_medida: string | null
}

interface Tanda {
  id                  : string
  producto_final_id   : string
  cantidad_fraccionada: number
  fecha_vencimiento   : string | null
  numero_lote         : string | null
  sucursal_id         : string | null
  created_at          : string
}

interface Bulto {
  itemId     : string
  descripcion: string
  proveedor  : string | null
  fecha      : string | null
  kgRecibidos: number
  /** Vencimiento impreso en el envase del bulto. Lo heredan los paquetes. */
  venceMadre : string | null
  estado     : string
  mermaGramos: number | null
  tandas     : Tanda[]
}

/** Gramos por unidad del SKU final. `unidad_medida` numérico = gramos. */
function gramosPorUnidad(p: ProductoFrac | undefined): number {
  if (!p) return 0
  if (p.unidad_medida === 'kg') return 1000
  const n = Number(p.unidad_medida)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function TrabajoPendiente() {
  const [bultos, setBultos]     = useState<Bulto[]>([])
  const [productos, setProductos] = useState<ProductoFrac[]>([])
  const [loading, setLoading]   = useState(true)
  const [abierto, setAbierto]   = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  // Formulario de la tanda que se está cargando
  const [fProducto, setFProducto] = useState('')
  const [fBusqueda, setFBusqueda] = useState('')
  const [fCantidad, setFCantidad] = useState('')
  const [fVence, setFVence]       = useState('')
  const [fLote, setFLote]         = useState('')
  const [fSucursal, setFSucursal] = useState<string>(SUCURSALES_OPERATIVAS[0]?.id ?? '')

  const cargar = useCallback(async () => {
    // Bultos = renglones de recepciones confirmadas marcados como granel.
    const { data: itemsDb } = await supabase
      .from('recepcion_items')
      .select('id, descripcion_proveedor, cantidad_recibida, cantidad_esperada, fecha_vencimiento, fraccionado_estado, merma_gramos, recepciones!inner(estado, fecha_recepcion, proveedor_nombre)')
      .eq('es_granel', true)
      .eq('recepciones.estado', 'confirmada')

    type ItemDb = {
      id: string; descripcion_proveedor: string | null
      cantidad_recibida: number | null; cantidad_esperada: number | null
      fecha_vencimiento: string | null
      fraccionado_estado: string | null; merma_gramos: number | null
      recepciones: { fecha_recepcion: string | null; proveedor_nombre: string | null } | null
    }
    const items = (itemsDb as unknown as ItemDb[]) ?? []
    if (items.length === 0) { setBultos([]); setLoading(false); return }

    const [{ data: tandasDb }, { data: prodsDb }] = await Promise.all([
      supabase.from('recepcion_item_fraccionamiento')
        .select('id, recepcion_item_id, producto_final_id, cantidad_fraccionada, fecha_vencimiento, numero_lote, sucursal_id, created_at')
        .in('recepcion_item_id', items.map(i => i.id)),
      supabase.from('productos').select('id, sku, nombre, unidad_medida').eq('categoria', 'GRANEL'),
    ])

    const porItem = new Map<string, Tanda[]>()
    for (const t of ((tandasDb ?? []) as (Tanda & { recepcion_item_id: string })[])) {
      const lista = porItem.get(t.recepcion_item_id) ?? []
      lista.push({ ...t, cantidad_fraccionada: Number(t.cantidad_fraccionada ?? 0) })
      porItem.set(t.recepcion_item_id, lista)
    }

    const lista: Bulto[] = items.map(i => ({
      itemId     : i.id,
      descripcion: i.descripcion_proveedor ?? 'Bulto sin descripción',
      proveedor  : i.recepciones?.proveedor_nombre ?? null,
      fecha      : i.recepciones?.fecha_recepcion ?? null,
      kgRecibidos: Number(i.cantidad_recibida ?? i.cantidad_esperada ?? 0),
      venceMadre : i.fecha_vencimiento,
      estado     : i.fraccionado_estado ?? 'pendiente',
      mermaGramos: i.merma_gramos == null ? null : Number(i.merma_gramos),
      tandas     : (porItem.get(i.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    }))

    // Los cerrados abajo. Entre los abiertos, primero el más viejo: es el que
    // lleva más días a medio embolsar.
    lista.sort((a, b) => {
      const ca = a.estado === 'terminado', cb = b.estado === 'terminado'
      if (ca !== cb) return ca ? 1 : -1
      return (a.fecha ?? '').localeCompare(b.fecha ?? '')
    })

    setProductos(((prodsDb ?? []) as ProductoFrac[]))
    setBultos(lista)
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const prodMap = useMemo(() => new Map(productos.map(p => [p.id, p])), [productos])

  const sugeridos = useMemo(() => {
    if (fBusqueda.trim().length < 2) return []
    return productos.filter(p => matchesQuery(fBusqueda, p.nombre, p.sku)).slice(0, 8)
  }, [fBusqueda, productos])

  function abrir(b: Bulto) {
    const cerrando = abierto === b.itemId
    setAbierto(cerrando ? null : b.itemId)
    setFProducto(''); setFBusqueda(''); setFCantidad(''); setFLote('')
    // La fecha del bulto se hereda: los paquetes vencen cuando vence la
    // mercadería, no cuando se embolsaron. Igual queda editable.
    setFVence(cerrando ? '' : (b.venceMadre ?? ''))
  }

  /** Cierra el bulto y guarda la merma: lo que entró menos lo embolsado. */
  async function cerrarBulto(b: Bulto, gramosHechos: number) {
    const gramosTotales = b.kgRecibidos * 1000
    const merma = Math.round(gramosTotales - gramosHechos)
    const detalle = merma >= 0
      ? `Se registra una merma de ${formatNum(merma, 0)} g.`
      : `Salieron ${formatNum(-merma, 0)} g MÁS de lo que entró — revisá las cantidades.`
    if (!window.confirm(
      `Cerrar "${b.descripcion}"\n\n` +
      `Entraron ${formatNum(b.kgRecibidos, 2)} kg y se embolsaron ${formatNum(gramosHechos / 1000, 2)} kg.\n` +
      `${detalle}\n\nUna vez cerrado no se cargan más tandas.`
    )) return

    const { error } = await supabase.from('recepcion_items').update({
      fraccionado_estado    : 'terminado',
      fraccionado_cerrado_at: new Date().toISOString(),
      merma_gramos          : merma,
    }).eq('id', b.itemId)
    if (error) { toast.error('No se pudo cerrar: ' + error.message); return }
    toast.success(`Bulto terminado — merma ${formatNum(merma, 0)} g`)
    setAbierto(null)
    cargar()
  }

  async function reabrirBulto(b: Bulto) {
    const { error } = await supabase.from('recepcion_items').update({
      fraccionado_estado: 'pendiente', fraccionado_cerrado_at: null, merma_gramos: null,
    }).eq('id', b.itemId)
    if (error) { toast.error('No se pudo reabrir: ' + error.message); return }
    toast.success('Bulto reabierto')
    cargar()
  }

  async function registrarTanda(b: Bulto) {
    const cant = Number(fCantidad)
    if (!fProducto)                       { toast.error('Elegí en qué variedad se fraccionó'); return }
    if (!Number.isFinite(cant) || cant <= 0) { toast.error('Poné cuántos paquetes salieron'); return }
    if (!fVence)                          { toast.error('Falta la fecha de vencimiento'); return }

    setGuardando(true)
    try {
      const { error: e1 } = await supabase.from('recepcion_item_fraccionamiento').insert({
        recepcion_item_id   : b.itemId,
        producto_final_id   : fProducto,
        cantidad_fraccionada: cant,
        fecha_vencimiento   : fVence,
        numero_lote         : fLote.trim() || null,
        sucursal_id         : fSucursal || null,
        estado              : 'completo',
      })
      if (e1) throw new Error(e1.message)

      // Los paquetes embolsados sí son stock con vencimiento: se suman a la
      // fecha correspondiente, igual que en una recepción normal.
      const { data: existente } = await supabase.from('vencimientos')
        .select('id, cantidad')
        .eq('producto_id', fProducto)
        .eq('sucursal_id', fSucursal)
        .eq('fecha_vencimiento', fVence)
        .maybeSingle()
      if (existente) {
        const prev = existente as { id: string; cantidad: number }
        await supabase.from('vencimientos')
          .update({ cantidad: Number(prev.cantidad) + cant, updated_at: new Date().toISOString() })
          .eq('id', prev.id)
      } else {
        await supabase.from('vencimientos').insert({
          producto_id      : fProducto,
          sucursal_id      : fSucursal,
          fecha_vencimiento: fVence,
          cantidad         : cant,
          origen           : 'fraccionamiento',
        })
      }

      toast.success(`${cant} paquetes registrados`)
      setFProducto(''); setFBusqueda(''); setFCantidad(''); setFLote('')
      cargar()
    } catch (err) {
      toast.error('No se pudo guardar: ' + (err as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  async function borrarTanda(t: Tanda) {
    if (!window.confirm('¿Borrar esta tanda? No se descuenta el vencimiento que ya generó.')) return
    const { error } = await supabase.from('recepcion_item_fraccionamiento').delete().eq('id', t.id)
    if (error) { toast.error('No se pudo borrar: ' + error.message); return }
    toast.success('Tanda borrada')
    cargar()
  }

  if (loading) return <p className="text-sm text-zinc-400 py-8">Cargando bultos...</p>

  if (bultos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 py-14 text-center">
        <p className="text-sm text-zinc-500">No hay bultos para fraccionar</p>
        <p className="text-xs text-zinc-400 mt-1">
          Aparecen acá cuando confirmás una recepción con renglones marcados como granel.
        </p>
      </div>
    )
  }

  // Informe de bultos: cuántos hay, cuántos cerrados y cuánta merma acumulada.
  const resumen = bultos.reduce((acc, b) => {
    acc.total++
    if (b.estado === 'terminado') { acc.cerrados++; acc.merma += b.mermaGramos ?? 0 }
    else acc.abiertos++
    acc.kg += b.kgRecibidos
    return acc
  }, { total: 0, cerrados: 0, abiertos: 0, kg: 0, merma: 0 })

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Bultos', valor: formatNum(resumen.total), sub: `${formatNum(resumen.kg, 2)} kg recibidos` },
          { label: 'A fraccionar', valor: formatNum(resumen.abiertos), sub: 'abiertos' },
          { label: 'Terminados', valor: formatNum(resumen.cerrados), sub: 'cerrados' },
          { label: 'Merma', valor: `${formatNum(resumen.merma / 1000, 2)} kg`, sub: 'de los cerrados' },
        ].map(k => (
          <div key={k.label} className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
            <p className="text-[11px] text-zinc-500">{k.label}</p>
            <p className="text-lg font-bold text-zinc-900 tabular-nums leading-tight">{k.valor}</p>
            <p className="text-[10px] text-zinc-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {bultos.map(b => {
        const gramosHechos = b.tandas.reduce((s, t) =>
          s + t.cantidad_fraccionada * gramosPorUnidad(prodMap.get(t.producto_final_id)), 0)
        const gramosTotales = b.kgRecibidos * 1000
        const pct = gramosTotales > 0 ? Math.min(100, Math.round(100 * gramosHechos / gramosTotales)) : 0
        const restanKg = Math.max(0, (gramosTotales - gramosHechos) / 1000)
        const dias = b.fecha ? Math.floor((Date.now() - new Date(b.fecha).getTime()) / 86400000) : null
        const estaAbierto = abierto === b.itemId
        const cerrado = b.estado === 'terminado'

        return (
          <div key={b.itemId} className={`rounded-xl border bg-white overflow-hidden ${
            cerrado ? 'border-emerald-200' : 'border-zinc-200'
          }`}>
            <button
              onClick={() => abrir(b)}
              className={`w-full text-left px-4 py-3 transition-colors ${cerrado ? 'bg-emerald-50/40 hover:bg-emerald-50' : 'hover:bg-zinc-50'}`}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-zinc-900 leading-snug">{b.descripcion}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {b.proveedor ? toTitleCase(b.proveedor) : 'Sin proveedor'}
                    {b.fecha && <> · recibido {formatDate(b.fecha)}</>}
                    {dias !== null && dias > 0 && <> · hace {dias} día{dias === 1 ? '' : 's'}</>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-xs font-semibold ${cerrado ? 'text-emerald-700' : 'text-zinc-600'}`}>
                    {cerrado
                      ? '✓ Terminado'
                      : b.tandas.length === 0 ? 'Sin fraccionar' : `${pct}% embolsado`}
                  </span>
                  {b.kgRecibidos > 0 && (
                    <p className="text-[11px] text-zinc-400 mt-0.5 tabular-nums">
                      {cerrado
                        ? `merma ${formatNum((b.mermaGramos ?? 0) / 1000, 2)} kg`
                        : `${formatNum(b.kgRecibidos, 2)} kg · restan ${formatNum(restanKg, 2)} kg`}
                    </p>
                  )}
                </div>
              </div>
              {b.kgRecibidos > 0 && <Progress value={pct} className="mt-2 h-1.5" />}
            </button>

            {estaAbierto && (
              <div className="border-t border-zinc-100 px-4 py-3 space-y-3 bg-zinc-50/50">
                {/* Tandas ya registradas */}
                {b.tandas.length > 0 && (
                  <div className="space-y-1">
                    {b.tandas.map(t => {
                      const p = prodMap.get(t.producto_final_id)
                      return (
                        <div key={t.id} className="flex items-center gap-3 text-xs bg-white rounded border border-zinc-200 px-3 py-2 flex-wrap">
                          <span className="font-medium text-zinc-800 flex-1 min-w-[160px]">
                            {p?.nombre ? toTitleCase(p.nombre) : '—'}
                          </span>
                          <span className="tabular-nums text-zinc-700">{t.cantidad_fraccionada} paq.</span>
                          <span className="text-zinc-500">vence {t.fecha_vencimiento ? formatDate(t.fecha_vencimiento) : '—'}</span>
                          {t.numero_lote && <span className="text-zinc-400 font-mono">lote {t.numero_lote}</span>}
                          <button onClick={() => borrarTanda(t)} className="text-red-500 hover:text-red-700 ml-auto">✕</button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {cerrado ? (
                  <div className="bg-white rounded-lg border border-emerald-200 p-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-xs text-zinc-700">
                      <p className="font-semibold text-emerald-800">Bulto terminado</p>
                      <p className="text-zinc-500 mt-0.5 tabular-nums">
                        Entraron {formatNum(b.kgRecibidos, 2)} kg · se embolsaron {formatNum(gramosHechos / 1000, 2)} kg ·
                        merma {formatNum((b.mermaGramos ?? 0) / 1000, 2)} kg
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => reabrirBulto(b)}>Reabrir</Button>
                  </div>
                ) : (
                <>
                {/* Alta de tanda */}
                <div className="bg-white rounded-lg border border-zinc-200 p-3 space-y-2.5">
                  <p className="text-xs font-semibold text-zinc-700">Registrar lo que se embolsó</p>

                  <div>
                    <label className="text-[11px] text-zinc-500">¿En qué variedad?</label>
                    {fProducto ? (
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-sm text-zinc-800 flex-1">
                          {toTitleCase(prodMap.get(fProducto)?.nombre ?? '')}
                          <span className="text-xs text-zinc-400 ml-2">
                            {gramosPorUnidad(prodMap.get(fProducto)) || '?'} g c/u
                          </span>
                        </span>
                        <button onClick={() => { setFProducto(''); setFBusqueda('') }}
                          className="text-xs text-zinc-400 underline">cambiar</button>
                      </div>
                    ) : (
                      <>
                        <Input value={fBusqueda} onChange={e => setFBusqueda(e.target.value)}
                          placeholder="Buscá el producto fraccionado..." className="h-8 mt-0.5" />
                        {sugeridos.length > 0 && (
                          <div className="mt-1 border rounded max-h-40 overflow-y-auto">
                            {sugeridos.map(p => (
                              <button key={p.id} onClick={() => { setFProducto(p.id); setFBusqueda('') }}
                                className="w-full text-left px-2 py-1.5 text-xs hover:bg-emerald-50 border-b last:border-b-0">
                                <span className="text-zinc-800">{toTitleCase(p.nombre ?? p.sku)}</span>
                                <span className="text-zinc-400 ml-2">{gramosPorUnidad(p) || '?'} g</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="text-[11px] text-zinc-500">Paquetes</label>
                      <Input type="number" min={1} value={fCantidad}
                        onChange={e => setFCantidad(e.target.value)} className="h-8" placeholder="Ej: 20" />
                    </div>
                    <div>
                      <label className="text-[11px] text-zinc-500">Vence</label>
                      <Input type="date" value={fVence} min={hoyISO()}
                        onChange={e => setFVence(e.target.value)} className="h-8" />
                    </div>
                    <div>
                      <label className="text-[11px] text-zinc-500">Lote (opcional)</label>
                      <Input value={fLote} onChange={e => setFLote(e.target.value)}
                        className="h-8" placeholder="—" />
                    </div>
                    <div>
                      <label className="text-[11px] text-zinc-500">Sucursal</label>
                      <Select value={fSucursal} onValueChange={v => setFSucursal(v ?? '')}>
                        <SelectTrigger className="h-8">
                          <SelectValue>
                            {SUCURSALES_OPERATIVAS.find(s => s.id === fSucursal)?.nombre ?? 'Elegir'}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {SUCURSALES_OPERATIVAS.map(s => (
                            <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {fProducto && Number(fCantidad) > 0 && gramosPorUnidad(prodMap.get(fProducto)) > 0 && (
                    <p className="text-[11px] text-zinc-500">
                      Son {formatNum(Number(fCantidad) * gramosPorUnidad(prodMap.get(fProducto)) / 1000, 2)} kg del bulto.
                    </p>
                  )}

                  <Button size="sm" disabled={guardando} onClick={() => registrarTanda(b)}>
                    {guardando ? 'Guardando...' : 'Registrar fraccionado'}
                  </Button>
                </div>

                {/* Cierre del bulto: acá se calcula y guarda la merma. */}
                {b.tandas.length > 0 && (
                  <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                    <p className="text-[11px] text-zinc-500">
                      Cuando termines el bulto completo, cerralo: se guarda la merma
                      ({formatNum(Math.max(0, gramosTotales - gramosHechos), 0)} g por ahora).
                    </p>
                    <Button size="sm" variant="outline" onClick={() => cerrarBulto(b, gramosHechos)}>
                      Marcar bulto terminado
                    </Button>
                  </div>
                )}
                </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
