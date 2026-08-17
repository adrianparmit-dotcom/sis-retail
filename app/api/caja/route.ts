/**
 * GET /api/caja?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Informe de caja para el retiro quincenal: cuánto efectivo entró por cobros,
 * cuánto salió en pagos a proveedores que se pagan en efectivo, y el neto.
 *
 * Por qué se hace del lado del servidor: son varias páginas de la API de Dux
 * (50 por request) con su rate limit, y el token no puede salir al navegador.
 *
 * OJO con el medio de pago:
 *   - COBROS: Dux sí distingue. `cobranza[].tipo_valor` viene 'EFECTIVO' o
 *     'CUENTA' con valores reales, así que se filtra por ahí.
 *   - PAGOS: Dux NO distingue. Verificado sobre 222 pagos (may-ago 2026): el
 *     100% viene con tipo_valor='EFECTIVO', incluidas transferencias. El campo
 *     está por defecto y no sirve. Por eso se clasifica por proveedor, con la
 *     marca `paga_en_efectivo` de proveedores_config.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

const DUX_BASE  = 'https://erp.duxsoftware.com.ar/WSERP/rest/services'
const DUX_TOKEN = process.env.DUX_API_TOKEN ?? ''
const ID_EMPRESA = parseInt(process.env.DUX_ID_EMPRESA || '4065')
const PAGE = 50           // tope de la API v2
const SUCURSALES: Record<number, string> = { 1: 'SOHO 1', 3: 'SOHO 2' }

/** Clave de proveedor sin puntuación ni mayúsculas, para comparar nombres
 *  que vienen escritos distinto entre Dux y la config. */
function clave(nombre: string | null | undefined): string {
  return (nombre ?? '').toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z0-9]/g, '')
}

async function duxV2(path: string, params: Record<string, string | number>) {
  const url = new URL(`${DUX_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${DUX_TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Dux ${res.status} en ${path}`)
  return res.json()
}

/** Trae todas las páginas de un endpoint v2.
 *
 *  `sucursal` se manda a Dux para no traer de más, pero además se filtra acá:
 *  si Dux ignorara el parámetro devolvería las dos sucursales sin avisar y el
 *  informe saldría mal justo cuando el usuario lo pide separado por local. */
async function duxTodo(path: string, desde: string, hasta: string, sucursal?: number) {
  const filas: Record<string, unknown>[] = []
  let offset = 0, total = 1
  while (offset < total && offset < 2000) {
    const j = await duxV2(path, {
      id_empresa: ID_EMPRESA, fecha_desde: desde, fecha_hasta: hasta,
      ...(sucursal ? { id_sucursal: sucursal } : {}),
      limit: PAGE, offset,
    })
    total = Number(j?.paginacion?.total ?? 0)
    filas.push(...((j?.datos ?? []) as Record<string, unknown>[]))
    offset += PAGE
  }
  return sucursal ? filas.filter(f => Number(f.id_sucursal) === sucursal) : filas
}

interface Movimiento {
  fecha: string; sucursal: string; concepto: string; persona: string; monto: number
}

/** Un turno reconstruido: día + sucursal + quién cobró.
 *  Dux no expone los cierres de caja por API (probado: /v2/cajas, /cierrecaja,
 *  /v2/movimientos-caja y variantes dan 404), así que se arman sumando los
 *  comprobantes. Es lo VENDIDO en efectivo, no lo que se movió a la caja
 *  grande — parte queda como fondo de cambio en la sucursal. */
interface Cierre {
  fecha: string; sucursal: string; persona: string
  efectivo: number; otros: number; total: number; tickets: number
}

export async function GET(req: NextRequest) {
  if (!DUX_TOKEN) return NextResponse.json({ error: 'DUX_API_TOKEN no configurado' }, { status: 503 })

  const { searchParams } = new URL(req.url)
  const desde = searchParams.get('desde') ?? ''
  const hasta = searchParams.get('hasta') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return NextResponse.json({ error: 'Faltan desde/hasta en formato YYYY-MM-DD' }, { status: 400 })
  }
  if (desde > hasta) {
    return NextResponse.json({ error: 'La fecha desde es posterior a hasta' }, { status: 400 })
  }

  // Sucursal opcional: el usuario suele controlar la caja de cada local por
  // separado. Vacío o 'todas' = las dos.
  const sucParam = searchParams.get('sucursal') ?? ''
  const sucursal = /^\d+$/.test(sucParam) ? Number(sucParam) : undefined
  if (sucursal !== undefined && !SUCURSALES[sucursal]) {
    return NextResponse.json({ error: `Sucursal ${sucursal} desconocida` }, { status: 400 })
  }

  try {
    // Qué proveedores se pagan en efectivo (configurable desde /caja).
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data: provCfg } = await supabase
      .from('proveedores_config').select('nombre, paga_en_efectivo')
    const enEfectivo = new Set(
      (provCfg ?? [])
        .filter((p: { paga_en_efectivo: boolean }) => p.paga_en_efectivo)
        .map((p: { nombre: string }) => clave(p.nombre)),
    )

    const [cobros, pagos] = await Promise.all([
      duxTodo('/v2/cobros', desde, hasta, sucursal),
      duxTodo('/v2/pagos-proveedores', desde, hasta, sucursal),
    ])

    // ── Entradas: cobros en efectivo + armado de los turnos ─────────
    const entradas: Movimiento[] = []
    const porTurno = new Map<string, Cierre>()
    for (const c of cobros) {
      const lineas = (c.cobranza ?? []) as { tipo_valor?: string; monto?: number }[]
      const efectivo = lineas
        .filter(l => (l.tipo_valor ?? '').toUpperCase() === 'EFECTIVO')
        .reduce((s, l) => s + Number(l.monto ?? 0), 0)
      const suc     = SUCURSALES[Number(c.id_sucursal)] ?? `Sucursal ${c.id_sucursal}`
      const fecha   = String(c.fecha ?? '')
      const persona = String((c.personal as { nombre?: string })?.nombre ?? '—')
      const total   = Number(c.monto ?? 0)

      // El turno cuenta TODOS los cobros, no solo los de efectivo: sirve para
      // ver qué parte del día se cobró en billetes y qué parte no.
      const key = `${fecha}|${suc}|${persona}`
      const t = porTurno.get(key) ?? { fecha, sucursal: suc, persona, efectivo: 0, otros: 0, total: 0, tickets: 0 }
      t.efectivo += efectivo
      t.otros    += Math.max(0, total - efectivo)
      t.total    += total
      t.tickets  += 1
      porTurno.set(key, t)

      if (efectivo <= 0) continue
      entradas.push({
        fecha, sucursal: suc,
        concepto: String((c.cliente as { apellido_razon_social?: string })?.apellido_razon_social ?? 'Consumidor final'),
        persona, monto: efectivo,
      })
    }
    const cierres = [...porTurno.values()]
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.sucursal.localeCompare(b.sucursal))
      .map(c => ({
        ...c,
        efectivo: Math.round(c.efectivo),
        otros   : Math.round(c.otros),
        total   : Math.round(c.total),
      }))

    // ── Salidas: pagos a proveedores marcados como efectivo ─────────
    const salidas: Movimiento[] = []
    const excluidos: { proveedor: string; monto: number }[] = []
    for (const p of pagos) {
      const prov = String((p.proveedor as { razon_social?: string })?.razon_social ?? '—')
      const monto = Number(p.monto ?? 0)
      if (monto <= 0) continue
      if (!enEfectivo.has(clave(prov))) { excluidos.push({ proveedor: prov, monto }); continue }
      const suc = SUCURSALES[Number(p.id_sucursal)] ?? `Sucursal ${p.id_sucursal}`
      salidas.push({
        fecha   : String(p.fecha ?? ''),
        sucursal: suc,
        concepto: prov,
        persona : String((p.caja as { descripcion?: string })?.descripcion ?? '—'),
        monto,
      })
    }

    const sumar = (ms: Movimiento[], f: (m: Movimiento) => string) => {
      const out: Record<string, number> = {}
      for (const m of ms) out[f(m)] = (out[f(m)] ?? 0) + m.monto
      return out
    }
    const totalEntra = entradas.reduce((s, m) => s + m.monto, 0)
    const totalSale  = salidas.reduce((s, m) => s + m.monto, 0)

    // Los excluidos se informan para poder auditar la clasificación: si algo
    // se pagó en efectivo y quedó afuera, se ve acá.
    const excluidosPorProv: Record<string, number> = {}
    for (const e of excluidos) excluidosPorProv[e.proveedor] = (excluidosPorProv[e.proveedor] ?? 0) + e.monto

    return NextResponse.json({
      periodo: { desde, hasta, sucursal: sucursal ? SUCURSALES[sucursal] : 'Todas' },
      entradas: {
        total          : Math.round(totalEntra),
        por_sucursal   : sumar(entradas, m => m.sucursal),
        por_persona    : sumar(entradas, m => `${m.sucursal} · ${m.persona}`),
        por_dia        : sumar(entradas, m => m.fecha),
        movimientos    : entradas.length,
      },
      salidas: {
        total          : Math.round(totalSale),
        por_sucursal   : sumar(salidas, m => m.sucursal),
        por_proveedor  : sumar(salidas, m => m.concepto),
        detalle        : salidas.sort((a, b) => b.fecha.localeCompare(a.fecha)),
      },
      cierres,
      neto: Math.round(totalEntra - totalSale),
      no_contados: {
        nota  : 'Pagos a proveedores marcados como transferencia. No descuentan de la caja.',
        total : Math.round(excluidos.reduce((s, e) => s + e.monto, 0)),
        por_proveedor: excluidosPorProv,
      },
    })
  } catch (err) {
    console.error('[caja] error:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
