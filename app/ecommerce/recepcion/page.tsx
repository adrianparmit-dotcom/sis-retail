'use client'

/**
 * Recepción de bultos de la línea de granel.
 *
 * Cada bulto entra como un lote propio. Dos bultos del mismo producto con
 * vencimientos distintos son dos lotes, no uno de 50 kg: si se sumaran, no se
 * podría decir qué vencimiento se le mandó al cliente.
 *
 * Los kilos que se cargan son los REALES, no los del envase. Si el bulto dice
 * 25 kg y la balanza marca 24,6, van 24,6 — el modelo entero descansa en que el
 * disponible sea de verdad.
 */

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatNum, formatDate, hoyISO, toTitleCase } from '@/lib/format'

interface Producto { id: string; nombre: string; kg_por_bulto: number; activo: boolean }

interface Lote {
  id: string
  producto_id: string
  kg_recibidos: number
  kg_disponibles: number
  fecha_vencimiento: string
  numero_lote: string | null
  proveedor: string | null
  costo_por_kg: number | null
  fecha_recepcion: string
  estado: string
}

export default function RecepcionEcommercePage() {
  const [productos, setProductos] = useState<Producto[]>([])
  const [lotes, setLotes] = useState<Lote[]>([])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  const [productoId, setProductoId] = useState('')
  const [kg, setKg] = useState('')
  const [vence, setVence] = useState('')
  const [numeroLote, setNumeroLote] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [costoKg, setCostoKg] = useState('')

  const cargar = useCallback(async () => {
    const [prodRes, loteRes] = await Promise.all([
      supabase.from('ecom_productos').select('id,nombre,kg_por_bulto,activo').eq('activo', true).order('nombre'),
      supabase.from('ecom_lotes').select('*').order('fecha_recepcion', { ascending: false }).limit(60),
    ])
    setProductos((prodRes.data ?? []) as Producto[])
    setLotes((loteRes.data ?? []) as Lote[])
    setCargando(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const productoElegido = productos.find(p => p.id === productoId)

  /** Al elegir producto se propone el peso del bulto, editable. */
  function elegirProducto(id: string) {
    setProductoId(id)
    const p = productos.find(x => x.id === id)
    if (p && !kg) setKg(String(p.kg_por_bulto))
  }

  async function recibir() {
    const kgNum = Number(kg.replace(',', '.'))
    const costo  = costoKg.trim() ? Number(costoKg.replace(',', '.')) : null

    if (!productoId)                          { toast.error('Elegí qué producto entró'); return }
    if (!Number.isFinite(kgNum) || kgNum <= 0) { toast.error('Poné cuántos kilos entraron'); return }
    if (!vence)                               { toast.error('Falta la fecha de vencimiento'); return }
    if (costo !== null && (!Number.isFinite(costo) || costo < 0)) {
      toast.error('El costo por kilo no es un número válido'); return
    }

    setGuardando(true)
    try {
      const { data, error } = await supabase.from('ecom_lotes').insert({
        producto_id      : productoId,
        kg_recibidos     : kgNum,
        kg_disponibles   : kgNum,
        fecha_vencimiento: vence,
        numero_lote      : numeroLote.trim() || null,
        proveedor        : proveedor.trim() || null,
        costo_por_kg     : costo,
      }).select('id').single()
      if (error) throw new Error(error.message)

      // El movimiento de entrada deja el libro mayor cuadrado desde el arranque:
      // kg_disponibles tiene que poder reconstruirse sumando los movimientos.
      const { error: e2 } = await supabase.from('ecom_movimientos').insert({
        lote_id: (data as { id: string }).id,
        tipo   : 'recepcion',
        kg     : kgNum,
        nota   : proveedor.trim() || null,
      })
      if (e2) throw new Error(e2.message)

      toast.success(`${formatNum(kgNum, 2)} kg de ${toTitleCase(productoElegido?.nombre ?? '')} recibidos`)
      setKg(''); setVence(''); setNumeroLote(''); setCostoKg('')
      cargar()
    } catch (err) {
      toast.error('No se pudo guardar: ' + (err as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  const nombrePorId = new Map(productos.map(p => [p.id, p.nombre]))

  return (
    <div className="p-6 space-y-6 max-w-5xl">

      <div>
        <Link href="/ecommerce" className="text-zinc-400 hover:text-zinc-700 text-sm">← Ecommerce Shuk</Link>
        <h1 className="text-xl font-semibold text-zinc-900 mt-1">Recepción de bultos</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          Cada bulto entra como un lote con su propio vencimiento
        </p>
      </div>

      {productos.length === 0 && !cargando ? (
        <div className="rounded-lg border border-dashed border-zinc-200 bg-white p-12 text-center">
          <p className="text-sm text-zinc-500">No hay productos activos en la línea</p>
          <p className="text-xs text-zinc-400 mt-1">
            Cargalos primero en <Link href="/ecommerce/catalogo" className="text-indigo-600 underline">Catálogo</Link>.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <p className="text-xs font-semibold text-zinc-700">Registrar lo que entró</p>

          <div>
            <label className="text-[11px] text-zinc-500 block mb-1">Producto</label>
            <Select value={productoId} onValueChange={v => elegirProducto(v ?? '')}>
              <SelectTrigger className="h-9">
                <SelectValue>
                  {productoElegido ? toTitleCase(productoElegido.nombre) : 'Elegir producto'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {productos.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {toTitleCase(p.nombre)} · bulto {formatNum(p.kg_por_bulto, 0)} kg
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label className="text-[11px] text-zinc-500 block mb-1">Kilos reales</label>
              <Input type="number" min={0} step="0.01" value={kg}
                onChange={e => setKg(e.target.value)} className="h-9" placeholder="25" />
            </div>
            <div>
              <label className="text-[11px] text-zinc-500 block mb-1">Vence</label>
              <Input type="date" value={vence} min={hoyISO()}
                onChange={e => setVence(e.target.value)} className="h-9" />
            </div>
            <div>
              <label className="text-[11px] text-zinc-500 block mb-1">Lote del proveedor</label>
              <Input value={numeroLote} onChange={e => setNumeroLote(e.target.value)}
                className="h-9" placeholder="opcional" />
            </div>
            <div>
              <label className="text-[11px] text-zinc-500 block mb-1">Costo por kg</label>
              <Input type="number" min={0} step="0.01" value={costoKg}
                onChange={e => setCostoKg(e.target.value)} className="h-9" placeholder="opcional" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
            <div>
              <label className="text-[11px] text-zinc-500 block mb-1">Proveedor</label>
              <Input value={proveedor} onChange={e => setProveedor(e.target.value)}
                className="h-9" placeholder="opcional" />
            </div>
            <Button onClick={recibir} disabled={guardando} className="h-9">
              {guardando ? 'Guardando...' : 'Recibir bulto'}
            </Button>
          </div>

          {productoElegido && Number(kg) > 0 && Number(kg) !== productoElegido.kg_por_bulto && (
            <p className="text-[11px] text-amber-700">
              El bulto de {toTitleCase(productoElegido.nombre)} debería traer{' '}
              {formatNum(productoElegido.kg_por_bulto, 2)} kg y estás cargando {formatNum(Number(kg), 2)}.
              Si eso es lo que marcó la balanza, está bien: se guarda lo real.
            </p>
          )}
        </div>
      )}

      {/* Lotes recibidos */}
      <div className="space-y-2.5">
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Últimos lotes</h2>
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50">
                  <TableHead>Producto</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead className="text-center">Recibido</TableHead>
                  <TableHead className="text-right">Entraron</TableHead>
                  <TableHead className="text-right">Quedan</TableHead>
                  <TableHead className="text-center">Vence</TableHead>
                  <TableHead className="text-center">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cargando ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-zinc-400 py-12">Cargando...</TableCell></TableRow>
                ) : lotes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-zinc-400">
                      Todavía no se recibió ningún bulto
                    </TableCell>
                  </TableRow>
                ) : lotes.map(l => (
                  <TableRow key={l.id} className="hover:bg-zinc-50">
                    <TableCell className="text-sm">{toTitleCase(nombrePorId.get(l.producto_id) ?? '—')}</TableCell>
                    <TableCell className="font-mono text-xs text-zinc-500">{l.numero_lote ?? '—'}</TableCell>
                    <TableCell className="text-center text-xs text-zinc-500">{formatDate(l.fecha_recepcion)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-zinc-500">{formatNum(l.kg_recibidos, 2)} kg</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">{formatNum(l.kg_disponibles, 2)} kg</TableCell>
                    <TableCell className="text-center text-xs text-zinc-500">{formatDate(l.fecha_vencimiento)}</TableCell>
                    <TableCell className="text-center">
                      <Badge className={l.estado === 'abierto'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-zinc-100 text-zinc-500 border-zinc-200'}>
                        {l.estado === 'abierto' ? 'Abierto' : 'Cerrado'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

    </div>
  )
}
