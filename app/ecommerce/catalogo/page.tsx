'use client'

/**
 * Catálogo de la línea de granel.
 *
 * Define qué productos se venden, cuántos kilos trae el bulto que se le compra
 * al proveedor y en qué formatos sale. Los formatos NO son stock: son maneras
 * de sacar del pool de kilos, y su disponible se calcula.
 *
 * El id de La Pyme queda pendiente hasta que se defina el catálogo del ERP.
 * Funciona igual si allá los formatos son productos separados o variantes de
 * uno solo: en los dos casos cada formato apunta a un product_id.
 */

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { formatNum, toTitleCase } from '@/lib/format'
import { ECOM_FORMATOS_SUGERIDOS } from '@/lib/constants'
import { Trash2, Plus } from 'lucide-react'

interface Formato {
  id: string
  producto_id: string
  nombre: string
  kg: number
  es_bulto_cerrado: boolean
  lapyme_product_id: string | null
  activo: boolean
}

interface Producto {
  id: string
  nombre: string
  kg_por_bulto: number
  lapyme_product_id: string | null
  activo: boolean
}

export default function CatalogoPage() {
  const [productos, setProductos] = useState<Producto[]>([])
  const [formatos, setFormatos] = useState<Formato[]>([])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [aBorrar, setABorrar] = useState<Producto | null>(null)

  // Alta de producto
  const [nombre, setNombre] = useState('')
  const [kgBulto, setKgBulto] = useState('')

  const cargar = useCallback(async () => {
    const [prodRes, fmtRes] = await Promise.all([
      supabase.from('ecom_productos').select('*').order('nombre'),
      supabase.from('ecom_formatos').select('*').order('kg'),
    ])
    setProductos((prodRes.data ?? []) as Producto[])
    setFormatos((fmtRes.data ?? []) as Formato[])
    setCargando(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function crearProducto() {
    const kg = Number(kgBulto)
    if (!nombre.trim())               { toast.error('Poné el nombre del producto'); return }
    if (!Number.isFinite(kg) || kg <= 0) { toast.error('Poné cuántos kilos trae el bulto'); return }

    setGuardando(true)
    try {
      const { data, error } = await supabase.from('ecom_productos')
        .insert({ nombre: nombre.trim(), kg_por_bulto: kg })
        .select('id').single()
      if (error) throw new Error(error.message)

      const prodId = (data as { id: string }).id

      // Se crean los formatos sugeridos que entren en el bulto, más el bulto
      // cerrado. Los que no entran no tienen sentido: no se puede vender un
      // paquete de 10 kg de un bulto de 5.
      const filas = [
        ...ECOM_FORMATOS_SUGERIDOS
          .filter(f => f.kg <= kg)
          .map(f => ({ producto_id: prodId, nombre: f.nombre, kg: f.kg, es_bulto_cerrado: false })),
        { producto_id: prodId, nombre: `Bulto cerrado ${formatNum(kg, 0)} kg`, kg, es_bulto_cerrado: true },
      ]
      // Si el bulto coincide con un formato sugerido, el UNIQUE (producto, kg)
      // rechazaría el duplicado: gana el bulto cerrado.
      const vistos = new Set<number>()
      const sinDuplicar = filas.reverse().filter(f => {
        if (vistos.has(f.kg)) return false
        vistos.add(f.kg); return true
      }).reverse()

      const { error: e2 } = await supabase.from('ecom_formatos').insert(sinDuplicar)
      if (e2) throw new Error(e2.message)

      toast.success(`${toTitleCase(nombre.trim())} creado con ${sinDuplicar.length} formatos`)
      setNombre(''); setKgBulto('')
      cargar()
    } catch (err) {
      toast.error('No se pudo crear: ' + (err as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  async function agregarFormato(p: Producto) {
    const txt = window.prompt(`¿De cuántos kilos es el formato nuevo de ${toTitleCase(p.nombre)}?`)
    if (txt === null) return
    const kg = Number(txt.replace(',', '.'))
    if (!Number.isFinite(kg) || kg <= 0) { toast.error('Ese número no sirve'); return }
    if (kg > p.kg_por_bulto) {
      toast.error(`No entra: el bulto trae ${formatNum(p.kg_por_bulto, 2)} kg`)
      return
    }
    const { error } = await supabase.from('ecom_formatos').insert({
      producto_id: p.id, nombre: `${formatNum(kg, kg % 1 === 0 ? 0 : 2)} kg`, kg, es_bulto_cerrado: false,
    })
    if (error) {
      toast.error(error.message.includes('duplicate') ? 'Ya existe un formato de esos kilos' : error.message)
      return
    }
    cargar()
  }

  async function borrarFormato(f: Formato) {
    const { error } = await supabase.from('ecom_formatos').delete().eq('id', f.id)
    if (error) { toast.error('No se pudo borrar: ' + error.message); return }
    cargar()
  }

  async function guardarLapymeId(f: Formato, valor: string) {
    const limpio = valor.trim() || null
    if (limpio === f.lapyme_product_id) return
    const { error } = await supabase.from('ecom_formatos')
      .update({ lapyme_product_id: limpio }).eq('id', f.id)
    if (error) { toast.error('No se pudo guardar: ' + error.message); return }
    setFormatos(prev => prev.map(x => x.id === f.id ? { ...x, lapyme_product_id: limpio } : x))
  }

  async function borrarProducto() {
    if (!aBorrar) return
    // Los lotes tienen ON DELETE RESTRICT: si ya se recibió mercadería, la base
    // frena el borrado y el producto queda. Es la protección que queremos.
    const { error } = await supabase.from('ecom_productos').delete().eq('id', aBorrar.id)
    if (error) {
      toast.error('No se puede borrar: ya tiene lotes recibidos. Desactivalo en vez de borrarlo.')
      setABorrar(null)
      return
    }
    toast.success('Producto borrado')
    setABorrar(null)
    cargar()
  }

  async function alternarActivo(p: Producto) {
    const { error } = await supabase.from('ecom_productos')
      .update({ activo: !p.activo, updated_at: new Date().toISOString() }).eq('id', p.id)
    if (error) { toast.error(error.message); return }
    setProductos(prev => prev.map(x => x.id === p.id ? { ...x, activo: !x.activo } : x))
  }

  const sinMapear = formatos.filter(f => !f.lapyme_product_id).length

  return (
    <div className="p-6 space-y-6 max-w-5xl">

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/ecommerce" className="text-zinc-400 hover:text-zinc-700 text-sm">← Ecommerce Shuk</Link>
          <h1 className="text-xl font-semibold text-zinc-900 mt-1">Catálogo de granel</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Qué se vende, cuántos kilos trae el bulto y en qué formatos sale
          </p>
        </div>
      </div>

      {/* Alta */}
      <div className="bg-white rounded-lg border p-4 space-y-3">
        <p className="text-xs font-semibold text-zinc-700">Agregar producto</p>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
          <div>
            <label className="text-[11px] text-zinc-500 block mb-1">Producto</label>
            <Input value={nombre} onChange={e => setNombre(e.target.value)}
              placeholder="Ej: Almendra Non Pareil" className="h-9" />
          </div>
          <div>
            <label className="text-[11px] text-zinc-500 block mb-1">Kg por bulto</label>
            <Input type="number" min={0} step="0.01" value={kgBulto}
              onChange={e => setKgBulto(e.target.value)} placeholder="25" className="h-9 w-32" />
          </div>
          <Button onClick={crearProducto} disabled={guardando} className="h-9">
            {guardando ? 'Creando...' : 'Crear'}
          </Button>
        </div>
        <p className="text-[11px] text-zinc-400">
          Se crean los formatos de 1, 3, 5 y 10 kg que entren en el bulto, más el bulto cerrado.
          Después se agregan o sacan de a uno.
        </p>
      </div>

      {sinMapear > 0 && productos.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">
            <strong>{sinMapear}</strong> formato{sinMapear === 1 ? '' : 's'} sin id de La Pyme.
          </p>
          <p className="text-xs text-amber-700 mt-0.5">
            Hasta que se complete no se les puede publicar el stock. Se carga cuando esté definido el
            catálogo del ERP.
          </p>
        </div>
      )}

      {/* Productos */}
      {cargando ? (
        <p className="text-sm text-zinc-400 py-12 text-center">Cargando...</p>
      ) : productos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 bg-white p-12 text-center">
          <p className="text-sm text-zinc-500">Todavía no hay productos en la línea</p>
          <p className="text-xs text-zinc-400 mt-1">Agregá el primero con el formulario de arriba.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {productos.map(p => {
            const fmts = formatos.filter(f => f.producto_id === p.id)
            return (
              <div key={p.id} className={`bg-white rounded-lg border p-4 ${p.activo ? '' : 'opacity-60'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-zinc-900">{toTitleCase(p.nombre)}</h3>
                      {!p.activo && <Badge className="bg-zinc-100 text-zinc-500 border-zinc-200">Inactivo</Badge>}
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Bulto de {formatNum(p.kg_por_bulto, 2)} kg · {fmts.length} formato{fmts.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="text-xs h-7"
                      onClick={() => agregarFormato(p)}>
                      <Plus size={12} className="mr-1" /> Formato
                    </Button>
                    <Button variant="outline" size="sm" className="text-xs h-7"
                      onClick={() => alternarActivo(p)}>
                      {p.activo ? 'Desactivar' : 'Activar'}
                    </Button>
                    <button onClick={() => setABorrar(p)}
                      className="text-zinc-300 hover:text-red-500 p-1" title="Borrar producto">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[34rem]">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-zinc-400 border-b">
                        <th className="text-left font-medium py-1.5">Formato</th>
                        <th className="text-right font-medium py-1.5 w-20">Kg</th>
                        <th className="text-left font-medium py-1.5 pl-4">Id en La Pyme</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {fmts.map(f => (
                        <tr key={f.id} className="border-b last:border-b-0">
                          <td className="py-1.5">
                            {f.nombre}
                            {f.es_bulto_cerrado && (
                              <span className="text-[10px] text-zinc-400 ml-2">sale sin abrir</span>
                            )}
                          </td>
                          <td className="text-right tabular-nums py-1.5 text-zinc-600">
                            {formatNum(f.kg, f.kg % 1 === 0 ? 0 : 2)}
                          </td>
                          <td className="pl-4 py-1">
                            <Input
                              defaultValue={f.lapyme_product_id ?? ''}
                              onBlur={e => guardarLapymeId(f, e.target.value)}
                              placeholder="pendiente"
                              className={`h-7 text-xs font-mono ${f.lapyme_product_id ? '' : 'border-amber-200 bg-amber-50/50'}`}
                            />
                          </td>
                          <td className="py-1.5">
                            <button onClick={() => borrarFormato(f)}
                              className="text-zinc-300 hover:text-red-500" title="Quitar formato">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {fmts.length === 0 && (
                        <tr><td colSpan={4} className="py-3 text-xs text-zinc-400">Sin formatos</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={aBorrar !== null}
        variant="danger"
        title="¿Borrar este producto?"
        description={aBorrar
          ? `${toTitleCase(aBorrar.nombre)} y todos sus formatos. Si ya tiene lotes recibidos, la base lo va a impedir — en ese caso desactivalo.`
          : undefined}
        confirmLabel="Borrar"
        cancelLabel="Volver"
        onConfirm={borrarProducto}
        onCancel={() => setABorrar(null)}
      />
    </div>
  )
}
