'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { parseDuxInvoice, duxDateToISO } from '@/lib/dux-parser'
import type { ParsedInvoice, ParsedInvoiceItem } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

const SUCURSALES = [
  { id: 'a0000000-0000-0000-0000-000000000001', nombre: 'SOHO 1 - Local' },
  { id: 'a0000000-0000-0000-0000-000000000002', nombre: 'SOHO 1 - La Pieza' },
  { id: 'a0000000-0000-0000-0000-000000000003', nombre: 'SOHO 2 - Local' },
  { id: 'a0000000-0000-0000-0000-000000000004', nombre: 'SOHO 2 - Depósito' },
]

type Step = 'paste' | 'review' | 'confirmed'

const ESTADO_LABELS: Record<ParsedInvoiceItem['estado_recepcion'], string> = {
  ok:             'OK',
  faltante:       'Faltante',
  extra:          'Extra',
  vencido_llegada:'Vencido en llegada',
}

const ESTADO_BADGE: Record<ParsedInvoiceItem['estado_recepcion'], string> = {
  ok:             'bg-green-100 text-green-700 border-green-200',
  faltante:       'bg-red-100 text-red-700 border-red-200',
  extra:          'bg-blue-100 text-blue-700 border-blue-200',
  vencido_llegada:'bg-orange-100 text-orange-700 border-orange-200',
}

export default function NuevaRecepcionPage() {
  const [step, setStep] = useState<Step>('paste')
  const [texto, setTexto] = useState('')
  const [sucursalId, setSucursalId] = useState(SUCURSALES[0].id)
  const [invoice, setInvoice] = useState<ParsedInvoice | null>(null)
  const [items, setItems] = useState<ParsedInvoiceItem[]>([])
  const [saving, setSaving] = useState(false)
  const [recepcionId, setRecepcionId] = useState<string | null>(null)
  const [informe, setInforme] = useState('')
  // Map sku → { id, nombre } for DB lookup
  const [productosBySku, setProductosBySku] = useState<Map<string, { id: string; nombre: string | null }>>(new Map())

  // Load all productos for SKU matching
  useEffect(() => {
    async function loadProductos() {
      const PAGE = 1000
      let all: { id: string; sku: string; nombre: string | null }[] = []
      let from = 0
      while (true) {
        const { data } = await supabase
          .from('productos')
          .select('id,sku,nombre')
          .range(from, from + PAGE - 1)
        if (!data || data.length === 0) break
        all = all.concat(data)
        if (data.length < PAGE) break
        from += PAGE
      }
      const map = new Map(all.map(p => [p.sku, { id: p.id, nombre: p.nombre }]))
      setProductosBySku(map)
    }
    loadProductos()
  }, [])

  function handleParsear() {
    if (!texto.trim()) return
    const parsed = parseDuxInvoice(texto)

    // Match each item to our DB by SKU
    const enriched: ParsedInvoiceItem[] = parsed.items.map(item => {
      const prod = productosBySku.get(item.codigo)
      return {
        ...item,
        producto_id: prod?.id,
        nombre_app: prod?.nombre ?? null,
      }
    })

    setInvoice(parsed)
    setItems(enriched)
    setStep('review')
  }

  function updateItem(index: number, changes: Partial<ParsedInvoiceItem>) {
    setItems(prev => {
      const next = [...prev]
      next[index] = { ...next[index], ...changes }
      // Auto-set estado based on quantities or fecha
      const item = next[index]
      if (changes.cantidad_recibida !== undefined || changes.fecha_vencimiento !== undefined) {
        const qty = item.cantidad_recibida
        const expected = item.cantidad
        const fecha = item.fecha_vencimiento
        let estado: ParsedInvoiceItem['estado_recepcion'] = 'ok'
        if (fecha && fecha < new Date().toISOString().split('T')[0]) {
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

  const confirmar = useCallback(async () => {
    if (!invoice) return
    setSaving(true)

    try {
      const sucursalNombre = SUCURSALES.find(s => s.id === sucursalId)?.nombre ?? ''
      const fechaISO = duxDateToISO(invoice.fecha)

      // 1. Create recepcion record
      const { data: recData, error: recError } = await supabase
        .from('recepciones')
        .insert({
          numero_comprobante: invoice.comprobante || null,
          dux_compra_id: invoice.comprobante || null,
          proveedor_nombre: invoice.proveedor || null,
          fecha_factura: fechaISO || null,
          fecha_recepcion: new Date().toISOString().split('T')[0],
          estado: 'confirmada',
          sucursal_id: sucursalId,
          texto_original: texto,
        })
        .select('id')
        .single()

      if (recError || !recData) throw new Error(recError?.message ?? 'Error creando recepcion')
      const recId = recData.id
      setRecepcionId(recId)

      // 2. Create recepcion_items + vencimientos for each item
      for (const item of items) {
        // Insert recepcion_item
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

        // Create/update vencimiento only if product found and fecha entered
        if (item.producto_id && item.fecha_vencimiento && item.cantidad_recibida > 0 && item.estado_recepcion !== 'vencido_llegada') {
          const { data: existing } = await supabase
            .from('vencimientos')
            .select('id, cantidad')
            .eq('producto_id', item.producto_id)
            .eq('sucursal_id', sucursalId)
            .eq('fecha_vencimiento', item.fecha_vencimiento)
            .single()

          if (existing) {
            await supabase
              .from('vencimientos')
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

      // 3. Build provider report
      const ok      = items.filter(i => i.estado_recepcion === 'ok')
      const faltante = items.filter(i => i.estado_recepcion === 'faltante')
      const extra    = items.filter(i => i.estado_recepcion === 'extra')
      const vencLlegada = items.filter(i => i.estado_recepcion === 'vencido_llegada')
      const sinMatch = items.filter(i => !i.producto_id)

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
        sinMatch.forEach(i => lines.push(`  · ${i.codigo} ${i.descripcion}`))
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
  }, [invoice, items, sucursalId, texto])

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
    const noMatchCount = items.filter(i => !i.producto_id).length
    return (
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setStep('paste')} className="text-zinc-400 hover:text-zinc-700 text-sm">← Volver</button>
            <h1 className="text-xl font-semibold text-zinc-900">Revisar recepción</h1>
          </div>
          <Button onClick={confirmar} disabled={saving} size="sm">
            {saving ? 'Confirmando...' : 'Confirmar recepción →'}
          </Button>
        </div>

        {/* Invoice summary */}
        <div className="rounded-lg border bg-zinc-50 px-4 py-3 flex flex-wrap gap-6 text-sm">
          <div><span className="text-zinc-400">Comprobante:</span> <span className="font-mono font-medium">{invoice.comprobante || '—'}</span></div>
          <div><span className="text-zinc-400">Fecha:</span> <span className="font-medium">{invoice.fecha || '—'}</span></div>
          <div><span className="text-zinc-400">Proveedor:</span> <span className="font-medium">{invoice.proveedor || '—'}</span></div>
          <div><span className="text-zinc-400">Ítems:</span> <span className="font-medium">{items.length}</span></div>
          {noMatchCount > 0 && (
            <div className="text-orange-600"><span>{noMatchCount} códigos sin match en sistema</span></div>
          )}
        </div>

        {/* Items table */}
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-zinc-500 text-xs">Código</th>
                  <th className="text-left px-3 py-2 font-medium text-zinc-500 text-xs">Producto</th>
                  <th className="text-right px-3 py-2 font-medium text-zinc-500 text-xs w-20">Fact.</th>
                  <th className="text-right px-3 py-2 font-medium text-zinc-500 text-xs w-24">Recibido</th>
                  <th className="text-left px-3 py-2 font-medium text-zinc-500 text-xs w-36">Vence</th>
                  <th className="text-center px-3 py-2 font-medium text-zinc-500 text-xs w-32">Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className={`border-b last:border-b-0 ${!item.producto_id ? 'bg-orange-50' : 'hover:bg-zinc-50'}`}>
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
                    <td className="px-3 py-2 text-right tabular-nums">{item.cantidad}</td>
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
                      <input
                        type="date"
                        value={item.fecha_vencimiento}
                        onChange={e => updateItem(i, { fecha_vencimiento: e.target.value })}
                        className="border border-zinc-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400 w-36"
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
          </p>
          <Button onClick={confirmar} disabled={saving} size="sm">
            {saving ? 'Confirmando...' : 'Confirmar recepción →'}
          </Button>
        </div>
      </div>
    )
  }

  // ── PASO 3: Confirmado + informe ──
  if (step === 'confirmed') {
    const ok           = items.filter(i => i.estado_recepcion === 'ok').length
    const faltante     = items.filter(i => i.estado_recepcion === 'faltante').length
    const extra        = items.filter(i => i.estado_recepcion === 'extra').length
    const vencLlegada  = items.filter(i => i.estado_recepcion === 'vencido_llegada').length

    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-zinc-900">Recepción confirmada</h1>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap gap-3">
          <Badge className="bg-green-100 text-green-700 border-green-200">{ok} OK</Badge>
          {faltante > 0 && <Badge className="bg-red-100 text-red-700 border-red-200">{faltante} faltantes</Badge>}
          {extra > 0 && <Badge className="bg-blue-100 text-blue-700 border-blue-200">{extra} extras</Badge>}
          {vencLlegada > 0 && <Badge className="bg-orange-100 text-orange-700 border-orange-200">{vencLlegada} venc. en llegada</Badge>}
        </div>

        {/* Provider report */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Informe para el proveedor</p>
            <Button variant="outline" size="sm" onClick={copiarInforme}>Copiar informe</Button>
          </div>
          <pre className="bg-zinc-50 border rounded-lg p-4 text-xs font-mono whitespace-pre-wrap text-zinc-700 leading-relaxed">
            {informe}
          </pre>
        </div>

        {/* Actions */}
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
