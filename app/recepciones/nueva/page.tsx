'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { parseDuxInvoice, duxDateToISO } from '@/lib/dux-parser'
import type { ParsedInvoice, ParsedInvoiceItem } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { SUCURSALES_OPERATIVAS } from '@/lib/constants'
import { hoyISO } from '@/lib/format'

const SUCURSALES: ReadonlyArray<{ id: string; nombre: string }> = SUCURSALES_OPERATIVAS

type Step = 'paste' | 'review' | 'confirmed'

const ESTADO_LABELS: Record<ParsedInvoiceItem['estado_recepcion'], string> = {
  ok:             'OK',
  faltante:       'Faltante',
  extra:          'Extra',
  vencido_llegada:'Vencido en llegada',
}

// ── Selector de fecha cascada: Año → Mes → Día (igual que carga-rapida) ──
const MONTHS_CASCADE = [
  { num: 1, name: 'Enero' }, { num: 2, name: 'Febrero' }, { num: 3, name: 'Marzo' },
  { num: 4, name: 'Abril' }, { num: 5, name: 'Mayo' }, { num: 6, name: 'Junio' },
  { num: 7, name: 'Julio' }, { num: 8, name: 'Agosto' }, { num: 9, name: 'Septiembre' },
  { num: 10, name: 'Octubre' }, { num: 11, name: 'Noviembre' }, { num: 12, name: 'Diciembre' },
]

function DateSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const currentYear = new Date().getFullYear()
  const years = useMemo(() => Array.from({ length: 7 }, (_, i) => currentYear - 1 + i), [currentYear])

  const initParts = value ? value.split('-') : ['', '', '']
  const [selY, setSelY] = useState(initParts[0] || '')
  const [selM, setSelM] = useState(initParts[1] || '')
  const [selD, setSelD] = useState(initParts[2] || '')
  const [cascadeStep, setCascadeStep] = useState<'year' | 'month' | 'day' | null>(null)

  // Sync internal year/month/day state with the external ISO `value` prop.
  // Guard against redundant sets so we don't trigger render storms.
  useEffect(() => {
    const [y, m, d] = (value || '').split('-')
    if ((y || '') !== selY) setSelY(y || '')
    if ((m || '') !== selM) setSelM(m || '')
    if ((d || '') !== selD) setSelD(d || '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function getDays() {
    if (!selY || !selM) return []
    const n = new Date(parseInt(selY), parseInt(selM), 0).getDate()
    return Array.from({ length: n }, (_, i) => i + 1)
  }

  function selectYear(y: number) { setSelY(y.toString()); setCascadeStep('month') }
  function selectMonth(m: number) { setSelM(m.toString().padStart(2, '0')); setCascadeStep('day') }
  function selectDay(d: number) {
    const ds = d.toString().padStart(2, '0')
    setSelD(ds)
    setCascadeStep(null)
    onChange(`${selY}-${selM}-${ds}`)
  }
  function resetDate() { setSelY(''); setSelM(''); setSelD(''); setCascadeStep(null); onChange('') }

  const displayDate = selY && selM && selD ? `${selD}/${selM}/${selY}` : ''

  if (!cascadeStep) {
    return displayDate ? (
      <div className="rounded bg-green-50 border border-green-200 px-2 py-1 flex items-center justify-between gap-2 min-w-[130px]">
        <span className="text-xs font-semibold text-green-700">{displayDate}</span>
        <button type="button" onClick={() => setCascadeStep('year')} className="text-xs text-green-600 hover:text-green-800 underline shrink-0">Cambiar</button>
      </div>
    ) : (
      <button type="button" onClick={() => setCascadeStep('year')}
        className="rounded border-2 border-dashed border-zinc-300 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-500 hover:border-zinc-400 hover:bg-white transition-colors whitespace-nowrap">
        Seleccionar fecha
      </button>
    )
  }

  if (cascadeStep === 'year') return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2 shadow-sm min-w-[220px]">
      <p className="text-xs text-zinc-500 mb-1.5 font-medium">Año</p>
      <div className="grid grid-cols-4 gap-1">
        {years.map(y => (
          <button key={y} type="button" onClick={() => selectYear(y)}
            className={`rounded border-2 py-1.5 text-xs font-medium transition-all hover:border-blue-400 hover:bg-blue-50 ${selY === y.toString() ? 'border-blue-400 bg-blue-50' : 'border-zinc-200'}`}>
            {y}
          </button>
        ))}
      </div>
      <button type="button" onClick={resetDate} className="mt-1.5 text-xs text-zinc-400 hover:text-zinc-600 underline">Cancelar</button>
    </div>
  )

  if (cascadeStep === 'month') return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2 shadow-sm min-w-[220px]">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-semibold text-zinc-700">{selY}</span>
        <button type="button" onClick={() => setCascadeStep('year')} className="text-xs text-zinc-400 hover:text-zinc-600 underline">cambiar</button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTHS_CASCADE.map(m => (
          <button key={m.num} type="button" onClick={() => selectMonth(m.num)}
            className={`rounded border-2 py-1.5 text-xs font-medium transition-all hover:border-blue-400 hover:bg-blue-50 ${selM === m.num.toString().padStart(2,'0') ? 'border-blue-400 bg-blue-50' : 'border-zinc-200'}`}>
            {m.name}
          </button>
        ))}
      </div>
    </div>
  )

  if (cascadeStep === 'day') return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2 shadow-sm min-w-[220px]">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-semibold text-zinc-700">
          {selY} – {MONTHS_CASCADE.find(m => m.num === parseInt(selM))?.name}
        </span>
        <button type="button" onClick={() => setCascadeStep('month')} className="text-xs text-zinc-400 hover:text-zinc-600 underline">cambiar</button>
      </div>
      <div className="grid grid-cols-7 gap-1 max-h-36 overflow-y-auto">
        {getDays().map(d => (
          <button key={d} type="button" onClick={() => selectDay(d)}
            className={`rounded border-2 py-1.5 text-xs font-medium transition-all hover:border-blue-400 hover:bg-blue-50 text-center ${selD === d.toString().padStart(2,'0') ? 'border-blue-400 bg-blue-50' : 'border-zinc-200'}`}>
            {d}
          </button>
        ))}
      </div>
    </div>
  )

  return null
}

export default function NuevaRecepcionPage() {
  const [step, setStep] = useState<Step>('paste')
  const [texto, setTexto] = useState('')
  const [sucursalId, setSucursalId] = useState(SUCURSALES[0].id)
  const [invoice, setInvoice] = useState<ParsedInvoice | null>(null)
  const [items, setItems] = useState<ParsedInvoiceItem[]>([])
  const [saving, setSaving] = useState(false)
  // recepcionId was tracked here but never read after save; removed to silence the unused-var warning.
  // If you need to navigate to /recepciones/[id] after confirming, re-add and use it.
  const [informe, setInforme] = useState('')
  const [borradorId, setBorradorId] = useState<string | null>(null)
  const [borradorSavedAt, setBorradorSavedAt] = useState<string | null>(null)
  const [productosBySku, setProductosBySku] = useState<Map<string, { id: string; nombre: string | null }>>(new Map())
  const [productosByBarcode, setProductosByBarcode] = useState<Map<string, { id: string; nombre: string | null }>>(new Map())
  const [scanInput, setScanInput] = useState('')
  const [scanFeedback, setScanFeedback] = useState<{ msg: string; ok: boolean } | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)

  // Load all productos for SKU matching
  useEffect(() => {
    async function loadProductos() {
      const PAGE = 1000
      let all: { id: string; sku: string; nombre: string | null }[] = []
      let from = 0
      while (true) {
        const { data } = await supabase
          .from('productos')
          .select('id,sku,nombre,codigo_barras')
          .range(from, from + PAGE - 1)
        if (!data || data.length === 0) break
        all = all.concat(data as typeof all)
        if (data.length < PAGE) break
        from += PAGE
      }
      setProductosBySku(new Map(all.map(p => [p.sku, { id: p.id, nombre: p.nombre }])))
      setProductosByBarcode(new Map(
        (all as (typeof all[0] & { codigo_barras?: string | null })[])
          .filter(p => p.codigo_barras)
          .map(p => [p.codigo_barras!, { id: p.id, nombre: p.nombre }])
      ))
    }
    loadProductos()
  }, [])

  async function loadBorrador(id: string) {
    const [recRes, itemsRes] = await Promise.all([
      supabase.from('recepciones').select('*').eq('id', id).single(),
      supabase.from('recepcion_items').select('*').eq('recepcion_id', id),
    ])
    if (!recRes.data) return
    const rec = recRes.data as {
      numero_comprobante: string | null; proveedor_nombre: string | null;
      fecha_factura: string | null; sucursal_id: string | null; texto_original: string | null;
    }
    const inv: ParsedInvoice = {
      comprobante: rec.numero_comprobante ?? '',
      fecha: rec.fecha_factura ? rec.fecha_factura.split('-').reverse().join('/') : '',
      proveedor: rec.proveedor_nombre ?? '',
      items: [],
    }
    const dbItems = (itemsRes.data ?? []) as Array<{
      sku: string; nombre_producto: string | null; cantidad_esperada: number;
      cantidad_recibida: number | null; fecha_vencimiento: string | null;
      estado: string; producto_id: string | null;
    }>
    const reconstructed: ParsedInvoiceItem[] = dbItems.map(it => ({
      codigo: it.sku,
      descripcion: it.nombre_producto ?? it.sku,
      cantidad: it.cantidad_esperada,
      precio_unitario: 0,
      cantidad_recibida: it.cantidad_recibida ?? 0,
      fecha_vencimiento: it.fecha_vencimiento ?? '',
      estado_recepcion: it.estado as ParsedInvoiceItem['estado_recepcion'],
      producto_id: it.producto_id ?? undefined,
      nombre_app: it.nombre_producto,
    }))
    setSucursalId(rec.sucursal_id ?? SUCURSALES[0].id)
    setTexto(rec.texto_original ?? '')
    setInvoice(inv)
    setItems(reconstructed)
    setBorradorId(id)
    setStep('review')
  }

  // Detect ?borrador=<id> in URL and load draft (declared after loadBorrador)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const bid = params.get('borrador')
    if (bid) loadBorrador(bid)
  }, [])

  function handleParsear() {
    if (!texto.trim()) return
    const parsed = parseDuxInvoice(texto)
    const enriched: ParsedInvoiceItem[] = parsed.items.map(item => {
      const prod = productosBySku.get(item.codigo)
      return { ...item, producto_id: prod?.id, nombre_app: prod?.nombre ?? null }
    })
    setInvoice(parsed)
    setItems(enriched)
    setStep('review')
  }

  function updateItem(index: number, changes: Partial<ParsedInvoiceItem>) {
    setItems(prev => {
      const next = [...prev]
      next[index] = { ...next[index], ...changes }
      const item = next[index]
      if (changes.cantidad_recibida !== undefined || changes.fecha_vencimiento !== undefined) {
        const qty = item.cantidad_recibida
        const expected = item.cantidad
        const fecha = item.fecha_vencimiento
        let estado: ParsedInvoiceItem['estado_recepcion'] = 'ok'
        if (fecha && fecha < hoyISO()) {
          estado = 'vencido_llegada'
        } else if (qty < expected) {
          estado = 'faltante'
        } else if (qty > expected) {
          estado = 'extra'
        }
        next[index] = { ...next[index], estado_recepcion: estado }
      }
      return next
    })
  }

  async function saveBorrador() {
    if (!invoice) return
    setSaving(true)
    try {
      const fechaISO = duxDateToISO(invoice.fecha)
      let recId = borradorId

      if (!recId) {
        const { data: recData, error } = await supabase
          .from('recepciones')
          .insert({
            numero_comprobante: invoice.comprobante || null,
            dux_compra_id: invoice.comprobante || null,
            proveedor_nombre: invoice.proveedor || null,
            fecha_factura: fechaISO || null,
            fecha_recepcion: hoyISO(),
            estado: 'borrador',
            sucursal_id: sucursalId,
            texto_original: texto,
          })
          .select('id')
          .single()
        if (error || !recData) throw new Error(error?.message ?? 'Error')
        recId = (recData as { id: string }).id
        setBorradorId(recId)
      } else {
        await supabase.from('recepciones')
          .update({ estado: 'borrador', sucursal_id: sucursalId })
          .eq('id', recId)
      }

      // Replace all items
      await supabase.from('recepcion_items').delete().eq('recepcion_id', recId)
      for (const item of items) {
        await supabase.from('recepcion_items').insert({
          recepcion_id: recId,
          producto_id: item.producto_id ?? null,
          sku: item.codigo,
          nombre_producto: item.nombre_app ?? item.descripcion,
          cantidad_esperada: item.cantidad,
          cantidad_recibida: item.cantidad_recibida,
          fecha_vencimiento: item.fecha_vencimiento || null,
          estado: item.estado_recepcion,
        })
      }
      setBorradorSavedAt(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }))
    } catch (err) {
      console.error(err)
      alert('Error al guardar el borrador.')
    } finally {
      setSaving(false)
    }
  }

  const confirmar = useCallback(async () => {
    if (!invoice) return
    setSaving(true)
    try {
      const sucursalNombre = SUCURSALES.find(s => s.id === sucursalId)?.nombre ?? ''
      const fechaISO = duxDateToISO(invoice.fecha)
      let recId: string

      if (borradorId) {
        await supabase.from('recepciones')
          .update({
            estado: 'confirmada',
            sucursal_id: sucursalId,
            fecha_recepcion: hoyISO(),
          })
          .eq('id', borradorId)
        recId = borradorId
        await supabase.from('recepcion_items').delete().eq('recepcion_id', recId)
      } else {
        const { data: recData, error: recError } = await supabase
          .from('recepciones')
          .insert({
            numero_comprobante: invoice.comprobante || null,
            dux_compra_id: invoice.comprobante || null,
            proveedor_nombre: invoice.proveedor || null,
            fecha_factura: fechaISO || null,
            fecha_recepcion: hoyISO(),
            estado: 'confirmada',
            sucursal_id: sucursalId,
            texto_original: texto,
          })
          .select('id')
          .single()
        if (recError || !recData) throw new Error(recError?.message ?? 'Error creando recepcion')
        recId = (recData as { id: string }).id
      }

      for (const item of items) {
        await supabase.from('recepcion_items').insert({
          recepcion_id: recId,
          producto_id: item.producto_id ?? null,
          sku: item.codigo,
          nombre_producto: item.nombre_app ?? item.descripcion,
          cantidad_esperada: item.cantidad,
          cantidad_recibida: item.cantidad_recibida,
          fecha_vencimiento: item.fecha_vencimiento || null,
          estado: item.estado_recepcion,
        })

        if (item.producto_id && item.fecha_vencimiento && item.cantidad_recibida > 0 && item.estado_recepcion !== 'vencido_llegada') {
          const { data: existing } = await supabase
            .from('vencimientos')
            .select('id, cantidad')
            .eq('producto_id', item.producto_id)
            .eq('sucursal_id', sucursalId)
            .eq('fecha_vencimiento', item.fecha_vencimiento)
            .single()
          if (existing) {
            await supabase.from('vencimientos')
              .update({ cantidad: existing.cantidad + item.cantidad_recibida, updated_at: new Date().toISOString() })
              .eq('id', existing.id)
          } else {
            await supabase.from('vencimientos').insert({
              producto_id: item.producto_id,
              sucursal_id: sucursalId,
              fecha_vencimiento: item.fecha_vencimiento,
              cantidad: item.cantidad_recibida,
              origen: 'recepcion',
              recepcion_id: recId,
            })
          }
        }
      }

      const ok          = items.filter(i => i.estado_recepcion === 'ok')
      const faltante    = items.filter(i => i.estado_recepcion === 'faltante')
      const extra       = items.filter(i => i.estado_recepcion === 'extra')
      const vencLlegada = items.filter(i => i.estado_recepcion === 'vencido_llegada')
      const sinMatch    = items.filter(i => !i.producto_id)

      const lines: string[] = [
        `INFORME DE RECEPCIÓN`,
        `Proveedor: ${invoice.proveedor || '—'}`,
        `Factura: ${invoice.comprobante || '—'}  Fecha: ${invoice.fecha || '—'}`,
        `Sucursal: ${sucursalNombre}`,
        `Fecha recepción: ${new Date().toLocaleDateString('es-AR')}`,
        '',
      ]
      if (ok.length) {
        lines.push(`✅ RECIBIDOS OK (${ok.length})`)
        ok.forEach(i => lines.push(`  · ${i.codigo} ${i.nombre_app ?? i.descripcion} — ${i.cantidad_recibida} ud, vence ${i.fecha_vencimiento ? i.fecha_vencimiento.split('-').reverse().join('/') : 'sin fecha'}`))
        lines.push('')
      }
      if (faltante.length) {
        lines.push(`❌ FALTANTES (${faltante.length})`)
        faltante.forEach(i => lines.push(`  · ${i.codigo} ${i.nombre_app ?? i.descripcion} — pedido ${i.cantidad}, recibido ${i.cantidad_recibida}`))
        lines.push('')
      }
      if (extra.length) {
        lines.push(`➕ EXTRAS NO PEDIDOS (${extra.length})`)
        extra.forEach(i => lines.push(`  · ${i.codigo} ${i.nombre_app ?? i.descripcion} — ${i.cantidad_recibida} ud`))
        lines.push('')
      }
      if (vencLlegada.length) {
        lines.push(`⚠️ VENCIDOS EN LLEGADA (${vencLlegada.length})`)
        vencLlegada.forEach(i => lines.push(`  · ${i.codigo} ${i.nombre_app ?? i.descripcion} — vence ${i.fecha_vencimiento ? i.fecha_vencimiento.split('-').reverse().join('/') : '?'}`))
        lines.push('')
      }
      if (sinMatch.length) {
        lines.push(`❓ CÓDIGOS SIN MATCH EN SISTEMA (${sinMatch.length})`)
        sinMatch.forEach(i => lines.push(`  · ${i.codigo}  ${i.descripcion}`))
        lines.push('')
      }
      setInforme(lines.join('\n'))
      setStep('confirmed')
    } catch (err) {
      console.error(err)
      alert('Error al confirmar la recepción. Revisá la consola.')
    } finally {
      setSaving(false)
    }
  }, [invoice, items, sucursalId, texto, borradorId])

  function handleScan(barcode: string) {
    const trimmed = barcode.trim()
    if (!trimmed) return
    const prod = productosByBarcode.get(trimmed) ?? productosBySku.get(trimmed)
    if (!prod) {
      setScanFeedback({ msg: 'Código no encontrado en productos', ok: false })
      setScanInput('')
      setTimeout(() => setScanFeedback(null), 2500)
      setTimeout(() => scanRef.current?.focus(), 50)
      return
    }
    const idx = items.findIndex(it => it.producto_id === prod.id)
    if (idx >= 0) {
      updateItem(idx, { cantidad_recibida: items[idx].cantidad_recibida + 1 })
      setScanFeedback({ msg: `+1 — ${items[idx].nombre_app ?? items[idx].codigo}`, ok: true })
    } else {
      setScanFeedback({ msg: `No está en esta factura: ${prod.nombre ?? trimmed}`, ok: false })
    }
    setScanInput('')
    setTimeout(() => setScanFeedback(null), 2500)
    setTimeout(() => scanRef.current?.focus(), 50)
  }

  function copiarInforme() {
    navigator.clipboard.writeText(informe).catch(() => {})
  }

  // ── PASO 1: Pegar factura ──
  if (step === 'paste') {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/recepciones" className="text-zinc-400 hover:text-zinc-700 text-sm">← Recepciones</Link>
          <h1 className="text-xl font-semibold text-zinc-900">Nueva Recepción</h1>
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">Sucursal destino</label>
          <Select value={sucursalId} onValueChange={v => setSucursalId(v ?? SUCURSALES[0].id)}>
            <SelectTrigger className="w-64">
              <SelectValue>{SUCURSALES.find(s => s.id === sucursalId)?.nombre}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SUCURSALES.map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1 block">
            Pegá el texto de la factura Dux
          </label>
          <textarea
            value={texto}
            onChange={e => setTexto(e.target.value)}
            placeholder="Copiá la factura desde Dux y pegala acá (Ctrl+V)..."
            className="w-full h-72 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-400 resize-none"
          />
          <p className="text-xs text-zinc-400 mt-1">
            Podés pegar varias páginas de la misma factura — los encabezados repetidos se descartan automáticamente.
          </p>
        </div>

        <Button onClick={handleParsear} disabled={!texto.trim() || productosBySku.size === 0} size="lg" className="w-full">
          {productosBySku.size === 0 ? 'Cargando productos...' : 'Parsear factura →'}
        </Button>
      </div>
    )
  }

  // ── PASO 2: Revisar ítems ──
  if (step === 'review' && invoice) {
    const sinMatch = items.filter(i => !i.producto_id)
    return (
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setStep('paste')} className="text-zinc-400 hover:text-zinc-700 text-sm">← Volver</button>
            <h1 className="text-xl font-semibold text-zinc-900">Revisar recepción</h1>
            {borradorId && <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 text-xs">Borrador</Badge>}
          </div>
          <div className="flex items-center gap-2">
            {borradorSavedAt && (
              <span className="text-xs text-green-600">Guardado a las {borradorSavedAt}</span>
            )}
            <Button variant="outline" size="sm" onClick={saveBorrador} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar borrador'}
            </Button>
            <Button onClick={confirmar} disabled={saving} size="sm">
              {saving ? 'Confirmando...' : 'Confirmar recepción →'}
            </Button>
          </div>
        </div>

        {/* Invoice summary */}
        <div className="rounded-lg border bg-zinc-50 px-4 py-3 flex flex-wrap gap-6 text-sm">
          <div><span className="text-zinc-400">Comprobante:</span> <span className="font-mono font-medium">{invoice.comprobante || '—'}</span></div>
          <div><span className="text-zinc-400">Fecha:</span> <span className="font-medium">{invoice.fecha || '—'}</span></div>
          <div><span className="text-zinc-400">Proveedor:</span> <span className="font-medium">{invoice.proveedor || '—'}</span></div>
          <div><span className="text-zinc-400">Ítems:</span> <span className="font-medium">{items.length}</span></div>
        </div>

        {/* Scanner de pistola lectora */}
        <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-50 rounded-lg border border-zinc-200">
          <span className="text-xs font-medium text-zinc-500 shrink-0">Pistola:</span>
          <input
            ref={scanRef}
            value={scanInput}
            onChange={e => setScanInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleScan(scanInput) }}
            placeholder="Escanear código de barras para sumar +1 unidad..."
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder-zinc-400"
            autoFocus
          />
          {scanFeedback && (
            <span className={`text-xs font-medium shrink-0 ${scanFeedback.ok ? 'text-green-600' : 'text-red-500'}`}>
              {scanFeedback.msg}
            </span>
          )}
        </div>

        {/* Sin match warning — lista los códigos */}
        {sinMatch.length > 0 && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800 space-y-1.5">
            <p className="font-semibold">{sinMatch.length} código{sinMatch.length > 1 ? 's' : ''} sin match en sistema — no se van a guardar vencimientos para estos ítems:</p>
            <ul className="space-y-0.5 pl-2">
              {sinMatch.map((it, i) => (
                <li key={i} className="font-mono text-xs">
                  <span className="font-bold">{it.codigo}</span>
                  <span className="text-orange-600 ml-2">{it.descripcion}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Alerta productos vencidos */}
        {items.some(i => i.estado_recepcion === 'vencido_llegada') && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 space-y-1">
            <p className="font-semibold">⚠️ {items.filter(i => i.estado_recepcion === 'vencido_llegada').length} ítem(s) con fecha vencida en esta recepción</p>
            <p className="text-xs text-red-600">Marcados en rojo. No se generarán registros de vencimiento para estos productos, pero quedarán documentados en el informe al proveedor.</p>
          </div>
        )}

        {/* Items table */}
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-zinc-500 text-xs">Código</th>
                  <th className="text-left px-3 py-2 font-medium text-zinc-500 text-xs">Producto</th>
                  <th className="text-right px-3 py-2 font-medium text-zinc-500 text-xs w-16">Fact.</th>
                  <th className="text-right px-3 py-2 font-medium text-zinc-500 text-xs w-24">Recibido</th>
                  <th className="text-left px-3 py-2 font-medium text-zinc-500 text-xs">Vencimiento</th>
                  <th className="text-center px-3 py-2 font-medium text-zinc-500 text-xs w-32">Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className={`border-b last:border-b-0 ${
                    item.estado_recepcion === 'vencido_llegada'
                      ? 'bg-red-50'
                      : !item.producto_id
                      ? 'bg-orange-50'
                      : 'hover:bg-zinc-50'
                  }`}>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-500">{item.codigo}</td>
                    <td className="px-3 py-2 max-w-xs">
                      {item.nombre_app ? (
                        <>
                          <div className="font-medium truncate">{item.nombre_app}</div>
                          <div className="text-xs text-zinc-400 truncate">{item.descripcion}</div>
                        </>
                      ) : (
                        <div className="text-orange-600 text-xs">{item.descripcion}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{item.cantidad}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        value={item.cantidad_recibida}
                        onChange={e => updateItem(i, { cantidad_recibida: parseInt(e.target.value) || 0 })}
                        className="w-20 text-right border border-zinc-200 rounded px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-zinc-400"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <DateSelector
                        value={item.fecha_vencimiento}
                        onChange={v => updateItem(i, { fecha_vencimiento: v })}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <select
                        value={item.estado_recepcion}
                        onChange={e => updateItem(i, { estado_recepcion: e.target.value as ParsedInvoiceItem['estado_recepcion'] })}
                        className="text-xs border border-zinc-200 rounded px-1 py-0.5 focus:outline-none"
                      >
                        {Object.entries(ESTADO_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-between items-center">
          <p className="text-xs text-zinc-400">
            Solo se crean registros de vencimiento para ítems con fecha cargada y estado OK o Extra.
            Podés guardar borrador y retomar desde el listado de recepciones.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={saveBorrador} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar borrador'}
            </Button>
            <Button onClick={confirmar} disabled={saving} size="sm">
              {saving ? 'Confirmando...' : 'Confirmar recepción →'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── PASO 3: Confirmado + informe ──
  if (step === 'confirmed') {
    const ok          = items.filter(i => i.estado_recepcion === 'ok').length
    const faltante    = items.filter(i => i.estado_recepcion === 'faltante').length
    const extra       = items.filter(i => i.estado_recepcion === 'extra').length
    const vencLlegada = items.filter(i => i.estado_recepcion === 'vencido_llegada').length

    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold text-zinc-900">Recepción confirmada</h1>

        <div className="flex flex-wrap gap-3">
          <Badge className="bg-green-100 text-green-700 border-green-200">{ok} OK</Badge>
          {faltante > 0 && <Badge className="bg-red-100 text-red-700 border-red-200">{faltante} faltantes</Badge>}
          {extra > 0 && <Badge className="bg-blue-100 text-blue-700 border-blue-200">{extra} extras</Badge>}
          {vencLlegada > 0 && <Badge className="bg-orange-100 text-orange-700 border-orange-200">{vencLlegada} venc. en llegada</Badge>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Informe para el proveedor</p>
            <Button variant="outline" size="sm" onClick={copiarInforme}>Copiar informe</Button>
          </div>
          <pre className="bg-zinc-50 border rounded-lg p-4 text-xs font-mono whitespace-pre-wrap text-zinc-700 leading-relaxed">
            {informe}
          </pre>
        </div>

        <div className="flex gap-3">
          <Link href="/vencimientos" className="flex-1">
            <Button variant="outline" className="w-full">Ver vencimientos</Button>
          </Link>
          <Link href="/recepciones/nueva" className="flex-1">
            <Button className="w-full">Nueva recepción</Button>
          </Link>
        </div>
      </div>
    )
  }

  return null
}
