import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Link from 'next/link'
import { ShoppingCart, Package } from 'lucide-react'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'SOHO Retail OS',
  description: 'Sistema de gestión SOHO',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={`${inter.className} bg-gray-50 min-h-screen`}>
        <div className="flex min-h-screen">
          <aside className="w-56 bg-zinc-900 text-white flex flex-col shrink-0">
            <div className="px-6 py-5 border-b border-zinc-700">
              <span className="text-lg font-bold tracking-tight">SOHO</span>
              <span className="text-xs text-zinc-400 block">Retail OS</span>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              <NavLink href="/compras" icon={<ShoppingCart size={16} />}>Compras</NavLink>
              <NavLink href="/vencimientos" icon={<Package size={16} />}>Vencimientos</NavLink>
            </nav>
            <div className="px-6 py-4 border-t border-zinc-700">
              <span className="text-xs text-zinc-500">sis-retail v1.0</span>
            </div>
          </aside>
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  )
}

function NavLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors">
      {icon}
      {children}
    </Link>
  )
}
