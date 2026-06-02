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
import { parseFactura, calcPrecioVenta, detectProveedorType } from '@/lib/invoice-parsers'
import { buildDocumentoProveedor, documentoProveedorToText, documentoProveedorToPDF, type DocumentoProveedor } from '@/lib/proveedor-doc'
import type { InvoiceLineItem, ParsedFactura, MatchConfidence, ProveedorType, SkuMapEntry, GranelDerivado, Lote } from '@/lib/types'
import { CLIENT_ID, persistItem, useRecepcionRealtime } from '@/lib/recepcion-collab'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCircle2, HelpCircle, Download, Loader2, ChevronRight, Save, Users, Link2 } from 'lucide-react'

// ── Constants ────────────────────────────────────────────────────

const SUCURSALES = [
  // dux_sucursal_id = Dux logical branch ID (1=SOHO1, 3=SOHO2) used in v2/compras
  // dux_deposito    = Dux warehouse ID used as id_deposito in v2/compras
  { id: 'a0000000-0000-0000-0000-000000000001', nombre: 'SOHO 1 - Local',    dux_deposito: 7951,  dux_sucursal: 7951,  dux_sucursal_id: 1 },
  { id: 'a0000000-0000-0000-0000-000000000002', nombre: 'SOHO 1 - La Pieza', dux_deposito: 8545,  dux_sucursal: 7951,  dux_sucursal_id: 1 },
  { id: 'a0000000-0000-0000-0000-000000000003', nombre: 'SOHO 2 - Local',    dux_deposito: 15289, dux_sucursal: 15289, dux_sucursal_id: 3 },
  { id: 'a0000000-0000-0000-0000-000000000004', nombre: 'SOHO 2 - Depósito', dux_deposito: 15513, dux_sucursal: 15289, dux_sucursal_id: 3 },
]

const PROVEEDOR_LABELS: Record<ProveedorType | 'auto', string> = {
  auto : 'Auto-detectar',
  diet : 'Diet / Mayordiet',
  ankas: 'Ankas del Sur',
  epn  : 'EPN / Mayorista',
  otro : 'Otro (manual)',
}

// ── Local types ──────────────────────────────────────────────────

interface Producto {
  id               : string
  sku              : string
  nombre           : string | null
  codigo_barras    : string | null
  codigo_externo   : string | null
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

  // Sync state to the external `value` prop. Necessary because the picker keeps
  // 3 separate pieces of state (year/month/day) that must stay in sync with the
  // single ISO string from the parent. Skip render-time set when value matches.
  useEffect(() => {
    const [y, m, d] = (value || '').split('-')
    if ((y ?? '') !== selY) setSelY(y ?? '')
    if ((m ?? '') !== selM) setSelM(m ?? '')
    if ((d ?? '') !== selD) setSelD(d ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

function ProductSearch({ productos, initialQuery, supplierContext, onSelect, onClose, onProductoFetched }: {
  productos         : Producto[]
  initialQuery     ?: string
  supplierContext  ?: string
  onSelect          : (p: Producto) => void
  onClose           : () => void
  onProductoFetched?: (p: Producto) => void
}) {
  const [q, setQ] = useState(initialQuery ?? '')
  const [highlightIdx, setHighlightIdx] = useState(0)
  const [fetchingDux, setFetchingDux]       = useState(false)
  const [duxFetchError, setDuxFetchError]   = useState<string | null>(null)
  const [duxProgress, setDuxProgress]       = useState<{ page: number; total: number } | null>(null)
  const [dbResults, setDbResults]           = useState<Producto[]>([])
  const [loadingDb, setLoadingDb]           = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)
  const dbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  // Auto-search Supabase when local results are empty (debounced 500ms).
  // Catches: (a) products inserted after page load, (b) name mismatches between
  // the supplier description and the SOHO product name.
  useEffect(() => {
    if (dbTimerRef.current) clearTimeout(dbTimerRef.current)
    setDbResults([])
    const query = q.trim()
    if (query.length < 2) return
    dbTimerRef.current = setTimeout(async () => {
      setLoadingDb(true)
      try {
        // Build OR filter: match sku exactly, barcode exactly, or name contains all tokens
        const tokens = query.toLowerCase().replace(/[^a-z0-9áéíóúñ\s]+/g, ' ').split(/\s+/).filter(t => t.length >= 2)
        let req = supabase.from('productos')
          .select('id,sku,nombre,codigo_barras,codigo_externo,precio_venta,costo,proveedor_id_dux,categoria')
          .limit(20)
        if (tokens.length === 0) return
        // If it looks like a pure code (no spaces, <= 12 chars) try exact first
        if (!query.includes(' ') && query.length <= 12) {
          req = req.or(`sku.eq.${query},codigo_barras.eq.${query}`)
        } else {
          // name ilike with all tokens chained as AND
          req = tokens.reduce(
            (r, t) => r.ilike('nombre', `%${t}%`),
            req
          )
        }
        const { data } = await req
        if (data && data.length > 0) {
          // Exclude items already in the in-memory list to avoid dups
          const inMemoryIds = new Set(productos.map(p => p.id))
          const fresh = (data as Producto[]).filter(p => !inMemoryIds.has(p.id))
          setDbResults(fresh.length > 0 ? fresh : (data as Producto[]))
        }
      } finally {
        setLoadingDb(false)
      }
    }, 500)
    return () => { if (dbTimerRef.current) clearTimeout(dbTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // ranked is declared below via useMemo — use a separate effect that watches q only
  // and checks ranked.length inline after it's computed; this avoids the forward-ref error.
  // The guard `ranked.length > 0` is applied in the render (dbResults shown only when ranked empty).
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchFromDux() {
    const query = q.trim()
    if (!query) return
    setFetchingDux(true)
    setDuxFetchError(null)
    setDuxProgress(null)
    try {
      const res = await fetch(`/api/dux/fetch-producto?q=${encodeURIComponent(query)}`)
      if (!res.ok || !res.body) {
        let errMsg = `Error ${res.status}`
        try { errMsg = (await res.json()).error ?? errMsg } catch {}
        setDuxFetchError(errMsg)
        return
      }
      // Stream NDJSON: each line is a {type: ...} event
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let foundProducto: Producto | null = null
      let finalError: string | null = null
      let notFound = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const evt = JSON.parse(line) as {
              type: string
              total_items?: number
              total_pages?: number
              page?: number
              producto?: Producto
              error?: string
            }
            if (evt.type === 'start' && evt.total_pages) {
              setDuxProgress({ page: 0, total: evt.total_pages })
            } else if (evt.type === 'progress' && evt.page && evt.total_pages) {
              setDuxProgress({ page: evt.page, total: evt.total_pages })
            } else if (evt.type === 'found' && evt.producto) {
              foundProducto = evt.producto
            } else if (evt.type === 'notFound') {
              notFound = true
            } else if (evt.type === 'error' && evt.error) {
              finalError = evt.error
            }
          } catch {}
        }
      }
      if (foundProducto) {
        onProductoFetched?.(foundProducto)
        onSelect(foundProducto)
        onClose()
      } else if (notFound) {
        setDuxFetchError(`No encontrado en Dux. Verificá que el SKU "${query}" exista y esté habilitado.`)
      } else if (finalError) {
        setDuxFetchError(finalError)
      } else {
        setDuxFetchError('Sin respuesta de Dux. Reintentá.')
      }
    } catch (e) {
      setDuxFetchError((e as Error).message)
    } finally {
      setFetchingDux(false)
      setDuxProgress(null)
    }
  }

  // Match by SKU, barcode or name. Pure SKU/barcode matches rank highest.
  const ranked = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return [] as Producto[]
    const tokenize = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, ' ').split(/\s+/).filter(t => t.length >= 2)
    const qt = tokenize(query)
    const ctxTokens = supplierContext ? new Set(tokenize(supplierContext)) : null
    const scored = productos.map(p => {
      const sku  = (p.sku ?? '').toLowerCase()
      const ean  = (p.codigo_barras ?? '').toLowerCase()
      const name = (p.nombre ?? '').toLowerCase()

      // 1) Exact / prefix SKU or barcode match → top priority
      if (sku === query || ean === query) return { p, score: 1000 }
      if (sku.startsWith(query)) return { p, score: 500 }
      if (ean.startsWith(query)) return { p, score: 400 }

      // 2) Substring in SKU or barcode (handles partial codes)
      if (sku.includes(query) || ean.includes(query)) return { p, score: 200 }

      // 3) Fall back to name word-overlap (all tokens must appear in name)
      const allInName = qt.every(t => name.includes(t))
      if (!allInName) return { p, score: 0 }
      const tokens = tokenize(p.nombre ?? '')
      let score = qt.length * 10
      if (name.startsWith(qt[0])) score += 5
      if (ctxTokens) for (const t of tokens) if (ctxTokens.has(t)) score += 1
      return { p, score }
    }).filter(x => x.score > 0)
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 30).map(x => x.p)
  }, [productos, q, supplierContext])

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, ranked.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') {
      e.preventDefault()
      // Scanner-friendly path: read the live input value (in case React state hasn't
      // caught up with fast-typing scanner) and try exact SKU / barcode match first.
      const current = (inputRef.current?.value ?? q).trim().toLowerCase()
      if (current) {
        const exact = productos.find(p =>
          (p.sku ?? '').toLowerCase() === current ||
          (p.codigo_barras ?? '').toLowerCase() === current
        )
        if (exact) { onSelect(exact); onClose(); return }
      }
      if (ranked[highlightIdx]) { onSelect(ranked[highlightIdx]); onClose() }
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 pt-20" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl p-4" onClick={e => e.stopPropagation()}>
        {supplierContext && (
          <p className="text-xs text-zinc-500 mb-1">
            Buscar para: <span className="font-medium text-zinc-700">{supplierContext}</span>
          </p>
        )}
        <Input ref={inputRef} value={q}
          onChange={e => { setQ(e.target.value); setHighlightIdx(0) }}
          onKeyDown={handleKey}
          placeholder="Escaneá código de barras o escribí SKU / nombre..." />
        <div ref={listRef} className="mt-2 max-h-80 overflow-y-auto space-y-0.5">
          {ranked.map((p, idx) => (
            <button
              key={p.id}
              onClick={() => { onSelect(p); onClose() }}
              onMouseEnter={() => setHighlightIdx(idx)}
              className={`w-full text-left px-3 py-2 rounded text-sm ${
                idx === highlightIdx ? 'bg-blue-50 border border-blue-200' : 'hover:bg-zinc-50 border border-transparent'
              }`}
            >
              <div className="font-medium text-zinc-800 leading-tight">{p.nombre ?? p.sku}</div>
              <div className="text-[11px] text-zinc-400 mt-0.5">
                <span className="font-mono">{p.sku}</span>
                {p.categoria && <span className="ml-2">{p.categoria}</span>}
              </div>
            </button>
          ))}
          {q.trim().length >= 2 && ranked.length === 0 && (
            <div className="py-2 space-y-1">
              {/* DB fallback results (products not in memory or with different name) */}
              {loadingDb && (
                <p className="text-xs text-zinc-400 py-2 text-center flex items-center justify-center gap-1">
                  <Loader2 size={11} className="animate-spin" />Buscando en sistema...
                </p>
              )}
              {!loadingDb && dbResults.length > 0 && (
                <>
                  <p className="text-[10px] text-zinc-400 px-2 pt-1">Encontrado en sistema:</p>
                  {dbResults.map((p, idx) => (
                    <button
                      key={p.id}
                      onClick={() => { onProductoFetched?.(p); onSelect(p); onClose() }}
                      onMouseEnter={() => setHighlightIdx(-1)}
                      className="w-full text-left px-3 py-2 rounded text-sm hover:bg-blue-50 border border-transparent hover:border-blue-200"
                    >
                      <div className="font-medium text-zinc-800 leading-tight">{p.nombre ?? p.sku}</div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">
                        <span className="font-mono">{p.sku}</span>
                        {p.categoria && <span className="ml-2">{p.categoria}</span>}
                      </div>
                    </button>
                  ))}
                </>
              )}
              {!loadingDb && dbResults.length === 0 && (
                <div className="py-3 text-center space-y-2">
                  <p className="text-xs text-zinc-400">No encontrado en sistema para &ldquo;{q}&rdquo;</p>
                  <Button size="sm" variant="outline" onClick={fetchFromDux} disabled={fetchingDux}>
                    {fetchingDux
                      ? <><Loader2 size={12} className="animate-spin mr-1" />
                          {duxProgress ? `Buscando pág. ${duxProgress.page}/${duxProgress.total}...` : 'Conectando a Dux...'}
                        </>
                      : <>🔄 Buscar en Dux (puede tardar 2-4 min)</>}
                  </Button>
                  {duxFetchError && <p className="text-xs text-red-600">{duxFetchError}</p>}
                  <p className="text-[10px] text-zinc-400">Solo si lo creaste en Dux hace menos de 1 hora</p>
                </div>
              )}
            </div>
          )}
          {q.trim().length < 2 && (
            <p className="text-xs text-zinc-400 py-4 text-center">Escribí al menos 2 letras para buscar</p>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-400">
          <span>📷 Escaneá · ↑↓ navegar · Enter elegir · Esc cerrar</span>
          <button onClick={onClose} className="underline">Cerrar</button>
        </div>
      </div>
    </div>
  )
}

// ── Granel mapper modal: 1 supplier item → N final SKUs ──────────

function GranelMapper({ productos, supplierContext, derivados, onChange, onClose }: {
  productos       : Producto[]
  supplierContext : string
  derivados       : GranelDerivado[]
  onChange        : (next: GranelDerivado[]) => void
  onClose         : () => void
}) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const ranked = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return [] as Producto[]
    const tokenize = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, ' ').split(/\s+/).filter(t => t.length >= 2)
    const qt = tokenize(query)
    const ctxTokens = new Set(tokenize(supplierContext))
    const alreadyAdded = new Set(derivados.map(d => d.producto_id))
    const scored = productos
      .filter(p => !alreadyAdded.has(p.id))
      .map(p => {
        const sku  = (p.sku ?? '').toLowerCase()
        const ean  = (p.codigo_barras ?? '').toLowerCase()
        const name = (p.nombre ?? '').toLowerCase()

        if (sku === query || ean === query) return { p, score: 1000 }
        if (sku.startsWith(query)) return { p, score: 500 }
        if (ean.startsWith(query)) return { p, score: 400 }
        if (sku.includes(query) || ean.includes(query)) return { p, score: 200 }

        if (!qt.every(t => name.includes(t))) return { p, score: 0 }
        const tokens = tokenize(p.nombre ?? '')
        let score = qt.length * 10
        if (name.startsWith(qt[0])) score += 5
        for (const t of tokens) if (ctxTokens.has(t)) score += 1
        return { p, score }
      })
      .filter(x => x.score > 0)
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 30).map(x => x.p)
  }, [productos, q, supplierContext, derivados])

  function addDerivado(p: Producto) {
    onChange([...derivados, {
      producto_id    : p.id,
      producto_sku   : p.sku,
      producto_nombre: p.nombre,
    }])
    setQ('')
    inputRef.current?.focus()
  }

  function removeDerivado(idx: number) {
    onChange(derivados.filter((_, i) => i !== idx))
  }

  function updateCantidad(idx: number, value: string) {
    const num = value.trim() === '' ? undefined : Number(value)
    onChange(derivados.map((d, i) => i === idx ? { ...d, cantidad_objetivo: num } : d))
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 pt-12" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-zinc-800">🌾 Configurar derivados de granel</p>
            <p className="text-xs text-zinc-500 mt-0.5">Origen: <span className="font-medium text-zinc-700">{supplierContext}</span></p>
          </div>
          <button onClick={onClose} className="text-xs text-zinc-400 underline">Cerrar</button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Left: search */}
          <div>
            <p className="text-[11px] font-medium text-zinc-500 uppercase mb-1">Buscar SKU final</p>
            <Input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
              placeholder="Escribí parte del nombre..." />
            <div className="mt-2 max-h-72 overflow-y-auto space-y-0.5">
              {ranked.map(p => (
                <button key={p.id} onClick={() => addDerivado(p)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-emerald-50 border border-transparent hover:border-emerald-200 text-sm">
                  <div className="font-medium text-zinc-800 leading-tight truncate" title={p.nombre ?? p.sku}>
                    {p.nombre ?? p.sku}
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-0.5 font-mono">{p.sku}</div>
                </button>
              ))}
              {q.trim().length >= 2 && ranked.length === 0 && (
                <p className="text-xs text-zinc-400 py-3 text-center">Sin resultados</p>
              )}
              {q.trim().length < 2 && (
                <p className="text-xs text-zinc-400 py-3 text-center">Escribí al menos 2 letras</p>
              )}
            </div>
          </div>

          {/* Right: chosen derivados */}
          <div>
            <p className="text-[11px] font-medium text-zinc-500 uppercase mb-1">
              Derivados ({derivados.length})
            </p>
            <div className="border rounded-lg bg-emerald-50/40 p-2 max-h-[340px] overflow-y-auto space-y-1.5">
              {derivados.length === 0 ? (
                <p className="text-xs text-zinc-400 italic py-6 text-center">
                  Ningún derivado todavía.<br />Buscá productos a la izquierda.
                </p>
              ) : (
                derivados.map((d, i) => (
                  <div key={i} className="bg-white rounded border border-emerald-200 px-2 py-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-zinc-800 truncate" title={d.producto_nombre ?? d.producto_sku}>
                          {d.producto_nombre ?? d.producto_sku}
                        </div>
                        <div className="text-[10px] text-zinc-400 font-mono">{d.producto_sku}</div>
                      </div>
                      <button onClick={() => removeDerivado(i)}
                        className="text-xs text-red-500 hover:text-red-700">✕</button>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <label className="text-[10px] text-zinc-500">Objetivo (opcional):</label>
                      <input type="number" min="0" step="1"
                        value={d.cantidad_objetivo ?? ''}
                        onChange={e => updateCantidad(i, e.target.value)}
                        className="w-20 text-right border border-zinc-200 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-300"
                        placeholder="—"
                      />
                      <span className="text-[10px] text-zinc-400">unidades</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={onClose}>Listo</Button>
        </div>
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
  const [granelTarget, setGranelTarget]       = useState<number | null>(null)
  const [saving, setSaving]                   = useState(false)
  const [doneReport, setDoneReport]           = useState('')
  const [duxError, setDuxError]               = useState<string | null>(null)
  const [duxPayloadRetry, setDuxPayloadRetry] = useState<Record<string, unknown> | null>(null)
  const [retryingDux, setRetryingDux]         = useState(false)
  const [priceExcelUrl, setPriceExcelUrl]     = useState<string | null>(null)
  const [priceExcelCount, setPriceExcelCount] = useState(0)
  const [transferenciaId, setTransferenciaId] = useState<string | null>(null)
  const [loadingPdf, setLoadingPdf]           = useState(false)
  const [docProveedor, setDocProveedor]       = useState<DocumentoProveedor | null>(null)
  const [docCopied, setDocCopied]             = useState(false)
  const pdfInputRef                           = useRef<HTMLInputElement>(null)

  // Live multi-user collab state
  const [presenceCount, setPresenceCount]     = useState(1)
  const [linkCopied, setLinkCopied]           = useState(false)
  const itemsRef                              = useRef<InvoiceLineItem[]>([])
  const saveTimersRef                         = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  // Keep itemsRef fresh so debounced save callbacks always see the latest state
  useEffect(() => { itemsRef.current = items }, [items])

  // Realtime: subscribe to borrador changes from other users
  useRecepcionRealtime(borradorId, productos, setItems, setPresenceCount)

  // Cleanup pending autosave timers on unmount
  useEffect(() => {
    const timers = saveTimersRef.current
    return () => { for (const t of timers.values()) clearTimeout(t) }
  }, [])

  /**
   * Schedule a per-item autosave (debounced 600ms). Called from every state
   * mutator. If the item has no recepcion_item_id yet, the save creates one
   * and writes it back into local state so subsequent saves are upserts.
   */
  const scheduleSave = useCallback((idx: number) => {
    const recId = borradorId
    if (!recId) return
    const timers = saveTimersRef.current
    const existing = timers.get(idx)
    if (existing) clearTimeout(existing)
    const t = setTimeout(async () => {
      timers.delete(idx)
      const item = itemsRef.current[idx]
      if (!item) return
      const newId = await persistItem(recId, item)
      if (newId && !item.recepcion_item_id) {
        setItems(prev => prev.map((it, i) => i === idx ? { ...it, recepcion_item_id: newId } : it))
      }
    }, 600)
    timers.set(idx, t)
  }, [borradorId])

  /** Flush every pending autosave immediately and wait for them. */
  const flushPendingSaves = useCallback(async () => {
    const recId = borradorId
    if (!recId) return
    const timers = saveTimersRef.current
    const pending = Array.from(timers.keys())
    for (const idx of pending) {
      const t = timers.get(idx)
      if (t) clearTimeout(t)
      timers.delete(idx)
    }
    await Promise.all(pending.map(async (idx) => {
      const item = itemsRef.current[idx]
      if (!item) return
      const newId = await persistItem(recId, item)
      if (newId && !item.recepcion_item_id) {
        setItems(prev => prev.map((it, i) => i === idx ? { ...it, recepcion_item_id: newId } : it))
      }
    }))
  }, [borradorId])

  // ── Load products + SKU map ──────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoadingProds(true)
      const [prodRes, skuRes] = await Promise.all([
        supabase.from('productos')
          .select('id,sku,nombre,codigo_barras,codigo_externo,precio_venta,costo,proveedor_id_dux,categoria')
          .order('nombre'),
        supabase.from('proveedor_sku_map').select('*'),
      ])
      setProductos((prodRes.data ?? []) as Producto[])
      setSkuMap((skuRes.data ?? []) as SkuMapEntry[])
      setLoadingProds(false)
    }
    load()
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
      id: string; sku: string; nombre_producto: string | null; cantidad_esperada: number
      cantidad_recibida: number | null; fecha_vencimiento: string | null
      estado: string; producto_id: string | null
      es_granel: boolean | null
      iva_porcentaje: number | null
      costo_unitario: number | null
      sku_proveedor: string | null
      descripcion_proveedor: string | null
      precio_venta_sugerido: number | null
      unidades_por_blister: number | null
      transferir_cantidad: number | null
    }>

    // Fetch derivados for any granel items, then resolve product info from local state
    const granelItemIds = dbItems.filter(it => it.es_granel).map(it => it.id)
    const derivadosByItemId = new Map<string, GranelDerivado[]>()
    if (granelItemIds.length > 0) {
      const { data: fracRows } = await supabase
        .from('recepcion_item_fraccionamiento')
        .select('recepcion_item_id, producto_final_id, cantidad_objetivo')
        .in('recepcion_item_id', granelItemIds)
      type FracRow = {
        recepcion_item_id : string
        producto_final_id : string
        cantidad_objetivo : number | null
      }
      const productById = new Map(productos.map(p => [p.id, p]))
      for (const row of (fracRows ?? []) as FracRow[]) {
        const prod = productById.get(row.producto_final_id)
        const list = derivadosByItemId.get(row.recepcion_item_id) ?? []
        list.push({
          producto_id      : row.producto_final_id,
          producto_sku     : prod?.sku ?? '',
          producto_nombre  : prod?.nombre ?? null,
          cantidad_objetivo: row.cantidad_objetivo ?? undefined,
        })
        derivadosByItemId.set(row.recepcion_item_id, list)
      }
    }

    // Fetch lotes for all items
    const itemIds = dbItems.map(it => it.id)
    const lotesByItemId = new Map<string, Lote[]>()
    if (itemIds.length > 0) {
      const { data: loteRows } = await supabase
        .from('recepcion_item_lotes')
        .select('recepcion_item_id, cantidad, fecha_vencimiento, numero_lote')
        .in('recepcion_item_id', itemIds)
        .order('fecha_vencimiento', { ascending: true })
      type LoteRow = {
        recepcion_item_id: string
        cantidad         : number
        fecha_vencimiento: string | null
        numero_lote      : string | null
      }
      for (const row of (loteRows ?? []) as LoteRow[]) {
        const list = lotesByItemId.get(row.recepcion_item_id) ?? []
        list.push({
          cantidad         : row.cantidad,
          fecha_vencimiento: row.fecha_vencimiento ?? '',
          numero_lote      : row.numero_lote ?? undefined,
        })
        lotesByItemId.set(row.recepcion_item_id, list)
      }
    }

    // Fetch full product data for all matched items so producto_nombre / producto_sku
    // display correctly on reload (the local `productos` state may not be loaded yet
    // when loadBorrador runs, so we query directly instead of relying on it).
    const matchedProductIds = [...new Set(dbItems.filter(it => it.producto_id).map(it => it.producto_id!))]
    const prodByIdForBorrador = new Map<string, Producto>()
    if (matchedProductIds.length > 0) {
      const { data: prodRows } = await supabase
        .from('productos')
        .select('id,sku,nombre,codigo_barras,codigo_externo,precio_venta,costo,proveedor_id_dux,categoria')
        .in('id', matchedProductIds)
      for (const p of (prodRows ?? []) as Producto[]) {
        prodByIdForBorrador.set(p.id, p)
      }
    }

    const reconstructed: InvoiceLineItem[] = dbItems.map(it => {
      const lotes = lotesByItemId.get(it.id) ?? []
      const cantidadRecibida = lotes.length > 0
        ? lotes.reduce((s, l) => s + l.cantidad, 0)
        : (it.cantidad_recibida ?? 0)
      const prod = it.producto_id ? prodByIdForBorrador.get(it.producto_id) : undefined
      return {
        recepcion_item_id     : it.id,
        sku_proveedor         : it.sku_proveedor ?? it.sku,
        descripcion_proveedor : it.descripcion_proveedor ?? it.nombre_producto ?? it.sku,
        cantidad              : it.cantidad_esperada,
        costo_unitario        : it.costo_unitario ?? 0,
        iva_porcentaje        : it.iva_porcentaje ?? 21,
        precio_venta_sugerido : it.precio_venta_sugerido ?? 0,
        match_confidence      : it.producto_id ? 'sku_map' : 'sin_match',
        producto_id           : it.producto_id ?? undefined,
        // These three are what make the UI show the product name + "Cambiar" instead of "+ Asignar"
        producto_sku          : prod?.sku,
        producto_nombre       : prod?.nombre ?? undefined,
        producto_precio_actual: prod?.precio_venta ?? undefined,
        producto_id_dux       : prod?.proveedor_id_dux ?? undefined,
        cantidad_recibida     : cantidadRecibida,
        fecha_vencimiento     : it.fecha_vencimiento ?? '',
        estado_recepcion      : (it.estado as InvoiceLineItem['estado_recepcion']) ?? 'ok',
        es_blister            : /^BLISTER\s/i.test(it.nombre_producto ?? ''),
        unidades_por_blister  : it.unidades_por_blister ?? 1,
        transferir_cantidad   : it.transferir_cantidad ?? 0,
        es_granel             : !!it.es_granel,
        derivados             : it.es_granel ? (derivadosByItemId.get(it.id) ?? []) : undefined,
        lotes,
      }
    })

    setSucursalId(rec.sucursal_id ?? SUCURSALES[0].id)
    setTexto(rec.texto_original ?? '')
    setFactura(inv)
    setItems(reconstructed)
    setBorradorId(id)
    setStep('review')
  }

  // Load borrador from URL if present (declared after loadBorrador so it's not used-before-declared)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const bid = params.get('borrador')
    if (bid) loadBorrador(bid)
  }, [])

  // Fetch margin + iva_default when factura changes; if iva_default is set,
  // apply it to any item that still has the parser default (21).
  useEffect(() => {
    if (!factura?.proveedor_nombre) return
    supabase.from('proveedores_config')
      .select('margen_costo, iva_default')
      .ilike('nombre', `%${factura.proveedor_nombre}%`)
      .single()
      .then(({ data }) => {
        if (!data) return
        const row = data as { margen_costo: number | null; iva_default: number | null }
        if (row.margen_costo != null) setMargenProveedor(row.margen_costo)
        if (row.iva_default != null && row.iva_default !== 21) {
          setItems(prev => prev.map(it =>
            it.iva_porcentaje === 21 ? { ...it, iva_porcentaje: row.iva_default! } : it
          ))
        }
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
    // Only use learned mappings — supplier sku previously matched manually by an operator.
    // No automatic matching by barcode / codigo_externo / SKU / fuzzy name.
    const mapEntry = skuMap.find(
      e => e.proveedor_nombre.toLowerCase() === proveedorNombre.toLowerCase()
        && e.sku_proveedor === item.sku_proveedor
    )
    if (mapEntry?.producto_id) {
      const p = productos.find(p => p.id === mapEntry.producto_id)
      if (p) {
        const matched = applyMatch(item, p, 'sku_map')
        // Flag description change if the supplier renamed/replaced the product under same sku
        const prev = mapEntry.descripcion_proveedor?.trim()
        const curr = item.descripcion_proveedor.trim()
        if (prev && prev !== curr) {
          matched.descripcion_anterior = prev
        }
        return matched
      }
    }
    return { ...item, match_confidence: 'sin_match' }
  }

  // ── Step 1 ────────────────────────────────────────────────────

  /**
   * Create the recepciones row + insert all items, returning items with their
   * persisted recepcion_item_id. Called right after parse so a second user
   * can immediately join via the borrador URL.
   */
  async function createBorradorFromParsed(
    parsed     : ParsedFactura,
    items      : InvoiceLineItem[],
    textoOrig  : string,
  ): Promise<{ recId: string | null; items: InvoiceLineItem[] }> {
    const fechaISO = parsed.fecha
      ? parsed.fecha.split('/').reverse().join('-')
      : new Date().toISOString().split('T')[0]
    const { data: recRow, error: recErr } = await supabase.from('recepciones').insert({
      numero_comprobante : parsed.nro_comprobante || null,
      dux_compra_id      : parsed.nro_comprobante || null,
      proveedor_nombre   : parsed.proveedor_nombre || null,
      fecha_factura      : fechaISO,
      fecha_recepcion    : new Date().toISOString().split('T')[0],
      estado             : 'borrador',
      sucursal_id        : sucursalId,
      texto_original     : textoOrig,
      last_edited_by     : CLIENT_ID,
    }).select('id').single()
    if (recErr || !recRow) {
      console.error('Error creando borrador:', recErr)
      return { recId: null, items }
    }
    const recId = (recRow as { id: string }).id
    // Persist all items in parallel so the borrador is fully shareable from t=0
    const withIds = await Promise.all(items.map(async (it) => {
      const id = await persistItem(recId, it)
      return id ? { ...it, recepcion_item_id: id } : it
    }))
    // Update URL so the second user can land on the same borrador
    try { window.history.replaceState({}, '', `?borrador=${recId}`) } catch {}
    return { recId, items: withIds }
  }

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
          lotes                 : [],
        })),
      }

      const textoOriginal = JSON.stringify(data, null, 2)
      setTexto(textoOriginal)
      const matched = parsed.items.map(item => matchItem(item, parsed.proveedor_nombre))
      // Auto-create the borrador so multi-user collab works from t=0
      const { recId, items: withIds } = await createBorradorFromParsed(parsed, matched, textoOriginal)
      setFactura(parsed)
      setItems(withIds)
      if (recId) setBorradorId(recId)
      setStep('review')
    } catch (err) {
      alert('Error al procesar el PDF: ' + (err as Error).message)
    } finally {
      setLoadingPdf(false)
      if (pdfInputRef.current) pdfInputRef.current.value = ''
    }
  }

  async function handleParsear() {
    if (!texto.trim()) return
    const tipo   = tipoProveedor === 'auto' ? detectProveedorType(texto) : tipoProveedor
    const parsed = parseFactura(texto, tipo)
    const matched = parsed.items.map(item => matchItem(item, parsed.proveedor_nombre))
    const { recId, items: withIds } = await createBorradorFromParsed(parsed, matched, texto)
    setFactura(parsed)
    setItems(withIds)
    if (recId) setBorradorId(recId)
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
    scheduleSave(idx)
  }

  function manualMatch(idx: number, p: Producto) {
    setItems(prev => {
      const next = [...prev]
      next[idx] = applyMatch(next[idx], p, 'manual')
      return next
    })
    setSearchTarget(null)
    scheduleSave(idx)
  }

  function toggleGranel(idx: number) {
    setItems(prev => {
      const next = [...prev]
      const it = next[idx]
      const becoming = !it.es_granel
      next[idx] = {
        ...it,
        es_granel       : becoming,
        // When marking as granel, drop the single-product match — derivados take over
        producto_id     : becoming ? undefined : it.producto_id,
        producto_sku    : becoming ? undefined : it.producto_sku,
        producto_nombre : becoming ? undefined : it.producto_nombre,
        match_confidence: becoming ? 'sin_match' : it.match_confidence,
        derivados       : becoming ? (it.derivados ?? []) : undefined,
        cantidad_recibida: becoming ? 0 : it.cantidad_recibida,
      }
      return next
    })
    scheduleSave(idx)
  }

  function updateDerivados(idx: number, derivados: GranelDerivado[]) {
    setItems(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], derivados }
      return next
    })
    scheduleSave(idx)
  }

  // Multi-lot helpers — first call to addLote "materializes" current single-lot values
  function addLote(idx: number) {
    setItems(prev => {
      const next = [...prev]
      const it = next[idx]
      let lotes = it.lotes
      if (lotes.length === 0) {
        lotes = [{
          cantidad         : it.cantidad_recibida,
          fecha_vencimiento: it.fecha_vencimiento,
        }, { cantidad: 0, fecha_vencimiento: '' }]
      } else {
        lotes = [...lotes, { cantidad: 0, fecha_vencimiento: '' }]
      }
      next[idx] = {
        ...it,
        lotes,
        cantidad_recibida: lotes.reduce((s, l) => s + l.cantidad, 0),
      }
      return next
    })
    scheduleSave(idx)
  }

  function removeLote(idx: number, loteIdx: number) {
    setItems(prev => {
      const next = [...prev]
      const it = next[idx]
      const newLotes = it.lotes.filter((_, i) => i !== loteIdx)
      // Collapse back to single-lot mode if only one remains
      if (newLotes.length === 1) {
        next[idx] = {
          ...it,
          lotes            : [],
          cantidad_recibida: newLotes[0].cantidad,
          fecha_vencimiento: newLotes[0].fecha_vencimiento,
        }
      } else {
        next[idx] = {
          ...it,
          lotes            : newLotes,
          cantidad_recibida: newLotes.reduce((s, l) => s + l.cantidad, 0),
        }
      }
      return next
    })
    scheduleSave(idx)
  }

  function updateLote(idx: number, loteIdx: number, patch: Partial<Lote>) {
    setItems(prev => {
      const next = [...prev]
      const it = next[idx]
      const newLotes = it.lotes.map((l, i) => i === loteIdx ? { ...l, ...patch } : l)
      next[idx] = {
        ...it,
        lotes            : newLotes,
        cantidad_recibida: newLotes.reduce((s, l) => s + l.cantidad, 0),
      }
      return next
    })
    scheduleSave(idx)
  }

  // ── Save borrador ─────────────────────────────────────────────
  // Now that every state mutation triggers a debounced per-item save, this is
  // essentially a "force flush + confirm everything is on the DB" action.
  // Keeps the explicit button for operator peace of mind.

  const saveBorrador = useCallback(async () => {
    if (!factura) return
    setSavingBorrador(true)
    try {
      let recId = borradorId
      // If for some reason auto-create on parse didn't run (older borrador URL, race), make one now.
      if (!recId) {
        const created = await createBorradorFromParsed(factura, items, texto)
        recId = created.recId
        if (recId) {
          setBorradorId(recId)
          setItems(created.items)
        }
      } else {
        await supabase.from('recepciones').update({
          estado         : 'borrador',
          sucursal_id    : sucursalId,
          last_edited_by : CLIENT_ID,
          updated_at     : new Date().toISOString(),
        }).eq('id', recId)
        await flushPendingSaves()
      }
      if (!recId) throw new Error('No se pudo crear el borrador')
      setBorradorSavedAt(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }))
    } catch (err) {
      alert('Error al guardar borrador: ' + (err as Error).message)
    } finally {
      setSavingBorrador(false)
    }
    // createBorradorFromParsed is stable enough at runtime; eslint deps quieted intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factura, items, sucursalId, texto, borradorId, flushPendingSaves])

  // ── Confirm ───────────────────────────────────────────────────

  // ── Dux compras helper ──────────────────────────────────────
  async function postDuxCompra(payload: Record<string, unknown>): Promise<{ msg: string; detail?: string } | null> {
    const res = await fetch('/api/dux/compras', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(payload),
    })
    if (res.ok) return null
    const e = await res.json().catch(() => ({})) as Record<string, unknown>
    const duxResp = e.dux_response as Record<string, unknown> | null | undefined
    const msg = (duxResp?.error as Record<string, unknown>)?.mensaje as string
             ?? (duxResp?.mensaje as string)
             ?? (e.error as string)
             ?? 'error desconocido'
    // Build detail string for debugging: show which items were sent
    const payloadSent = e.payload_sent as Record<string, unknown> | undefined
    const prods = payloadSent?.productos as Array<{id_item:string; cantidad:number; precio_unitario:number}> | undefined
    const detail = prods
      ? `Items enviados a Dux: ${prods.map(p => `${p.id_item} (cant:${p.cantidad} precio:${p.precio_unitario})`).join(' | ')}`
      : undefined
    return { msg: `Dux ${res.status}: ${msg}`, detail }
  }

  async function retryDux() {
    if (!duxPayloadRetry) return
    setRetryingDux(true)
    setDuxError(null)
    const err = await postDuxCompra(duxPayloadRetry)
    if (err) {
      setDuxError(err.msg + (err.detail ? `\n\n${err.detail}` : ''))
    } else {
      setDuxPayloadRetry(null)
    }
    setRetryingDux(false)
  }

  const confirmar = useCallback(async () => {
    if (!factura) return
    setSaving(true)
    setDuxError(null)
    try {
      const sucursal = SUCURSALES.find(s => s.id === sucursalId)!
      const fechaISO = factura.fecha
        ? factura.fecha.split('/').reverse().join('-')
        : new Date().toISOString().split('T')[0]

      // Compute totals inline (mirrors `stats` but kept local to avoid stale-closure issues)
      const totalNeto  = items.reduce((s, i) => s + i.costo_unitario * i.cantidad, 0)
      const totalIva   = items.reduce((s, i) => s + i.costo_unitario * i.cantidad * ((i.iva_porcentaje ?? 0) / 100), 0)
      const totalFinal = totalNeto + totalIva

      // ── 1. Ensure borrador exists + flush pending edits ───────
      let recId = borradorId
      if (!recId) {
        const created = await createBorradorFromParsed(factura, items, texto)
        recId = created.recId
        if (recId) {
          setBorradorId(recId)
          setItems(created.items)
        }
      }
      if (!recId) throw new Error('No se pudo crear / encontrar el borrador')
      await flushPendingSaves()

      // Mark recepción as confirmada + totals
      await supabase.from('recepciones').update({
        estado          : 'confirmada',
        sucursal_id     : sucursalId,
        fecha_recepcion : new Date().toISOString().split('T')[0],
        total_neto      : totalNeto,
        total_iva       : totalIva,
        total_factura   : totalFinal,
        last_edited_by  : CLIENT_ID,
        updated_at      : new Date().toISOString(),
      }).eq('id', recId)

      // ── 2. Crear vencimientos (los items y sus lotes ya estan en DB) ──
      for (const item of items) {
        if (item.es_granel) continue
        // Multi-lot path
        if (item.lotes.length > 0) {
          const validLotes = item.lotes.filter(l => l.cantidad > 0)
          if (item.producto_id && item.estado_recepcion !== 'vencido_llegada') {
            for (const l of validLotes) {
              if (!l.fecha_vencimiento) continue
              const { data: existing } = await supabase.from('vencimientos')
                .select('id,cantidad')
                .eq('producto_id', item.producto_id)
                .eq('sucursal_id', sucursalId)
                .eq('fecha_vencimiento', l.fecha_vencimiento)
                .maybeSingle()
              if (existing) {
                await supabase.from('vencimientos')
                  .update({ cantidad: (existing as { id: string; cantidad: number }).cantidad + l.cantidad,
                    updated_at: new Date().toISOString() })
                  .eq('id', (existing as { id: string }).id)
              } else {
                await supabase.from('vencimientos').insert({
                  producto_id      : item.producto_id,
                  sucursal_id      : sucursalId,
                  fecha_vencimiento: l.fecha_vencimiento,
                  cantidad         : l.cantidad,
                  origen           : 'recepcion_factura',
                  recepcion_id     : recId,
                })
              }
            }
          }
          continue
        }
        // Single-lot legacy path
        if (
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
            .maybeSingle()

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

      // ── 3. Crear transferencia interna si hay ítems para S1 ──
      const itemsATransferir = items.filter(
        i => i.producto_id && !i.es_granel && (i.transferir_cantidad ?? 0) > 0
      )
      if (itemsATransferir.length > 0) {
        const { data: transf } = await supabase.from('transferencias_recepcion').insert({
          recepcion_id        : recId,
          sucursal_origen_id  : sucursalId,
          sucursal_destino_id : 'a0000000-0000-0000-0000-000000000002', // SOHO 1 - La Pieza
          estado              : 'pendiente',
        }).select('id').single()
        const transfId = (transf as { id: string } | null)?.id ?? null
        if (transfId) {
          await supabase.from('transferencias_recepcion_items').insert(
            itemsATransferir.map(i => ({
              transferencia_id  : transfId,
              recepcion_item_id : i.recepcion_item_id ?? null,
              producto_id       : i.producto_id!,
              producto_sku      : i.producto_sku ?? i.sku_proveedor,
              producto_nombre   : i.producto_nombre ?? i.descripcion_proveedor,
              cantidad          : i.transferir_cantidad,
            }))
          )
          setTransferenciaId(transfId)
        }
      }

      // ── 4. Save new SKU mappings ─────────────────────────────
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

      // ── 3.5. Learn iva_default for supplier when >=70% items are 10.5% ─
      if (items.length > 0 && factura.proveedor_nombre) {
        const pct10 = items.filter(i => i.iva_porcentaje === 10.5).length / items.length
        if (pct10 >= 0.70) {
          await supabase.from('proveedores_config')
            .update({ iva_default: 10.5 })
            .ilike('nombre', `%${factura.proveedor_nombre}%`)
        }
      }

      // ── 4. POST to Dux v2/compras ────────────────────────────
      // Include all matched items (granel included — Dux needs the purchase registered)
      const duxItems = items.filter(i => i.producto_sku && i.cantidad > 0)

      // Resolve id_proveedor for the Dux purchase:
      // Priority 1: dux_proveedor_id set explicitly in proveedores_config (by proveedor_nombre)
      // Priority 2: most frequent proveedor_id_dux across matched items (handles multi-brand distributors)
      let provId: number | undefined
      if (factura.proveedor_nombre) {
        const { data: provCfg } = await supabase.from('proveedores_config')
          .select('dux_proveedor_id')
          .ilike('nombre', `%${factura.proveedor_nombre}%`)
          .not('dux_proveedor_id', 'is', null)
          .limit(1)
          .maybeSingle()
        if (provCfg) provId = (provCfg as { dux_proveedor_id: number }).dux_proveedor_id
      }
      if (!provId) {
        // Fallback: pick the proveedor_id_dux that appears most frequently among items
        const freq = new Map<number, number>()
        for (const i of items) {
          if (i.producto_id_dux) freq.set(i.producto_id_dux, (freq.get(i.producto_id_dux) ?? 0) + 1)
        }
        if (freq.size > 0) {
          provId = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0]
        }
      }

      if (duxItems.length === 0) {
        setDuxError('La compra NO se cargó en Dux: ningún ítem tiene un SKU del sistema asignado. Cargala manualmente en Dux.')
      } else if (!provId) {
        setDuxError('La compra NO se cargó en Dux: no se pudo determinar el proveedor en Dux. Configuralo en /compras/proveedores → campo "ID Dux".')
      } else {
        const duxPayload = {
          id_sucursal     : sucursal.dux_sucursal_id,  // Dux logical branch: 1=SOHO1, 3=SOHO2
          id_proveedor    : provId,
          id_deposito     : sucursal.dux_deposito,
          fecha           : fechaISO,
          nro_comprobante : factura.nro_comprobante || 'S/N',
          tipo_comprobante: 'FACTURA',
          // For granel: use invoice quantity (what physically arrived), not cantidad_recibida
          productos: duxItems.map(i => ({
            id_item         : i.producto_sku!,
            cantidad        : i.cantidad,  // siempre la cantidad de factura (Fact.), no la recibida
            precio_unitario : i.costo_unitario,
          })),
        }

        const duxRes = await postDuxCompra(duxPayload)
        if (duxRes) {
          setDuxError(duxRes.msg + (duxRes.detail ? `\n\n${duxRes.detail}` : ''))
          setDuxPayloadRetry(duxPayload)
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

      // ── 7. Documento para el proveedor (4 categorías) ────────
      const documento = buildDocumentoProveedor(items, {
        proveedor      : factura.proveedor_nombre ?? '',
        nroComprobante : factura.nro_comprobante ?? '',
        fechaFactura   : factura.fecha ?? '',
        sucursal       : sucursal.nombre,
      })
      setDocProveedor(documento)
      setDocCopied(false)

      setStep('done')
    } catch (err) {
      alert('Error al confirmar: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
    // createBorradorFromParsed is intentionally not declared as a dep (stable at runtime)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factura, items, sucursalId, texto, borradorId, margenProveedor, flushPendingSaves])

  // ── Stats ─────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const totalNeto = items.reduce((s, i) => s + i.costo_unitario * i.cantidad, 0)
    const totalIva  = items.reduce((s, i) => s + i.costo_unitario * i.cantidad * ((i.iva_porcentaje ?? 0) / 100), 0)
    return {
      total      : items.length,
      pendientes : items.filter(i => !i.producto_id && !i.es_granel).length,
      mapeados   : items.filter(i => i.producto_id || (i.es_granel && (i.derivados?.length ?? 0) > 0)).length,
      granel     : items.filter(i => i.es_granel).length,
      blisters   : items.filter(i => i.es_blister && !i.es_granel).length,
      totalCosto : totalNeto,
      totalNeto,
      totalIva,
      totalFinal : totalNeto + totalIva,
    }
  }, [items])

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
            supplierContext={items[searchTarget]?.descripcion_proveedor}
            initialQuery=""
            onSelect={p => manualMatch(searchTarget, p)}
            onClose={() => setSearchTarget(null)}
            onProductoFetched={p => setProductos(prev =>
              prev.some(x => x.id === p.id)
                ? prev.map(x => x.id === p.id ? p : x)
                : [...prev, p]
            )}
          />
        )}

        {granelTarget !== null && items[granelTarget] && (
          <GranelMapper
            productos={productos}
            supplierContext={items[granelTarget].descripcion_proveedor}
            derivados={items[granelTarget].derivados ?? []}
            onChange={ds => updateDerivados(granelTarget, ds)}
            onClose={() => setGranelTarget(null)}
          />
        )}

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <button onClick={() => setStep('paste')} className="text-zinc-400 hover:text-zinc-700 text-sm">← Volver</button>
            <h1 className="text-xl font-semibold text-zinc-900">Revisar factura</h1>
            {borradorId && <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">Borrador</Badge>}
            {presenceCount > 1 && (
              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 flex items-center gap-1">
                <Users size={11} />{presenceCount} editando
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {borradorId && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const url = `${window.location.origin}/recepciones/factura?borrador=${borradorId}`
                  try {
                    await navigator.clipboard.writeText(url)
                    setLinkCopied(true)
                    setTimeout(() => setLinkCopied(false), 2000)
                  } catch {
                    window.prompt('Copiá este link:', url)
                  }
                }}
              >
                {linkCopied
                  ? <>✓ Copiado</>
                  : <><Link2 size={13} className="mr-1" />Compartir</>}
              </Button>
            )}
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

        {/* Pending mapping notice */}
        <div className="flex items-center gap-2 text-xs">
          <Badge className="bg-zinc-100 text-zinc-700 border-zinc-300">{items.length} ítems</Badge>
          {stats.pendientes > 0 && <Badge className="bg-red-100 text-red-700 border-red-300">{stats.pendientes} por asignar</Badge>}
          {stats.mapeados > 0 && <Badge className="bg-green-100 text-green-700 border-green-300">{stats.mapeados} mapeados</Badge>}
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
                  <th className="text-right px-2 py-2 text-xs font-medium text-zinc-500 w-14">Fact.</th>
                  <th className="text-right px-2 py-2 text-xs font-medium text-zinc-500 w-20">Recibido</th>
                  {(sucursalId === 'a0000000-0000-0000-0000-000000000003' || sucursalId === 'a0000000-0000-0000-0000-000000000004') && (
                    <th className="text-right px-2 py-2 text-xs font-medium text-indigo-500 w-16" title="Unidades a transferir a SOHO 1">→ S1</th>
                  )}
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
                    : !item.producto_id
                    ? 'bg-red-50'
                    : item.estado_recepcion === 'vencido_llegada'
                    ? 'bg-orange-50'
                    : 'hover:bg-zinc-50'

                  return (
                    <tr key={i} className={`border-b last:border-b-0 ${rowCls}`}>
                      <td className="px-3 py-2 text-xs text-zinc-400">{i + 1}</td>

                      {/* Supplier description */}
                      <td className="px-3 py-2 max-w-[280px] min-w-[200px]">
                        <div className="text-xs font-mono text-zinc-400 truncate">{item.sku_proveedor}</div>
                        <div className="flex items-start gap-1">
                          <div className="text-xs text-zinc-700 leading-tight flex-1 line-clamp-3">
                            {item.descripcion_proveedor}
                          </div>
                          {item.descripcion_anterior && (
                            <span title={`Antes era: ${item.descripcion_anterior}`}
                              className="text-amber-500 text-sm cursor-help shrink-0">⚠️</span>
                          )}
                        </div>
                      </td>

                      {/* Matched product (or list of derivados if granel) */}
                      <td className="px-3 py-2 max-w-[200px]">
                        {item.es_granel ? (
                          <div className="space-y-0.5">
                            {(item.derivados ?? []).length === 0 ? (
                              <button onClick={() => setGranelTarget(i)}
                                className="text-xs text-emerald-700 underline hover:text-emerald-900 font-medium">
                                + Configurar derivados
                              </button>
                            ) : (
                              <>
                                <ul className="text-[11px] text-zinc-700 leading-tight space-y-0.5">
                                  {(item.derivados ?? []).map((d, di) => (
                                    <li key={di} className="truncate" title={d.producto_nombre ?? d.producto_sku}>
                                      · {d.producto_nombre ?? d.producto_sku}
                                      {d.cantidad_objetivo != null && (
                                        <span className="text-zinc-400"> ({d.cantidad_objetivo})</span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                                <button onClick={() => setGranelTarget(i)}
                                  className="text-[10px] text-emerald-700 underline hover:text-emerald-900">
                                  Editar derivados ({(item.derivados ?? []).length})
                                </button>
                              </>
                            )}
                          </div>
                        ) : item.producto_nombre ? (
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
                        ) : item.lotes.length > 0 ? (
                          <span className="inline-block w-16 text-right text-sm tabular-nums text-zinc-600 italic" title="Calculado desde lotes">
                            {item.cantidad_recibida}
                          </span>
                        ) : (
                          <input type="number" min="0"
                            value={item.cantidad_recibida}
                            onChange={e => updateItem(i, { cantidad_recibida: parseInt(e.target.value) || 0 })}
                            className="w-16 text-right border border-zinc-200 rounded px-1 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-zinc-400"
                          />
                        )}
                      </td>

                      {/* Transfer to S1 — only visible when receiving at SOHO 2 */}
                      {(sucursalId === 'a0000000-0000-0000-0000-000000000003' || sucursalId === 'a0000000-0000-0000-0000-000000000004') && (
                        <td className="px-2 py-2 text-right">
                          {item.producto_id && !item.es_granel ? (
                            <input
                              type="number" min="0"
                              max={item.cantidad_recibida}
                              value={item.transferir_cantidad ?? 0}
                              onChange={e => updateItem(i, { transferir_cantidad: parseInt(e.target.value) || 0 })}
                              className="w-14 text-right border border-indigo-200 rounded px-1 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-indigo-50"
                              title="Unidades a transferir a SOHO 1"
                            />
                          ) : (
                            <span className="text-zinc-300 text-xs">—</span>
                          )}
                        </td>
                      )}

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

                      {/* Expiry — single date or multi-lot */}
                      <td className="px-2 py-2 relative align-top">
                        {item.es_granel ? (
                          <span className="text-[10px] text-emerald-600 italic">en fraccionamiento</span>
                        ) : item.lotes.length === 0 ? (
                          <div className="flex flex-col gap-1">
                            <DateSelector value={item.fecha_vencimiento} onChange={v => updateItem(i, { fecha_vencimiento: v })} />
                            <button onClick={() => addLote(i)}
                              className="text-[10px] text-zinc-400 underline hover:text-zinc-700 text-left">
                              + otro vencimiento
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1.5 min-w-[200px]">
                            {item.lotes.map((lote, li) => (
                              <div key={li} className="flex items-center gap-1 bg-white border border-zinc-200 rounded px-1.5 py-1">
                                <input type="number" min="0" value={lote.cantidad}
                                  onChange={e => updateLote(i, li, { cantidad: parseInt(e.target.value) || 0 })}
                                  className="w-12 text-right border border-zinc-200 rounded px-1 py-0.5 text-xs tabular-nums focus:outline-none"
                                  title="Cantidad de este lote"
                                />
                                <DateSelector value={lote.fecha_vencimiento}
                                  onChange={v => updateLote(i, li, { fecha_vencimiento: v })} />
                                <button onClick={() => removeLote(i, li)}
                                  className="text-xs text-red-500 hover:text-red-700">✕</button>
                              </div>
                            ))}
                            <div className="flex items-center justify-between text-[10px]">
                              <button onClick={() => addLote(i)}
                                className="text-zinc-500 underline hover:text-zinc-800">+ lote</button>
                              <span className={`tabular-nums ${item.cantidad_recibida === item.cantidad ? 'text-green-600' : 'text-orange-600'}`}>
                                Σ {item.cantidad_recibida}/{item.cantidad}
                              </span>
                            </div>
                          </div>
                        )}
                      </td>

                      {/* IVA */}
                      <td className="px-2 py-2 text-center">
                        <select
                          value={item.iva_porcentaje}
                          onChange={e => updateItem(i, { iva_porcentaje: parseFloat(e.target.value) })}
                          className="text-xs border border-zinc-200 rounded px-1 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400 cursor-pointer"
                        >
                          <option value={21}>21%</option>
                          <option value={10.5}>10.5%</option>
                          <option value={0}>0%</option>
                        </select>
                      </td>

                      {/* Type badge + granel toggle */}
                      <td className="px-2 py-2 text-center">
                        {item.es_granel ? (
                          <div className="flex flex-col items-center gap-1">
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-[10px] px-1">🌾 Granel</Badge>
                            <button onClick={() => toggleGranel(i)} className="text-[10px] text-zinc-400 underline hover:text-zinc-700">
                              quitar
                            </button>
                          </div>
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
                        ) : (
                          <button onClick={() => toggleGranel(i)}
                            className="text-[10px] text-zinc-400 underline hover:text-emerald-700">
                            marcar granel
                          </button>
                        )}
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
          <span className="flex items-center gap-1"><HelpCircle size={12} className="text-red-500" />Rojo = sin asignar — click en &ldquo;+ Asignar&rdquo;</span>
          <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-green-600" />Sin color = mapeado</span>
          <span className="flex items-center gap-1"><span className="text-emerald-600">🌾</span>Verde = granel (se fracciona después)</span>
        </div>

        {/* Totals validation panel */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <p className="text-xs font-medium text-blue-900 mb-2 uppercase tracking-wide">Validación de totales</p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-[11px] text-blue-700">Neto</div>
              <div className="font-medium tabular-nums text-blue-900">
                ${stats.totalNeto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-blue-700">IVA</div>
              <div className="font-medium tabular-nums text-blue-900">
                ${stats.totalIva.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-blue-700">Total final</div>
              <div className="font-semibold tabular-nums text-blue-900">
                ${stats.totalFinal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-blue-700 mt-2">
            Verificá que el total coincida con el de la factura antes de confirmar. Si no, ajustá costo o IVA por ítem.
          </p>
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
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800 space-y-2">
            <p className="font-semibold">⚠️ No se pudo registrar la compra en Dux</p>
            <p className="text-xs">{duxError}</p>
            {duxPayloadRetry && (
              <Button
                size="sm"
                variant="outline"
                className="border-orange-300 text-orange-800 hover:bg-orange-100"
                disabled={retryingDux}
                onClick={retryDux}
              >
                {retryingDux
                  ? <><Loader2 size={12} className="animate-spin mr-1" />Reintentando...</>
                  : '🔄 Reintentar envío a Dux'}
              </Button>
            )}
            {!duxPayloadRetry && (
              <p className="text-xs text-orange-600">✓ Enviado correctamente a Dux al reintentar.</p>
            )}
          </div>
        )}

        {/* Granel queue */}
        {granelItems.length > 0 && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4">
            <p className="text-sm font-semibold text-emerald-800 mb-1">🌾 {granelItems.length} productos granel — ir a fraccionar</p>
            <p className="text-xs text-emerald-700 mb-3">
              La factura está registrada en Dux. Ahora fraccioná la mercadería y <strong>volvé a esta recepción para actualizar las cantidades recibidas</strong> (botón &ldquo;Editar borrador&rdquo;).
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

        {/* Transferencia interna pendiente */}
        {transferenciaId && (() => {
          const itemsT = items.filter(i => i.producto_id && !i.es_granel && (i.transferir_cantidad ?? 0) > 0)
          const sucOrigen = SUCURSALES.find(s => s.id === sucursalId)?.nombre ?? 'SOHO 2'
          const totalUnidades = itemsT.reduce((s, i) => s + (i.transferir_cantidad ?? 0), 0)
          const textoTransferencia = [
            `TRANSFERENCIA INTERNA PENDIENTE`,
            `De: ${sucOrigen}  →  A: SOHO 1 - La Pieza`,
            `Fecha recepción: ${new Date().toLocaleDateString('es-AR')}`,
            '',
            ...itemsT.map(i =>
              `  · ${i.producto_sku ?? i.sku_proveedor}  ${i.producto_nombre ?? i.descripcion_proveedor}  —  ${i.transferir_cantidad} unidades`
            ),
            '',
            `Total: ${totalUnidades} unidades`,
            ``,
            `→ Cargar en Dux: Movimientos → Transferencia interna`,
          ].join('\n')
          return (
            <div className="rounded-lg border-2 border-indigo-300 bg-indigo-50 px-4 py-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-sm font-semibold text-indigo-900">
                    🔄 Transferencia interna pendiente — {sucOrigen} → SOHO 1
                  </p>
                  <p className="text-xs text-indigo-700 mt-0.5">
                    {itemsT.length} productos · {totalUnidades} unidades totales
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm"
                    className="border-indigo-300 text-indigo-700"
                    onClick={() => navigator.clipboard.writeText(textoTransferencia)}
                  >
                    Copiar lista
                  </Button>
                  <Link href="/transferencias" target="_blank">
                    <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                      Ver transferencias →
                    </Button>
                  </Link>
                </div>
              </div>
              <div className="bg-white border border-indigo-200 rounded-lg p-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-indigo-100">
                      <th className="text-left text-xs font-medium text-indigo-600 pb-1">SKU</th>
                      <th className="text-left text-xs font-medium text-indigo-600 pb-1">Producto</th>
                      <th className="text-right text-xs font-medium text-indigo-600 pb-1">Unidades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsT.map((it, idx) => (
                      <tr key={idx} className="border-b border-indigo-50 last:border-0">
                        <td className="py-1 text-xs font-mono text-zinc-500">{it.producto_sku ?? it.sku_proveedor}</td>
                        <td className="py-1 text-xs text-zinc-800">{it.producto_nombre ?? it.descripcion_proveedor}</td>
                        <td className="py-1 text-xs font-semibold text-indigo-700 text-right">{it.transferir_cantidad}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-indigo-600">
                <strong>Dux:</strong> Movimientos → Transferencia interna → De {sucOrigen} → A SOHO 1 La Pieza
              </p>
            </div>
          )
        })()}

        {/* Documento para el proveedor (4 categorías) */}
        {docProveedor && (
          <div>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">📋 Documento para el proveedor</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(documentoProveedorToText(docProveedor))
                    setDocCopied(true)
                    setTimeout(() => setDocCopied(false), 2000)
                  }}
                >
                  {docCopied ? '✓ Copiado' : 'Copiar texto'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => documentoProveedorToPDF(docProveedor)}
                >
                  <Download size={13} className="mr-1" />Descargar PDF
                </Button>
              </div>
            </div>

            <div className="bg-white border rounded-lg p-4 space-y-4">
              {docProveedor.vencidos.length === 0 &&
               docProveedor.proximosAVencer.length === 0 &&
               docProveedor.faltantes.length === 0 &&
               docProveedor.sobrantes.length === 0 && (
                <p className="text-sm text-zinc-500 italic">
                  Sin novedades — la recepción coincide con la factura.
                </p>
              )}

              {docProveedor.vencidos.length > 0 && (
                <section>
                  <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1.5">
                    ⚠️ Vencidos al llegar ({docProveedor.vencidos.length})
                  </p>
                  <ul className="space-y-1 text-sm text-zinc-700">
                    {docProveedor.vencidos.map((it, i) => (
                      <li key={i} className="flex flex-wrap gap-x-2">
                        <span className="font-mono text-xs bg-red-50 text-red-700 px-1.5 py-0.5 rounded">{it.sku}</span>
                        <span>{it.nombre}</span>
                        <span className="text-zinc-500">
                          — {it.cantidad ?? it.cantidad_recibida} ud
                          {it.fecha_vencimiento && ` (venc. ${it.fecha_vencimiento})`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {docProveedor.proximosAVencer.length > 0 && (
                <section>
                  <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-1.5">
                    ⏰ Próximos a vencer ({docProveedor.proximosAVencer.length})
                  </p>
                  <ul className="space-y-1 text-sm text-zinc-700">
                    {docProveedor.proximosAVencer.map((it, i) => (
                      <li key={i} className="flex flex-wrap gap-x-2">
                        <span className="font-mono text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">{it.sku}</span>
                        <span>{it.nombre}</span>
                        <span className="text-zinc-500">
                          — {it.cantidad ?? it.cantidad_recibida} ud
                          {it.fecha_vencimiento && ` (vencen ${it.fecha_vencimiento})`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {docProveedor.faltantes.length > 0 && (
                <section>
                  <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1.5">
                    ❌ Faltantes ({docProveedor.faltantes.length})
                  </p>
                  <ul className="space-y-1 text-sm text-zinc-700">
                    {docProveedor.faltantes.map((it, i) => (
                      <li key={i} className="flex flex-wrap gap-x-2">
                        <span className="font-mono text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">{it.sku}</span>
                        <span>{it.nombre}</span>
                        <span className="text-zinc-500">
                          — esperado: {it.cantidad_esperada}, recibido: {it.cantidad_recibida} (faltan {it.diferencia})
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {docProveedor.sobrantes.length > 0 && (
                <section>
                  <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1.5">
                    ➕ Sobrantes ({docProveedor.sobrantes.length})
                  </p>
                  <ul className="space-y-1 text-sm text-zinc-700">
                    {docProveedor.sobrantes.map((it, i) => (
                      <li key={i} className="flex flex-wrap gap-x-2">
                        <span className="font-mono text-xs bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">{it.sku}</span>
                        <span>{it.nombre}</span>
                        <span className="text-zinc-500">
                          — esperado: {it.cantidad_esperada}, recibido: {it.cantidad_recibida} (sobran {it.diferencia})
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
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
