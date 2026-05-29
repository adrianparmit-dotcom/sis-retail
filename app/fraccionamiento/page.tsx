'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function ProductPicker({ value, onChange, productos, placeholder }: {
  value: string
  onChange: (id: string) => void
  productos: { id: string; sku: string; nombre: string | null; codigo_barras?: string | null }[]
  placeholder?: string
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const selected = productos.find(p => p.id === value)
  const inputRef = useRef<HTMLInputElement>(null)

  const barcodeMap = useMemo(() => new Map(
    productos.filter(p => p.codigo_barras).map(p => [p.codigo_barras!, p])
  ), [productos])

  const filtered = useMemo(() =>
    search.length >= 1
      ? productos.filter(p => `${p.nombre ?? ''} ${p.sku} ${p.codigo_barras ?? ''}`.toLowerCase().includes(search.toLowerCase())).slice(0, 15)
      : [],
    [productos, search]
  )

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const term = search.trim()
    const found = barcodeMap.get(term) ?? productos.find(p => p.sku === term)
    if (found) { onChange(found.id); setSearch(''); setOpen(false) }
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={selected ? (selected.nombre ?? selected.sku) : search}
        onChange={e => {
          if (selected) onChange('')
          setSearch(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKey}
        placeholder={placeholder ?? 'Buscar o escanear código...'}
        className="h-9"
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {filtered.map(p => (
            <button
              key={p.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50"
              onMouseDown={() => { onChange(p.id); setSearch(''); setOpen(false) }}
            >
              {p.nombre ?? p.sku} <span className="text-zinc-400 text-xs ml-1">{p.sku}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const SUCURSALES = [
  { id: 'a0000000-0000-0000-0000-000000000001', nombre: 'SOHO 1 - Local' },
  { id: 'a0000000-0000-0000-0000-000000000002', nombre: 'SOHO 1 - La Pieza' },
  { id: 'a0000000-0000-0000-0000-000000000003', nombre: 'SOHO 2 - Local' },
  { id: 'a0000000-0000-0000-0000-000000000004', nombre: 'SOHO 2 - Depósito' },
]

interface Producto {
  id: string
  sku: string
  nombre: string | null
  categoria: string | null
  stock_dux: number
  codigo_barras?: string | null
}

interface DerivadoRow {
  key: number
  producto_id: string
  cantidad: number
  peso_gramos: number
  bolsas_usadas: number
  destino_sucursal_id: string
}

interface FraccionamientoRecord {
  id: string
  lote_origen: string
  cantidad_origen_kg: number
  fecha_fraccionamiento: string
  merma_gramos: number
  observaciones: string | null
  producto_origen_id: string
  // joined
  origen_nombre?: string | null
  origen_sku?: string
  derivados_count?: number
}

let keySeq = 0

export default function FraccionamientoPage() {
  const [productos, setProductos] = useState<Producto[]>([])
  const [historial, setHistorial] = useState<FraccionamientoRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [origenId, setOrigenId] = useState('')
  const [loteOrigen, setLoteOrigen] = useState('')
  const [cantidadKg, setCantidadKg] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [usuario, setUsuario] = useState('')
  const [derivados, setDerivados] = useState<DerivadoRow[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [searchOrigen, setSearchOrigen] = useState('')

  useEffect(() => {
    async function load() {
      const [prodRes, histRes] = await Promise.all([
        supabase.from('productos').select('id,sku,nombre,categoria,stock_dux,codigo_barras').order('nombre'),
        supabase
          .from('fraccionamientos')
          .select('id,lote_origen,cantidad_origen_kg,fecha_fraccionamiento,merma_gramos,observaciones,producto_origen_id')
          .order('fecha_fraccionamiento', { ascending: false })
          .limit(50),
      ])
      const prods = (prodRes.data ?? []) as Producto[]
      const hist = (histRes.data ?? []) as FraccionamientoRecord[]

      // Enrich historial with product names
      const prodMap = new Map(prods.map(p => [p.id, p]))
      const enriched = hist.map(h => ({
        ...h,
        origen_nombre: prodMap.get(h.producto_origen_id)?.nombre,
        origen_sku: prodMap.get(h.producto_origen_id)?.sku,
      }))

      setProductos(prods)
      setHistorial(enriched)
      setLoading(false)
    }
    load()
  }, [])

  const addDerivado = useCallback(() => {
    setDerivados(prev => [...prev, {
      key: keySeq++,
      producto_id: '',
      cantidad: 1,
      peso_gramos: 500,
      bolsas_usadas: 0,
      destino_sucursal_id: SUCURSALES[0].id,
    }])
  }, [])

  const updateDerivado = useCallback((key: number, patch: Partial<DerivadoRow>) => {
    setDerivados(prev => prev.map(d => d.key === key ? { ...d, ...patch } : d))
  }, [])

  const removeDerivado = useCallback((key: number) => {
    setDerivados(prev => prev.filter(d => d.key !== key))
  }, [])

  const totalDerivadosGramos = useMemo(() =>
    derivados.reduce((s, d) => s + d.cantidad * d.peso_gramos, 0),
    [derivados]
  )

  const mermaGramos = useMemo(() => {
    const kg = parseFloat(cantidadKg)
    if (isNaN(kg) || kg <= 0) return null
    return Math.max(0, Math.round(kg * 1000 - totalDerivadosGramos))
  }, [cantidadKg, totalDerivadosGramos])

  const filteredProductos = useMemo(() =>
    searchOrigen
      ? productos.filter(p => `${p.nombre} ${p.sku} ${p.codigo_barras ?? ''}`.toLowerCase().includes(searchOrigen.toLowerCase())).slice(0, 20)
      : productos.slice(0, 20),
    [productos, searchOrigen]
  )

  const barcodeProdMap = useMemo(() => new Map(
    productos.filter(p => p.codigo_barras).map(p => [p.codigo_barras!, p])
  ), [productos])

  function handleOrigenKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const term = searchOrigen.trim()
    const found = barcodeProdMap.get(term) ?? productos.find(p => p.sku === term)
    if (found) { setOrigenId(found.id); setSearchOrigen('') }
  }

  async function guardar() {
    if (!origenId || !loteOrigen || !cantidadKg) {
      setError('Completá producto origen, lote y cantidad')
      return
    }
    if (derivados.length === 0) {
      setError('Agregá al menos un producto derivado')
      return
    }
    if (derivados.some(d => !d.producto_id)) {
      setError('Seleccioná el producto para cada derivado')
      return
    }
    const kg = parseFloat(cantidadKg)
    if (isNaN(kg) || kg <= 0) { setError('Cantidad inválida'); return }

    setError('')
    setSaving(true)
    try {
      const { data: fracData, error: fracErr } = await supabase
        .from('fraccionamientos')
        .insert({
          producto_origen_id: origenId,
          lote_origen: loteOrigen,
          cantidad_origen_kg: kg,
          merma_gramos: mermaGramos ?? 0,
          usuario: usuario || null,
          observaciones: observaciones || null,
        })
        .select('id')
        .single()

      if (fracErr || !fracData) throw fracErr ?? new Error('No se pudo crear el fraccionamiento')

      const detalles = derivados.map(d => ({
        fraccionamiento_id: (fracData as { id: string }).id,
        producto_derivado_id: d.producto_id,
        lote_derivado: `FRAC-${loteOrigen}`,
        cantidad: d.cantidad,
        peso_gramos: d.peso_gramos,
        bolsas_usadas: d.bolsas_usadas,
        destino_sucursal_id: d.destino_sucursal_id,
      }))
      await supabase.from('fraccionamientos_detalle').insert(detalles)

      // Reset
      setOrigenId(''); setLoteOrigen(''); setCantidadKg(''); setObservaciones('')
      setUsuario(''); setDerivados([]); setShowForm(false)

      // Reload historial
      const { data: newHist } = await supabase
        .from('fraccionamientos')
        .select('id,lote_origen,cantidad_origen_kg,fecha_fraccionamiento,merma_gramos,observaciones,producto_origen_id')
        .order('fecha_fraccionamiento', { ascending: false })
        .limit(50)
      const prodMap = new Map(productos.map(p => [p.id, p]))
      setHistorial(((newHist ?? []) as FraccionamientoRecord[]).map(h => ({
        ...h,
        origen_nombre: prodMap.get(h.producto_origen_id)?.nombre,
        origen_sku: prodMap.get(h.producto_origen_id)?.sku,
      })))
    } catch (e) {
      setError('Error al guardar: ' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const origenProducto = productos.find(p => p.id === origenId)

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Fraccionamiento y Mermas</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Registrá el fraccionamiento de productos a granel en unidades</p>
        </div>
        <Button onClick={() => { setShowForm(true); setError('') }}>+ Nuevo fraccionamiento</Button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-lg border border-zinc-200 bg-white p-5 space-y-5">
          <h2 className="font-semibold text-zinc-900">Nuevo fraccionamiento</h2>

          {/* Producto origen */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Producto origen</label>
              <Input
                placeholder="Buscar, SKU o escanear código..."
                value={searchOrigen}
                onChange={e => setSearchOrigen(e.target.value)}
                onKeyDown={handleOrigenKey}
                className="mb-1"
              />
              <Select value={origenId} onValueChange={v => setOrigenId(v ?? '')}>
                <SelectTrigger><SelectValue placeholder="Seleccioná..." /></SelectTrigger>
                <SelectContent>
                  {filteredProductos.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre ?? p.sku} <span className="text-zinc-400 text-xs ml-1">({p.sku})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {origenProducto && (
                <p className="text-xs text-zinc-400 mt-1">Stock actual: {origenProducto.stock_dux.toLocaleString('es-AR')}</p>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Lote / Identificador</label>
                <Input value={loteOrigen} onChange={e => setLoteOrigen(e.target.value)} placeholder="Ej: 2026-05-09" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Cantidad origen (kg)</label>
                <Input type="number" step="0.001" value={cantidadKg} onChange={e => setCantidadKg(e.target.value)} placeholder="Ej: 5.5" />
              </div>
            </div>
          </div>

          {/* Derivados */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Productos derivados</label>
              <Button size="sm" variant="outline" onClick={addDerivado} className="h-7 text-xs">+ Agregar</Button>
            </div>

            {derivados.length === 0 ? (
              <p className="text-sm text-zinc-400 py-3 text-center border rounded-md">
                Hacé click en &ldquo;Agregar&rdquo; para añadir productos derivados
              </p>
            ) : (
              <div className="space-y-2">
                {derivados.map(d => (
                  <div key={d.key} className="grid grid-cols-[1fr_80px_80px_80px_160px_32px] gap-2 items-end">
                    <div>
                      {d.key === derivados[0].key && <label className="text-xs text-zinc-400 block mb-1">Producto</label>}
                      <ProductPicker
                        value={d.producto_id}
                        onChange={v => updateDerivado(d.key, { producto_id: v })}
                        productos={productos}
                        placeholder="Buscar derivado..."
                      />
                    </div>
                    <div>
                      {d.key === derivados[0].key && <label className="text-xs text-zinc-400 block mb-1">Cant.</label>}
                      <Input type="number" min="1" className="h-9" value={d.cantidad}
                        onChange={e => updateDerivado(d.key, { cantidad: parseInt(e.target.value) || 1 })} />
                    </div>
                    <div>
                      {d.key === derivados[0].key && <label className="text-xs text-zinc-400 block mb-1">Gramos c/u</label>}
                      <Input type="number" min="1" className="h-9" value={d.peso_gramos}
                        onChange={e => updateDerivado(d.key, { peso_gramos: parseInt(e.target.value) || 0 })} />
                    </div>
                    <div>
                      {d.key === derivados[0].key && <label className="text-xs text-zinc-400 block mb-1">Bolsas</label>}
                      <Input type="number" min="0" className="h-9" value={d.bolsas_usadas}
                        onChange={e => updateDerivado(d.key, { bolsas_usadas: parseInt(e.target.value) || 0 })} />
                    </div>
                    <div>
                      {d.key === derivados[0].key && <label className="text-xs text-zinc-400 block mb-1">Destino</label>}
                      <Select value={d.destino_sucursal_id} onValueChange={v => updateDerivado(d.key, { destino_sucursal_id: v ?? SUCURSALES[0].id })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SUCURSALES.map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <button onClick={() => removeDerivado(d.key)}
                      className="h-9 w-8 flex items-center justify-center text-zinc-400 hover:text-red-500 text-lg">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Merma summary */}
          {derivados.length > 0 && cantidadKg && (
            <div className="rounded-md bg-zinc-50 border px-4 py-3 flex gap-6 text-sm">
              <div>
                <span className="text-zinc-400">Origen: </span>
                <span className="font-medium">{(parseFloat(cantidadKg) * 1000 || 0).toLocaleString('es-AR')}g</span>
              </div>
              <div>
                <span className="text-zinc-400">Derivados: </span>
                <span className="font-medium">{totalDerivadosGramos.toLocaleString('es-AR')}g</span>
              </div>
              <div>
                <span className="text-zinc-400">Merma: </span>
                <span className={`font-semibold ${(mermaGramos ?? 0) > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                  {mermaGramos !== null ? `${mermaGramos.toLocaleString('es-AR')}g` : '—'}
                  {mermaGramos !== null && cantidadKg
                    ? ` (${((mermaGramos / (parseFloat(cantidadKg) * 1000)) * 100).toFixed(1)}%)`
                    : ''}
                </span>
              </div>
            </div>
          )}

          {/* Extra fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Operario</label>
              <Input value={usuario} onChange={e => setUsuario(e.target.value)} placeholder="Nombre (opcional)" />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Observaciones</label>
              <Input value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="(opcional)" />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={guardar} disabled={saving} className="flex-1">
              {saving ? 'Guardando...' : 'Guardar fraccionamiento'}
            </Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setError('') }}>Cancelar</Button>
          </div>
        </div>
      )}

      {/* Historial */}
      <div>
        <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wide mb-3">Historial reciente</h2>
        {loading ? (
          <div className="text-zinc-400 text-sm py-8 text-center">Cargando...</div>
        ) : historial.length === 0 ? (
          <div className="text-zinc-400 text-sm py-8 text-center border rounded-lg">
            No hay fraccionamientos registrados
          </div>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50">
                  <TableHead>Fecha</TableHead>
                  <TableHead>Producto origen</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead className="text-right">Kg origen</TableHead>
                  <TableHead className="text-right">Merma</TableHead>
                  <TableHead>Operario</TableHead>
                  <TableHead>Obs.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historial.map(h => (
                  <TableRow key={h.id} className="hover:bg-zinc-50">
                    <TableCell className="text-xs tabular-nums text-zinc-500">
                      {new Date(h.fecha_fraccionamiento).toLocaleDateString('es-AR')}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{h.origen_nombre ?? h.producto_origen_id.slice(0, 8)}</div>
                      <div className="text-xs text-zinc-400 font-mono">{h.origen_sku}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{h.lote_origen}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{h.cantidad_origen_kg}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {h.merma_gramos > 0 ? (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">{h.merma_gramos}g</Badge>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500">{(h as unknown as Record<string, unknown>).usuario as string ?? '—'}</TableCell>
                    <TableCell className="text-xs text-zinc-400 max-w-xs truncate">{h.observaciones ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
