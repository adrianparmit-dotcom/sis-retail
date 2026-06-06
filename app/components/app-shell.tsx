'use client'

import { usePathname } from 'next/navigation'
import {
  ShoppingCart, Package, Truck, BarChart2, ArrowLeftRight,
  Tag, Scissors, MapPin, AlertTriangle, CheckSquare, MoveRight,
} from 'lucide-react'
import { NavLink, NavSection } from './nav-link'
import { PreciosBadge } from './precios-badge'
import { AyudaChat } from './ayuda-chat'

// Routes that should NOT show the sidebar
const NO_SIDEBAR_PATHS = ['/login']

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hideSidebar = NO_SIDEBAR_PATHS.some((p) => pathname.startsWith(p))

  if (hideSidebar) {
    return <>{children}</>
  }

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── Sidebar ── */}
      <aside className="w-[220px] bg-zinc-950 text-white flex flex-col shrink-0 border-r border-zinc-800/60">

        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-[57px] border-b border-zinc-800/60 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/30">
            <span className="text-[11px] font-black text-white tracking-tight">S</span>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white leading-none tracking-tight">SOHO</p>
            <p className="text-[10px] text-zinc-500 mt-0.5 leading-none">Retail OS</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2.5 py-2.5 overflow-y-auto">

          <NavSection label="Stock" />
          <NavLink href="/compras" icon={<ShoppingCart size={14} />}>Compras</NavLink>
          <NavLink href="/compras/sin-proveedor" icon={<AlertTriangle size={14} />}>Sin proveedor</NavLink>
          <NavLink href="/vencimientos" icon={<Package size={14} />}>Vencimientos</NavLink>

          <NavSection label="Operaciones" />
          <NavLink href="/recepciones" icon={<Truck size={14} />}>Recepciones</NavLink>
          <NavLink href="/transferencias" icon={<MoveRight size={14} />}>Transferencias</NavLink>
          <NavLink href="/reposicion" icon={<ArrowLeftRight size={14} />}>Reposición</NavLink>
          <NavLink href="/promociones" icon={<Tag size={14} />}>Promociones</NavLink>
          <NavLink href="/tareas" icon={<CheckSquare size={14} />}>Tareas</NavLink>
          <NavLink href="/reconciliacion" icon={<BarChart2 size={14} />}>Reconciliación</NavLink>

          <NavSection label="Góndola" />
          <PreciosBadge />

          <NavSection label="Producción" />
          <NavLink href="/fraccionamiento" icon={<Scissors size={14} />}>Fraccionamiento</NavLink>
          <NavLink href="/ubicaciones" icon={<MapPin size={14} />}>Ubicaciones</NavLink>

        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-zinc-800/60 shrink-0 flex items-center justify-between">
          <span className="text-[10px] text-zinc-600 font-mono">v2.0</span>
          <span className="text-[10px] text-zinc-700">sis-retail</span>
        </div>

      </aside>

      {/* ── Main ── */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-slate-50">
        {children}
      </main>

      {/* ── Ayuda flotante (todas las pantallas con sidebar) ── */}
      <AyudaChat />

    </div>
  )
}
