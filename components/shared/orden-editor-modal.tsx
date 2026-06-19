'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Trash2, FileText, Download, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ProductPicker } from '@/components/shared/product-picker'
import {
  buildGruposFromRows,
  emptyHeader,
  exportOrdenCSVFromGrupos,
  exportOrdenPDFFromGrupos,
  type OrdenGrupoEditado,
  type OrdenItemEditado,
  type OrdenHeader,
} from '@/lib/export-orden'
import type { ProductoCompra, ProductoStock } from '@/lib/types'

// Catálogo extendido para el picker — incluye los campos que necesitamos al
// agregar un producto a la orden (costo, iva, granel) sin re-fetchear.
export interface ProductoCatalogo extends ProductoStock {
  costo            : number | null
  iva_porcentaje   : number | null
  es_granel        : boolean
}

// Subset de proveedores_config con los campos editables del header.
export interface ProveedorConfigHeader {
  nombre              : string
  cuit                : string | null
  direccion           : string | null
  telefono            : string | null
  localidad           : string | null
  provincia           : string | null
  iva_condicion       : string | null
  condicion_pago      : string | null
  condiciones_entrega : string | null
}

interface Props {
  open               : boolean
  rows               : ProductoCompra[]
  entregaDefault     : string | null
  proveedoresConfig  : ProveedorConfigHeader[]
  productosCatalogo  : ProductoCatalogo[]
  onClose            : () => void
}

function fmtPeso(n: number): string {
  return `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function hidratarHeader(prov: ProveedorConfigHeader | undefined): OrdenHeader {
  if (!prov) return emptyHeader()
  return {
    cuit:                prov.cuit ?? '',
    direccion:           prov.direccion ?? '',
    telefono:            prov.telefono ?? '',
    localidad:           prov.localidad ?? '',
    provincia:           prov.provincia ?? '',
    iva_condicion:       prov.iva_condicion ?? 'RESPONSABLE INSCRIPTO',
    condicion_pago:      prov.condicion_pago ?? '',
    condiciones_entrega: prov.condiciones_entrega ?? '',
    fecha_entrega:       '',
  }
}

export function OrdenEditorModal({
  open, rows, entregaDefault, proveedoresConfig, productosCatalogo, onClose,
}: Props) {
  const [grupos, setGrupos] = useState<OrdenGrupoEditado[]>([])
  const [activeTab, setActiveTab] = useState<string>('0')
  const [guardarProveedor, setGuardarProveedor] = useState(true)
  const [busy, setBusy] = useState(false)

  const provByName = useMemo(() => {
    const map = new Map<string, ProveedorConfigHeader>()
    for (const p of proveedoresConfig) map.set(p.nombre, p)
    return map
  }, [proveedoresConfig])

  // Reset cada vez que se abre con filas nuevas
  useEffect(() => {
    if (!open) return
    const base = buildGruposFromRows(rows)
    const hidratados = base.map(g => ({
      ...g,
      header: hidratarHeader(provByName.get(g.proveedor)),
    }))
    setGrupos(hidratados)
    setActiveTab('0')
  }, [open, rows, provByName])

  // Lock scroll + escape
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', handler)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', handler)
    }
  }, [open, onClose, busy])

  if (!open) return null

  function updateGrupo(idx: number, patch: Partial<OrdenGrupoEditado>) {
    setGrupos(prev => prev.map((g, i) => i === idx ? { ...g, ...patch } : g))
  }

  function updateHeader(idx: number, patch: Partial<OrdenHeader>) {
    setGrupos(prev => prev.map((g, i) =>
      i === idx ? { ...g, header: { ...g.header, ...patch } } : g
    ))
  }

  function updateItem(grupoIdx: number, itemIdx: number, patch: Partial<OrdenItemEditado>) {
    setGrupos(prev => prev.map((g, i) => {
      if (i !== grupoIdx) return g
      return { ...g, items: g.items.map((it, j) => j === itemIdx ? { ...it, ...patch } : it) }
    }))
  }

  function quitarItem(grupoIdx: number, itemIdx: number) {
    setGrupos(prev => prev.map((g, i) => {
      if (i !== grupoIdx) return g
      return { ...g, items: g.items.filter((_, j) => j !== itemIdx) }
    }))
  }

  function agregarProducto(grupoIdx: number, prod: ProductoCatalogo) {
    setGrupos(prev => prev.map((g, i) => {
      if (i !== grupoIdx) return g
      const existeIdx = g.items.findIndex(it => it.sku === prod.sku)
      if (existeIdx >= 0) {
        // Ya está — sumá 1 a la cantidad actual y dejá un highlight visual via reorder
        return {
          ...g,
          items: g.items.map((it, j) => j === existeIdx ? { ...it, cantidad: it.cantidad + 1 } : it),
        }
      }
      const nuevo: OrdenItemEditado = {
        sku: prod.sku,
        nombre: prod.nombre ?? '',
        cantidad: 1,
        costo: prod.costo ?? 0,
        iva_porcentaje: prod.iva_porcentaje ?? 0,
        es_granel: prod.es_granel,
      }
      return { ...g, items: [...g.items, nuevo] }
    }))
  }

  async function persistirHeaders(): Promise<void> {
    if (!guardarProveedor) return
    // Una orden con muchos grupos puede tener al mismo proveedor en SOHO 1 y SOHO 2:
    // los datos del header son los mismos por proveedor, así que de-dup por nombre.
    const porProveedor = new Map<string, OrdenHeader>()
    for (const g of grupos) porProveedor.set(g.proveedor, g.header)

    for (const [nombre, h] of porProveedor) {
      const prov = provByName.get(nombre)
      if (!prov) continue   // no existe en proveedores_config → no creamos uno nuevo desde acá
      await supabase
        .from('proveedores_config')
        .update({
          cuit:                h.cuit                || null,
          direccion:           h.direccion           || null,
          telefono:            h.telefono            || null,
          localidad:           h.localidad           || null,
          provincia:           h.provincia           || null,
          iva_condicion:       h.iva_condicion       || 'RESPONSABLE INSCRIPTO',
          condicion_pago:      h.condicion_pago      || null,
          condiciones_entrega: h.condiciones_entrega || null,
        })
        .eq('nombre', nombre)
    }
  }

  async function handlePDF() {
    setBusy(true)
    try {
      await persistirHeaders()
      await exportOrdenPDFFromGrupos(grupos, entregaDefault)
    } finally {
      setBusy(false)
    }
  }

  async function handleCSV() {
    setBusy(true)
    try {
      await persistirHeaders()
      exportOrdenCSVFromGrupos(grupos, entregaDefault)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => !busy && onClose()} aria-hidden />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col border border-gray-200/80 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Generar orden de compra</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Ajustá cantidades, agregá o quitá productos y completá los datos del proveedor antes de exportar.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 bg-gray-50/50">
          {grupos.length === 0 ? (
            <div className="text-center py-16 text-sm text-gray-400">
              No hay productos con sugerencia &gt; 0 en el filtro actual.
            </div>
          ) : grupos.length === 1 ? (
            <GrupoEditor
              grupo={grupos[0]}
              productosCatalogo={productosCatalogo}
              onHeaderChange={p => updateHeader(0, p)}
              onItemChange={(j, p) => updateItem(0, j, p)}
              onItemRemove={j => quitarItem(0, j)}
              onAddProduct={prod => agregarProducto(0, prod)}
            />
          ) : (
            <Tabs value={activeTab} onValueChange={v => setActiveTab(v ?? '0')}>
              <TabsList className="mb-4 flex-wrap h-auto">
                {grupos.map((g, i) => (
                  <TabsTrigger key={i} value={String(i)}>
                    {g.proveedor}{g.sucursal ? ` · ${g.sucursal}` : ''}
                    <span className="ml-1.5 text-[10px] text-gray-400">({g.items.filter(it => it.cantidad > 0).length})</span>
                  </TabsTrigger>
                ))}
              </TabsList>
              {grupos.map((g, i) => (
                <TabsContent key={i} value={String(i)}>
                  <GrupoEditor
                    grupo={g}
                    productosCatalogo={productosCatalogo}
                    onHeaderChange={p => updateHeader(i, p)}
                    onItemChange={(j, p) => updateItem(i, j, p)}
                    onItemRemove={j => quitarItem(i, j)}
                    onAddProduct={prod => agregarProducto(i, prod)}
                  />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-white">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={guardarProveedor}
              onChange={e => setGuardarProveedor(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Guardar datos del proveedor
          </label>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button variant="outline" size="sm" onClick={handleCSV} disabled={busy || grupos.length === 0} className="flex items-center gap-1.5">
              <Download size={14} /> CSV
            </Button>
            <Button size="sm" onClick={handlePDF} disabled={busy || grupos.length === 0} className="flex items-center gap-1.5">
              <FileText size={14} /> {busy ? 'Generando...' : 'Descargar PDF'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Subcomponente: editor de un grupo ─────────────────────────────────

interface GrupoEditorProps {
  grupo             : OrdenGrupoEditado
  productosCatalogo : ProductoCatalogo[]
  onHeaderChange    : (patch: Partial<OrdenHeader>) => void
  onItemChange      : (itemIdx: number, patch: Partial<OrdenItemEditado>) => void
  onItemRemove      : (itemIdx: number) => void
  onAddProduct      : (prod: ProductoCatalogo) => void
}

function GrupoEditor({
  grupo, productosCatalogo, onHeaderChange, onItemChange, onItemRemove, onAddProduct,
}: GrupoEditorProps) {
  const totals = useMemo(() => {
    let sub = 0, iva = 0
    for (const it of grupo.items) {
      if (it.cantidad <= 0) continue
      const s = it.cantidad * it.costo
      sub += s
      iva += Math.round(s * (it.iva_porcentaje / 100) * 100) / 100
    }
    return { sub, iva, total: sub + iva }
  }, [grupo.items])

  return (
    <div className="space-y-4">
      {/* Header del proveedor */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">{grupo.proveedor}</h3>
          {grupo.sucursal && <span className="text-xs text-gray-500">Entrega: {grupo.sucursal}</span>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="CUIT" value={grupo.header.cuit} onChange={v => onHeaderChange({ cuit: v })} />
          <Field label="Teléfono" value={grupo.header.telefono} onChange={v => onHeaderChange({ telefono: v })} />
          <Field label="Dirección" value={grupo.header.direccion} onChange={v => onHeaderChange({ direccion: v })} />
          <Field label="Localidad" value={grupo.header.localidad} onChange={v => onHeaderChange({ localidad: v })} />
          <Field label="Provincia" value={grupo.header.provincia} onChange={v => onHeaderChange({ provincia: v })} />
          <Field label="Condición IVA" value={grupo.header.iva_condicion} onChange={v => onHeaderChange({ iva_condicion: v })} />
          <Field label="Condición de pago" value={grupo.header.condicion_pago} onChange={v => onHeaderChange({ condicion_pago: v })} />
          <Field label="Condiciones de entrega" value={grupo.header.condiciones_entrega} onChange={v => onHeaderChange({ condiciones_entrega: v })} />
          <Field label="Fecha de entrega" value={grupo.header.fecha_entrega} onChange={v => onHeaderChange({ fecha_entrega: v })} placeholder="DD/MM/AAAA" />
        </div>
      </div>

      {/* Items */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-3">
          <span className="text-xs font-medium text-gray-700">Agregar producto:</span>
          <div className="flex-1 max-w-md">
            <ProductPicker
              productos={productosCatalogo}
              placeholder="Buscar por nombre, SKU o código de barras…"
              onSelect={(p) => {
                const full = productosCatalogo.find(x => x.id === p.id)
                if (full) onAddProduct(full)
              }}
            />
          </div>
          <Plus size={14} className="text-gray-300" />
        </div>

        {grupo.items.length === 0 ? (
          <div className="text-center py-10 text-sm text-gray-400">Sin productos en este grupo.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">SKU</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="w-28 text-right">Cantidad</TableHead>
                <TableHead className="w-20 text-center">Unidad</TableHead>
                <TableHead className="w-28 text-right">Costo unit.</TableHead>
                <TableHead className="w-28 text-right">Subtotal</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grupo.items.map((it, j) => {
                const sub = it.cantidad * it.costo
                return (
                  <TableRow key={`${it.sku}-${j}`} className={it.cantidad <= 0 ? 'opacity-50' : ''}>
                    <TableCell className="font-mono text-xs">{it.sku}</TableCell>
                    <TableCell className="text-sm">{it.nombre}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        step={it.es_granel ? 0.5 : 1}
                        value={it.cantidad}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          onItemChange(j, { cantidad: Number.isFinite(n) && n >= 0 ? n : 0 })
                        }}
                        className="h-8 text-right tabular-nums"
                      />
                    </TableCell>
                    <TableCell className="text-center text-xs text-gray-500">
                      {it.es_granel ? 'KG' : 'UNIDAD'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{fmtPeso(it.costo)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">{fmtPeso(sub)}</TableCell>
                    <TableCell>
                      <button
                        onClick={() => onItemRemove(j)}
                        className="text-gray-300 hover:text-red-500 transition-colors"
                        aria-label="Quitar"
                      >
                        <Trash2 size={14} />
                      </button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        {/* Totals */}
        {grupo.items.length > 0 && (
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 flex justify-end">
            <div className="w-72 space-y-1 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span><span className="tabular-nums">{fmtPeso(totals.sub)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>IVA</span><span className="tabular-nums">{fmtPeso(totals.iva)}</span>
              </div>
              <div className="flex justify-between text-gray-900 font-semibold pt-1 border-t border-gray-200">
                <span>Total</span><span className="tabular-nums">{fmtPeso(totals.total)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Pequeño input con label ───────────────────────────────────────────

function Field({
  label, value, onChange, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-gray-600 mb-1">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8 text-sm" />
    </label>
  )
}
