'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Printer, Search, X, TrendingUp, Eye, RefreshCw, Tag, Download, CheckSquare, Square } from 'lucide-react'
import { exportTablaXlsx, type ColumnaExport } from '@/lib/export-xlsx'

// ─── Types ───────────────────────────────────────────────────────────
interface Producto {
  id: string
  sku: string
  nombre: string
  precio_venta: number | null
  categoria: string | null
  marca: string | null
  unidad_medida: string | null
  dux_sync_at: string | null
  stock_soho1: number
  stock_soho2: number
}

interface PriceChange {
  id: number
  sku: string
  nombre: string
  precio_anterior: number
  precio_nuevo: number
  variacion_pct: number
  detectado_at: string
  visto: boolean
}

type Sucursal = 'soho1' | 'soho2'
type Tab = 'etiquetas' | 'aumentos'

// ─── Utils ───────────────────────────────────────────────────────────
const MINOR_WORDS = new Set(['de','del','la','las','el','los','con','sin','por','y','e','a','en','al','x','o','u'])

function toTitleCase(str: string): string {
  return str.toLowerCase().split(' ').map((w, i) =>
    w.length === 0 ? w : (!MINOR_WORDS.has(w) || i === 0)
      ? w.charAt(0).toUpperCase() + w.slice(1)
      : w
  ).join(' ')
}

// Splits "ACEITE DE COCO NEUTRO 200ML ENTRENUTS" →
//   titulo: "Aceite de Coco Neutro"
//   variante: "x 200 ml · Entrenuts"
function parseLabel(nombre: string): { titulo: string; variante: string } {
  // Match optional X prefix + number + unit
  const re = /\b(?:X\s*)?(\d+(?:[.,]\d+)?)\s*(ML|GR?|KG|L|LT|CC|MG|UN|UDS|UNIDADES?|CAPS?|COMP?)\b/i
  const match = re.exec(nombre)

  if (match && match.index > 2) {
    const rawTitulo = nombre.slice(0, match.index).trim().replace(/[-–]\s*$/, '').trim()
    const rawRest   = nombre.slice(match.index + match[0].length).trim().replace(/^[-–\s]+/, '').trim()
    const qty       = `${match[1].replace(',', '.')} ${match[2].toLowerCase()}`
    const brand     = rawRest ? toTitleCase(rawRest) : ''
    return {
      titulo:   toTitleCase(rawTitulo),
      variante: brand ? `x ${qty} · ${brand}` : `x ${qty}`,
    }
  }
  return { titulo: toTitleCase(nombre), variante: '' }
}

const BADGE_RULES: Array<{ pattern: RegExp; label: string; color: string }> = [
  { pattern: /SIN\s*TACC/i,               label: 'SIN TACC',  color: 'bg-amber-100 text-amber-800 border-amber-200' },
  { pattern: /ORGAN[IÍ]C/i,               label: 'ORG',       color: 'bg-green-100 text-green-800 border-green-200' },
  { pattern: /\bVEGAN[OA]?\b/i,           label: 'VEGANO',    color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  { pattern: /\bKETO\b/i,                 label: 'KETO',      color: 'bg-purple-100 text-purple-800 border-purple-200' },
  { pattern: /\bAPTO\s*CELI[AÁ]C/i,       label: 'CELÍACO',   color: 'bg-amber-100 text-amber-800 border-amber-200' },
]

function detectBadges(nombre: string) {
  return BADGE_RULES.filter(r => r.pattern.test(nombre))
}

const fmt$ = (n: number | null) =>
  n == null ? '—' : `$${n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

// ─── Page ────────────────────────────────────────────────────────────
export default function PreciosPage() {
  const [productos, setProductos]     = useState<Producto[]>([])
  const [cambios, setCambios]         = useState<PriceChange[]>([])
  const [loading, setLoading]         = useState(true)
  const [busqueda, setBusqueda]       = useState('')
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [tab, setTab]                 = useState<Tab>('etiquetas')
  const [sucursal, setSucursal]       = useState<Sucursal>('soho1')
  const [markingVisto, setMarkingVisto] = useState(false)
  const [imprimiendo, setImprimiendo] = useState(false)
  const [vista, setVista]             = useState<'tarjetas' | 'lista'>('tarjetas')

  const fetchProductos = useCallback(async (suc: Sucursal) => {
    setLoading(true)
    setSeleccionados(new Set())
    const { data } = await supabase.rpc('productos_con_stock_sucursal', { p_sucursal: suc })
    setProductos((data ?? []) as Producto[])
    setLoading(false)
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [{ data: rawProds }, { data: pchanges }] = await Promise.all([
      supabase.rpc('productos_con_stock_sucursal', { p_sucursal: sucursal }),
      supabase.from('price_changes')
        .select('id,sku,nombre,precio_anterior,precio_nuevo,variacion_pct,detectado_at,visto')
        .order('detectado_at', { ascending: false }).limit(200),
    ])
    setProductos((rawProds ?? []) as Producto[])
    setCambios((pchanges ?? []) as PriceChange[])
    setLoading(false)
  }, [sucursal])

  // Fetch + populate when fetchData changes (mount + sucursal change).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData() }, [fetchData])

  const productosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return productos
    const q = busqueda.toLowerCase()
    return productos.filter(p =>
      p.nombre.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.categoria ?? '').toLowerCase().includes(q)
    )
  }, [productos, busqueda])

  const paraImprimir = useMemo(() =>
    seleccionados.size > 0
      ? productos.filter(p => seleccionados.has(p.id))
      : productosFiltrados,
    [seleccionados, productos, productosFiltrados]
  )

  const toggleSeleccion = (id: string) => {
    setSeleccionados(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const sinVer  = cambios.filter(c => !c.visto).length
  const hojas   = Math.ceil(paraImprimir.length / 36)

  const handlePrint = () => {
    setImprimiendo(true)
    setTimeout(() => {
      window.print()
      setTimeout(() => setImprimiendo(false), 600)
    }, 200)
  }

  const marcarTodosVistos = async () => {
    setMarkingVisto(true)
    await supabase.rpc('marcar_precios_vistos')
    setCambios(prev => prev.map(c => ({ ...c, visto: true })))
    setMarkingVisto(false)
  }

  const exportarAumentosExcel = () => {
    const cols: ColumnaExport<PriceChange>[] = [
      { header: 'SKU',             value: c => c.sku },
      { header: 'Nombre',          value: c => c.nombre },
      { header: 'Precio anterior', value: c => c.precio_anterior },
      { header: 'Precio nuevo',    value: c => c.precio_nuevo },
      { header: 'Variación %',     value: c => c.variacion_pct != null ? Number(c.variacion_pct.toFixed(2)) : '' },
      { header: 'Detectado',       value: c => new Date(c.detectado_at).toLocaleString('es-AR') },
    ]
    exportTablaXlsx('aumentos-precios', cols, cambios, 'Aumentos')
  }

  return (
    <>
      {/* ── PRINT CSS ────────────────────────────────────────────── */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #print-area, #print-area * { visibility: visible !important; }
          #print-area {
            display: block !important;
            position: absolute !important;
            top: 0 !important; left: 0 !important;
            margin: 0 !important; padding: 0 !important;
          }
          @page { size: A4 portrait; margin: 4mm; }
        }
        @media screen { #print-area { display: none; } }
      `}</style>

      {/* ── SCREEN UI ─────────────────────────────────────────────── */}
      <div className="p-6 max-w-7xl mx-auto no-print">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Precios &amp; Etiquetas</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              Etiqueta 5 × 3 cm · 36 por hoja A4 · Sin productos a granel
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </Button>
            {sinVer > 0 && (
              <Badge className="bg-orange-500 text-white px-3 py-1.5 text-sm gap-1.5">
                <TrendingUp size={13} />
                {sinVer} aumento{sinVer > 1 ? 's' : ''} sin ver
              </Badge>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 border-b border-zinc-200">
          {([
            { key: 'etiquetas', label: 'Etiquetas', icon: <Tag size={14} /> },
            { key: 'aumentos',  label: `Aumentos${sinVer > 0 ? ` (${sinVer})` : ''}`, icon: <TrendingUp size={14} /> },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t.key ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700'
              }`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* ── TAB ETIQUETAS ─────────────────────────────────────── */}
        {tab === 'etiquetas' && (
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
              {/* Sucursal */}
              <div className="flex rounded-lg border border-zinc-200 overflow-hidden shrink-0">
                {([['soho1','SOHO 1'],['soho2','SOHO 2']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => { setSucursal(k); setBusqueda(''); fetchProductos(k) }}
                    className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                      sucursal === k ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-50'
                    }`}>{l}</button>
                ))}
              </div>

              {/* Search */}
              <div className="relative flex-1 min-w-52">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <Input className="pl-8 h-9" placeholder="Buscar nombre, SKU, categoría…"
                  value={busqueda} onChange={e => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button onClick={() => setBusqueda('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700">
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Vista toggle */}
              <div className="flex rounded-lg border border-zinc-200 overflow-hidden shrink-0">
                {([['tarjetas','Tarjetas'],['lista','Lista']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setVista(k)}
                    className={`px-3 py-1.5 text-sm transition-colors ${
                      vista === k ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 hover:bg-zinc-50'
                    }`}>{l}</button>
                ))}
              </div>

              {/* Selection badge */}
              {seleccionados.size > 0 && (
                <Badge variant="outline" className="gap-1.5 px-3 py-1.5 shrink-0">
                  <CheckSquare size={13} />
                  {seleccionados.size} seleccionado{seleccionados.size > 1 ? 's' : ''}
                  <button onClick={() => setSeleccionados(new Set())} className="ml-1 hover:text-red-500"><X size={12} /></button>
                </Badge>
              )}

              {/* Print button */}
              <Button onClick={handlePrint} disabled={paraImprimir.length === 0 || imprimiendo} className="gap-1.5 h-9 shrink-0">
                <Printer size={14} />
                {imprimiendo ? 'Preparando…'
                  : seleccionados.size > 0 ? `Reimprimir ${seleccionados.size}`
                  : `Imprimir ${productosFiltrados.length} (${hojas} hoja${hojas > 1 ? 's' : ''})`}
              </Button>
            </div>

            <p className="text-xs text-zinc-400 mb-4">
              {productosFiltrados.length} productos · Clic para seleccionar y reimprimir individualmente
            </p>

            {/* ── VISTA TARJETAS ── */}
            {vista === 'tarjetas' && (
              <div className="flex flex-wrap gap-3">
                {productosFiltrados.map(p => (
                  <LabelCard
                    key={p.id}
                    producto={p}
                    seleccionado={seleccionados.has(p.id)}
                    onClick={() => toggleSeleccion(p.id)}
                  />
                ))}
                {productosFiltrados.length === 0 && !loading && (
                  <p className="text-sm text-zinc-400 py-8">Sin productos con stock en {sucursal === 'soho1' ? 'SOHO 1' : 'SOHO 2'}.</p>
                )}
              </div>
            )}

            {/* ── VISTA LISTA ── */}
            {vista === 'lista' && (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-auto max-h-[560px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead>Nombre</TableHead>
                          <TableHead>Categoría</TableHead>
                          <TableHead className="text-right">Stock {sucursal === 'soho1' ? 'S1' : 'S2'}</TableHead>
                          <TableHead className="text-right font-semibold">Precio</TableHead>
                          <TableHead className="text-right">Sync</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {productosFiltrados.map(p => (
                          <TableRow key={p.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => toggleSeleccion(p.id)}>
                            <TableCell>
                              {seleccionados.has(p.id)
                                ? <CheckSquare size={15} className="text-blue-600" />
                                : <Square size={15} className="text-zinc-300" />}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-zinc-400">{p.sku}</TableCell>
                            <TableCell className="text-sm font-medium max-w-72 truncate">{toTitleCase(p.nombre)}</TableCell>
                            <TableCell className="text-xs text-zinc-500">{p.categoria ?? '—'}</TableCell>
                            <TableCell className="text-right text-sm">{sucursal === 'soho1' ? p.stock_soho1 : p.stock_soho2}</TableCell>
                            <TableCell className="text-right font-bold text-sm text-blue-900">{fmt$(p.precio_venta)}</TableCell>
                            <TableCell className="text-right text-xs text-zinc-400">
                              {p.dux_sync_at ? new Date(p.dux_sync_at).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ── TAB AUMENTOS ──────────────────────────────────────── */}
        {tab === 'aumentos' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-zinc-500">{cambios.length} cambios detectados por el sync de Dux</p>
              <div className="flex gap-2">
                {cambios.length > 0 && (
                  <Button variant="outline" size="sm" onClick={exportarAumentosExcel} className="gap-1.5">
                    <Download size={14} /> Exportar Excel
                  </Button>
                )}
                {sinVer > 0 && (
                  <Button variant="outline" size="sm" onClick={marcarTodosVistos} disabled={markingVisto} className="gap-1.5">
                    <Eye size={14} /> Marcar vistos
                  </Button>
                )}
              </div>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-4"></TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead className="text-right">Anterior</TableHead>
                      <TableHead className="text-right">Nuevo</TableHead>
                      <TableHead className="text-right">Variación</TableHead>
                      <TableHead className="text-right">Detectado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cambios.map(c => (
                      <TableRow key={c.id} className={c.visto ? 'opacity-50' : ''}>
                        <TableCell>
                          {!c.visto && <div className="w-2 h-2 rounded-full bg-orange-400" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-zinc-400">{c.sku}</TableCell>
                        <TableCell className="text-sm font-medium max-w-60 truncate">{toTitleCase(c.nombre)}</TableCell>
                        <TableCell className="text-right text-sm text-zinc-500">{fmt$(c.precio_anterior)}</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{fmt$(c.precio_nuevo)}</TableCell>
                        <TableCell className="text-right">
                          <Badge className={
                            c.variacion_pct >= 20 ? 'bg-red-100 text-red-700 border-red-200' :
                            c.variacion_pct >= 10 ? 'bg-orange-100 text-orange-700 border-orange-200' :
                            'bg-yellow-100 text-yellow-700 border-yellow-200'
                          }>+{c.variacion_pct?.toFixed(1)}%</Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-zinc-400">
                          {new Date(c.detectado_at).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
                        </TableCell>
                      </TableRow>
                    ))}
                    {cambios.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-10 text-zinc-400 text-sm">
                          Sin aumentos detectados aún.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* ── PRINT AREA ────────────────────────────────────────────── */}
      <div id="print-area">
        {imprimiendo && <PrintSheet productos={paraImprimir} />}
      </div>
    </>
  )
}

// ─── Premium label card (screen) ─────────────────────────────────────
function LabelCard({ producto, seleccionado, onClick }: {
  producto: Producto
  seleccionado: boolean
  onClick: () => void
}) {
  const { titulo, variante } = parseLabel(producto.nombre)
  const badges = detectBadges(producto.nombre)

  return (
    <div
      onClick={onClick}
      className="relative cursor-pointer select-none transition-all duration-150"
      style={{
        width: 253,
        height: 152,
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 16px 10px 16px',
        borderRadius: 12,
        background: seleccionado ? '#EFF6FF' : '#FFFFFF',
        border: seleccionado ? '1.5px solid #3B82F6' : '1px solid #E5E7EB',
        boxShadow: seleccionado
          ? '0 0 0 3px rgba(59,130,246,0.15), 0 4px 12px rgba(0,0,0,0.08)'
          : '0 1px 3px rgba(0,0,0,0.06)',
      }}
      onMouseEnter={e => {
        if (!seleccionado) {
          (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.11)'
          ;(e.currentTarget as HTMLDivElement).style.borderColor = '#D1D5DB'
        }
      }}
      onMouseLeave={e => {
        if (!seleccionado) {
          (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)'
          ;(e.currentTarget as HTMLDivElement).style.borderColor = '#E5E7EB'
        }
      }}
    >
      {/* Badges top-right */}
      {badges.length > 0 && (
        <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
          {badges.map(b => (
            <span key={b.label}
              className={`text-[8px] font-bold px-2 py-0.5 rounded-full border leading-tight ${b.color}`}>
              {b.label}
            </span>
          ))}
        </div>
      )}

      {/* Name + variant */}
      <div style={{ paddingRight: badges.length > 0 ? 52 : 0 }}>
        <p style={{
          fontSize: 15,
          fontWeight: 700,
          color: '#111111',
          lineHeight: 1.25,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          margin: 0,
        }}>
          {titulo}
        </p>
        {variante && (
          <p style={{
            fontSize: 13,
            fontWeight: 400,
            color: '#666666',
            marginTop: 5,
            lineHeight: 1.3,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}>
            {variante}
          </p>
        )}
      </div>

      {/* Price — hero element */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 6,
        paddingBottom: 6,
      }}>
        <span style={{
          fontSize: 34,
          fontWeight: 800,
          color: '#000000',
          letterSpacing: '-1.5px',
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {fmt$(producto.precio_venta)}
        </span>
      </div>

      {/* SKU — bottom left, very discreet */}
      <p style={{ fontSize: 8.5, color: '#9CA3AF', lineHeight: 1, margin: 0 }}>
        Cod. {producto.sku}
      </p>
    </div>
  )
}

// ─── Print sheet ─────────────────────────────────────────────────────
function PrintSheet({ productos }: { productos: Producto[] }) {
  if (productos.length === 0) return null
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 50mm)',
      gridAutoRows: '30mm',
      gap: '0',
      width: '200mm',
      background: 'white',
    }}>
      {productos.map(p => <PrintLabel key={p.id} producto={p} />)}
    </div>
  )
}

function PrintLabel({ producto }: { producto: Producto }) {
  const { titulo, variante } = parseLabel(producto.nombre)
  const badges = detectBadges(producto.nombre)

  return (
    <div style={{
      width: '50mm', height: '30mm',
      boxSizing: 'border-box',
      border: '0.4pt solid #E5E7EB',
      display: 'flex',
      flexDirection: 'column',
      padding: '2mm 2.5mm 1.5mm 2.5mm',
      overflow: 'hidden',
      pageBreakInside: 'avoid',
      background: 'white',
      fontFamily: 'Arial, Helvetica, sans-serif',
      position: 'relative',
    }}>
      {/* Badges */}
      {badges.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5mm', marginBottom: '0.4mm', flexWrap: 'wrap' }}>
          {badges.slice(0, 2).map(b => (
            <span key={b.label} style={{
              fontSize: '4.5pt', fontWeight: 700, padding: '0.2mm 1mm',
              borderRadius: '2pt', border: '0.3pt solid',
              background: '#FEF3C7', color: '#92400E', borderColor: '#FDE68A',
              lineHeight: 1.3,
            }}>{b.label}</span>
          ))}
        </div>
      )}

      {/* Name */}
      <div style={{
        fontSize: '10pt', fontWeight: 700, lineHeight: 1.2,
        color: '#111111',
        overflow: 'hidden',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
      }}>{titulo}</div>

      {/* Variant */}
      {variante && (
        <div style={{
          fontSize: '6pt', color: '#666666', lineHeight: 1.2,
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          marginTop: '0.5mm',
        }}>{variante}</div>
      )}

      {/* Price — hero, centered */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{
          fontSize: '18pt', fontWeight: 800, color: '#000000',
          lineHeight: 1, letterSpacing: '-0.5pt',
        }}>{fmt$(producto.precio_venta)}</span>
      </div>

      {/* SKU bottom-left */}
      <div style={{
        fontSize: '4pt', color: '#9CA3AF', lineHeight: 1,
        position: 'absolute', bottom: '1.2mm', left: '2.5mm',
      }}>Cod. {producto.sku}</div>
    </div>
  )
}
