'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { fetchAllFromView } from '@/lib/hooks/use-fetch-all'

const PIEZA_ID = 'a0000000-0000-0000-0000-000000000002'
const DEPOSITO_ID = 'a0000000-0000-0000-0000-000000000004'
const SECTOR_ORDER = ['Cajones', 'Cajas']

interface Producto {
  id: string
  sku: string
  nombre: string | null
  codigo_barras?: string | null
}

interface Cajon {
  id: string
  sucursal_id: string
  codigo: string
  sector: string | null
  numero: number | null
  nota: string | null
}

// Human-friendly label: "Cajón 51" / "Caja 17"
function cajonLabel(c: Pick<Cajon, 'sector' | 'numero' | 'codigo'>): string {
  const tipo = c.sector === 'Cajas' ? 'Caja' : 'Cajón'
  if (c.numero != null) return `${tipo} ${c.numero}`
  return c.codigo  // fallback for legacy rows without numero
}

interface CajonProducto {
  id: string
  cajon_id: string
  producto_id: string
  cantidad: number
  producto: { id: string; sku: string; nombre: string | null }
}

export default function UbicacionesPage() {
  const [cajones, setCajones] = useState<Cajon[]>([])
  const [cajonProductos, setCajonProductos] = useState<CajonProducto[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pieza' | 'deposito'>('pieza')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  // Quantities being edited (cpId → draft string)
  const [qtyEdits, setQtyEdits] = useState<Record<string, string>>({})

  // Add-product state
  const [searchProd, setSearchProd] = useState('')
  const [addingProd, setAddingProd] = useState<{ cajonId: string; productoId: string; nombre: string; sku: string } | null>(null)
  const [addQty, setAddQty] = useState('')
  const [saving, setSaving] = useState(false)

  // Scanner feedback
  const [scanMiss, setScanMiss] = useState(false)
  const [scanHit, setScanHit] = useState(false)
  const missTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref to the card currently being edited (for click-outside to deselect)
  const editingCardRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => {
    if (missTimerRef.current) clearTimeout(missTimerRef.current)
    if (hitTimerRef.current) clearTimeout(hitTimerRef.current)
  }, [])

  useEffect(() => {
    const load = async () => {
      const [cajonRes, cpRes, allProds] = await Promise.all([
        supabase.from('cajones').select('id,sucursal_id,codigo,sector,numero,nota').order('sector').order('numero'),
        supabase.from('cajon_productos').select('id,cajon_id,producto_id,cantidad,producto:productos(id,sku,nombre)'),
        fetchAllFromView<Producto>('productos', {
          select: 'id,sku,nombre,codigo_barras',
          order: { column: 'nombre', ascending: true },
        }),
      ])
      setCajones((cajonRes.data ?? []) as Cajon[])
      setCajonProductos((cpRes.data ?? []) as unknown as CajonProducto[])
      setProductos(allProds)
      setLoading(false)
    }
    load()
  }, [])

  const cajonProductosMap = useMemo(() => {
    const map = new Map<string, CajonProducto[]>()
    for (const cp of cajonProductos) {
      if (!map.has(cp.cajon_id)) map.set(cp.cajon_id, [])
      map.get(cp.cajon_id)!.push(cp)
    }
    return map
  }, [cajonProductos])

  const barcodeToProducto = useMemo(() => new Map(
    productos.filter(p => p.codigo_barras).map(p => [p.codigo_barras!, p])
  ), [productos])

  const skuToProducto = useMemo(() => new Map(productos.map(p => [p.sku, p])), [productos])

  // ── Tabs ──────────────────────────────────────────────────────────────
  const activeSucursal = tab === 'pieza' ? PIEZA_ID : DEPOSITO_ID
  const tabCajones = useMemo(
    () => cajones.filter(c => c.sucursal_id === activeSucursal),
    [cajones, activeSucursal]
  )

  const tabStats = useMemo(() => {
    const compute = (sid: string) => {
      const cs = cajones.filter(c => c.sucursal_id === sid)
      const all = cs.flatMap(c => cajonProductosMap.get(c.id) ?? [])
      return {
        total: cs.length,
        ocupados: cs.filter(c => (cajonProductosMap.get(c.id)?.length ?? 0) > 0).length,
        sinContar: all.filter(cp => cp.cantidad === 0).length,
      }
    }
    return { pieza: compute(PIEZA_ID), deposito: compute(DEPOSITO_ID) }
  }, [cajones, cajonProductosMap])

  // ── Search / highlight ────────────────────────────────────────────────
  const matchingIds = useMemo(() => {
    if (!search) return null
    const term = search.toLowerCase()
    const ids = new Set<string>()
    for (const c of tabCajones) {
      const prods = cajonProductosMap.get(c.id) ?? []
      const hay = `${c.codigo} ${prods.map(cp => `${cp.producto.nombre ?? ''} ${cp.producto.sku}`).join(' ')}`.toLowerCase()
      if (hay.includes(term)) ids.add(c.id)
    }
    return ids
  }, [tabCajones, search, cajonProductosMap])

  // Main search bar — resolves barcode/SKU on Enter
  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const term = search.trim()
    if (!term) return
    const found = barcodeToProducto.get(term) ?? skuToProducto.get(term)
    if (found) setSearch(found.nombre ?? found.sku)
    else {
      setScanMiss(true)
      if (missTimerRef.current) clearTimeout(missTimerRef.current)
      missTimerRef.current = setTimeout(() => setScanMiss(false), 1500)
    }
  }

  // ── Grouped by sector (Cajones first, Cajas after) + sorted by número.
  // Always include both 'Cajones' and 'Cajas' so the add button shows up
  // even when the current sucursal has zero of that type yet.
  const grouped = useMemo(() => {
    const map = new Map<string, Cajon[]>()
    for (const s of SECTOR_ORDER) map.set(s, [])
    for (const c of tabCajones) {
      const key = c.sector ?? 'Sin sector'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(c)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0))
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ai = SECTOR_ORDER.indexOf(a), bi = SECTOR_ORDER.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1; if (bi === -1) return -1
      return ai - bi
    })
  }, [tabCajones])

  // ── Product search for add ────────────────────────────────────────────
  const filteredProd = useMemo(() =>
    searchProd.length >= 2
      ? productos.filter(p => `${p.nombre ?? ''} ${p.sku}`.toLowerCase().includes(searchProd.toLowerCase())).slice(0, 8)
      : [],
    [productos, searchProd]
  )

  // Scanner / SKU resolve in the add-product input
  function handleAddProdKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const term = searchProd.trim()
    if (!term) return
    const found = barcodeToProducto.get(term) ?? skuToProducto.get(term)
    if (found) {
      setAddingProd({ cajonId: editingId!, productoId: found.id, nombre: found.nombre ?? found.sku, sku: found.sku })
      setSearchProd('')
      setScanHit(true)
      if (hitTimerRef.current) clearTimeout(hitTimerRef.current)
      hitTimerRef.current = setTimeout(() => setScanHit(false), 1000)
    } else {
      setScanMiss(true)
      if (missTimerRef.current) clearTimeout(missTimerRef.current)
      missTimerRef.current = setTimeout(() => setScanMiss(false), 1500)
    }
  }

  // ── Quantity edit ─────────────────────────────────────────────────────
  async function saveQty(cpId: string, val: string) {
    const qty = Math.max(0, parseInt(val) || 0)
    await supabase.from('cajon_productos').update({ cantidad: qty }).eq('id', cpId)
    setCajonProductos(prev => prev.map(cp => cp.id === cpId ? { ...cp, cantidad: qty } : cp))
    setQtyEdits(prev => { const n = { ...prev }; delete n[cpId]; return n })
  }

  // ── Cajón header edit (sector / numero) ────────────────────────────────
  async function setCajonSector(cajonId: string, newSector: 'Cajones' | 'Cajas') {
    const c = cajones.find(x => x.id === cajonId)
    if (!c || c.sector === newSector) return
    // Keep codigo in sync (legacy field)
    const prefix = newSector === 'Cajas' ? 'CA' : 'C'
    const newCodigo = c.numero != null ? `${prefix}-${String(c.numero).padStart(2, '0')}` : c.codigo
    const { error } = await supabase.from('cajones')
      .update({ sector: newSector, codigo: newCodigo })
      .eq('id', cajonId)
    if (error) { alert('No se pudo cambiar tipo: ' + error.message); return }
    setCajones(prev => prev.map(x => x.id === cajonId ? { ...x, sector: newSector, codigo: newCodigo } : x))
  }

  async function setCajonNumero(cajonId: string, raw: string) {
    const n = parseInt(raw)
    if (!Number.isFinite(n) || n < 0) return
    const c = cajones.find(x => x.id === cajonId)
    if (!c || c.numero === n) return
    // Check duplicates in same sucursal+sector
    const dup = cajones.some(x => x.id !== cajonId && x.sucursal_id === c.sucursal_id && x.sector === c.sector && x.numero === n)
    if (dup) { alert(`Ya existe un ${c.sector === 'Cajas' ? 'Caja' : 'Cajón'} con número ${n} en esta sucursal.`); return }
    const prefix = c.sector === 'Cajas' ? 'CA' : 'C'
    const newCodigo = `${prefix}-${String(n).padStart(2, '0')}`
    const { error } = await supabase.from('cajones')
      .update({ numero: n, codigo: newCodigo })
      .eq('id', cajonId)
    if (error) { alert('No se pudo cambiar número: ' + error.message); return }
    setCajones(prev => prev.map(x => x.id === cajonId ? { ...x, numero: n, codigo: newCodigo } : x))
  }

  async function setCajonNota(cajonId: string, raw: string) {
    const c = cajones.find(x => x.id === cajonId)
    if (!c) return
    const trimmed = raw.trim()
    const next = trimmed === '' ? null : trimmed
    if (next === c.nota) return
    const { error } = await supabase.from('cajones').update({ nota: next }).eq('id', cajonId)
    if (error) { alert('No se pudo guardar nota: ' + error.message); return }
    setCajones(prev => prev.map(x => x.id === cajonId ? { ...x, nota: next } : x))
  }

  async function eliminarCajon(cajonId: string) {
    const c = cajones.find(x => x.id === cajonId)
    if (!c) return
    const label = cajonLabel(c)
    const prods = cajonProductos.filter(cp => cp.cajon_id === cajonId)
    const msg = prods.length > 0
      ? `Eliminar ${label}? Tiene ${prods.length} producto(s) asignado(s) que también se desasignarán.`
      : `Eliminar ${label}?`
    if (!confirm(msg)) return
    const { error } = await supabase.from('cajones').delete().eq('id', cajonId)
    if (error) { alert('No se pudo eliminar: ' + error.message); return }
    setCajones(prev => prev.filter(x => x.id !== cajonId))
    setCajonProductos(prev => prev.filter(cp => cp.cajon_id !== cajonId))
    if (editingId === cajonId) setEditingId(null)
  }

  async function agregarCajon(sector: 'Cajones' | 'Cajas') {
    const tipo = sector === 'Cajas' ? 'Caja' : 'Cajón'
    // Suggest next available number in current sucursal+sector
    const sameGroup = cajones
      .filter(c => c.sucursal_id === activeSucursal && c.sector === sector && c.numero != null)
      .map(c => c.numero!)
    const suggested = sameGroup.length > 0 ? Math.max(...sameGroup) + 1 : 1
    const raw = window.prompt(`Número de la nueva ${tipo}:`, String(suggested))
    if (!raw) return
    const n = parseInt(raw.trim())
    if (!Number.isFinite(n) || n < 0) { alert('Número inválido'); return }
    if (sameGroup.includes(n)) { alert(`Ya existe ${tipo} ${n} en esta sucursal.`); return }
    const prefix = sector === 'Cajas' ? 'CA' : 'C'
    const codigo = `${prefix}-${String(n).padStart(2, '0')}`
    const { data, error } = await supabase.from('cajones').insert({
      sucursal_id: activeSucursal,
      sector,
      numero     : n,
      codigo,
    }).select('id,sucursal_id,codigo,sector,numero').single()
    if (error || !data) { alert('No se pudo crear: ' + (error?.message ?? '')); return }
    setCajones(prev => [...prev, data as Cajon])
  }

  // ── Add product ───────────────────────────────────────────────────────
  const agregarProducto = useCallback(async () => {
    if (!addingProd) return
    const qty = Math.max(0, parseInt(addQty) || 0)
    setSaving(true)
    const { data } = await supabase
      .from('cajon_productos')
      .insert({ cajon_id: addingProd.cajonId, producto_id: addingProd.productoId, cantidad: qty })
      .select('id,cajon_id,producto_id,cantidad,producto:productos(id,sku,nombre)')
      .single()
    if (data) setCajonProductos(prev => [...prev, data as unknown as CajonProducto])
    setAddingProd(null); setAddQty(''); setSearchProd('')
    setSaving(false)
  }, [addingProd, addQty])

  async function eliminarCajonProducto(cpId: string) {
    await supabase.from('cajon_productos').delete().eq('id', cpId)
    setCajonProductos(prev => prev.filter(cp => cp.id !== cpId))
  }

  function closeEdit() {
    setEditingId(null); setSearchProd(''); setAddingProd(null); setAddQty(''); setQtyEdits({})
  }

  // Click fuera del cajón en edición → deseleccionar
  useEffect(() => {
    if (!editingId) return
    function onDocMouseDown(e: MouseEvent) {
      if (editingCardRef.current && !editingCardRef.current.contains(e.target as Node)) {
        closeEdit()
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [editingId])

  function switchTab(t: 'pieza' | 'deposito') {
    setTab(t); setSearch(''); closeEdit()
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Cajones</h1>
        <p className="text-sm text-zinc-400 mt-0.5">Click en un cajón para editar · Escaneá o ingresá SKU para buscar</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200">
        {([
          { key: 'pieza' as const, label: 'La Pieza', s: tabStats.pieza },
          { key: 'deposito' as const, label: 'Depósito', s: tabStats.deposito },
        ]).map(({ key, label, s }) => (
          <button
            key={key}
            onClick={() => switchTab(key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              tab === key ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-400 hover:text-zinc-700'
            }`}
          >
            {label}
            {!loading && (
              <>
                <span className={`text-xs rounded px-1.5 py-0.5 ${tab === key ? 'bg-zinc-100 text-zinc-600' : 'text-zinc-300'}`}>
                  {s.ocupados}/{s.total}
                </span>
                {s.sinContar > 0 && (
                  <span className="text-xs bg-orange-100 text-orange-600 rounded px-1.5 py-0.5 font-medium">
                    {s.sinContar} sin contar
                  </span>
                )}
              </>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Input
          placeholder="Buscar, SKU o escanear código..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={handleSearchKey}
          className="pr-7 text-sm"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 text-xs">✕</button>
        )}
        {scanMiss && <p className="absolute -bottom-5 left-0 text-xs text-red-500 whitespace-nowrap">Código no encontrado</p>}
        {search && matchingIds && (
          <p className="absolute -bottom-5 right-0 text-xs text-zinc-400">{matchingIds.size} coincidencias</p>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="py-16 text-center text-zinc-400 text-sm">Cargando...</div>
      ) : (
        <div className="space-y-8 pt-1">
          {grouped.map(([sector, items]) => {
            const matchCount = matchingIds ? items.filter(c => matchingIds.has(c.id)).length : items.length
            return (
              <div key={sector}>
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">{sector}</h3>
                  <span className="text-xs text-zinc-300">{items.length}</span>
                  {matchingIds && matchCount < items.length && (
                    <span className="text-xs text-amber-600 font-medium">{matchCount} coinciden</span>
                  )}
                  {(sector === 'Cajones' || sector === 'Cajas') && (
                    <button
                      onClick={() => agregarCajon(sector as 'Cajones' | 'Cajas')}
                      className="ml-auto text-xs text-blue-600 hover:text-blue-800 underline"
                    >
                      + {sector === 'Cajas' ? 'Caja' : 'Cajón'}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2">
                  {items.map(c => {
                    const prods = cajonProductosMap.get(c.id) ?? []
                    const ocupado = prods.length > 0
                    const sinContar = prods.some(cp => cp.cantidad === 0)
                    const isEditing = editingId === c.id
                    const dimmed = !!matchingIds && !matchingIds.has(c.id) && !isEditing
                    const highlighted = !!matchingIds && matchingIds.has(c.id)

                    return (
                      <div
                        key={c.id}
                        ref={isEditing ? editingCardRef : undefined}
                        onClick={() => { if (!isEditing) setEditingId(c.id) }}
                        className={`rounded-lg border p-3 transition-all select-none ${
                          dimmed ? 'opacity-20 pointer-events-none' : ''
                        } ${
                          isEditing
                            ? 'ring-2 ring-blue-400 border-blue-200 bg-blue-50/40 cursor-default'
                            : highlighted
                            ? 'ring-2 ring-amber-300 border-amber-200 bg-amber-50 cursor-pointer hover:shadow-sm'
                            : ocupado
                            ? 'bg-white border-zinc-200 hover:border-zinc-300 hover:shadow-sm cursor-pointer'
                            : 'bg-zinc-50 border-dashed border-zinc-200 hover:border-zinc-300 cursor-pointer'
                        }`}
                      >
                        {/* Header: human label + nota badge + counters */}
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <div className="flex items-baseline gap-1.5 min-w-0">
                            <span className="text-sm font-semibold text-zinc-800 leading-tight whitespace-nowrap">
                              {cajonLabel(c)}
                            </span>
                            {c.nota && (
                              <span className="text-[10px] font-medium text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-1 py-0.5 leading-none truncate"
                                title={c.nota}>
                                {/^freezer$/i.test(c.nota.trim()) ? '❄️' : ''} {c.nota}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {sinContar && !isEditing && (
                              <span className="w-1.5 h-1.5 rounded-full bg-orange-400" title="Sin contar" />
                            )}
                            {ocupado
                              ? <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 py-0.5 leading-none">{prods.length}</span>
                              : <span className="text-[10px] text-zinc-300 leading-none">libre</span>
                            }
                          </div>
                        </div>

                        {/* Edit header: tipo toggle + número + eliminar */}
                        {isEditing && (
                          <div className="mb-2 space-y-1.5" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5">
                              <div className="flex rounded border border-zinc-200 overflow-hidden text-[11px]">
                                <button
                                  onClick={() => setCajonSector(c.id, 'Cajones')}
                                  className={`px-2 py-0.5 ${c.sector === 'Cajones' ? 'bg-blue-500 text-white font-semibold' : 'bg-white text-zinc-600 hover:bg-zinc-50'}`}
                                >Cajón</button>
                                <button
                                  onClick={() => setCajonSector(c.id, 'Cajas')}
                                  className={`px-2 py-0.5 border-l border-zinc-200 ${c.sector === 'Cajas' ? 'bg-blue-500 text-white font-semibold' : 'bg-white text-zinc-600 hover:bg-zinc-50'}`}
                                >Caja</button>
                              </div>
                              <span className="text-[10px] text-zinc-400">N°</span>
                              <input
                                type="number"
                                min="1"
                                defaultValue={c.numero ?? ''}
                                onBlur={e => setCajonNumero(c.id, e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                }}
                                onClick={e => { e.stopPropagation(); (e.target as HTMLInputElement).select() }}
                                className="w-14 text-[11px] text-center bg-white border border-blue-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                            </div>
                            <input
                              type="text"
                              defaultValue={c.nota ?? ''}
                              placeholder="Nota (ej: Freezer)"
                              onBlur={e => setCajonNota(c.id, e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              }}
                              onClick={e => { e.stopPropagation(); (e.target as HTMLInputElement).select() }}
                              className="w-full text-[10px] bg-white border border-zinc-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-cyan-300 focus:border-cyan-300"
                            />
                            <button
                              onClick={() => eliminarCajon(c.id)}
                              className="w-full text-[10px] text-red-500 border border-red-200 rounded py-0.5 hover:bg-red-50"
                            >
                              Eliminar {cajonLabel(c)}
                            </button>
                          </div>
                        )}

                        {/* VIEW MODE */}
                        {!isEditing && (
                          ocupado
                            ? <ul className="space-y-1">
                                {prods.map(cp => (
                                  <li key={cp.id} className="flex items-start justify-between gap-1 min-w-0"
                                    title={cp.producto.nombre ?? cp.producto.sku}>
                                    <span className="text-[11px] text-zinc-700 leading-snug line-clamp-2 flex-1">
                                      {cp.producto.nombre ?? cp.producto.sku}
                                    </span>
                                    {cp.cantidad > 0
                                      ? <span className="text-[10px] text-zinc-400 flex-shrink-0 font-mono mt-0.5">{cp.cantidad}u</span>
                                      : <span className="text-[10px] text-orange-400 flex-shrink-0 font-medium mt-0.5">—</span>
                                    }
                                  </li>
                                ))}
                              </ul>
                            : <p className="text-[11px] text-zinc-300">—</p>
                        )}

                        {/* EDIT MODE */}
                        {isEditing && (
                          <div className="space-y-2 mt-1" onClick={e => e.stopPropagation()}>

                            {/* Existing products with qty edit */}
                            {prods.length > 0 && (
                              <ul className="space-y-1.5">
                                {prods.map(cp => {
                                  const draftQty = qtyEdits[cp.id] ?? String(cp.cantidad)
                                  return (
                                    <li key={cp.id} className="flex items-center gap-1.5 bg-white rounded px-1.5 py-1 border border-zinc-100"
                                      title={cp.producto.nombre ?? cp.producto.sku}>
                                      <span className="flex-1 min-w-0 text-[11px] text-zinc-700 leading-snug line-clamp-2">
                                        {cp.producto.nombre ?? cp.producto.sku}
                                      </span>
                                      <div className="flex items-center gap-0.5 flex-shrink-0">
                                        <input
                                          type="number"
                                          min="0"
                                          value={draftQty}
                                          onChange={e => setQtyEdits(prev => ({ ...prev, [cp.id]: e.target.value }))}
                                          onBlur={e => saveQty(cp.id, e.target.value)}
                                          onKeyDown={e => {
                                            if (e.key === 'Enter') { saveQty(cp.id, draftQty); (e.target as HTMLInputElement).blur() }
                                          }}
                                          onClick={e => { e.stopPropagation(); (e.target as HTMLInputElement).select() }}
                                          className={`w-12 h-6 text-[11px] text-center border rounded focus:outline-none focus:ring-1 focus:ring-blue-300 ${
                                            draftQty === '0' || draftQty === '' ? 'border-orange-300 text-orange-500' : 'border-zinc-200 text-zinc-800'
                                          }`}
                                        />
                                        <span className="text-[10px] text-zinc-400">u</span>
                                      </div>
                                      <button
                                        onClick={() => eliminarCajonProducto(cp.id)}
                                        className="flex-shrink-0 text-red-400 hover:text-red-600 text-[11px] font-bold px-0.5 leading-none"
                                      >✕</button>
                                    </li>
                                  )
                                })}
                              </ul>
                            )}

                            {/* Add product */}
                            {addingProd?.cajonId === c.id ? (
                              <div className="space-y-1.5 border-t border-zinc-100 pt-1.5">
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] text-zinc-400 uppercase tracking-wide">SKU</span>
                                  <span className="text-[11px] font-mono text-zinc-500">{addingProd.sku}</span>
                                </div>
                                <p className="text-[11px] font-medium text-blue-700 leading-tight truncate">{addingProd.nombre}</p>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    autoFocus
                                    type="number"
                                    min="0"
                                    placeholder="Cant."
                                    value={addQty}
                                    onChange={e => setAddQty(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && agregarProducto()}
                                    onClick={e => e.stopPropagation()}
                                    className="w-16 h-7 text-[11px] text-center border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  />
                                  <span className="text-[10px] text-zinc-400">u</span>
                                  <Button
                                    size="sm"
                                    onClick={agregarProducto}
                                    disabled={saving}
                                    className="h-7 text-[11px] flex-1 px-2"
                                  >
                                    {saving ? '...' : 'Agregar'}
                                  </Button>
                                  <button
                                    onClick={() => { setAddingProd(null); setSearchProd(''); setAddQty('') }}
                                    className="text-[11px] text-zinc-400 hover:text-zinc-600 px-0.5 leading-none"
                                  >✕</button>
                                </div>
                              </div>
                            ) : (
                              <div className="relative border-t border-zinc-100 pt-1.5">
                                <Input
                                  autoFocus={prods.length === 0}
                                  placeholder="SKU, nombre o escanear..."
                                  value={searchProd}
                                  onChange={e => setSearchProd(e.target.value)}
                                  onKeyDown={handleAddProdKey}
                                  className={`h-7 text-[11px] ${scanHit ? 'border-green-400 bg-green-50' : ''} ${scanMiss && editingId === c.id ? 'border-red-300 bg-red-50' : ''}`}
                                  onClick={e => e.stopPropagation()}
                                />
                                {filteredProd.length > 0 && (
                                  <div className="absolute top-9 left-0 right-0 z-50 rounded-md border bg-white shadow-xl max-h-44 overflow-y-auto">
                                    {filteredProd.map(p => (
                                      <button
                                        key={p.id}
                                        onClick={e => {
                                          e.stopPropagation()
                                          setAddingProd({ cajonId: c.id, productoId: p.id, nombre: p.nombre ?? p.sku, sku: p.sku })
                                          setSearchProd('')
                                        }}
                                        className="w-full text-left px-2.5 py-1.5 hover:bg-zinc-50 border-t first:border-t-0"
                                      >
                                        <span className="text-[11px] text-zinc-800 block truncate">{p.nombre}</span>
                                        <span className="text-[10px] text-zinc-400 font-mono">{p.sku}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Close */}
                            <button
                              onClick={e => { e.stopPropagation(); closeEdit() }}
                              className="w-full text-[11px] text-zinc-400 hover:text-zinc-700 border border-zinc-200 rounded py-1 hover:bg-zinc-50 transition-colors"
                            >
                              Listo ✓
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
