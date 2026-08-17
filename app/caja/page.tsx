'use client'

/**
 * Informe de caja — control del efectivo entre retiros.
 *
 * Elegís un período y muestra cuánto efectivo entró por cobros, cuánto salió
 * en pagos a proveedores que se pagan en efectivo, y el neto. Reemplaza el
 * sumar papelito por papelito cada 15 días.
 *
 * El saldo de CAJA GRANDE en Dux no es confiable, así que todo se calcula
 * desde los movimientos del período.
 */

import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { exportTablaXlsx, type ColumnaExport } from '@/lib/export-xlsx'
import { formatDate, hoyISO, toTitleCase } from '@/lib/format'
import { Loader2, Download, Wallet } from 'lucide-react'

interface Movimiento {
  fecha: string; sucursal: string; concepto: string; persona: string; monto: number
}
interface Cierre {
  fecha: string; sucursal: string; persona: string
  efectivo: number; otros: number; total: number; tickets: number
}
interface Informe {
  periodo : { desde: string; hasta: string }
  entradas: {
    total: number
    por_sucursal: Record<string, number>
    por_persona : Record<string, number>
    por_dia     : Record<string, number>
    movimientos : number
  }
  salidas: {
    total: number
    por_sucursal : Record<string, number>
    por_proveedor: Record<string, number>
    detalle      : Movimiento[]
  }
  cierres: Cierre[]
  neto: number
  no_contados: { nota: string; total: number; por_proveedor: Record<string, number> }
}

interface ProvCfg { id: string; nombre: string; paga_en_efectivo: boolean }

const $ = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

/** Primer día del mes actual, para arrancar con un período razonable. */
function inicioDeMes(): string {
  const h = hoyISO()
  return `${h.slice(0, 7)}-01`
}

export default function CajaPage() {
  const [desde, setDesde] = useState(inicioDeMes())
  const [hasta, setHasta] = useState(hoyISO())
  const [data, setData]   = useState<Informe | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [provs, setProvs] = useState<ProvCfg[]>([])
  const [verConfig, setVerConfig] = useState(false)

  const cargarProvs = useCallback(async () => {
    const { data: d } = await supabase.from('proveedores_config')
      .select('id, nombre, paga_en_efectivo').order('nombre')
    setProvs((d ?? []) as ProvCfg[])
  }, [])
  useEffect(() => { cargarProvs() }, [cargarProvs])

  async function generar() {
    setCargando(true); setError(null)
    try {
      const res = await fetch(`/api/caja?desde=${desde}&hasta=${hasta}`)
      const j = await res.json()
      if (!res.ok) { setError(j.error ?? 'No se pudo generar el informe'); setData(null) }
      else setData(j as Informe)
    } catch {
      setError('No se pudo contactar el servidor')
    } finally {
      setCargando(false)
    }
  }

  async function toggleProv(p: ProvCfg) {
    const nuevo = !p.paga_en_efectivo
    setProvs(ps => ps.map(x => x.id === p.id ? { ...x, paga_en_efectivo: nuevo } : x))
    const { error: e } = await supabase.from('proveedores_config')
      .update({ paga_en_efectivo: nuevo }).eq('id', p.id)
    if (e) { toast.error('No se pudo guardar: ' + e.message); cargarProvs(); return }
    toast.success(`${toTitleCase(p.nombre)}: ${nuevo ? 'efectivo' : 'transferencia'}`)
  }

  function exportarPagos() {
    if (!data) return
    const cols: ColumnaExport<Movimiento>[] = [
      { header: 'Fecha',     value: m => formatDate(m.fecha) },
      { header: 'Sucursal',  value: m => m.sucursal },
      { header: 'Proveedor', value: m => m.concepto },
      { header: 'Caja',      value: m => m.persona },
      { header: 'Monto',     value: m => m.monto },
    ]
    exportTablaXlsx(`caja_pagos_${desde}_a_${hasta}`, cols, data.salidas.detalle, 'Pagos en efectivo')
  }

  function exportarCierres() {
    if (!data) return
    const cols: ColumnaExport<Cierre>[] = [
      { header: 'Fecha',        value: c => formatDate(c.fecha) },
      { header: 'Sucursal',     value: c => c.sucursal },
      { header: 'Quién cobró',  value: c => toTitleCase(c.persona) },
      { header: 'Efectivo',     value: c => c.efectivo },
      { header: 'Otros medios', value: c => c.otros },
      { header: 'Total',        value: c => c.total },
      { header: 'Tickets',      value: c => c.tickets },
    ]
    exportTablaXlsx(`caja_cierres_${desde}_a_${hasta}`, cols, data.cierres, 'Cierres por turno')
  }

  const filas = (o: Record<string, number>) =>
    Object.entries(o).sort((a, b) => b[1] - a[1])

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0">
            <Wallet size={18} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Caja</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              Efectivo cobrado menos pagos en efectivo, para controlar el retiro
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setVerConfig(v => !v)}>
          {verConfig ? 'Ocultar proveedores' : 'Proveedores en efectivo'}
        </Button>
      </div>

      {/* Config de proveedores */}
      {verConfig && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-sm font-semibold text-zinc-800">¿A quién se le paga en efectivo?</p>
          <p className="text-xs text-zinc-500 mt-1 mb-3">
            Dux no guarda con qué se pagó cada compra — todos los pagos le figuran como efectivo.
            Por eso el informe se guía por esta lista. Solo los marcados descuentan de la caja.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {provs.map(p => (
              <button key={p.id} onClick={() => toggleProv(p)}
                className={`flex items-center gap-2 text-left text-xs px-2.5 py-2 rounded-lg border transition-colors ${
                  p.paga_en_efectivo
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                    : 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50'
                }`}>
                <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] shrink-0 ${
                  p.paga_en_efectivo ? 'bg-emerald-600 text-white' : 'border border-zinc-300'
                }`}>{p.paga_en_efectivo ? '✓' : ''}</span>
                <span className="truncate">{toTitleCase(p.nombre)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Período */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-200 bg-white p-4">
        <div>
          <label className="text-xs text-zinc-500">Desde</label>
          <Input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="h-9 w-40" />
        </div>
        <div>
          <label className="text-xs text-zinc-500">Hasta</label>
          <Input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="h-9 w-40" />
        </div>
        <Button onClick={generar} disabled={cargando}>
          {cargando ? <><Loader2 size={14} className="animate-spin mr-1.5" />Consultando Dux...</> : 'Generar informe'}
        </Button>
        {data && (
          <>
            <Button variant="outline" onClick={exportarCierres} className="flex items-center gap-1.5">
              <Download size={14} />Cierres
            </Button>
            <Button variant="outline" onClick={exportarPagos} className="flex items-center gap-1.5">
              <Download size={14} />Pagos
            </Button>
          </>
        )}
        <p className="text-xs text-zinc-400 self-center">Tarda unos segundos: se consulta Dux página por página.</p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50/70 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {data && (
        <>
          {/* Resultado */}
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
              <p className="text-xs font-medium text-emerald-800">Efectivo cobrado</p>
              <p className="text-2xl font-bold text-emerald-900 tabular-nums mt-1">{$(data.entradas.total)}</p>
              <p className="text-[11px] text-emerald-700 mt-0.5">{data.entradas.movimientos} cobros</p>
            </div>
            <div className="rounded-2xl border border-red-200 bg-red-50/50 p-4">
              <p className="text-xs font-medium text-red-800">Pagado en efectivo</p>
              <p className="text-2xl font-bold text-red-900 tabular-nums mt-1">{$(data.salidas.total)}</p>
              <p className="text-[11px] text-red-700 mt-0.5">{data.salidas.detalle.length} pagos</p>
            </div>
            <div className="rounded-2xl border border-zinc-300 bg-white p-4">
              <p className="text-xs font-medium text-zinc-600">Neto del período</p>
              <p className={`text-2xl font-bold tabular-nums mt-1 ${data.neto >= 0 ? 'text-zinc-900' : 'text-red-700'}`}>
                {$(data.neto)}
              </p>
              <p className="text-[11px] text-zinc-500 mt-0.5">lo que quedó en caja</p>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* Entradas */}
            <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
              <p className="text-sm font-semibold text-zinc-800 px-4 py-3 border-b border-zinc-100">
                Efectivo cobrado por turno
              </p>
              <div className="divide-y divide-zinc-100">
                {filas(data.entradas.por_persona).map(([k, v]) => (
                  <div key={k} className="flex justify-between px-4 py-2 text-sm">
                    <span className="text-zinc-700">{toTitleCase(k)}</span>
                    <span className="tabular-nums font-medium">{$(v)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Salidas por proveedor */}
            <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
              <p className="text-sm font-semibold text-zinc-800 px-4 py-3 border-b border-zinc-100">
                Pagos en efectivo por proveedor
              </p>
              <div className="divide-y divide-zinc-100">
                {filas(data.salidas.por_proveedor).length === 0 && (
                  <p className="px-4 py-3 text-sm text-zinc-400">Sin pagos en efectivo en el período</p>
                )}
                {filas(data.salidas.por_proveedor).map(([k, v]) => (
                  <div key={k} className="flex justify-between px-4 py-2 text-sm">
                    <span className="text-zinc-700">{toTitleCase(k)}</span>
                    <span className="tabular-nums font-medium">{$(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* No contados — para auditar la clasificación */}
          {data.no_contados.total > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3">
              <p className="text-sm font-semibold text-amber-900">
                No descontados: {$(data.no_contados.total)}
              </p>
              <p className="text-xs text-amber-800 mt-0.5">{data.no_contados.nota}</p>
              <p className="text-xs text-amber-800 mt-1.5">
                {filas(data.no_contados.por_proveedor)
                  .map(([k, v]) => `${toTitleCase(k)} ${$(v)}`).join(' · ')}
              </p>
            </div>
          )}

          {/* Resumen por turno */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100">
              <p className="text-sm font-semibold text-zinc-800">
                Cierres por turno <span className="font-normal text-zinc-400">({data.cierres.length})</span>
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Sumado comprobante por comprobante. Es lo <strong>vendido</strong> en efectivo — en la caja
                grande va a haber menos, porque queda fondo de cambio en la sucursal.
              </p>
            </div>
            <div className="overflow-x-auto row-hover">
              <Table>
                <TableHeader>
                  <TableRow className="bg-zinc-50 hover:bg-zinc-50">
                    <TableHead>Fecha</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead>Quién cobró</TableHead>
                    <TableHead className="text-right">Efectivo</TableHead>
                    <TableHead className="text-right">Otros medios</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Tickets</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.cierres.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell className="tabular-nums text-sm">{formatDate(c.fecha)}</TableCell>
                      <TableCell className="text-sm">{c.sucursal}</TableCell>
                      <TableCell className="text-sm">{toTitleCase(c.persona)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-emerald-800">{$(c.efectivo)}</TableCell>
                      <TableCell className="text-right tabular-nums text-zinc-500">{$(c.otros)}</TableCell>
                      <TableCell className="text-right tabular-nums">{$(c.total)}</TableCell>
                      <TableCell className="text-right tabular-nums text-zinc-500">{c.tickets}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Detalle de pagos */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto row-hover">
              <Table>
                <TableHeader>
                  <TableRow className="bg-zinc-50 hover:bg-zinc-50">
                    <TableHead>Fecha</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead>Caja</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.salidas.detalle.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell className="tabular-nums text-sm">{formatDate(m.fecha)}</TableCell>
                      <TableCell className="text-sm">{m.sucursal}</TableCell>
                      <TableCell className="text-sm">{toTitleCase(m.concepto)}</TableCell>
                      <TableCell className="text-xs text-zinc-500">{m.persona}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{$(m.monto)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
