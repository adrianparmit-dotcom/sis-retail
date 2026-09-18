'use client'

/**
 * El bloque "Pendientes" del pie del menú.
 *
 * Los badges al lado de cada ítem alcanzan cuando ya sabés dónde mirar. Esto es
 * para lo que llega solo: un pedido de granel entra por webhook desde Shuk sin
 * que nadie lo pida, y si la única señal es un puntito en un ítem del medio del
 * menú, se pierde. Acá queda abajo de todo, siempre en el mismo lugar y a la
 * misma altura de la pantalla, aunque se navegue.
 *
 * **Se esconde entero cuando no hay nada.** Un panel que siempre dice "0" deja
 * de mirarse a la semana, y entonces no sirve el día que dice "3".
 */

import Link from 'next/link'
import type { Pendientes } from './use-pendientes'

interface Fila {
  href: string
  label: string
  cantidad: number
}

export function PendientesPanel({ pendientes }: { pendientes: Pendientes }) {
  const filas: Fila[] = [
    { href: '/ecommerce/requerimientos', label: 'Pedidos Shuk', cantidad: pendientes.requerimientos },
    { href: '/precios',                  label: 'Precios',      cantidad: pendientes.precios },
  ].filter(f => f.cantidad > 0)

  if (filas.length === 0) return null

  return (
    <div className="shrink-0 border-t border-zinc-800/60 bg-zinc-900/40 px-2.5 py-2">
      <p className="px-3 pb-1.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.08em] select-none">
        Pendientes
      </p>
      {filas.map(f => (
        <Link
          key={f.href}
          href={f.href}
          className="flex items-center gap-2 px-3 py-[6px] rounded-md text-[13px] leading-none text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100 transition-colors duration-100"
        >
          {f.label}
          <span className="ml-auto text-[13px] font-semibold text-orange-400 tabular-nums">
            {f.cantidad}
          </span>
        </Link>
      ))}
    </div>
  )
}
