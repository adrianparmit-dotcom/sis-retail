'use client'

/**
 * /precios/blisters — Blisters y su unidad
 *
 * En Dux la UNIDAD es el "producto compuesto" y el BLISTER es el producto
 * simple que tiene el stock real: vender una unidad le descuenta stock al
 * blister. La API de Dux deja saber CUÁLES items son compuestos
 * (`tipo_item=COMPUESTO`) pero NO de qué están compuestos, así que el par y la
 * cantidad de unidades se administran acá.
 *
 * El precio del blister se deriva del de la unidad, con la bonificación por
 * llevarlo cerrado:
 *     precio_blister = redondeo100( precio_unidad × unidades × (1 − 20%) )
 *
 * Nada se manda a Dux sin que alguien lo revise y lo confirme desde esta
 * pantalla: un vínculo o una cantidad mal puesta mueve un precio de góndola.
 */

import { useEffect, useState, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Link2, Link2Off, Loader2, Search, Send, X } from 'lucide-react'
import { calcPrecioBlister } from '@/lib/invoice-parsers'
import { DESCUENTO_BLISTER } from '@/lib/constants'
import { formatNum } from '@/lib/format'
import { matchesQuery } from '@/lib/search'

/** Los precios ya vienen redondeados de a 100, así que van sin decimales. */
const fmtMoneda = (n: number): string => `$${formatNum(n, 0)}`

// ─── Types ───────────────────────────────────────────────────────────

interface ProductoRow {
  id                  : string
  sku                 : string
  nombre              : string
  precio_venta        : number | null
  estado              : string
  es_compuesto_dux    : boolean
  blister_producto_id : string | null
  unidades_por_blister: number | null
}

type Filtro = 'listos' | 'falta_cantidad' | 'sin_blister' | 'todos'

const FILTRO_LABEL: Record<Filtro, string> = {
  listos        : 'Listos',
  falta_cantidad: 'Falta la cantidad',
  sin_blister   : 'Sin blister',
  todos         : 'Todos',
}

/** Fila armada: la unidad con su blister resuelto y el precio que le corresponde. */
interface Par {
  unidad      : ProductoRow
  blister     : ProductoRow | null
  unidades    : number | null
  precioNuevo : number      // 0 si todavía no se puede calcular
  precioActual: number
  aplicable   : boolean     // hay precio nuevo y difiere del actual
}

export default function BlistersPage() {
  const [productos, setProductos] = useState<ProductoRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [filtro, setFiltro]       = useState<Filtro>('falta_cantidad')
  const [busqueda, setBusqueda]   = useState('')
  const [guardando, setGuardando] = useState<string | null>(null)
  const [enviando, setEnviando]   = useState(false)
  const [vinculando, setVinculando] = useState<string | null>(null)
  const [busquedaBlister, setBusquedaBlister] = useState('')

  // ── Carga ──────────────────────────────────────────────────────

  const cargar = useCallback(async () => {
    setLoading(true)
    // El catálogo pasa las 1000 filas del límite de PostgREST, así que se trae
    // paginado. Un select plano devolvía solo el primer tramo y faltaban pares.
    const PAGE = 1000
    const filas: ProductoRow[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('productos')
        .select('id, sku, nombre, precio_venta, estado, es_compuesto_dux, blister_producto_id, unidades_por_blister')
        .order('nombre')
        .range(from, from + PAGE - 1)
      if (error) { toast.error('No se pudo cargar el catálogo: ' + error.message); break }
      const page = (data ?? []) as ProductoRow[]
      filas.push(...page)
      if (page.length < PAGE) break
    }
    setProductos(filas)
    setLoading(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const porId = useMemo(
    () => new Map(productos.map(p => [p.id, p])),
    [productos],
  )

  /** Blisters del catálogo, para el buscador de vinculación. */
  const blisters = useMemo(
    () => productos.filter(p => /^BLISTER\s/i.test(p.nombre) && p.estado === 'activo'),
    [productos],
  )

  /** Blisters ya tomados por otra unidad — no se pueden asignar dos veces. */
  const blistersTomados = useMemo(
    () => new Set(productos.map(p => p.blister_producto_id).filter(Boolean) as string[]),
    [productos],
  )

  // ── Armado de pares ────────────────────────────────────────────

  const pares = useMemo<Par[]>(() => {
    return productos
      .filter(p => p.es_compuesto_dux || p.blister_producto_id !== null)
      .map(unidad => {
        const blister      = unidad.blister_producto_id ? porId.get(unidad.blister_producto_id) ?? null : null
        const unidades     = unidad.unidades_por_blister
        const precioUnidad = unidad.precio_venta ?? 0
        const precioActual = blister?.precio_venta ?? 0
        const precioNuevo  = blister && unidades && precioUnidad > 0
          ? calcPrecioBlister(precioUnidad, unidades)
          : 0
        return {
          unidad, blister, unidades, precioNuevo, precioActual,
          aplicable: precioNuevo > 0 && precioNuevo !== precioActual,
        }
      })
  }, [productos, porId])

  const conteos = useMemo(() => ({
    listos        : pares.filter(p => p.blister && p.unidades).length,
    falta_cantidad: pares.filter(p => p.blister && !p.unidades).length,
    sin_blister   : pares.filter(p => !p.blister).length,
    todos         : pares.length,
  }), [pares])

  const visibles = useMemo(() => {
    const porFiltro = pares.filter(p => {
      if (filtro === 'listos')         return p.blister !== null && p.unidades !== null
      if (filtro === 'falta_cantidad') return p.blister !== null && p.unidades === null
      if (filtro === 'sin_blister')    return p.blister === null
      return true
    })
    if (!busqueda.trim()) return porFiltro
    return porFiltro.filter(p =>
      matchesQuery(busqueda, `${p.unidad.sku} ${p.unidad.nombre} ${p.blister?.sku ?? ''} ${p.blister?.nombre ?? ''}`)
    )
  }, [pares, filtro, busqueda])

  const aplicables = useMemo(() => visibles.filter(p => p.aplicable), [visibles])

  // ── Mutaciones ─────────────────────────────────────────────────

  async function guardarUnidades(unidadId: string, valor: string) {
    const n = parseInt(valor, 10)
    const nuevo = Number.isFinite(n) && n > 0 ? n : null
    const actual = porId.get(unidadId)?.unidades_por_blister ?? null
    if (nuevo === actual) return
    setGuardando(unidadId)
    const { error } = await supabase.from('productos')
      .update({ unidades_por_blister: nuevo, updated_at: new Date().toISOString() })
      .eq('id', unidadId)
    setGuardando(null)
    if (error) { toast.error('No se pudo guardar: ' + error.message); return }
    setProductos(prev => prev.map(p => p.id === unidadId ? { ...p, unidades_por_blister: nuevo } : p))
  }

  async function vincular(unidadId: string, blisterId: string | null) {
    setGuardando(unidadId)
    const { error } = await supabase.from('productos')
      .update({ blister_producto_id: blisterId, updated_at: new Date().toISOString() })
      .eq('id', unidadId)
    setGuardando(null)
    if (error) { toast.error('No se pudo vincular: ' + error.message); return }
    setProductos(prev => prev.map(p => p.id === unidadId ? { ...p, blister_producto_id: blisterId } : p))
    setVinculando(null)
    setBusquedaBlister('')
    toast.success(blisterId ? 'Blister vinculado' : 'Vínculo quitado')
  }

  /**
   * Manda los precios nuevos de los blisters a Dux.
   * Dux es dueño del precio: se escribe allá y `dux-sync` lo trae de vuelta.
   * Igual se refleja acá para que la pantalla no siga mostrando la diferencia.
   */
  async function enviarADux() {
    if (aplicables.length === 0) return
    const ok = window.confirm(
      `Se van a actualizar ${aplicables.length} precios de blister en Dux.\n\n` +
      'Los precios de las unidades no se tocan. ¿Confirmás?'
    )
    if (!ok) return
    setEnviando(true)
    try {
      const items = aplicables
        .filter(p => p.blister !== null)
        .map(p => ({ codigo: p.blister!.sku, importe: p.precioNuevo }))
      const res = await fetch('/api/dux/precios', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ items }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(j.error ?? `Error ${res.status}`)
      }
      const aplicados = new Map(aplicables.map(p => [p.blister!.id, p.precioNuevo]))
      setProductos(prev => prev.map(p =>
        aplicados.has(p.id) ? { ...p, precio_venta: aplicados.get(p.id)! } : p
      ))
      toast.success(`${items.length} precios enviados a Dux`)
    } catch (err) {
      toast.error('No se pudieron enviar: ' + (err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────

  const candidatosBlister = useMemo(() => {
    if (!vinculando) return []
    const q = busquedaBlister.trim()
    return blisters
      .filter(b => !blistersTomados.has(b.id))
      .filter(b => !q || matchesQuery(q, `${b.sku} ${b.nombre}`))
      .slice(0, 12)
  }, [vinculando, busquedaBlister, blisters, blistersTomados])

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Blisters y su unidad</h1>
        <p className="text-sm text-zinc-500 mt-1">
          El blister es el producto con stock real; la unidad le descuenta al venderse.
          El precio del blister sale del de la unidad con{' '}
          <strong>{Math.round(DESCUENTO_BLISTER * 100)}% de bonificación</strong> por llevarlo cerrado.
          El redondeo de a 100 se aplica en la <strong>unidad</strong>, que es lo que se vende
          al público; el blister queda al peso.
        </p>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        {(Object.keys(FILTRO_LABEL) as Filtro[]).map(f => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
              filtro === f
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
            }`}
          >
            {FILTRO_LABEL[f]} <span className="tabular-nums opacity-70">({conteos[f]})</span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <Input
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar producto o SKU…"
            className="pl-8 w-64"
          />
        </div>
        <Button onClick={() => void enviarADux()} disabled={enviando || aplicables.length === 0} className="gap-2">
          {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Enviar {aplicables.length} precios a Dux
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500 py-8 text-center">Cargando catálogo…</p>
      ) : visibles.length === 0 ? (
        <p className="text-sm text-zinc-500 py-8 text-center">No hay productos en este filtro.</p>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidad</TableHead>
                <TableHead className="text-right w-28">P. unidad</TableHead>
                <TableHead className="text-center w-24">Unidades</TableHead>
                <TableHead>Blister</TableHead>
                <TableHead className="text-right w-28">P. actual</TableHead>
                <TableHead className="text-right w-28">P. nuevo</TableHead>
                <TableHead className="text-right w-24">Dif.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map(par => {
                const diff = par.precioNuevo > 0 && par.precioActual > 0
                  ? par.precioNuevo - par.precioActual
                  : null
                return (
                  <TableRow key={par.unidad.id} className={par.aplicable ? 'bg-amber-50/40' : undefined}>
                    <TableCell>
                      <div className="text-sm">{par.unidad.nombre}</div>
                      <div className="text-xs text-zinc-400 tabular-nums">{par.unidad.sku}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {par.unidad.precio_venta ? fmtMoneda(par.unidad.precio_venta) : (
                        <span className="text-red-500 text-xs">sin precio</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Input
                        type="number" min="2" max="100"
                        defaultValue={par.unidades ?? ''}
                        placeholder="—"
                        disabled={guardando === par.unidad.id}
                        onBlur={e => void guardarUnidades(par.unidad.id, e.target.value)}
                        className="w-16 text-center tabular-nums mx-auto"
                      />
                    </TableCell>
                    <TableCell>
                      {par.blister ? (
                        <div className="flex items-start gap-2">
                          <div className="min-w-0">
                            <div className="text-sm truncate">{par.blister.nombre}</div>
                            <div className="text-xs text-zinc-400 tabular-nums">{par.blister.sku}</div>
                          </div>
                          <button
                            onClick={() => void vincular(par.unidad.id, null)}
                            title="Quitar el vínculo"
                            className="text-zinc-300 hover:text-red-500 shrink-0 mt-0.5"
                          >
                            <Link2Off size={14} />
                          </button>
                        </div>
                      ) : vinculando === par.unidad.id ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1">
                            <Input
                              autoFocus
                              value={busquedaBlister}
                              onChange={e => setBusquedaBlister(e.target.value)}
                              placeholder="Buscar blister…"
                              className="h-8 text-xs"
                            />
                            <button onClick={() => { setVinculando(null); setBusquedaBlister('') }} className="text-zinc-400 hover:text-zinc-700">
                              <X size={14} />
                            </button>
                          </div>
                          <div className="max-h-40 overflow-y-auto border rounded bg-white">
                            {candidatosBlister.length === 0 ? (
                              <p className="text-xs text-zinc-400 p-2">Sin blisters libres que coincidan.</p>
                            ) : candidatosBlister.map(b => (
                              <button
                                key={b.id}
                                onClick={() => void vincular(par.unidad.id, b.id)}
                                className="block w-full text-left px-2 py-1 text-xs hover:bg-zinc-100"
                              >
                                <span className="tabular-nums text-zinc-400 mr-1">{b.sku}</span>{b.nombre}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm" variant="outline"
                          onClick={() => { setVinculando(par.unidad.id); setBusquedaBlister('') }}
                          className="gap-1 h-7 text-xs"
                        >
                          <Link2 size={12} /> Vincular blister
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-zinc-500">
                      {par.precioActual > 0 ? fmtMoneda(par.precioActual) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {par.precioNuevo > 0 ? fmtMoneda(par.precioNuevo) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {diff === null || diff === 0 ? (
                        <span className="text-zinc-300 text-xs">—</span>
                      ) : (
                        <Badge variant="outline" className={diff > 0 ? 'text-emerald-700 border-emerald-200' : 'text-red-700 border-red-200'}>
                          {diff > 0 ? '+' : ''}{fmtMoneda(diff)}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
