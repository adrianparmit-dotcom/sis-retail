'use client'

/**
 * Ecommerce Shuk — inventario de la línea de granel.
 *
 * Muestra los 19 productos PADRE de la linea de granel: son los que llevan el
 * stock en kilos y los que se fraccionan. Los 74 combos (1kg, 3kg, 5kg, 10kg,
 * bulto cerrado) son formatos de venta que se arman cuando entra el pedido y no
 * tienen stock propio: aparecen como etiquetas en la fila del padre, no como
 * filas sueltas. Listarlos seria contar cinco veces la misma mercaderia.
 *
 * De los 356 productos de La Pyme solo 93 son granel; el resto — ECOM, DISTRI,
 * TiendaNube — lo maneja Shuk por su cuenta. La etiqueta GRANEL viene SOLO en
 * /products, no en el inventario, asi que la pantalla cruza las dos listas por
 * product_id (ver catalogoGranel).
 */

import { useEffect, useState, useCallback, Fragment } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { formatNum, toTitleCase, hoyISO } from '@/lib/format'
import { generarEtiquetasGranel, descargarEtiquetasGranel } from '@/lib/etiqueta-granel'
import { matchesQuery } from '@/lib/search'
import { Printer } from 'lucide-react'
import {
  lapymeGet, lapymeGetTodo, catalogoGranel, LapymeApiError, centavosAPesos,
  type LapymeLista, type Deposito, type ItemInventario, type Pedido, type FormatoGranel,
} from '@/lib/lapyme'

/** Guarda el depósito elegido para no volver a elegirlo en cada visita. */
const CLAVE_DEPOSITO = 'ecommerce.depositoId'

export default function EcommercePage() {
  const [depositos, setDepositos] = useState<Deposito[]>([])
  const [depositoId, setDepositoId] = useState<string>('')
  const [items, setItems] = useState<ItemInventario[]>([])
  /** product_id del padre -> sus formatos de venta. Solo para mostrar. */
  const [formatos, setFormatos] = useState<Map<string, FormatoGranel[]>>(new Map())
  /**
   * product_id -> vencimiento más próximo habilitado para vender (FEFO).
   *
   * Sale de `ecom_vencimientos`, que carga la pantalla de Recepciones Shuk.
   * Mientras no haya recepciones cargadas viene vacío y la fecha de la etiqueta
   * se escribe a mano; cuando empiecen a cargarse, se completa sola.
   */
  const [vencPorProducto, setVencPorProducto] = useState<Map<string, string>>(new Map())

  // Etiquetas: qué producto se está etiquetando y con qué datos.
  const [etiquetaDe, setEtiquetaDe] = useState<string | null>(null)
  const [fmtSel, setFmtSel]   = useState('')
  const [cantEtq, setCantEtq] = useState(1)
  const [vencEtq, setVencEtq] = useState('')
  const [imprimiendo, setImprimiendo] = useState(false)
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<{ msg: string; detalle?: string } | null>(null)
  const [busqueda, setBusqueda] = useState('')

  // Los depósitos y los pedidos no dependen de la selección: se piden una vez.
  useEffect(() => {
    const cargar = async () => {
      try {
        const [deps, peds] = await Promise.all([
          lapymeGet<LapymeLista<Deposito>>('warehouses'),
          lapymeGet<LapymeLista<Pedido>>('orders', { limit: 20 }),
        ])
        const lista = deps.data ?? []
        setDepositos(lista)
        setPedidos(peds.data ?? [])

        const guardado = typeof window !== 'undefined' ? localStorage.getItem(CLAVE_DEPOSITO) : null
        const elegido = lista.find(d => d.id === guardado)?.id
          // Sin elección previa arranca por el de ecommerce si existe.
          ?? lista.find(d => /ecommerce/i.test(d.name))?.id
          ?? lista.find(d => d.is_default)?.id
          ?? lista[0]?.id
          ?? ''
        setDepositoId(elegido)
      } catch (err) {
        const e = err as LapymeApiError
        setError({ msg: e.message, detalle: e.detalle })
        setCargando(false)
      }
    }
    cargar()
  }, [])

  const cargarInventario = useCallback(async (id: string) => {
    if (!id) return
    setCargando(true)
    try {
      // Solo la línea de granel, y de esa línea solo los PADRES.
      //
      // El padre es el que lleva el stock en kilos. Los combos (1kg, 3kg, 5kg,
      // 10kg, bulto cerrado) son formatos de venta que se arman recién cuando
      // entra el pedido, así que mostrarlos acá sería contar cinco veces la
      // misma mercadería. Quedan 19 filas en vez de 93.
      //
      // Las dos listas se piden completas: paginadas, no los primeros 100.
      const [cat, inv] = await Promise.all([
        catalogoGranel(),
        lapymeGetTodo<ItemInventario>(
          'inventory',
          r => ((r.data as { items?: ItemInventario[] } | undefined)?.items) ?? [],
          { warehouse_id: id },
        ),
      ])
      setItems(inv.filter(i => cat.padres.has(i.product_id)))
      setFormatos(cat.formatos)
      setError(null)

      // Vencimiento FEFO por producto, para precargar la etiqueta. Vive en
      // Supabase, no en La Pyme: el ERP no lleva vencimientos, esa es
      // justamente la parte que pone SOHO.
      const { data: vencs } = await supabase
        .from('ecom_vencimientos')
        .select('lapyme_product_id, fecha_vencimiento')
        .eq('estado', 'habilitado')
        .not('lapyme_product_id', 'is', null)
        .order('fecha_vencimiento')
      const mapa = new Map<string, string>()
      for (const v of (vencs ?? []) as { lapyme_product_id: string; fecha_vencimiento: string }[]) {
        // Vienen ordenados: el primero de cada producto es el más próximo.
        if (!mapa.has(v.lapyme_product_id)) mapa.set(v.lapyme_product_id, v.fecha_vencimiento)
      }
      setVencPorProducto(mapa)
    } catch (err) {
      const e = err as LapymeApiError
      setError({ msg: e.message, detalle: e.detalle })
      setItems([])
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargarInventario(depositoId) }, [depositoId, cargarInventario])

  function elegirDeposito(id: string) {
    setDepositoId(id)
    try { localStorage.setItem(CLAVE_DEPOSITO, id) } catch { /* modo privado */ }
  }

  /** Abre el panel de etiquetas de un producto, precargado con lo que se sabe. */
  function abrirEtiquetas(i: ItemInventario) {
    if (etiquetaDe === i.product_id) { setEtiquetaDe(null); return }
    setEtiquetaDe(i.product_id)
    const fmts = formatos.get(i.product_id) ?? []
    // Arranca por el formato más chico, que es el que más se fracciona.
    setFmtSel(fmts[0]?.sku ?? '')
    setCantEtq(1)
    setVencEtq(vencPorProducto.get(i.product_id) ?? '')
  }

  async function imprimirEtiquetas(i: ItemInventario, descargar: boolean) {
    const fmt = (formatos.get(i.product_id) ?? []).find(f => f.sku === fmtSel)
    if (!fmt) { toast.error('Elegí el formato del paquete.'); return }
    if (!vencEtq) { toast.error('Falta el vencimiento. Sin eso la etiqueta no sirve.'); return }
    if (vencEtq < hoyISO()) { toast.error('El vencimiento ya pasó. Revisá la fecha.'); return }

    const etiqueta = {
      nombre     : i.product_name,
      formato    : fmt.etiqueta === 'Bulto cerrado' ? `Bulto ${formatNum(fmt.kg, 2)} kg` : fmt.etiqueta,
      vencimiento: vencEtq,
      sku        : fmt.sku,
    }
    setImprimiendo(true)
    try {
      if (descargar) await descargarEtiquetasGranel([etiqueta], cantEtq, `etiquetas-${fmt.sku}.pdf`)
      else await generarEtiquetasGranel([etiqueta], cantEtq)
      toast.success(`${cantEtq} etiqueta${cantEtq === 1 ? '' : 's'} de ${etiqueta.formato}`)
    } catch (err) {
      toast.error('No se pudo generar el PDF: ' + (err as Error).message)
    } finally {
      setImprimiendo(false)
    }
  }

  const visibles = busqueda
    ? items.filter(i => matchesQuery(busqueda, i.product_name, i.sku ?? ''))
    : items

  const conStock = items.filter(i => i.stock.available !== 0).length
  const reservados = items.reduce((s, i) => s + (i.stock.reserved || 0), 0)

  return (
    <div className="p-6 space-y-6 max-w-6xl">

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Ecommerce Shuk</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Línea de granel de shuk.ar · datos en vivo de La Pyme · solo etiqueta GRANEL
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">{error.msg}</p>
          {error.detalle && <p className="text-xs text-red-700 mt-1 font-mono">{error.detalle}</p>}
          <Button variant="outline" size="sm" className="mt-3 text-xs h-7"
            onClick={() => cargarInventario(depositoId)}>
            Reintentar
          </Button>
        </div>
      )}

      {/* Depósito de trabajo */}
      {depositos.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-widest mb-2">
            Depósito de la línea
          </p>
          <div className="flex flex-wrap gap-2">
            {depositos.map(d => {
              const activo = d.id === depositoId
              return (
                <button
                  key={d.id}
                  onClick={() => elegirDeposito(d.id)}
                  className={`text-left rounded-lg border px-3.5 py-2.5 transition-all ${
                    activo
                      ? 'border-indigo-300 bg-indigo-50 ring-2 ring-indigo-200'
                      : 'border-zinc-200 bg-white hover:border-zinc-300'
                  }`}
                >
                  <span className={`block text-sm font-medium ${activo ? 'text-indigo-900' : 'text-zinc-800'}`}>
                    {d.name}
                  </span>
                  <span className="block text-[11px] text-zinc-400 font-mono mt-0.5">
                    {d.is_default ? 'predeterminado' : 'secundario'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Resumen */}
      {!error && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Resumen label="Productos granel" valor={cargando ? '—' : formatNum(items.length, 0)}
            nota="los que mueven stock" />
          <Resumen label="Con stock" valor={cargando ? '—' : formatNum(conStock, 0)} />
          <Resumen label="Kilos reservados" valor={cargando ? '—' : formatNum(reservados, 2)}
            nota="comprometidos en pedidos" />
          <Resumen label="Pedidos" valor={cargando ? '—' : formatNum(pedidos.length, 0)}
            nota={pedidos.length === 0 ? 'ninguno todavía' : 'últimos 20'} />
        </div>
      )}

      {/* Inventario */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
            Inventario de granel
          </h2>
          <div className="relative max-w-xs flex-1 min-w-[180px]">
            <Input
              placeholder="Buscar producto o SKU..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="h-8 text-sm pr-7"
            />
            {busqueda && (
              <button onClick={() => setBusqueda('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 text-xs">
                ✕
              </button>
            )}
          </div>
          {busqueda && (
            <span className="text-xs text-zinc-400">{visibles.length} de {items.length}</span>
          )}
        </div>

        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50">
                  <TableHead className="w-20">SKU</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right w-24">Kilos</TableHead>
                  <TableHead className="text-right w-24">Reservado</TableHead>
                  <TableHead className="text-right w-28">Costo /kg</TableHead>
                  <TableHead>Formatos de venta</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cargando ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-zinc-400 py-12">Cargando...</TableCell></TableRow>
                ) : visibles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12">
                      <p className="text-zinc-400">
                        {items.length === 0 ? 'El depósito no tiene productos cargados' : 'Sin coincidencias'}
                      </p>
                    </TableCell>
                  </TableRow>
                ) : visibles.map(i => (
                  <Fragment key={i.product_id}>
                  <TableRow className="hover:bg-zinc-50">
                    <TableCell className="font-mono text-xs text-zinc-500">{i.sku ?? '—'}</TableCell>
                    <TableCell className="text-sm">{toTitleCase(i.product_name)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {/* El stock del padre son KILOS: es el que se fracciona.
                          El ERP admite existencias negativas: se deja ver, en
                          rojo, porque es justo lo que la línea nueva no debería
                          repetir. */}
                      <span className={i.stock.available < 0 ? 'text-red-600 font-semibold' : 'text-zinc-700'}>
                        {formatNum(i.stock.available, 2)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-zinc-500">
                      {i.stock.reserved ? formatNum(i.stock.reserved, 2) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-zinc-500">
                      ${formatNum(centavosAPesos(i.cost), 0)}
                    </TableCell>
                    <TableCell>
                      {/* Los formatos no tienen stock propio: se arman del padre
                          cuando entra el pedido. Van acá para saber en qué se
                          vende cada cosa y cuántos kilos lleva el bulto. */}
                      <div className="flex flex-wrap gap-1">
                        {(formatos.get(i.product_id) ?? []).map(f => (
                          <Badge
                            key={f.sku}
                            className="bg-zinc-100 text-zinc-600 border-zinc-200 text-[10px] px-1.5 font-normal"
                            title={`${f.sku} · ${formatNum(f.kg, 2)} kg · costo $${formatNum(f.costo, 0)}`}
                          >
                            {f.etiqueta === 'Bulto cerrado' ? `Bulto ${formatNum(f.kg, 2)}kg` : f.etiqueta}
                          </Badge>
                        ))}
                        {(formatos.get(i.product_id) ?? []).length === 0 && (
                          <span className="text-xs text-zinc-300">sin formatos</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" className="h-7 text-xs"
                        onClick={() => abrirEtiquetas(i)}>
                        <Printer size={12} className="mr-1" />
                        Etiquetas
                      </Button>
                    </TableCell>
                  </TableRow>

                  {/* Panel de etiquetas del producto. Se despliega debajo de su
                      fila para no perder de vista de cuál se está hablando. */}
                  {etiquetaDe === i.product_id && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-amber-50 border-y border-amber-200">
                        <div className="flex flex-wrap items-end gap-4 py-1">
                          <div>
                            <label className="block text-[11px] font-medium text-amber-800 uppercase tracking-wide mb-1">
                              Formato del paquete
                            </label>
                            <select
                              value={fmtSel}
                              onChange={e => setFmtSel(e.target.value)}
                              className="border border-amber-300 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                            >
                              {(formatos.get(i.product_id) ?? []).map(f => (
                                <option key={f.sku} value={f.sku}>
                                  {f.etiqueta === 'Bulto cerrado' ? `Bulto ${formatNum(f.kg, 2)} kg` : f.etiqueta}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-amber-800 uppercase tracking-wide mb-1">
                              Cuántas
                            </label>
                            <input
                              type="number" min={1} max={200}
                              value={cantEtq}
                              onChange={e => setCantEtq(Math.max(1, Math.min(200, parseInt(e.target.value) || 1)))}
                              className="w-20 border border-amber-300 rounded px-2 py-1 text-sm bg-white text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-amber-400"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-amber-800 uppercase tracking-wide mb-1">
                              Vencimiento
                            </label>
                            <input
                              type="date"
                              value={vencEtq}
                              onChange={e => setVencEtq(e.target.value)}
                              className={`border rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 ${
                                vencEtq ? 'border-amber-300' : 'border-amber-500'
                              }`}
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            <Button size="sm" className="h-8 bg-amber-600 hover:bg-amber-700 text-white"
                              disabled={imprimiendo}
                              onClick={() => imprimirEtiquetas(i, false)}>
                              <Printer size={13} className="mr-1" />
                              {imprimiendo ? 'Generando...' : 'Imprimir'}
                            </Button>
                            <Button size="sm" variant="outline" className="h-8"
                              disabled={imprimiendo}
                              onClick={() => imprimirEtiquetas(i, true)}>
                              Descargar
                            </Button>
                          </div>

                          <p className="text-[11px] text-amber-700 basis-full">
                            {vencPorProducto.has(i.product_id)
                              ? 'La fecha viene del vencimiento más próximo cargado en la recepción. Podés cambiarla.'
                              : 'Todavía no hay recepciones cargadas para este producto, así que la fecha va a mano.'}
                            {' '}Etiqueta de 100 × 150 mm — imprimir a tamaño real, sin ajustar a la hoja.
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Pedidos */}
      <div className="space-y-2.5">
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Pedidos</h2>
        {pedidos.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center">
            <p className="text-sm text-zinc-500">Todavía no entró ningún pedido</p>
            <p className="text-xs text-zinc-400 mt-1">
              Cuando se publiquen los frutos secos, los pedidos van a aparecer acá apenas los avise La Pyme.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-zinc-50">
                    <TableHead>Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pedidos.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.number ?? p.id.slice(0, 8)}</TableCell>
                      <TableCell className="text-sm">{p.customer?.name ?? '—'}</TableCell>
                      <TableCell className="text-center">
                        <Badge className="bg-zinc-100 text-zinc-600 border-zinc-200">{p.status ?? '—'}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {p.total != null ? `$${formatNum(centavosAPesos(p.total), 0)}` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

function Resumen({ label, valor, nota }: { label: string; valor: string; nota?: string }) {
  return (
    <div className="bg-white rounded-lg border border-zinc-200 px-4 py-3">
      <p className="text-xl font-bold text-zinc-800 leading-none tabular-nums">{valor}</p>
      <p className="text-[11px] text-zinc-500 mt-1.5 leading-tight">{label}</p>
      {nota && <p className="text-[10px] text-zinc-400 mt-0.5 leading-tight">{nota}</p>}
    </div>
  )
}
