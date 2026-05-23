'use client'

import { SUCURSALES_OPERATIVAS, type SucursalId } from '@/lib/constants'
import { cn } from '@/lib/utils'

interface SucursalSelectorProps {
  value: string
  onChange: (id: SucursalId | '') => void
  includeAll?: boolean
  allLabel?: string
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md'
}

export function SucursalSelector({
  value,
  onChange,
  includeAll = true,
  allLabel = 'Todas las sucursales',
  disabled = false,
  className,
  size = 'md',
}: SucursalSelectorProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SucursalId | '')}
      disabled={disabled}
      className={cn(
        'rounded-lg border border-gray-200 bg-white text-gray-900',
        'focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400',
        'transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-sm',
        className,
      )}
    >
      {includeAll && (
        <option value="">{allLabel}</option>
      )}
      {SUCURSALES_OPERATIVAS.map((s) => (
        <option key={s.id} value={s.id}>
          {s.nombre}
        </option>
      ))}
    </select>
  )
}
