'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import {
  CheckCircle2, Circle, ExternalLink, CheckCheck,
  RotateCcw, AlertCircle, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Sucursales ────────────────────────────────────────────────────────────
const SUCURSALES = [
  { id: 'a0000000-0000-0000-0000-000000000001', label: 'SOHO 1', short: 'S1' },
  { id: 'a0000000-0000-0000-0000-000000000003', label: 'SOHO 2', short: 'S2' },
]
const STORAGE_KEY = 'tareas_sucursal_id'

// ── Day helpers ───────────────────────────────────────────────────────────
// 0=Lun … 6=Dom
function getDia(): number {
  const d = new Date().getDay()
  return d === 0 ? 6 : d - 1
}
function todayISO() { return new Date().toISOString().slice(0, 10) }
function fechaLabel() {
  const dias = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const now = new Date()
  return `${dias[getDia()]} ${now.getDate()} de ${meses[now.getMonth()]}`
}

// ── Task definitions ──────────────────────────────────────────────────────
interface TareaDef {
  id: string
  texto: string
  detalle?: string
  href: string
  dias?: number[]   // only show on these days (0=Lun…6=Dom). undefined = every day
}

const STAFF: TareaDef[] = [
  {
    id: 'reconciliacion',
    texto: 'Revisar reconciliación y cargar vencimientos pendientes',
    detalle: 'Entrá a Reconciliación y fijate qué productos tienen diferencia entre stock Dux y vencimientos cargados.',
    href: '/reconciliacion',
  },
  {
    id: 'reposicion',
    texto: 'Revisar reposición y trasladar lo que corresponda',
    detalle: 'Mirá el panel de reposición: si hay productos bajos en la góndola y stock en la pieza o depósito, trasladar.',
    href: '/reposicion',
  },
  {
    id: 'vencimientos',
    texto: 'Revisar vencimientos críticos y aplicar promos si hace falta',
    detalle: 'Si hay productos a punto de vencer (rojo o naranja), activar promo desde el módulo de promociones.',
    href: '/vencimientos',
  },
  {
    id: 'precios',
    texto: 'Verificar precios en góndola vs sistema',
    detalle: 'Chequear si hay etiquetas desactualizadas en góndola respecto al precio de Dux.',
    href: '/precios',
  },
  {
    id: 'cajones',
    texto: 'Completar cantidades de cajones pendientes',
    detalle: 'Entrar a Cajones y completar la cantidad real de los que todavía tienen "—" (sin contar).',
    href: '/ubicaciones',
  },
  {
    id: 'traslado-s1',
    texto: 'Preparar traslado La Pieza → SOHO 1 Local',
    detalle: 'Miércoles y jueves: armar la lista de lo que hay que llevar desde La Pieza al local.',
    href: '/reposicion',
    dias: [2, 3],
  },
  {
    id: 'traslado-s2',
    texto: 'Preparar traslado Depósito → SOHO 2 Local',
    detalle: 'Miércoles y jueves: armar la lista de lo que hay que llevar desde el Depósito al local SOHO 2.',
    href: '/reposicion',
    dias: [2, 3],
  },
]

const GESTION: TareaDef[] = [
  {
    id: 'compras',
    texto: 'Revisar dashboard de compras y confirmar pedidos del día',
    detalle: 'Ver qué productos hay que pedir y a qué proveedor. Confirmar pedidos con cobertura crítica.',
    href: '/compras',
  },
  {
    id: 'sin-proveedor',
    texto: 'Resolver productos sin proveedor configurado',
    detalle: 'Productos que entran en el sistema pero no tienen proveedor asignado → no aparecen en pedidos.',
    href: '/compras/sin-proveedor',
  },
  {
    id: 'promociones',
    texto: 'Aprobar o descartar promociones propuestas por el sistema',
    detalle: 'El sistema sugiere promos automáticas basadas en vencimientos y stock. Revisar y aprobar.',
    href: '/promociones',
  },
  {
    id: 'fraccionamiento',
    texto: 'Revisar órdenes de fraccionamiento por prioridad de cobertura',
    detalle: 'Ver qué hay que fraccionar primero en base a lo que tiene menos cobertura de stock.',
    href: '/fraccionamiento',
  },
]

// ── Sistema card config ───────────────────────────────────────────────────
interface SistemaCard {
  id: string
  label: string
  href: string
  count: number | null    // null = loading / error
  urgente: number         // >= this = red
  alerta: number          // > 0 and < urgente = amber
  formatear: (n: number) => string
  okText: string
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function TareasPage() {
  const dia      = getDia()
  const fecha    = todayISO()

  // ── Sucursal selection (persisted in localStorage) ──
  const [sucursalId,     setSucursalId]     = useState<string | null>(null)
  const [showSucSelect,  setShowSucSelect]  = useState(false)

  // Restore sucursal from localStorage on mount.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && SUCURSALES.find(s => s.id === saved)) {
      setSucursalId(saved) // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [])

  function selectSucursal(id: string) {
    setSucursalId(id)
    localStorage.setItem(STORAGE_KEY, id)
    setShowSucSelect(false)
    // Reload checks for the new sucursal
    setLoadingChecks(true)
    setDone(new Set())
  }

  const sucursal = SUCURSALES.find(s => s.id === sucursalId)

  // ── Task state ──
  const [done,          setDone]          = useState<Set<string>>(new Set())
  const [loadingChecks, setLoadingChecks] = useState(true)
  const [toggling,      setToggling]      = useState<string | null>(null)
  const [expanded,      setExpanded]      = useState<string | null>(null)

  const [counts,        setCounts]        = useState<Record<string, number | null>>({})
  const [loadingSist,   setLoadingSist]   = useState(true)
  const [refreshKey,    setRefreshKey]    = useState(0)

  // Tasks for today
  const staffHoy = useMemo(
    () => STAFF.filter(t => !t.dias || t.dias.includes(dia)),
    [dia],
  )
  const todasHoy = useMemo(() => [...staffHoy, ...GESTION], [staffHoy])
  const completadas = done.size
  const total       = todasHoy.length
  const pct         = total === 0 ? 0 : Math.round((completadas / total) * 100)

  // ── Load today's checks (scoped by sucursal) ──
  useEffect(() => {
    if (!sucursalId) { setLoadingChecks(false); return }
    setLoadingChecks(true)
    supabase
      .from('tarea_checks')
      .select('tarea_id')
      .eq('fecha', fecha)
      .eq('sucursal_id', sucursalId)
      .then(({ data }) => {
        if (data) setDone(new Set(data.map(r => r.tarea_id)))
        setLoadingChecks(false)
      })
  }, [fecha, sucursalId])

  // ── Load sistema counts (sets loading + counts when deps change) ──
  useEffect(() => {
    setLoadingSist(true) // eslint-disable-line react-hooks/set-state-in-effect
    Promise.allSettled([
      supabase.from('v_reconciliacion').select('*', { count: 'exact', head: true }).not('estado', 'eq', 'ok'),
      supabase.from('v_reposicion_dashboard').select('*', { count: 'exact', head: true }).lte('soho1_local', 2),
      supabase.from('v_vencimientos_fefo').select('*', { count: 'exact', head: true }).in('estado', ['critico', 'alerta']),
      supabase.from('v_proveedores_sin_config').select('*', { count: 'exact', head: true }),
      supabase.from('cajon_productos').select('*', { count: 'exact', head: true }).eq('cantidad', 0),
      supabase.from('v_compras_inteligentes').select('*', { count: 'exact', head: true }).lt('dias_cobertura', 7).gt('ventas_30d', 0),
      supabase.from('promociones').select('*', { count: 'exact', head: true }).eq('estado', 'propuesta'),
    ]).then(results => {
      const keys = ['reconciliacion','reposicion','vencimientos','sin_proveedor','cajones','compras_urgentes','promociones']
      const data: Record<string, number | null> = {}
      results.forEach((r, i) => {
        data[keys[i]] = r.status === 'fulfilled' ? (r.value.count ?? 0) : null
      })
      setCounts(data)
      setLoadingSist(false)
    })
  }, [refreshKey])

  // ── Toggle task ──
  const toggle = useCallback(async (tareaId: string) => {
    if (toggling || !sucursalId) return
    setToggling(tareaId)
    const isDone = done.has(tareaId)
    setDone(prev => {
      const next = new Set(prev)
      if (isDone) next.delete(tareaId)
      else next.add(tareaId)
      return next
    })
    if (isDone) {
      await supabase.from('tarea_checks').delete()
        .eq('fecha', fecha)
        .eq('tarea_id', tareaId)
        .eq('sucursal_id', sucursalId)
    } else {
      await supabase.from('tarea_checks').upsert(
        { fecha, tarea_id: tareaId, sucursal_id: sucursalId },
        { onConflict: 'fecha,tarea_id,sucursal_id' },
      )
    }
    setToggling(null)
  }, [done, fecha, sucursalId, toggling])

  // ── Sistema cards ──
  const sistemaCards: SistemaCard[] = [
    {
      id: 'vencimientos', label: 'Vencimientos críticos', href: '/vencimientos',
      count: counts.vencimientos ?? null, urgente: 1, alerta: 0,
      formatear: n => `${n} crítico${n !== 1 ? 's' : ''}`, okText: 'Sin críticos',
    },
    {
      id: 'reposicion', label: 'Reposición góndola', href: '/reposicion',
      count: counts.reposicion ?? null, urgente: 10, alerta: 0,
      formatear: n => `${n} a reponer`, okText: 'Góndola OK',
    },
    {
      id: 'reconciliacion', label: 'Reconciliación', href: '/reconciliacion',
      count: counts.reconciliacion ?? null, urgente: 30, alerta: 0,
      formatear: n => `${n} sin cargar`, okText: 'Al día',
    },
    {
      id: 'cajones', label: 'Cajones sin contar', href: '/ubicaciones',
      count: counts.cajones ?? null, urgente: 50, alerta: 0,
      formatear: n => `${n} pendientes`, okText: 'Todo contado',
    },
    {
      id: 'compras_urgentes', label: 'Compras urgentes', href: '/compras',
      count: counts.compras_urgentes ?? null, urgente: 1, alerta: 0,
      formatear: n => `${n} SKU${n !== 1 ? 's' : ''} crítico${n !== 1 ? 's' : ''}`, okText: 'Sin urgencias',
    },
    {
      id: 'sin_proveedor', label: 'Sin proveedor', href: '/compras/sin-proveedor',
      count: counts.sin_proveedor ?? null, urgente: 1, alerta: 0,
      formatear: n => `${n} sin config`, okText: 'Todo OK',
    },
  ]

  const todoOk = !loadingSist && sistemaCards.every(c => c.count === 0)

  // ── Sucursal picker (shown when not yet selected) ──
  if (!sucursalId) {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-xl font-semibold text-zinc-900 mb-1">Tareas del día</h1>
        <p className="text-sm text-zinc-400 mb-8">{fechaLabel()}</p>
        <div className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
          <p className="text-sm font-medium text-zinc-700">¿Desde qué local estás operando?</p>
          <div className="grid grid-cols-2 gap-3">
            {SUCURSALES.map(s => (
              <button
                key={s.id}
                onClick={() => selectSucursal(s.id)}
                className="border-2 border-zinc-200 hover:border-indigo-400 hover:bg-indigo-50 rounded-xl p-5 text-center transition-all"
              >
                <p className="text-2xl font-bold text-indigo-600">{s.short}</p>
                <p className="text-sm text-zinc-600 mt-1">{s.label}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-7 max-w-2xl">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Tareas del día</h1>
          <p className="text-sm text-zinc-400 mt-0.5">{fechaLabel()}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Sucursal switcher */}
          <div className="relative">
            <button
              onClick={() => setShowSucSelect(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-100 transition-colors"
            >
              {sucursal?.label}
              <ChevronDown size={12} />
            </button>
            {showSucSelect && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-zinc-200 rounded-lg shadow-md overflow-hidden z-10 min-w-[120px]">
                {SUCURSALES.map(s => (
                  <button
                    key={s.id}
                    onClick={() => selectSucursal(s.id)}
                    className={cn(
                      'w-full text-left px-4 py-2.5 text-sm hover:bg-zinc-50 transition-colors',
                      s.id === sucursalId ? 'text-indigo-600 font-semibold bg-indigo-50' : 'text-zinc-700',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Progress count */}
          {!loadingChecks && (
            <div className="text-right">
              <p className={cn('text-2xl font-bold', pct === 100 ? 'text-emerald-600' : 'text-zinc-900')}>
                {completadas}/{total}
              </p>
              <p className="text-xs text-zinc-400">completadas</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Progress ── */}
      <div className="space-y-2">
        <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-500', pct === 100 ? 'bg-emerald-500' : 'bg-indigo-500')}
            style={{ width: `${pct}%` }}
          />
        </div>
        {pct === 100 && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
            <CheckCheck size={15} className="text-emerald-600" />
            <p className="text-sm font-medium text-emerald-700">Todo completado por hoy — bien hecho</p>
          </div>
        )}
      </div>

      {/* ── Sistema ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Estado del sistema</p>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            disabled={loadingSist}
            className="text-zinc-400 hover:text-zinc-700 disabled:opacity-30 transition-colors p-1 rounded"
            title="Actualizar"
          >
            <RotateCcw size={13} className={loadingSist ? 'animate-spin' : ''} />
          </button>
        </div>

        {!loadingSist && todoOk && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 mb-3">
            <CheckCheck size={14} className="text-emerald-600" />
            <p className="text-sm text-emerald-700 font-medium">Sistema al día — sin alertas activas</p>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {sistemaCards.map(card => {
            const loading = loadingSist
            const n = card.count
            const isOk      = n === 0
            const isUrgent  = n !== null && n >= card.urgente && !isOk
            const isError   = n === null && !loading

            return (
              <Link
                key={card.id}
                href={card.href}
                className={cn(
                  'rounded-lg border p-3 flex flex-col gap-1 transition-all hover:shadow-sm',
                  loading || isError
                    ? 'border-zinc-100 bg-zinc-50'
                    : isUrgent
                    ? 'border-red-200 bg-red-50 hover:border-red-300'
                    : isOk
                    ? 'border-emerald-200 bg-emerald-50 hover:border-emerald-300'
                    : 'border-amber-200 bg-amber-50 hover:border-amber-300',
                )}
              >
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide leading-none">
                  {card.label}
                </p>
                {loading ? (
                  <div className="h-4 w-16 bg-zinc-200 rounded animate-pulse mt-0.5" />
                ) : isError ? (
                  <p className="text-xs text-zinc-400 flex items-center gap-1 mt-0.5">
                    <AlertCircle size={11} />Error
                  </p>
                ) : isOk ? (
                  <p className="text-sm font-semibold text-emerald-700 flex items-center gap-1 mt-0.5">
                    <CheckCheck size={13} />{card.okText}
                  </p>
                ) : (
                  <p className={cn('text-sm font-bold mt-0.5', isUrgent ? 'text-red-700' : 'text-amber-700')}>
                    {card.formatear(n!)}
                  </p>
                )}
              </Link>
            )
          })}
        </div>
      </div>

      {/* ── Rutina del día ── */}
      <div>
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">
          Rutina del día
          {dia === 2 || dia === 3
            ? <span className="ml-2 normal-case font-normal text-indigo-500">+ traslados de hoy</span>
            : null}
        </p>
        <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
          {staffHoy.map(t => (
            <TareaRow
              key={t.id}
              tarea={t}
              done={done.has(t.id)}
              toggling={toggling === t.id}
              expanded={expanded === t.id}
              onToggle={() => toggle(t.id)}
              onExpand={() => setExpanded(e => e === t.id ? null : t.id)}
            />
          ))}
        </div>
      </div>

      {/* ── Gestión ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Gestión</p>
          <span className="text-[10px] bg-indigo-50 text-indigo-500 border border-indigo-200 rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide">
            Admin
          </span>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
          {GESTION.map(t => (
            <TareaRow
              key={t.id}
              tarea={t}
              done={done.has(t.id)}
              toggling={toggling === t.id}
              expanded={expanded === t.id}
              onToggle={() => toggle(t.id)}
              onExpand={() => setExpanded(e => e === t.id ? null : t.id)}
            />
          ))}
        </div>
      </div>

    </div>
  )
}

// ── TareaRow ─────────────────────────────────────────────────────────────
function TareaRow({
  tarea, done, toggling, expanded, onToggle, onExpand,
}: {
  tarea: TareaDef
  done: boolean
  toggling: boolean
  expanded: boolean
  onToggle: () => void
  onExpand: () => void
}) {
  return (
    <div className={cn('transition-colors', done ? 'bg-zinc-50/60' : 'hover:bg-zinc-50/40')}>
      <div className="flex items-center gap-3 px-4 py-3.5 group">
        {/* Checkbox */}
        <button
          onClick={onToggle}
          disabled={toggling}
          className={cn(
            'shrink-0 transition-colors disabled:opacity-40',
            done ? 'text-indigo-500' : 'text-zinc-300 hover:text-indigo-400',
          )}
        >
          {done
            ? <CheckCircle2 size={18} />
            : <Circle size={18} />}
        </button>

        {/* Text */}
        <button
          onClick={onExpand}
          className={cn(
            'flex-1 text-left text-sm leading-snug transition-colors',
            done ? 'line-through text-zinc-400' : 'text-zinc-800',
          )}
        >
          {tarea.texto}
        </button>

        {/* Link */}
        <Link
          href={tarea.href}
          onClick={e => e.stopPropagation()}
          className="shrink-0 opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50 transition-all"
        >
          <ExternalLink size={13} />
        </Link>
      </div>

      {/* Detail (expanded) */}
      {expanded && tarea.detalle && !done && (
        <div className="px-4 pb-3 pl-[52px]">
          <p className="text-xs text-zinc-500 leading-relaxed bg-zinc-50 rounded-lg px-3 py-2.5 border border-zinc-100">
            {tarea.detalle}
          </p>
        </div>
      )}
    </div>
  )
}
