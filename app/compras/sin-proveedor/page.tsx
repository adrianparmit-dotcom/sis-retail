'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { matchesQuery } from '@/lib/search'
import { fetchAllFromView } from '@/lib/hooks/use-fetch-all'
import Link from 'next/link'

interface ProductoSinProveedor {
  id: string
  sku: string
  nombre: string | null
  categoria: string | null
  proveedor_nombre: string | null
}

export default function SinProveedorPage() {
  const [productos, setProductos] = useState<ProductoSinProveedor[]>([])
  const [proveedoresExistentes, setProveedoresExistentes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroCategoria, setFiltroCategoria] = useState<string>('todas')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [guardados, setGuardados] = useState(0)

  useEffect(() => {
    async function load() {
      // productos tiene >3000 filas: leer con fetchAllFromView (PostgREST corta en 1000)
      const [sinProv, provRows] = await Promise.all([
        fetchAllFromView<ProductoSinProveedor>('productos', {
          select: 'id,sku,nombre,categoria,proveedor_nombre',
          filters: [{ column: '', operator: 'or', value: 'proveedor_nombre.is.null,proveedor_nombre.eq.' }],
          order: [{ column: 'categoria', nullsFirst: false }, { column: 'nombre' }],
        }),
        fetchAllFromView<{ proveedor_nombre: string | null }>('productos', {
          select: 'proveedor_nombre',
          filters: [
            { column: 'proveedor_nombre', operator: 'not.is', value: null },
            { column: 'proveedor_nombre', operator: 'neq', value: '' },
          ],
        }),
      ])
      setProductos(sinProv)
      const nombres = [...new Set(provRows.map(r => r.proveedor_nombre).filter(Boolean) as string[])].sort()
      setProveedoresExistentes(nombres)
      setLoading(false)
    }
    load()
  }, [])

  const categorias = useMemo(() => {
    const cats = [...new Set(productos.map(p => p.categoria ?? 'Sin categoría'))].sort()
    return cats
  }, [productos])

  const filtered = useMemo(() => {
    return productos.filter(p => {
      if (filtroCategoria !== 'todas' && (p.categoria ?? 'Sin categoría') !== filtroCategoria) return false
      if (search && !matchesQuery(search, p.nombre, p.sku, p.categoria)) return false
      return true
    })
  }, [productos, filtroCategoria, search])

  const sugerencias = useMemo(() =>
    editValue
      ? proveedoresExistentes.filter(p => matchesQuery(editValue, p)).slice(0, 8)
      : proveedoresExistentes.slice(0, 8),
    [proveedoresExistentes, editValue]
  )

  function startEdit(p: ProductoSinProveedor) {
    setEditingId(p.id)
    setEditValue('')
  }

  async function guardar(productoId: string) {
    if (!editValue.trim()) return
    setSaving(true)
    await supabase
      .from('productos')
      .update({ proveedor_nombre: editValue.trim() })
      .eq('id', productoId)
    setProductos(prev => prev.filter(p => p.id !== productoId))
    setEditingId(null)
    setEditValue('')
    setGuardados(g => g + 1)
    setSaving(false)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditValue('')
  }

  const totalInicial = productos.length + guardados

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/compras" className="text-sm text-zinc-400 hover:text-zinc-600">← Compras</Link>
          </div>
          <h1 className="text-xl font-semibold text-zinc-900">Productos sin proveedor</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Productos sin proveedor_nombre cargado — asignar para mejorar sugerencias de compra</p>
        </div>
        {guardados > 0 && (
          <div className="text-right">
            <p className="text-2xl font-bold text-green-700">{guardados}</p>
            <p className="text-xs text-zinc-500">asignados hoy</p>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {totalInicial > 0 && (
        <div className="rounded-lg border p-4 bg-white">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-zinc-700">Progreso de carga</p>
            <p className="text-sm text-zinc-500">
              <span className="font-bold text-zinc-900">{guardados}</span> / {totalInicial} ({Math.round((guardados / totalInicial) * 100)}%)
            </p>
          </div>
          <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.round((guardados / totalInicial) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-zinc-400 mt-1.5">
            Quedan <span className="font-medium text-zinc-600">{productos.length}</span> productos pendientes
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <Input
          placeholder="Buscar por nombre o SKU..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
        <select
          value={filtroCategoria}
          onChange={e => setFiltroCategoria(e.target.value)}
          className="text-sm border rounded-md px-3 py-2 bg-white text-zinc-700 h-10"
        >
          <option value="todas">Todas las categorías</option>
          {categorias.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className="text-sm text-zinc-400 ml-auto">{filtered.length} productos</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-zinc-400 text-sm py-8 text-center">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-zinc-400 text-sm py-12 text-center border rounded-lg bg-white">
          {productos.length === 0
            ? '✓ Todos los productos tienen proveedor asignado'
            : 'No hay resultados para los filtros aplicados'
          }
        </div>
      ) : (
        <div className="rounded-lg border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide w-28">SKU</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Nombre</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide w-36">Categoría</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide w-72">Proveedor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{p.sku}</td>
                  <td className="px-4 py-3 font-medium text-zinc-800">{p.nombre ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">{p.categoria ?? <span className="text-zinc-300">—</span>}</td>
                  <td className="px-4 py-3">
                    {editingId === p.id ? (
                      <div className="relative">
                        <div className="flex gap-2 items-center">
                          <div className="relative flex-1">
                            <Input
                              autoFocus
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') guardar(p.id)
                                if (e.key === 'Escape') cancelEdit()
                              }}
                              placeholder="Nombre del proveedor..."
                              className="h-8 text-sm pr-2"
                            />
                            {sugerencias.length > 0 && editValue && (
                              <div className="absolute z-10 top-full left-0 right-0 mt-0.5 bg-white border rounded-md shadow-lg max-h-40 overflow-y-auto">
                                {sugerencias.map(s => (
                                  <button
                                    key={s}
                                    onClick={() => setEditValue(s)}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 border-b last:border-b-0 truncate"
                                  >
                                    {s}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => guardar(p.id)}
                            disabled={!editValue.trim() || saving}
                            className="px-3 py-1.5 text-xs font-medium bg-zinc-900 text-white rounded-md hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed h-8"
                          >
                            {saving ? '...' : 'Guardar'}
                          </button>
                          <button onClick={cancelEdit} className="text-xs text-zinc-400 hover:text-zinc-600 px-1">✕</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(p)}
                        className="text-zinc-300 hover:text-zinc-600 text-sm italic hover:underline transition-colors"
                      >
                        Sin proveedor — click para asignar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
