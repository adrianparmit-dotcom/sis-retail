'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  ShoppingCart, Package, ArrowLeftRight,
  Tag, Printer, Truck, BarChart2, CheckSquare, Clock, RefreshCw,
} from 'lucide-react'
import { formatDateTime } from '@/lib/format'

interface DashboardStats {
  urgentes: number
  sinStock: number
  vencCriticos: number
  preciosSinVer: number
  reposicionPendiente: number
  lastSync: string | null
}

const MODULE_LINKS = [
  { href: '/compras',       label: 'Compras',        sub: 'Órdenes inteligentes',  icon: ShoppingCart,   color: 'indigo'  },
  { href: '/vencimientos',  label: 'Vencimientos',   sub: 'Control FEFO',          icon: Package,        color: 'amber'   },
  { href: '/reposicion',    label: 'Reposición',     sub: 'Cascada de stock',      icon: ArrowLeftRight, color: 'sky'     },
  { href: '/recepciones',   label: 'Recepciones',    sub: 'Ingreso de mercadería', icon: Truck,          color: 'violet'  },
  { href: '/promociones',   label: 'Promociones',    sub: 'Sugerencias FEFO',      icon: Tag,            color: 'rose'    },
  { href: '/precios',       label: 'Precios',        sub: 'Etiquetas y aumentos',  icon: Printer,        color: 'orange'  },
  { href: '/tareas',        label: 'Tareas',         sub: 'Checklist semanal',     icon: CheckSquare,    color: 'emerald' },
  { href: '/reconciliacion',label: 'Reconciliación', sub: 'Stock Dux vs físico',  icon: BarChart2,      color: 'slate'   },
] as const

const COLOR_MAP: Record<string, { hover: string; icon: string }> = {
  indigo:  { hover: 'hover:border-indigo-200 hover:bg-indigo-50/40',   icon: 'bg-indigo-100 text-indigo-600'   },
  amber:   { hover: 'hover:border-amber-200 hover:bg-amber-50/40',     icon: 'bg-amber-100 text-amber-600'     },
  sky:     { hover: 'hover:border-sky-200 hover:bg-sky-50/40',         icon: 'bg-sky-100 text-sky-600'         },
  violet:  { hover: 'hover:border-violet-200 hover:bg-violet-50/40',   icon: 'bg-violet-100 text-violet-600'   },
  rose:    { hover: 'hover:border-rose-200 hover:bg-rose-50/40',       icon: 'bg-rose-100 text-rose-600'       },
  orange:  { hover: 'hover:border-orange-200 hover:bg-orange-50/40',   icon: 'bg-orange-100 text-orange-600'   },
  emerald: { hover: 'hover:border-emerald-200 hover:bg-emerald-50/40', icon: 'bg-emerald-100 text-emerald-600' },
  slate:   { hover: 'hover:border-slate-200 hover:bg-slate-50/40',     icon: 'bg-slate-100 text-slate-600'     },
}

const ALERT_CONFIG = [
  { key: 'urgentes',            label: 'Urgentes',       href: '/compras',      colorBorder: 'border-red-200',    colorText: 'text-red-600'    },
  { key: 'sinStock',            label: 'Sin stock',      href: '/compras',      colorBorder: 'border-red-200',    colorText: 'text-red-600'    },
  { key: 'vencCriticos',        label: 'Venc. críticos', href: '/vencimientos', colorBorder: 'border-amber-200',  colorText: 'text-amber-600'  },
  { key: 'reposicionPendiente', label: 'Reponer',        href: '/reposicion',   colorBorder: 'border-sky-200',    colorText: 'text-sky-600'    },
  { key: 'preciosSinVer',       label: 'Precios nuevos', href: '/precios',      colorBorder: 'border-orange-200', colorText: 'text-orange-600' },
] as const

export default function HomePage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [
          syncRes, urgentesRes, sinStockRes, vencRes, preciosRes, reposRes,
        ] = await Promise.all([
          supabase.from('productos').select('dux_sync_at').order('dux_sync_at', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('v_compras_inteligentes').select('id', { count: 'exact', head: true }).lte('dias_cobertura', 7).gt('vel_diaria', 0),
          supabase.from('v_compras_inteligentes').select('id', { count: 'exact', head: true }).lte('stock_actual', 0).gt('vel_diaria', 0),
          supabase.from('v_vencimientos_fefo').select('lote_id', { count: 'exact', head: true }).in('estado', ['vencido', 'critico']).gt('cantidad', 0),
          supabase.from('price_changes').select('id', { count: 'exact', head: true }).eq('visto', false),
          supabase.from('v_reposicion_dashboard').select('producto_id', { count: 'exact', head: true }).lte('soho1_local', 2),
        ])
        setStats({
          urgentes:            urgentesRes.count ?? 0,
          sinStock:            sinStockRes.count ?? 0,
          vencCriticos:        vencRes.count ?? 0,
          preciosSinVer:       preciosRes.count ?? 0,
          reposicionPendiente: reposRes.count ?? 0,
          lastSync:            (syncRes.data as { dux_sync_at: string } | null)?.dux_sync_at ?? null,
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const today = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="px-8 py-7 border-b border-gray-200 bg-white">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">SOHO Retail OS</h1>
            <p className="text-sm text-gray-500 mt-1 capitalize">{today}</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Clock size={12} />
            <span>{loading ? '—' : stats?.lastSync ? `Sync ${formatDateTime(stats.lastSync)}` : 'Sin sync'}</span>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6 max-w-4xl">

        {/* Alert strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {ALERT_CONFIG.map(({ key, label, href, colorBorder, colorText }) => {
            const value = stats?.[key] ?? 0
            const hasAlert = !loading && value > 0
            return (
              <Link
                key={key}
                href={href}
                className={`bg-white rounded-xl border px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                  hasAlert ? colorBorder : 'border-gray-200'
                }`}
              >
                {loading ? (
                  <div className="animate-pulse space-y-1.5">
                    <div className="h-6 bg-gray-200 rounded w-10" />
                    <div className="h-2.5 bg-gray-100 rounded w-16" />
                  </div>
                ) : (
                  <>
                    <p className={`text-2xl font-bold leading-none ${hasAlert ? colorText : 'text-gray-300'}`}>
                      {value}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-1.5 leading-tight">{label}</p>
                  </>
                )}
              </Link>
            )
          })}
        </div>

        {/* Modules */}
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Módulos</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {MODULE_LINKS.map(({ href, label, sub, icon: Icon, color }) => {
              const s = COLOR_MAP[color]
              return (
                <Link
                  key={href}
                  href={href}
                  className={`group bg-white rounded-xl border border-gray-200 p-4 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${s.hover}`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 transition-transform group-hover:scale-105 ${s.icon}`}>
                    <Icon size={17} />
                  </div>
                  <p className="text-sm font-semibold text-gray-900 leading-tight">{label}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>
                </Link>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <RefreshCw size={10} />
          <span>Stock sincronizado automáticamente 8 veces por día desde Dux Software</span>
        </div>

      </div>
    </div>
  )
}
