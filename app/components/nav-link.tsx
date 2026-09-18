'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavLinkProps {
  href: string
  icon: React.ReactNode
  children: React.ReactNode
  /** Cuántas cosas esperan acá. En 0 no se dibuja nada. */
  badge?: number
}

export function NavLink({ href, icon, children, badge = 0 }: NavLinkProps) {
  const pathname = usePathname()
  // Use trailing-slash prefix to avoid /compras matching /compras-extra
  const isActive = pathname === href || pathname.startsWith(href + '/')

  return (
    <Link
      href={href}
      className={`group flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] transition-all duration-100 leading-none ${
        isActive
          ? 'bg-indigo-950/70 text-indigo-200 font-medium'
          : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100'
      }`}
    >
      <span className={`shrink-0 transition-colors duration-100 ${
        isActive ? 'text-indigo-400' : 'text-zinc-500 group-hover:text-zinc-300'
      }`}>
        {icon}
      </span>
      {children}
      {badge > 0 && (
        <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-white leading-none tabular-nums">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  )
}

export function NavSection({ label }: { label: string }) {
  return (
    <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.08em] select-none">
      {label}
    </p>
  )
}
