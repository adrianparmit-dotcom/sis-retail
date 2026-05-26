'use client'

/**
 * /recepciones/factura
 * Invoice-based reception: paste PDF text → auto-parse → review & match → confirm.
 *
 * Granel workflow:
 *   - Granel products (categoria = 'GRANEL') default to cantidad_recibida = 0
 *   - They are saved as borrador; quantities are updated as fractionation happens
 *   - Vencimientos for granel are NOT created here — fraccionamiento creates them
 *   - Borrador can be loaded via ?borrador=<id> URL param
 *
 * Flow:
 *   Step 1 – Select supplier + paste PDF text
 *   Step 2 – Review matched items (green/yellow/red), fill qty received + expiry
 *   Step 3 – Confirm → POST Dux v2/compras + update Supabase + download price Excel
 */

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { parseFactura, calcPrecioVenta, nameMatchScore, detectProveedorType } from '@/lib/invoice-parsers'
import type { InvoiceLineItem, ParsedFactura, MatchConfidence, ProveedorType, SkuMapEntry } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertCircle, CheckCircle2, HelpCircle, Download, Loader2, ChevronRight, Save } from 'lucide-react'

// ── Constants ────────────────────────────────────────────────────

const SUCURSALES = [
  { id: 'a0000000-0000-0000-0000-000000000001', nombre: 'SOHO 1 - Local',    dux_deposito: 7951,  dux_sucursal: 7951 },
  { id: 'a0000000-0000-0000-0000-000000000002', nombre: 'SOHO 1 - La Pieza', dux_deposito: 8545,  dux_sucursal: 7951 },
  { id: 'a0000000-0000-0000-0000-000000000003', nombre: 'SOHO 2 - Local',    dux_deposito: 15289, dux_sucursal: 15289 },
  { id: 'a0000000-0000-0000-0000-000000000004', nombre: 'SOHO 2 - Depósito', dux_deposito: 15513, dux_sucursal: 15289 },
]

const PROVEEDOR_LABELS: Record<ProveedorType | 'auto', string> = {
  auto : 'Auto-detectar',
  diet : 'Diet / Mayordiet',
  ankas: 'Ankas del Sur',
  epn  : 'EPN / Mayorista',
  otro : 'Otro (manual)',
}

const CONFIDENCE_BADGE: Record<MatchConfidence, { label: string; cls: string }> = {
  exacto    : { label: '● Exacto',    cls: 'bg-green-100 text-green-700 border-green-300' },
  sku_map   : { label: '● Mapa SKU',  cls: 'bg-blue-100 text-blue-700 border-blue-300' },
  nombre    : { label: '◐ Nombre',    cls: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
  manual    : { label: '✎ Manual',    cls: 'bg-purple-100 text-purple-700 border-purple-300' },
  sin_match : { label: '✕ Sin match', cls: 'bg-red-100 text-red-700 border-red-300' },
}

// ── Local types ──────────────────────────────────────────────────

interface Producto {
  id               : string
  sku              : string
  nombre           : string | null
  codigo_barras    : string | null
  precio_venta     : number | null
  costo            : number | null
  proveedor_id_dux : number | null
  categoria        : string | null
}

type Step = 'paste' | 'review' | 'done'

// ── DateSelector ─────────────────────────────────────────────────

function DateSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 7 }, (_, i) => currentYear - 1 + i)

  const [selY, setSelY] = useState(value.split('-')[0] ?? '')
  const [selM, setSelM] = useState(value.split('-')[1] ?? '')
  const [selD, setSelD] = useState(value.split('-')[2] ?? '')
  const [step, setStep] = useState<'year'|'month'|'day'|null>(null)

  useEffect(() => {
    if (!value) { setSelY(''); setSelM(''); setSelD(''); return }
    const [y, m, d] = value.split('-')
    setSelY(y ?? ''); setSelM(m ?? ''); setSelD(d ?? '')
  }, [value])

  const getDays = () => !selY || !selM ? [] :
    Array.from({ length: new Date(parseInt(selY), parseInt(selM), 0).getDate() }, (_, i) => i + 1)

  const display = selY && selM && selD ? `${selD}/${selM}/${selY}` : ''

  if (!step) return display ? (
    <div className="rounded bg-green-50 border border-green-200 px-2 py-1 flex items-center gap-2 min-w-[110px]">
      <span className="text-xs font-semibold text-green-700">{display}</span>
      <button type="button" onClick={() => setStep('year')} className="text-xs text-green-600 underline shrink-0">✎</button>
    </div>
  ) : (
    <button type="button" onClick={() => setStep('year')}
      className="rounded border-2 border-dashed border-zinc-300 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-400 whitespace-nowrap">
      + Vencimiento
    </button>
  )

  if (step === 'year') return (
    <div className="absolute z-50 rounded-lg border bg-white p-2 shadow-lg min-w-[196px]">
      <p className="text-xs text-zinc-400 mb-1">Año</p>
      <div className="grid grid-cols-4 gap-1">
        {years.map(y => (
          <button key={y} type="button" onClick={() => { setSelY(y.toString()); setStep('month') }}
            className={`rounded border py-1 text-xs font-medium hover:bg-blue-50 hover:border-blue-300 ${selY === y.toString() ? 'border-blue-400 bg-blue-50' : 'border-zinc-200'}`}>
            {y}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setStep(null)} className="mt-1 text-xs text-zinc-400 underline">Cancelar</button>
    </div>
  )

  if (step === 'month') return (
    <div className="absolute z-50 rounded-lg border bg-white p-2 shadow-lg min-w-[196px]">
      <div className="flex items-center gap-2 mb-1"><span className="text-xs font-medium">{selY}</span>
        <button onClick={() => setStep('year')} className="text-xs text-zinc-400 underline">cambiar</button></div>
      <div className="grid grid-cols-3 gap-1">
        {MONTHS.map((m, i) => { const mv = String(i+1).padStart(2,'0')
          return <button key={m} type="button" onClick={() => { setSelM(mv); setStep('day') }}
            className={`rounded border py-1 text-xs hover:bg-blue-50 hover:border-blue-300 ${selM === mv ? 'border-blue-400 bg-blue-50' : 'border-zinc-200'}`}>{m}</button>
        })}
      </div>
    </div>
  )

  return (
    <div className="absolute z-50 rounded-lg border bg-white p-2 shadow-lg min-w-[196px]">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium">{selY} – {MONTHS[parseInt(selM)-1]}</span>
        <button onClick={() => setStep('month')} className="text-xs text-zinc-400 underline">cambiar</button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {getDays().map(d => { const dv = d.toString().padStart(2,'0')
          return <button key={d} type="button"
            onClick={() => { setSelD(dv); setStep(null); onChange(`${selY}-${selM}-${dv}`) }}
            className={`rounded border py-1 text-xs text-center hover:bg-blue-50 hover:border-blue-300 ${selD === dv ? 'border-blue-400 bg-blue-50' : 'border-zinc-200'}`}>{d}</button>
        })}
      </div>
    </div>
  )
}

// ── Product search popup ─────────────────────────────────────────

function ProductSearch({ productos, onSelect, onClose }: {
  productos: Producto[]
  onSelect: (p: Producto) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const barcodeMap = useMemo(() =>
    new Map(productos.filter(p => p.codigo_barras).map(p => [p.codigo_barras!, p]))
  , [productos])

  const filtered = useMemo(() => !q.trim() ? [] :
    productos.filter(p => `${p.nombre ?? ''} ${p.sku} ${p.codigo_barras ?? ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 20)
  , [productos, q])

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter') {
      const found = barcodeMap.get(q.trim()) ?? productos.find(p => p.sku === q.trim())
      if (found) { onSelect(found); onClose() }
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-medium text-zinc-700 mb-2">Buscar producto en el sistema</p>
        <Input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={handleKey}
          placeholder="Nombre, SKU o código de barras..." />
        <div className="mt-2 max-h-64 overflow-y-auto space-y-0.5">
          {filtered.map(p => (
            <button key={p.id} className="w-full text-left px-3 py-2 rounded hover:bg-zinc-50 text-sm"
              onClick={() => { onSelect(p); onClose() }}>
              <span className="font-medium">{p.nombre ?? p.sku}</span>
              <span className="text-zinc-400 text-xs ml-2 font-mono">{p.sku}</span>
              {p.categoria && <span className="text-zinc-400 text-xs ml-2">{p.categoria}</span>}
            </button>
          ))}
          {q.length > 1 && filtered.length === 0 && (
            <p className="text-xs text-zinc-400 py-3 text-center">Sin resultados para "{q}"</p>
          )}
        </div>
        <button onClick={onClose} className="mt-3 text-xs text-zinc-400 underline">Cerrar</button>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────

export default function RecepcionFacturaPage() {
  const [step, setStep]                       = useState<Step>('paste')
  const [texto, setTexto]                     = useState('')
  const [tipoProveedor, setTipoProveedor]     = useState<ProveedorType | 'auto'>('auto')
  const [sucursalId, setSucursalId]           = useState(SUCURSALES[0].id)
  const [factura, setFactura]                 = useState<ParsedFactura | null>(null)
  const [items, setItems]                     = useState<InvoiceLineItem[]>([])

  // Draft state
  const [borradorId, setBorradorId]           = useState<string | null>(null)
  const [borradorSavedAt, setBorradorSavedAt] = useState<string | null>(null)
  const [savingBorrador, setSavingBorrador]   = useState(false)

  // DB data
  const [productos, setProductos]             = useState<Producto[]>([])
  const [skuMap, setSkuMap]                   = useState<SkuMapEntry[]>([])
  const [margenProveedor, setMargenProveedor] = useState<number>(0.40)
  const [loadingProds, setLoadingProds]       = useState(true)

  // UI state
  const [searchTarget, setSearchTarget]       = useState<number | null>(null)
  const [saving, setSaving]                   = useState(false)
  const [doneReport, setDoneReport]           = useState('')
  const [duxError, setDuxError]               = useState<string | null>(null)
  const [priceExcelUrl, setPriceExcelUrl]     = useState<string | null>(null)
  const [priceExcelCount, setPriceExcelCount] = useState(0)
  const [loadingPdf, setLoadingPdf]           = useState(false)
  const pdfInputRef                           = useRef<HTMLInputElement>(null)

  // ── Load products + SKU map ──────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoadingProds(true)
      const [prodRes, skuRes] = await Promise.all([
        supabase.from('productos')
          .select('id,sku,nombre,codigo_barras,precio_venta,costo,proveedor_id_dux,categoria')
          .order('nombre'),
        supabase.from('proveedor_sku_map').select('*'),
      ])
      setProductos((prodRes.data ?? []) as Producto[])
      setSkuMap((skuRes.data ?? []) as SkuMapEntry[])
      setLoadingProds(false)
    }
    load()
  }, [])

  // Load borrador from URL if present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const bid = params.get('borrador')
    if (bid) loadBorrador(bid)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadBorrador(id: string) {
    const [recRes, itemsRes] = await Promise.all([
      supabase.from('recepciones').select('*').eq('id', id).single(),
      supabase.from('recepcion_items').select('*').eq('recepcion_id', id).order('id'),
    ])
    if (!recRes.data) return
    const rec = recRes.data as {
      proveedor_nombre: string | null; nro_comprobante?: string | null; numero_comprobante?: string | null
      fecha_factura: string | null; sucursal_id: string | null; texto_original: string | null
    }

    const inv: ParsedFactura = {
      proveedor_nombre : rec.proveedor_nombre ?? '',
      proveedor_type   : 'otro',
      nro_comprobante  : rec.nro_comprobante ?? rec.numero_comprobante ?? '',
      fecha            : rec.fecha_factura ? rec.fecha_factura.split('-').reverse().join('/') : '',
      items            : [],
    }

    const dbItems = (itemsRes.data ?? []) as Array<{
      sku: string; nombre_producto: string | null; cantidad_esperada: number
      cantidad_recibida: number | null; fecha_vencimiento: string | null
      estado: string; producto_id: string | null
    }>

    const reconstructed: InvoiceLineItem[] = dbItems.map(it => ({
      sku_proveedor         : it.sku,
      descripcion_proveedor : it.nombre_producto ?? it.sku,
      cantidad              : it.cantidad_esperada,
      costo_unitario        : 0,
      iva_porcentaje        : 21,
      precio_venta_sugerido : 0,
      match_confidence      : it.producto_id ? 'sku_map' : 'sin_match',
      producto_id           : it.producto_id ?? undefined,
      cantidad_recibida     : it.cantidad_recibida ?? 0,
      fecha_vencimiento     : it.fecha_vencimiento ?? '',
      estado_recepcion      : (it.estado as InvoiceLineItem['estado_recepcion']) ?? 'ok',
      es_blister            : /^BLISTER\s/i.test(it.nombre_producto ?? ''),
      unidades_por_blister  : 1,
      es_granel             : false,
    }))

    setSucursalId(rec.sucursal_id ?? SUCURSALES[0].id)
    setTexto(rec.texto_original ?? '')
    setFactura(inv)
    setItems(reconstructed)
    setBorradorId(id)
    setStep('review')
  }

  // ── Lookup maps ──────────────────────────────────────────────

  const barcodeMap = useMemo(() =>
    new Map(productos.filter(p => p.codigo_barras).map(p => [p.codigo_barras!, p]))
  , [productos])

  const skuProdMap = useMemo(() =>
    new Map(productos.map(p => [p.sku, p]))
  , [productos])

  // Fetch margin when factura changes
  useEffect(() => {
    if (!factura?.proveedor_nombre) return
    supabase.from('proveedores_config')
      .select('margen_costo')
      .ilike('nombre', `%${factura.proveedor_nombre}%`)
      .single()
      .then(({ data }) => {
        if (data?.margen_costo != null) setMargenProveedor(data.margen_costo as number)
      })
  }, [factura?.proveedor_nombre])

  // ── Matching ─────────────────────────────────────────────────

  function applyMatch(item: InvoiceLineItem, p: Producto, confidence: MatchConfidence): InvoiceLineItem {
    const esGranel  = p.categoria?.toUpperCase() === 'GRANEL'
    const esBlister = item.es_blister || /^BLISTER\s/i.test(p.nombre ?? '')
    const pv = margenProveedor > 0 ? calcPrecioVenta(item.costo_unitario, margenProveedor) : (p.precio_venta ?? 0)
    return {
      ...item,
      producto_id            : p.id,
      producto_sku           : p.sku,
      producto_nombre        : p.nombre ?? undefined,
      producto_precio_actual : p.precio_venta ?? undefined,
      producto_id_dux        : p.proveedor_id_dux ?? undefined,
      match_confidence       : confidence,
      precio_venta_sugerido  : pv,
      es_blister             : esBlister,
      es_granel              : esGranel,
      // Granel products start with 0 received — updated as fractionation happens
      cantidad_recibida      : esGranel ? 0 : item.cantidad_recibida,
    }
  }

  function matchItem(item: InvoiceLineItem, proveedorNombre: string): InvoiceLineItem {
    // 1. Barcode exact match (EAN13)
    if (item.sku_proveedor && barcodeMap.has(item.sku_proveedor))
      return applyMatch(item, barcodeMap.get(item.sku_proveedor)!, 'exacto')

    // 2. SKU map match
    const mapEntry = skuMap.find(
      e => e.proveedor_nombre.toLowerCase() === proveedorNombre.toLowerCase()
        && e.sku_proveedor === item.sku_proveedor
    )
    if (mapEntry?.producto_id) {
      const p = productos.find(p => p.id === mapEntry.producto_id)
      if (p) return applyMatch(item, p, 'sku_map')
    }

    // 3. Direct SKU match
    if (item.sku_proveedor && skuProdMap.has(item.sku_proveedor))
      return applyMatch(item, skuProdMap.get(item.sku_proveedor)!, 'exacto')

    // 4. Fuzzy name match
    let best = 0; let bestProd: Producto | null = null
    for (const p of productos) {
      const s = nameMatchScore(item.descripcion_proveedor, p.nombre ?? '')
      if (s > best) { best = s; bestProd = p }
    }
    if (best >= 0.55 && bestProd)
      return applyMatch(item, bestProd, 'nombre')

    return { ...item, match_confidence: 'sin_match' }
  }

  // ── Step 1 ────────────────────────────────────────────────────

  async function handlePdfUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoadingPdf(true)
    try {
      // Send PDF to Claude API — it reads and extracts structured data directly
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/parse-invoice', { method: 'POST', body: fd })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? `Error ${res.status}`)
      }
      const data = await res.json() as {
        proveedor: string
        nro_comprobante: string
        fecha: string
        items: Array<{
          codigo: string
          descripcion: string
          cantidad: number
          costo_unitario: number
          iva_porcentaje: number
        }>
      }

      // Build ParsedFactura from Claude response
      const tipo = tipoProveedor === 'auto' ? detectProveedorType(data.proveedor) : tipoProveedor
      const parsed: import('@/lib/types').ParsedFactura = {
        proveedor_nombre : data.proveedor,
        proveedor_type   : tipo === 'otro' ? 'otro' : tipo,
        nro_comprobante  : data.nro_comprobante ?? '',
        fecha            : data.fecha ?? '',
        items            : data.items.map(it => ({
          sku_proveedor         : it.codigo ?? '',
          descripcion_proveedor : it.descripcion,
          cantidad              : it.cantidad,
          costo_unitario        : it.costo_unitario,
          iva_porcentaje        : it.iva_porcentaje ?? 21,
          precio_venta_sugerido : 0,
          match_confidence      : 'sin_match' as const,
          cantidad_recibida     : it.cantidad,
          fecha_vencimiento     : '',
          estado_recepcion      : 'ok' as const,
          es_blister            : /^blister\s/i.test(it.descripcion),
          unidades_por_blister  : 1,
          es_granel             : false,
        })),
      }

      setTexto(JSON.stringify(data, null, 2))
      const matched = parsed.items.map(item => matchItem(item, parsed.proveedor_nombre))
      setFactura(parsed)
      setItems(matched)
      setStep('review')
    } catch (err) {
      alert('Error al procesar el PDF: ' + (err as Error).message)
    } finally {
      setLoadingPdf(false)
      if (pdfInputRef.current) pdfInputRef.current.value = ''
    }
  }

  function handleParsear() {
    if (!texto.trim()) return
    const tipo   = tipoProveedor === 'auto' ? detectProveedorType(texto) : tipoProveedor
    const parsed = parseFactura(texto, tipo)
    const matched = parsed.items.map(item => matchItem(item, parsed.proveedor_nombre))
    setFactura(parsed)
    setItems(matched)
    setStep('review')
  }

  // ── Step 2: Update item ───────────────────────────────────────

  function updateItem(idx: number, patch: Partial<InvoiceLineItem>) {
    setItems(prev => {
      const next = [...prev]
      const merged = { ...next[idx], ...patch }
      if (patch.cantidad_recibida !== undefined || patch.fecha_vencimiento !== undefined) {
        const qty = merged.cantidad_recibida
        const exp = merged.cantidad
        const fv  = merged.fecha_vencimiento
        let estado = merged.estado_recepcion
        if (fv && fv < new Date().toISOString().split('T')[0]) estado = 'vencido_llegada'
        else if (qty < exp) estado = 'faltante'
        else if (qty > exp) estado = 'extra'
        else estado = 'ok'
        merged.estado_recepcion = estado
      }
      if (patch.costo_unitario !== undefined && margenProveedor > 0) {
        merged.precio_venta_sugerido = calcPrecioVenta(merged.costo_unitario, margenProveedor)
      }
      next[idx] = merged
      return next
    })
  }

  function manualMatch(idx: number, p: Producto) {
    setItems(prev => {
      const next = [...prev]
      next[idx] = applyMatch(next[idx], p, 'manual')
      return next
    })
    setSearchTarget(null)
  }

  // ── Save borrador ─────────────────────────────────────────────

  const saveBorrador = useCallback(async () => {
    if (!factura) return
    setSavingBorrador(true)
    try {
      const fechaISO = factura.fecha
        ? factura.fecha.split('/').reverse().join('-')
        : new Date().toISOString().split('T')[0]

      let recId = borradorId
      if (!recId) {
        const { data } = await supabase.from('recepciones').insert({
          numero_comprobante : factura.nro_comprobante || null,
          dux_compra_id      : factura.nro_comprobante || null,
          proveedor_nombre   : factura.proveedor_nombre || null,
          fecha_factura      : fechaISO,
          fecha_recepcion    : new Date().toISOString().split('T')[0],
          estado             : 'borrador',
          sucursal_id        : sucursalId,
          texto_original     : texto,
        }).select('id').single()
        recId = (data as { id: string } | null)?.id ?? null
        if (recId) setBorradorId(recId)
      } else {
        await supabase.from('recepciones')
          .update({ estado: 'borrador', sucursal_id: sucursalId, updated_at: new Date().toISOString() })
          .eq('id', recId)
      }

      if (!recId) throw new Error('No se pudo crear el borrador')

      // Replace all items
      await supabase.from('recepcion_items').delete().eq('recepcion_id', recId)
      for (const item of items) {
        await supabase.from('recepcion_items').insert({
          recepcion_id      : recId,
          producto_id       : item.producto_id ?? null,
          sku               : item.producto_sku ?? item.sku_proveedor,
          nombre_producto   : item.producto_nombre ?? item.descripcion_proveedor,
          cantidad_esperada : item.cantidad,
          cantidad_recibida : item.cantidad_recibida,
          fecha_vencimiento : item.fecha_vencimiento || null,
          estado            : item.estado_recepcion,
        })
      }

      setBorradorSavedAt(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }))
    } catch (err) {
      alert('Error al guardar borrador: ' + (err as Error).message)
    } finally {
      setSavingBorrador(false)
    }
  }, [factura, items, sucursalId, texto, borradorId])

  // ── Confirm ───────────────────────────────────────────────────

  const confirmar = useCallback(async () => {
    if (!factura) return
    setSaving(true)
    setDuxError(null)
    try {
      const sucursal = SUCURSALES.find(s => s.id === sucursalId)!
      const fechaISO = factura.fecha
        ? factura.fecha.split('/').reverse().join('-')
        : new Date().toISOString().split('T')[0]

      // ── 1. Upsert recepciones record ────────────────────────
      let recId: string
      if (borradorId) {
        await supabase.from('recepciones')
          .update({ estado: 'confirmada', sucursal_id: sucursalId,
            fecha_recepcion: new Date().toISOString().split('T')[0] })
          .eq('id', borradorId)
        recId = borradorId
        await supabase.from('recepcion_items').delete().eq('recepcion_id', recId)
      } else {
        const { data, error } = await supabase.from('recepciones').insert({
          numero_comprobante : factura.nro_comprobante || null,
          dux_compra_id      : factura.nro_comprobante || null,
          proveedor_nombre   : factura.proveedor_nombre || null,
          fecha_factura      : fechaISO,
          fecha_recepcion    : new Date().toISOString().split('T')[0],
          estado             : 'confirmada',
          sucursal_id        : sucursalId,
          texto_original     : texto,
        }).select('id').single()
        if (error || !data) throw new Error(error?.message ?? 'Error')
        recId = (data as { id: string }).id
      }

      // ── 2. Save items + vencimientos ────────────────────────
      for (const item of items) {
        await supabase.from('recepcion_items').insert({
          recepcion_id      : recId,
          producto_id       : item.producto_id ?? null,
          sku               : item.producto_sku ?? item.sku_proveedor,
          nombre_producto   : item.producto_nombre ?? item.descripcion_proveedor,
          cantidad_esperada : item.cantidad,
          cantidad_recibida : item.cantidad_recibida,
          fecha_vencimiento : item.fecha_vencimiento || null,
          estado            : item.estado_recepcion,
        })

        // Granel: NO vencimientos here — fraccionamiento creates them
        // Regular products with expiry: create/update vencimiento
        if (
          !item.es_granel &&
          item.producto_id &&
          item.fecha_vencimiento &&
          item.cantidad_recibida > 0 &&
          item.estado_recepcion !== 'vencido_llegada'
        ) {
          const { data: existing } = await supabase.from('vencimientos')
            .select('id,cantidad')
            .eq('producto_id', item.producto_id)
            .eq('sucursal_id', sucursalId)
            .eq('fecha_vencimiento', item.fecha_vencimiento)
            .single()

          if (existing) {
            await supabase.from('vencimientos')
              .update({ cantidad: (existing as { id: string; cantidad: number }).cantidad + item.cantidad_recibida,
                updated_at: new Date().toISOString() })
              .eq('id', (existing as { id: string }).id)
          } else {
            await supabase.from('vencimientos').insert({
              producto_id      : item.producto_id,
              sucursal_id      : sucursalId,
              fecha_vencimiento: item.fecha_vencimiento,
              cantidad         : item.cantidad_recibida,
              origen           : 'recepcion_factura',
              recepcion_id     : recId,
            })
          }
        }
      }

      // ── 3. Save new SKU mappings ─────────────────────────────
      const newMappings = items.filter(i =>
        i.sku_proveedor && i.producto_id &&
        (i.match_confidence === 'manual' || i.match_confidence === 'nombre')
      )
      for (const m of newMappings) {
        await supabase.from('proveedor_sku_map').upsert({
          proveedor_nombre     : factura.proveedor_nombre,
          sku_proveedor        : m.sku_proveedor,
          descripcion_proveedor: m.descripcion_proveedor,
          producto_id          : m.producto_id,
          creado_por           : 'auto',
          updated_at           : new Date().toISOString(),
        }, { onConflict: 'proveedor_nombre,sku_proveedor' })
      }

      // ── 4. POST to Dux v2/compras ────────────────────────────
      // Include all matched items (granel included — Dux needs the purchase registered)
      const duxItems = items.filter(i => i.producto_sku && i.cantidad > 0)
      const provId   = items.find(i => i.producto_id_dux)?.producto_id_dux

      if (duxItems.length > 0 && provId) {
        const duxPayload = {
          id_sucursal     : sucursal.dux_sucursal,
          id_proveedor    : provId,
          id_deposito     : sucursal.dux_deposito,
          fecha           : fechaISO,
          nro_comprobante : factura.nro_comprobante || 'S/N',
          tipo_comprobante: 'FACTURA',
          // For granel: use invoice quantity (what physically arrived), not cantidad_recibida
          productos: duxItems.map(i => ({
            id_item         : i.producto_sku!,
            cantidad        : i.es_granel ? i.cantidad : i.cantidad_recibida,
            precio_unitario : i.costo_unitario,
          })),
        }

        const res = await fetch('/api/dux/compras', {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify(duxPayload),
        })
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          setDuxError(`Dux respondió ${res.status}: ${(e as Record<string,unknown>).error ?? 'error desconocido'}. La recepción se guardó en SOHO — cargala manualmente en Dux si es necesario.`)
        }
      }

      // ── 5. Price Excel ───────────────────────────────────────
      const priceItems = items.filter(i =>
        i.producto_sku && i.precio_venta_sugerido > 0 &&
        Math.abs((i.producto_precio_actual ?? 0) - i.precio_venta_sugerido) > 0.01
      )
      if (priceItems.length > 0) {
        const res = await fetch('/api/dux/exportar-precios', {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({ items: priceItems.map(i => ({ codigo: i.producto_sku!, importe: i.precio_venta_sugerido })) }),
        })
        if (res.ok) {
          setPriceExcelUrl(URL.createObjectURL(await res.blob()))
          setPriceExcelCount(priceItems.length)
        }
      }

      // ── 6. Report ────────────────────────────────────────────
      const ok          = items.filter(i => i.estado_recepcion === 'ok').length
      const faltante    = items.filter(i => i.estado_recepcion === 'faltante').length
      const extra       = items.filter(i => i.estado_recepcion === 'extra').length
      const vencLlegada = items.filter(i => i.estado_recepcion === 'vencido_llegada').length
      const sinMatch    = items.filter(i => !i.producto_id).length
      const granel      = items.filter(i => i.es_granel)
      const blisters    = items.filter(i => i.es_blister && !i.es_granel && i.cantidad_recibida > 0)

      const lines = [
        `INFORME DE RECEPCIÓN — ${factura.proveedor_nombre}`,
        `Factura: ${factura.nro_comprobante || '—'}  Fecha: ${factura.fecha || '—'}`,
        `Sucursal: ${sucursal.nombre}  |  Recepcionado: ${new Date().toLocaleDateString('es-AR')}`,
        '',
        `✅ OK: ${ok}  ❌ Faltantes: ${faltante}  ➕ Extras: ${extra}  ⚠️ Vencidos: ${vencLlegada}  ❓ Sin match: ${sinMatch}`,
      ]
      if (granel.length) {
        lines.push('', `🌾 GRANEL — PENDIENTE FRACCIONAMIENTO (${granel.length}):`)
        granel.forEach(i => lines.push(`  · ${i.producto_nombre ?? i.descripcion_proveedor} — ${i.cantidad} ${i.producto_sku?.includes('KG') ? 'kg' : 'und'} (recibido: ${i.cantidad_recibida})`))
        lines.push('  → Actualizá las cantidades en el borrador a medida que fraccionás')
      }
      if (blisters.length) {
        lines.push('', `🔷 BLISTERS A FRACCIONAR (${blisters.length}):`)
        blisters.forEach(i => lines.push(`  · ${i.producto_nombre ?? i.descripcion_proveedor} — ${i.cantidad_recibida} cajas × ${i.unidades_por_blister} ud`))
      }
      if (priceItems.length) lines.push('', `💰 PRECIOS A ACTUALIZAR EN DUX: ${priceItems.length} productos`)

      setDoneReport(lines.join('\n'))
      setStep('done')
    } catch (err) {
      alert('Error al confirmar: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [factura, items, sucursalId, texto, borradorId, margenProveedor])

  // ── Stats ─────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    total    : items.length,
    exacto   : items.filter(i => i.match_confidence === 'exacto' || i.match_confidence === 'sku_map').length,
    nombre   : items.filter(i => i.match_confidence === 'nombre').length,
    sinMatch : items.filter(i => i.match_confidence === 'sin_match').length,
    granel   : items.filter(i => i.es_granel).length,
    blisters : items.filter(i => i.es_blister && !i.es_granel).length,
    totalCosto: items.reduce((s, i) => s + i.costo_unitario * i.cantidad, 0),
  }), [items])

  // ── Computed derived values ───────────────────────────────────

  const granelItems   = useMemo(() => items.filter(i => i.es_granel),   [items])
  const blisterItems  = useMemo(() => items.filter(i => i.es_blister && !i.es_granel && i.cantidad_recibida > 0), [items])

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────

  // ── PASO 1: Pegar factura ──────────────────────────────────────
  if (step === 'paste') {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/recepciones" className="text-zinc-400 hover:text-zinc-700 text-sm">← Recepciones</Link>
          <h1 className="text-xl font-semibold text-zinc-900">Nueva recepción desde factura</h1>
        </div>

        {/* PDF upload — primary action */}
        <div className="rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-6 text-center space-y-3">
          <p className="text-sm font-medium text-zinc-700">Subí el PDF de la factura directamente</p>
          <p className="text-xs text-zinc-400">El sistema extrae el texto automáticamente y procesa todo de una vez</p>
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handlePdfUpload}
          />
          <Button
            onClick={() => pdfInputRef.current?.click()}
            disabled={loadingPdf || loadingProds}
            size="lg"
            className="w-full max-w-xs"
          >
            {loadingPdf
              ? <><Loader2 className="animate-spin mr-2" size={16} />Leyendo PDF...</>
              : loadingProds
              ? <><Loader2 className="animate-spin mr-2" size={16} />Cargando productos...</>
              : <>📄 Seleccionar PDF</>}
          </Button>
        </div>

        <div className="relative flex items-center gap-3">
          <div className="flex-1 border-t border-zinc-200" />
          <span className="text-xs text-zinc-400 shrink-0">o pegá el texto manualmente</span>
          <div className="flex-1 border-t border-zinc-200" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Proveedor</label>
            <Select value={tipoProveedor} onValueChange={v => setTipoProveedor(v as ProveedorType | 'auto')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PROVEEDOR_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Sucursal destino</label>
            <Select value={sucursalId} onValueChange={v => setSucursalId(v ?? SUCURSALES[0].id)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUCURSALES.map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">
            Texto de la factura (abrí el PDF → Ctrl+A → Ctrl+C → Ctrl+V acá)
          </label>
          <textarea
            value={texto}
            onChange={e => setTexto(e.target.value)}
            placeholder="Pegá acá todo el texto de la factura..."
            className="w-full h-72 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-400 resize-none"
          />
          <p className="text-xs text-zinc-400 mt-1">Podés pegar varias páginas — los encabezados repetidos se descartan automáticamente.</p>
        </div>

        <Button onClick={handleParsear} disabled={!texto.trim() || loadingProds} size="lg" className="w-full">
          {loadingProds
            ? <><Loader2 className="animate-spin mr-2" size={16} />Cargando productos...</>
            : <>Procesar factura <ChevronRight size={16} className="ml-1" /></>}
        </Button>
      </div>
    )
  }

  // ── PASO 2: Revisar items ──────────────────────────────────────
  if (step === 'review' && factura) {
    return (
      <div className="p-6 space-y-4">
        {searchTarget !== null && (
          <ProductSearch
            productos={productos}
            onSelect={p => manualMatch(searchTarget, p)}
            onClose={() => setSearchTarget(null)}
          />
        )}

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <button onClick={() => setStep('paste')} className="text-zinc-400 hover:text-zinc-700 text-sm">← Volver</button>
            <h1 className="text-xl font-semibold text-zinc-900">Revisar factura</h1>
            {borradorId && <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">Borrador</Badge>}
          </div>
          <div className="flex items-center gap-2">
            {borradorSavedAt && <span className="text-xs text-green-600">Guardado {borradorSavedAt}</span>}
            <Button variant="outline" size="sm" onClick={saveBorrador} disabled={savingBorrador}>
              {savingBorrador
                ? <><Loader2 className="animate-spin mr-1" size={12} />Guardando...</>
                : <><Save size={13} className="mr-1" />Guardar borrador</>}
            </Button>
            <Button size="sm" onClick={confirmar} disabled={saving}>
              {saving ? <><Loader2 className="animate-spin mr-1" size={13} />Confirmando...</> : 'Confirmar →'}
            </Button>
          </div>
        </div>

        {/* Granel notice */}
        {stats.granel > 0 && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-semibold">🌾 {stats.granel} producto{stats.granel > 1 ? 's' : ''} granel — workflow en dos pasos</p>
            <p className="text-xs text-emerald-700 mt-0.5">
              Arrancan con cantidad 0. <strong>Guardá el borrador</strong> y actualizá las cantidades a medida que fraccionás. Cuando terminés, confirmá.
            </p>
          </div>
        )}

        {/* Invoice summary */}
        <div className="rounded-lg border bg-zinc-50 px-4 py-3 flex flex-wrap gap-5 text-sm">
          <div><span className="text-zinc-400">Proveedor:</span> <span className="font-medium">{factura.proveedor_nombre}</span></div>
          <div><span className="text-zinc-400">Factura:</span> <span className="font-mono font-medium">{factura.nro_comprobante || '—'}</span></div>
          <div><span className="text-zinc-400">Fecha:</span> <span className="font-medium">{factura.fecha || '—'}</span></div>
          <div><span className="text-zinc-400">Sucursal:</span> <span className="font-medium">{SUCURSALES.find(s => s.id === sucursalId)?.nombre}</span></div>
          <div><span className="text-zinc-400">Margen:</span> <span className="font-medium">{(margenProveedor * 100).toFixed(0)}%</span></div>
          <div><span className="text-zinc-400">Costo total:</span> <span className="font-medium">${stats.totalCosto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span></div>
        </div>

        {/* Match stats */}
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge className="bg-green-100 text-green-700 border-green-300">{stats.exacto} exactos</Badge>
          {stats.nombre > 0 && <Badge className="bg-yellow-100 text-yellow-700 border-yellow-300">{stats.nombre} por nombre — verificar</Badge>}
          {stats.sinMatch > 0 && <Badge className="bg-red-100 text-red-700 border-red-300">{stats.sinMatch} sin match — asignar</Badge>}
          {stats.granel > 0 && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">🌾 {stats.granel} granel</Badge>}
          {stats.blisters > 0 && <Badge className="bg-blue-100 text-blue-700 border-blue-300">🔷 {stats.blisters} blisters</Badge>}
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 w-6">#</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500">Descripción factura</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500">Producto sistema</th>
                  <th className="text-center px-2 py-2 text-xs font-medium text-zinc-500 w-24">Match</th>
                  <th className="text-right px-2 py-2 text-xs font-medium text-zinc-500 w-14">Fact.</th>
                  <th className="text-right px-2 py-2 text-xs font-medium text-zinc-500 w-20">Recibido</th>
                  <th className="text-right px-2 py-2 text-xs font-medium text-zinc-500 w-22">Costo</th>
                  <th className="text-right px-2 py-2 text-xs font-medium text-zinc-500 w-24">P.Venta sug.</th>
                  <th className="text-left px-2 py-2 text-xs font-medium text-zinc-500 w-36">Vencimiento</th>
                  <th className="text-center px-2 py-2 text-xs font-medium text-zinc-500 w-16">IVA</th>
                  <th className="text-center px-2 py-2 text-xs font-medium text-zinc-500 w-20">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  const rowCls = item.es_granel
                    ? 'bg-emerald-50'
                    : item.match_confidence === 'sin_match'
                    ? 'bg-red-50'
                    : item.match_confidence === 'nombre'
                    ? 'bg-yellow-50'
                    : item.estado_recepcion === 'vencido_llegada'
                    ? 'bg-orange-50'
                    : 'hover:bg-zinc-50'

                  return (
                    <tr key={i} className={`border-b last:border-b-0 ${rowCls}`}>
                      <td className="px-3 py-2 text-xs text-zinc-400">{i + 1}</td>

                      {/* Supplier description */}
                      <td className="px-3 py-2 max-w-[160px]">
                        <div className="text-xs font-mono text-zinc-400 truncate">{item.sku_proveedor}</div>
                        <div className="text-xs text-zinc-700 truncate" title={item.descripcion_proveedor}>
                          {item.descripcion_proveedor}
                        </div>
                      </td>

                      {/* Matched product */}
                      <td className="px-3 py-2 max-w-[160px]">
                        {item.producto_nombre ? (
                          <>
                            <div className="text-xs font-medium text-zinc-800 truncate" title={item.producto_nombre}>
                              {item.producto_nombre}
                            </div>
                            <button onClick={() => setSearchTarget(i)} className="text-[10px] text-zinc-400 underline hover:text-zinc-600">
                              Cambiar
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setSearchTarget(i)}
                            className="text-xs text-red-600 underline hover:text-red-800 font-medium">
                            + Asignar
                          </button>
                        )}
                      </td>

                      {/* Match */}
                      <td className="px-2 py-2 text-center">
                        <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${CONFIDENCE_BADGE[item.match_confidence].cls}`}>
                          {CONFIDENCE_BADGE[item.match_confidence].label}
                        </span>
                      </td>

                      {/* Qty invoice */}
                      <td className="px-2 py-2 text-right tabular-nums text-zinc-500 text-sm">{item.cantidad}</td>

                      {/* Qty received */}
                      <td className="px-2 py-2 text-right">
                        {item.es_granel ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <input type="number" min="0"
                              value={item.cantidad_recibida}
                              onChange={e => updateItem(i, { cantidad_recibida: parseInt(e.target.value) || 0 })}
                              className="w-16 text-right border border-emerald-300 rounded px-1 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-emerald-50"
                            />
                            <span className="text-[10px] text-emerald-600">actualizar</span>
                          </div>
                        ) : (
                          <input type="number" min="0"
                            value={item.cantidad_recibida}
                            onChange={e => updateItem(i, { cantidad_recibida: parseInt(e.target.value) || 0 })}
                            className="w-16 text-right border border-zinc-200 rounded px-1 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-zinc-400"
                          />
                        )}
                      </td>

                      {/* Cost */}
                      <td className="px-2 py-2 text-right">
                        <input type="number" min="0" step="0.01"
                          value={item.costo_unitario.toFixed(2)}
                          onChange={e => updateItem(i, { costo_unitario: parseFloat(e.target.value) || 0 })}
                          className="w-20 text-right border border-zinc-200 rounded px-1 py-1 text-xs tabular-nums focus:outline-none"
                        />
                      </td>

                      {/* Suggested price */}
                      <td className="px-2 py-2 text-right">
                        {item.precio_venta_sugerido > 0 ? (
                          <div>
                            <span className={`text-xs font-medium tabular-nums ${
                              item.producto_precio_actual && item.precio_venta_sugerido > item.producto_precio_actual
                                ? 'text-orange-600' : 'text-zinc-700'
                            }`}>${item.precio_venta_sugerido.toFixed(2)}</span>
                            {item.producto_precio_actual && (
                              <div className="text-[10px] text-zinc-400">actual: ${item.producto_precio_actual.toFixed(2)}</div>
                            )}
                          </div>
                        ) : <span className="text-zinc-300 text-xs">—</span>}
                      </td>

                      {/* Expiry */}
                      <td className="px-2 py-2 relative">
                        {item.es_granel ? (
                          <span className="text-[10px] text-emerald-600 italic">en fraccionamiento</span>
                        ) : (
                          <DateSelector value={item.fecha_vencimiento} onChange={v => updateItem(i, { fecha_vencimiento: v })} />
                        )}
                      </td>

                      {/* IVA */}
                      <td className="px-2 py-2 text-center text-xs text-zinc-500">{item.iva_porcentaje}%</td>

                      {/* Type badge */}
                      <td className="px-2 py-2 text-center">
                        {item.es_granel ? (
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-[10px] px-1">🌾 Granel</Badge>
                        ) : item.es_blister ? (
                          <div className="flex flex-col items-center gap-1">
                            <Badge className="bg-blue-100 text-blue-700 border-blue-300 text-[10px] px-1">🔷 Blister</Badge>
                            <div className="flex items-center gap-0.5">
                              <span className="text-[10px] text-zinc-400">ud:</span>
                              <input type="number" min="1"
                                value={item.unidades_por_blister}
                                onChange={e => updateItem(i, { unidades_por_blister: parseInt(e.target.value) || 1 })}
                                className="w-10 text-center border border-zinc-200 rounded px-1 py-0.5 text-xs focus:outline-none"
                              />
                            </div>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-xs text-zinc-500">
          <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-green-600" />Verde = exacto</span>
          <span className="flex items-center gap-1"><AlertCircle size={12} className="text-yellow-500" />Amarillo = verificar nombre</span>
          <span className="flex items-center gap-1"><HelpCircle size={12} className="text-red-500" />Rojo = asignar manualmente</span>
          <span className="flex items-center gap-1"><span className="text-emerald-600">🌾</span>Verde oscuro = granel (actualizá al fraccionar)</span>
        </div>

        <div className="flex justify-between items-center">
          <p className="text-xs text-zinc-400">Los granel NO crean vencimientos acá — se crean en Fraccionamiento.</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={saveBorrador} disabled={savingBorrador}>
              {savingBorrador ? <><Loader2 className="animate-spin mr-1" size={12} />Guardando...</> : <><Save size={13} className="mr-1" />Guardar borrador</>}
            </Button>
            <Button size="sm" onClick={confirmar} disabled={saving}>
              {saving ? <><Loader2 className="animate-spin mr-1" size={13} />Confirmando...</> : 'Confirmar recepción →'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── PASO 3: Done ───────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="text-green-500" size={28} />
          <h1 className="text-xl font-semibold text-zinc-900">Recepción confirmada</h1>
        </div>

        {duxError && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
            <p className="font-semibold mb-1">⚠️ Aviso sobre Dux</p>
            <p>{duxError}</p>
          </div>
        )}

        {/* Granel queue */}
        {granelItems.length > 0 && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4">
            <p className="text-sm font-semibold text-emerald-800 mb-1">🌾 {granelItems.length} productos granel — ir a fraccionar</p>
            <p className="text-xs text-emerald-700 mb-3">
              La factura está registrada en Dux. Ahora fraccioná la mercadería y <strong>volvé a esta recepción para actualizar las cantidades recibidas</strong> (botón "Editar borrador").
            </p>
            <ul className="space-y-1 text-xs text-emerald-800 mb-3">
              {granelItems.map((g, i) => (
                <li key={i}>· {g.producto_nombre ?? g.descripcion_proveedor} — factura: {g.cantidad} / recibido hasta ahora: {g.cantidad_recibida}</li>
              ))}
            </ul>
            <Link href="/fraccionamiento">
              <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-100">
                Ir a Fraccionamiento →
              </Button>
            </Link>
          </div>
        )}

        {/* Blister queue */}
        {blisterItems.length > 0 && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <p className="text-sm font-semibold text-blue-800 mb-1">🔷 {blisterItems.length} blisters para fraccionar</p>
            <ul className="space-y-1 text-xs text-blue-800 mb-3">
              {blisterItems.map((b, i) => (
                <li key={i}>· {b.producto_nombre ?? b.descripcion_proveedor} — {b.cantidad_recibida} cajas × {b.unidades_por_blister} = {b.cantidad_recibida * b.unidades_por_blister} und</li>
              ))}
            </ul>
            <Link href="/fraccionamiento">
              <Button size="sm" variant="outline">Ir a Fraccionamiento →</Button>
            </Link>
          </div>
        )}

        {/* Price Excel */}
        {priceExcelUrl && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-800 mb-1">💰 {priceExcelCount} precios para actualizar en Dux</p>
            <p className="text-xs text-amber-700 mb-3">Dux → Configuración → Artículos → Actualización masiva de precios → subí este archivo</p>
            <a href={priceExcelUrl} download={`dux_precios_${new Date().toISOString().split('T')[0]}.xlsx`}>
              <Button size="sm" className="flex items-center gap-2">
                <Download size={14} />Descargar Excel de precios
              </Button>
            </a>
          </div>
        )}

        {/* Report */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Informe</p>
            <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(doneReport)}>Copiar</Button>
          </div>
          <pre className="bg-zinc-50 border rounded-lg p-4 text-xs font-mono whitespace-pre-wrap text-zinc-700 leading-relaxed">
            {doneReport}
          </pre>
        </div>

        <div className="flex gap-3">
          <Link href="/vencimientos" className="flex-1">
            <Button variant="outline" className="w-full">Ver vencimientos</Button>
          </Link>
          <Link href="/recepciones/factura" className="flex-1">
            <Button className="w-full">Nueva recepción</Button>
          </Link>
        </div>
      </div>
    )
  }

  return null
}
