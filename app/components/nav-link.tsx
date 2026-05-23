'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavLinkProps {
  href: string
  icon: React.ReactNode
  children: React.ReactNode
}

export function NavLink({ href, icon, children }: NavLinkProps) {
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
