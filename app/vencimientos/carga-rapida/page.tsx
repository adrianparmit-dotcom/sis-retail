'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
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
  const fechaRef = useRef<HTMLInputElement>(null)
  const cantidadRef = useRef<HTMLInputElement>(null)

  const [barcode, setBarcode] = useState(initialSku)
  const [producto, setProducto] = useState<Producto | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [sucursalId, setSucursalId] = useState(SUCURSALES[0].id)
  const [fecha, setFecha] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmados, setConfirmados] = useState<Confirmado[]>([])
  const [error, setError] = useState('')

  // Auto-focus barcode on mount; if SKU provided via query, search immediately
  useEffect(() => {
    if (initialSku) {
      buscarProducto(initialSku)
    } else {
      barcodeRef.current?.focus()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function buscarProducto(query: string) {
    const q = query.trim()
    if (!q) return
    setNotFound(false)
    setProducto(null)

    // Try by SKU first, then by barcode
    let { data } = await supabase
      .from('productos')
      .select('id,sku,nombre,categoria,stock_dux,codigo_barras')
      .eq('sku', q)
      .single()

    if (!data) {
      const res = await supabase
        .from('productos')
        .select('id,sku,nombre,categoria,stock_dux,codigo_barras')
        .eq('codigo_barras', q)
        .single()
      data = res.data
    }

    if (data) {
      setProducto(data as Producto)
      // Focus fecha field after product found
      setTimeout(() => fechaRef.current?.focus(), 50)
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

  function handleFechaKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      cantidadRef.current?.focus()
    }
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
    setError('')
    setSaving(true)

    try {
      // Check if a record already exists for this product+sucursal+fecha
      const { data: existing } = await supabase
        .from('vencimientos')
        .select('id, cantidad')
        .eq('producto_id', producto.id)
        .eq('sucursal_id', sucursalId)
        .eq('fecha_vencimiento', fecha)
        .single()

      if (existing) {
        // Accumulate quantity
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

      // Reset for next scan
      setProducto(null)
      setBarcode('')
      setFecha('')
      setCantidad('')
      barcodeRef.current?.focus()
    } catch {
      setError('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  function resetProducto() {
    setProducto(null)
    setNotFound(false)
    setBarcode('')
    setFecha('')
    setCantidad('')
    barcodeRef.current?.focus()
  }

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/vencimientos" className="text-zinc-400 hover:text-zinc-700 text-sm">← Vencimientos</Link>
        <h1 className="text-xl font-semibold text-zinc-900">Carga Rápida</h1>
      </div>
      <p className="text-sm text-zinc-500 -mt-4">Escaneá o escribí el código y presioná Enter en cada campo</p>

      {/* Sucursal selector (persists between scans) */}
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

      {/* Barcode / SKU input */}
      <div>
        <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Código de barras o SKU</label>
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
          <p className="text-sm text-red-600 mt-1">Producto no encontrado — verificá el código</p>
        )}
      </div>

      {/* Product found: show info + form */}
      {producto && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-4">
          {/* Product info */}
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold text-zinc-900">{producto.nombre ?? producto.sku}</p>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">{producto.sku}</p>
              {producto.categoria && <p className="text-xs text-zinc-500 mt-0.5">{producto.categoria}</p>}
            </div>
            <div className="text-right">
              <p className="text-xs text-zinc-400">Stock</p>
              <p className="font-bold text-zinc-700">{(producto.stock_dux ?? 0).toLocaleString('es-AR')}</p>
            </div>
          </div>

          {/* Fecha vencimiento */}
          <div>
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Fecha de vencimiento</label>
            <Input
              ref={fechaRef}
              type="date"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              onKeyDown={handleFechaKey}
              className="h-11 text-base"
            />
          </div>

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

          {/* Actions */}
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
                <div className="flex items-center gap-2">
                  <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                    {c.cantidad} ud — {c.fecha.split('-').reverse().join('/')}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
