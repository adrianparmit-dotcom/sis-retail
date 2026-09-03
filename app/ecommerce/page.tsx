'use client'

/**
 * Ecommerce Shuk — estado de la conexión con La Pyme.
 *
 * Primera pantalla de la línea de granel. Todavía no opera nada: sirve para ver
 * que los datos del ERP llegan y para elegir con qué depósito trabaja la línea.
 * Cuando estén cargados los frutos secos, de acá salen las pantallas de
 * recepción, stock y preparación de pedidos.
 */

import { useEffect, useState, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatNum, toTitleCase } from '@/lib/format'
import { matchesQuery } from '@/lib/search'
import {
  lapymeGet, LapymeApiError, centavosAPesos,
  type LapymeLista, type Deposito, type ItemInventario, type RespuestaInventario, type Pedido,
} from '@/lib/lapyme'

/** Guarda el depósito elegido para no volver a elegirlo en cada visita. */
const CLAVE_DEPOSITO = 'ecommerce.depositoId'

export default function EcommercePage() {
  const [depositos, setDepositos] = useState<Deposito[]>([])
  const [depositoId, setDepositoId] = useState<string>('')
  const [items, setItems] = useState<ItemInventario[]>([])
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
      const inv = await lapymeGet<RespuestaInventario>('inventory', { warehouse_id: id, limit: 100 })
      setItems(inv.data?.items ?? [])
      setError(null)
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

  const visibles = busqueda
    ? items.filter(i => matchesQuery(busqueda, i.product_name, i.sku ?? ''))
    : items

  const conStock = items.filter(i => i.stock.available !== 0).length
  const reservados = items.reduce((s, i) => s + (i.stock.reserved || 0), 0)

  return (
    <div className="p-6 space-y-6 max-w-6xl">

      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Ecommerce Shuk</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Línea de granel de shuk.ar · datos en vivo de La Pyme
        </p>
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
          <Resumen label="Productos" valor={cargando ? '—' : formatNum(items.length, 0)} />
          <Resumen label="Con stock" valor={cargando ? '—' : formatNum(conStock, 0)} />
          <Resumen label="Reservados" valor={cargando ? '—' : formatNum(reservados, 0)}
            nota="unidades comprometidas" />
          <Resumen label="Pedidos" valor={cargando ? '—' : formatNum(pedidos.length, 0)}
            nota={pedidos.length === 0 ? 'ninguno todavía' : 'últimos 20'} />
        </div>
      )}

      {/* Inventario */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
            Inventario del depósito
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
                  <TableHead>Categoría</TableHead>
                  <TableHead className="text-right">Disponible</TableHead>
                  <TableHead className="text-right">Reservado</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cargando ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-zinc-400 py-12">Cargando...</TableCell></TableRow>
                ) : visibles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12">
                      <p className="text-zinc-400">
                        {items.length === 0 ? 'El depósito no tiene productos cargados' : 'Sin coincidencias'}
                      </p>
                    </TableCell>
                  </TableRow>
                ) : visibles.map(i => (
                  <TableRow key={i.product_id} className="hover:bg-zinc-50">
                    <TableCell className="font-mono text-xs text-zinc-500">{i.sku ?? '—'}</TableCell>
                    <TableCell className="text-sm">{toTitleCase(i.product_name)}</TableCell>
                    <TableCell className="text-xs text-zinc-500">{i.category?.name ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {/* El ERP admite existencias negativas: se deja ver, en rojo,
                          porque es justo lo que la línea nueva no debería repetir. */}
                      <span className={i.stock.available < 0 ? 'text-red-600 font-semibold' : 'text-zinc-700'}>
                        {formatNum(i.stock.available, 2)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-zinc-500">
                      {i.stock.reserved ? formatNum(i.stock.reserved, 2) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-zinc-500">
                      ${formatNum(centavosAPesos(i.price), 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        {!cargando && items.length >= 100 && (
          <p className="text-[11px] text-zinc-400">
            Se muestran los primeros 100. La paginación completa entra cuando la línea tenga catálogo propio.
          </p>
        )}
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
