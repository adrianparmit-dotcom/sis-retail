'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

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
  codigo_barras: string | null
}

interface Confirmado {
  sku: string
  nombre: string | null
  sucursal: string
  fecha: string
  cantidad: number
}

export default function CargaRapidaPage() {
  return (
    <Suspense fallback={<div className="p-6 text-zinc-400">Cargando...</div>}>
      <CargaRapidaContent />
    </Suspense>
  )
}

function CargaRapidaContent() {
  const searchParams = useSearchParams()
  const initialSku = searchParams.get('sku') ?? ''

  const barcodeRef = useRef<HTMLInputElement>(null)
  const fechaAnioRef = useRef<HTMLInputElement>(null)
  const fechaMesRef = useRef<HTMLInputElement>(null)
  const fechaDiaRef = useRef<HTMLInputElement>(null)
  const cantidadRef = useRef<HTMLInputElement>(null)

  const [barcode, setBarcode] = useState(initialSku)
  const [producto, setProducto] = useState<Producto | null>(null)
  const [matches, setMatches] = useState<Producto[]>([])
  const [notFound, setNotFound] = useState(false)
  const [sucursalId, setSucursalId] = useState(SUCURSALES[0].id)
  const [stockPorSucursal, setStockPorSucursal] = useState<Record<string, number>>({})

  const [fechaAnio, setFechaAnio] = useState('')
  const [fechaMes, setFechaMes] = useState('')
  const [fechaDia, setFechaDia] = useState('')
  const [cascadeStep, setCascadeStep] = useState<'year' | 'month' | 'day' | null>(null)

  const [cantidad, setCantidad] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmados, setConfirmados] = useState<Confirmado[]>([])
  const [error, setError] = useState('')
  const [confirmVencido, setConfirmVencido] = useState(false)

  const [ordenTrabajo, setOrdenTrabajo] = useState<Producto[] | null>(null)
  const [loadingOrden, setLoadingOrden] = useState(false)

  // Reset orden de trabajo when sucursal changes
  useEffect(() => { setOrdenTrabajo(null) }, [sucursalId])

  const fecha = useMemo(() => {
    if (fechaAnio.length === 4 && fechaMes && fechaDia) {
      return `${fechaAnio}-${fechaMes.padStart(2, '0')}-${fechaDia.padStart(2, '0')}`
    }
    return ''
  }, [fechaAnio, fechaMes, fechaDia])

  const today = useMemo(() => new Date().toISOString().split('T')[0], [])
  const isExpired = !!fecha && fecha < today

  // Reset confirmation whenever the selected date changes
  useEffect(() => { setConfirmVencido(false) }, [fecha])

  useEffect(() => {
    if (initialSku) {
      buscarProducto(initialSku)
      setCascadeStep(null)
      setFechaAnio('')
      setFechaMes('')
      setFechaDia('')
    } else {
      barcodeRef.current?.focus()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchStockPorSucursal(productoId: string) {
    const { data } = await supabase
      .from('lotes')
      .select('sucursal_id, cantidad')
      .eq('producto_id', productoId)
      .gt('cantidad', 0)
    const map: Record<string, number> = {}
    for (const lote of (data ?? []) as Array<{ sucursal_id: string; cantidad: number }>) {
      map[lote.sucursal_id] = (map[lote.sucursal_id] ?? 0) + lote.cantidad
    }
    setStockPorSucursal(map)
  }

  async function buscarProducto(query: string) {
    const q = query.trim()
    if (!q) return
    setNotFound(false)
    setProducto(null)
    setMatches([])
    setStockPorSucursal({})

    // Try exact SKU first
    const { data: skuData } = await supabase
      .from('productos')
      .select('id,sku,nombre,categoria,stock_dux,codigo_barras')
      .eq('sku', q)
      .single()

    if (skuData) {
      setProducto(skuData as Producto)
      fetchStockPorSucursal(skuData.id)
      setCascadeStep(null)
      setFechaAnio('')
      setFechaMes('')
      setFechaDia('')
      return
    }

    // Try barcode (can have duplicates, so no .single())
    const { data: barcodeMatches } = await supabase
      .from('productos')
      .select('id,sku,nombre,categoria,stock_dux,codigo_barras')
      .eq('codigo_barras', q)
      .limit(10)

    if (barcodeMatches && barcodeMatches.length > 0) {
      if (barcodeMatches.length === 1) {
        setProducto(barcodeMatches[0] as Producto)
        fetchStockPorSucursal(barcodeMatches[0].id)
        setCascadeStep(null)
        setFechaAnio('')
        setFechaMes('')
        setFechaDia('')
      } else {
        setMatches(barcodeMatches as Producto[])
      }
      return
    }

    // Fallback: search by name
    const { data: nameMatches } = await supabase
      .from('productos')
      .select('id,sku,nombre,categoria,stock_dux,codigo_barras')
      .ilike('nombre', `%${q}%`)
      .limit(10)

    if (nameMatches && nameMatches.length > 0) {
      if (nameMatches.length === 1) {
        setProducto(nameMatches[0] as Producto)
        fetchStockPorSucursal(nameMatches[0].id)
        setCascadeStep(null)
        setFechaAnio('')
        setFechaMes('')
        setFechaDia('')
      } else {
        setMatches(nameMatches as Producto[])
      }
    } else {
      setNotFound(true)
      barcodeRef.current?.select()
    }
  }

  function handleBarcodeKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      buscarProducto(barcode)
    }
  }

  function getYears(): number[] {
    const now = new Date()
    const currentYear = now.getFullYear()
    return Array.from({ length: 7 }, (_, i) => currentYear + i)
  }

  function getMonths(): Array<{ num: number; name: string }> {
    return [
      { num: 1, name: 'Enero' },
      { num: 2, name: 'Febrero' },
      { num: 3, name: 'Marzo' },
      { num: 4, name: 'Abril' },
      { num: 5, name: 'Mayo' },
      { num: 6, name: 'Junio' },
      { num: 7, name: 'Julio' },
      { num: 8, name: 'Agosto' },
      { num: 9, name: 'Septiembre' },
      { num: 10, name: 'Octubre' },
      { num: 11, name: 'Noviembre' },
      { num: 12, name: 'Diciembre' },
    ]
  }

  function getDays(): number[] {
    if (!fechaAnio || !fechaMes) return []
    const year = parseInt(fechaAnio)
    const month = parseInt(fechaMes)
    const daysInMonth = new Date(year, month, 0).getDate()
    return Array.from({ length: daysInMonth }, (_, i) => i + 1)
  }

  function selectYear(year: number) {
    setFechaAnio(year.toString())
    setCascadeStep('month')
  }

  function selectMonth(monthNum: number) {
    setFechaMes(monthNum.toString().padStart(2, '0'))
    setCascadeStep('day')
  }

  function selectDay(day: number) {
    setFechaDia(day.toString().padStart(2, '0'))
    setCascadeStep(null)
    cantidadRef.current?.focus()
  }

  function resetCascade() {
    setFechaAnio('')
    setFechaMes('')
    setFechaDia('')
    setCascadeStep(null)
  }

  function handleCantidadKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      guardar()
    }
  }

  async function guardar() {
    if (!producto || !fecha || !cantidad) {
      setError('Completá fecha y cantidad')
      return
    }
    const cant = parseInt(cantidad)
    if (isNaN(cant) || cant <= 0) {
      setError('Cantidad inválida')
      return
    }
    if (isExpired && !confirmVencido) {
      setError('Confirmá que el producto está vencido antes de guardar')
      return
    }
    setError('')
    setSaving(true)

    try {
      const { data: existing } = await supabase
        .from('vencimientos')
        .select('id, cantidad')
        .eq('producto_id', producto.id)
        .eq('sucursal_id', sucursalId)
        .eq('fecha_vencimiento', fecha)
        .single()

      if (existing) {
        await supabase
          .from('vencimientos')
          .update({ cantidad: existing.cantidad + cant, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
      } else {
        await supabase.from('vencimientos').insert({
          producto_id: producto.id,
          sucursal_id: sucursalId,
          fecha_vencimiento: fecha,
          cantidad: cant,
          origen: 'manual',
        })
      }

      const sucursalNombre = SUCURSALES.find(s => s.id === sucursalId)?.nombre ?? sucursalId
      setConfirmados(prev => [
        { sku: producto.sku, nombre: producto.nombre, sucursal: sucursalNombre, fecha, cantidad: cant },
        ...prev,
      ])

      setProducto(null)
      setBarcode('')
      setFechaAnio('')
      setFechaMes('')
      setFechaDia('')
      setCantidad('')
      setCascadeStep(null)
      setConfirmVencido(false)
      barcodeRef.current?.focus()
    } catch {
      setError('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  function resetProducto() {
    setProducto(null)
    setMatches([])
    setNotFound(false)
    setBarcode('')
    setFechaAnio('')
    setFechaMes('')
    setFechaDia('')
    setCantidad('')
    setCascadeStep(null)
    setConfirmVencido(false)
    setStockPorSucursal({})
    barcodeRef.current?.focus()
  }

  async function generarOrdenTrabajo() {
    setLoadingOrden(true)
    setOrdenTrabajo(null)

    try {
      const PAGE = 1000

      // 1. Traer todos los vencimientos de esta sucursal (sin .in() de IDs grandes)
      const stockMap = new Map<string, number>()
      let from = 0
      while (true) {
        const { data: page } = await supabase
          .from('lotes')
          .select('producto_id,cantidad')
          .eq('sucursal_id', sucursalId)
          .gt('cantidad', 0)
          .range(from, from + PAGE - 1)
        if (!page || page.length === 0) break
        for (const l of page as Array<{ producto_id: string; cantidad: number }>) {
          stockMap.set(l.producto_id, (stockMap.get(l.producto_id) ?? 0) + l.cantidad)
        }
        if (page.length < PAGE) break
        from += PAGE
      }

      if (stockMap.size === 0) {
        setOrdenTrabajo([])
        setLoadingOrden(false)
        return
      }

      // 2. Traer todos los vencimientos de esta sucursal (paginado, sin .in() grande)
      let vencIds: string[] = []
      from = 0
      while (true) {
        const { data: page } = await supabase
          .from('vencimientos')
          .select('producto_id')
          .eq('sucursal_id', sucursalId)
          .range(from, from + PAGE - 1)
        if (!page || page.length === 0) break
        vencIds = vencIds.concat((page as Array<{ producto_id: string }>).map(v => v.producto_id))
        if (page.length < PAGE) break
        from += PAGE
      }
      const withVenc = new Set(vencIds)

      // 3. Filtrar client-side: productos con stock pero sin vencimiento en esta sucursal
      const pendingIds = Array.from(stockMap.keys()).filter(id => !withVenc.has(id))

      if (pendingIds.length === 0) {
        setOrdenTrabajo([])
        setLoadingOrden(false)
        return
      }

      // 4. Fetch detalles en batches de 200 para no exceder límite de URL
      const BATCH = 200
      let allProds: Omit<Producto, 'stock_dux'>[] = []
      for (let i = 0; i < pendingIds.length; i += BATCH) {
        const { data } = await supabase
          .from('productos')
          .select('id,sku,nombre,categoria,codigo_barras')
          .in('id', pendingIds.slice(i, i + BATCH))
        if (data) allProds = allProds.concat(data as Omit<Producto, 'stock_dux'>[])
      }

      const orden = allProds
        .map(p => ({ ...p, stock_dux: stockMap.get(p.id) ?? 0 }))
        .sort((a, b) => b.stock_dux - a.stock_dux) as Producto[]

      setOrdenTrabajo(orden)
    } catch {
      setOrdenTrabajo([])
    }
    setLoadingOrden(false)
  }

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/vencimientos" className="text-zinc-400 hover:text-zinc-700 text-sm">← Vencimientos</Link>
        <h1 className="text-xl font-semibold text-zinc-900">Carga Rápida</h1>
      </div>
      <p className="text-sm text-zinc-500 -mt-4">Escaneá o escribí el código/nombre y presioná Enter en cada campo</p>

      {/* Sucursal selector */}
      <div>
        <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Sucursal / Depósito</label>
        <Select value={sucursalId} onValueChange={v => setSucursalId(v ?? SUCURSALES[0].id)}>
          <SelectTrigger className="w-full">
            <SelectValue>{SUCURSALES.find(s => s.id === sucursalId)?.nombre}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SUCURSALES.map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Search input */}
      <div>
        <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Código de barras, SKU o nombre</label>
        <div className="flex gap-2">
          <Input
            ref={barcodeRef}
            value={barcode}
            onChange={e => setBarcode(e.target.value)}
            onKeyDown={handleBarcodeKey}
            placeholder="Escanear o escribir..."
            className="font-mono text-lg h-12"
            autoComplete="off"
          />
          <Button onClick={() => buscarProducto(barcode)} variant="outline" className="h-12 px-4">Buscar</Button>
        </div>
        {notFound && (
          <p className="text-sm text-red-600 mt-1">Producto no encontrado — verificá el código o nombre</p>
        )}

        {/* Multiple name matches */}
        {matches.length > 0 && (
          <div className="mt-2 border rounded-md divide-y bg-white shadow-sm">
            <p className="px-3 py-2 text-xs text-zinc-500 font-medium">{matches.length} resultados — elegí uno:</p>
            {matches.map(m => (
              <button
                key={m.id}
                onClick={() => { setProducto(m); fetchStockPorSucursal(m.id); setMatches([]); setCascadeStep(null); setFechaAnio(''); setFechaMes(''); setFechaDia(''); }}
                className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 transition-colors"
              >
                <span className="text-sm font-medium text-zinc-800">{m.nombre ?? m.sku}</span>
                <span className="text-xs text-zinc-400 ml-2 font-mono">{m.sku}</span>
                {m.categoria && <span className="text-xs text-zinc-400 ml-2">{m.categoria}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Product found: info + form */}
      {producto && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-zinc-900">{producto.nombre ?? producto.sku}</p>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">{producto.sku}</p>
              {producto.categoria && <p className="text-xs text-zinc-500 mt-0.5">{producto.categoria}</p>}
            </div>
            <div className="shrink-0 flex flex-col gap-1 items-end">
              {SUCURSALES.map(s => {
                const cant = stockPorSucursal[s.id] ?? 0
                const esActual = s.id === sucursalId
                return (
                  <div key={s.id} className={`flex items-center gap-2 rounded px-2 py-0.5 text-xs ${esActual ? 'bg-zinc-900 text-white font-semibold' : 'bg-zinc-100 text-zinc-500'}`}>
                    <span className="max-w-[110px] truncate">{s.nombre.replace('SOHO 1 - ', 'S1 ').replace('SOHO 2 - ', 'S2 ')}</span>
                    <span className="tabular-nums font-bold">{cant.toLocaleString('es-AR')}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Date: cascading selector */}
          <div>
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2 block">Fecha de vencimiento</label>

            {!cascadeStep ? (
              <div className="space-y-2">
                {fecha && (
                  <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-green-700">
                      {fechaDia.padStart(2, '0')}/{fechaMes.padStart(2, '0')}/{fechaAnio}
                    </span>
                    <button
                      type="button"
                      onClick={resetCascade}
                      className="text-xs text-green-600 hover:text-green-800 underline"
                    >Cambiar</button>
                  </div>
                )}
                {!fecha && (
                  <button
                    type="button"
                    onClick={() => setCascadeStep('year')}
                    className="w-full rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 py-3 text-center text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:bg-white transition-colors"
                  >
                    Seleccionar fecha
                  </button>
                )}
              </div>
            ) : cascadeStep === 'year' ? (
              <div>
                <p className="text-xs text-zinc-500 mb-2 font-medium">Año</p>
                <div className="grid grid-cols-4 gap-2">
                  {getYears().map(y => (
                    <button
                      key={y}
                      type="button"
                      onClick={() => selectYear(y)}
                      className="rounded-lg border-2 border-zinc-200 py-2 text-sm font-medium transition-all hover:border-blue-400 hover:bg-blue-50"
                    >
                      {y}
                    </button>
                  ))}
                </div>
              </div>
            ) : cascadeStep === 'month' ? (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-700">{fechaAnio}</span>
                  <button
                    type="button"
                    onClick={() => setCascadeStep('year')}
                    className="text-xs text-zinc-400 hover:text-zinc-600 underline"
                  >cambiar</button>
                </div>
                <p className="text-xs text-zinc-500 mb-2 font-medium">Mes</p>
                <div className="grid grid-cols-3 gap-2">
                  {getMonths().map(m => (
                    <button
                      key={m.num}
                      type="button"
                      onClick={() => selectMonth(m.num)}
                      className="rounded-lg border-2 border-zinc-200 py-2 text-sm font-medium transition-all hover:border-blue-400 hover:bg-blue-50"
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : cascadeStep === 'day' ? (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-700">{fechaAnio} - {getMonths().find(m => m.num === parseInt(fechaMes))?.name}</span>
                  <button
                    type="button"
                    onClick={() => setCascadeStep('month')}
                    className="text-xs text-zinc-400 hover:text-zinc-600 underline"
                  >cambiar</button>
                </div>
                <p className="text-xs text-zinc-500 mb-2 font-medium">Día</p>
                <div className="grid grid-cols-7 gap-1.5 max-h-48 overflow-y-auto">
                  {getDays().map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => selectDay(d)}
                      className="rounded-lg border-2 border-zinc-200 py-2 text-sm font-medium transition-all hover:border-blue-400 hover:bg-blue-50 text-center"
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* Alerta fecha vencida */}
          {isExpired && (
            <div className="rounded-lg bg-red-50 border border-red-300 px-3 py-3 space-y-2">
              <p className="text-sm font-semibold text-red-700">⚠️ La fecha seleccionada ya está vencida</p>
              <p className="text-xs text-red-600">Este producto estaría vencido al momento de la carga. Confirmá solo si es intencional (ej: registrar stock vencido para dar de baja).</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmVencido}
                  onChange={e => setConfirmVencido(e.target.checked)}
                  className="rounded border-red-400 text-red-600 focus:ring-red-400"
                />
                <span className="text-sm font-medium text-red-700">Acepto cargar un producto vencido</span>
              </label>
            </div>
          )}

          {/* Cantidad */}
          <div>
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Cantidad</label>
            <Input
              ref={cantidadRef}
              type="number"
              min="1"
              value={cantidad}
              onChange={e => setCantidad(e.target.value)}
              onKeyDown={handleCantidadKey}
              placeholder="Ej: 24"
              className="h-11 text-base"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={guardar} disabled={saving} className="flex-1 h-11">
              {saving ? 'Guardando...' : 'Guardar (Enter)'}
            </Button>
            <Button onClick={resetProducto} variant="outline" className="h-11">Cancelar</Button>
          </div>
        </div>
      )}

      {/* Confirmados */}
      {confirmados.length > 0 && (
        <div>
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">Cargados en esta sesión</p>
          <div className="space-y-1.5">
            {confirmados.map((c, i) => (
              <div key={i} className="flex items-center justify-between rounded-md bg-green-50 border border-green-100 px-3 py-2">
                <div>
                  <span className="text-sm font-medium text-zinc-700">{c.nombre ?? c.sku}</span>
                  <span className="text-xs text-zinc-400 ml-2">{c.sucursal}</span>
                </div>
                <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                  {c.cantidad} ud — {c.fecha.split('-').reverse().join('/')}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Orden de trabajo */}
      <div className="border-t pt-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-medium text-zinc-700">Orden de trabajo</p>
          <Button variant="outline" size="sm" onClick={generarOrdenTrabajo} disabled={loadingOrden}>
            {loadingOrden ? 'Generando...' : 'Generar'}
          </Button>
        </div>
        <div className="mb-3">
          <span className="inline-block text-xs font-semibold bg-zinc-900 text-white rounded px-2 py-0.5">
            {SUCURSALES.find(s => s.id === sucursalId)?.nombre}
          </span>
          <p className="text-xs text-zinc-400 mt-1">Productos con stock en esta ubicación sin vencimiento cargado</p>
        </div>

        {ordenTrabajo !== null && (
          ordenTrabajo.length === 0 ? (
            <p className="text-sm text-green-600 font-medium">¡Todo cargado! No hay productos pendientes en {SUCURSALES.find(s => s.id === sucursalId)?.nombre}.</p>
          ) : (
            <div>
              <p className="text-xs text-zinc-500 mb-2">{ordenTrabajo.length} productos pendientes en {SUCURSALES.find(s => s.id === sucursalId)?.nombre}</p>
              <div className="rounded-md border divide-y max-h-96 overflow-y-auto bg-white">
                {ordenTrabajo.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setProducto(p); fetchStockPorSucursal(p.id); setBarcode(p.sku); setMatches([]); setCascadeStep(null); setFechaAnio(''); setFechaMes(''); setFechaDia(''); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-zinc-800 block truncate">{p.nombre ?? p.sku}</span>
                      <span className="text-xs text-zinc-400 font-mono">{p.sku}</span>
                      {p.categoria && <span className="text-xs text-zinc-400 ml-2">{p.categoria}</span>}
                    </div>
                    <span className="text-xs font-medium text-zinc-600 shrink-0 bg-zinc-100 rounded px-2 py-0.5">{p.stock_dux} ud</span>
                  </button>
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
