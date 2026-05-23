import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

type KpiVariant = 'default' | 'danger' | 'warning' | 'success' | 'info' | 'indigo'

interface KpiCardProps {
  label: string
  value: string | number
  sublabel?: string
  icon?: LucideIcon
  variant?: KpiVariant
  active?: boolean
  onClick?: () => void
  className?: string
}

const variantStyles: Record<KpiVariant, { card: string; icon: string; value: string }> = {
  default: {
    card: 'bg-white border-gray-200 hover:border-gray-300',
    icon: 'bg-gray-100 text-gray-500',
    value: 'text-gray-900',
  },
  danger: {
    card: 'bg-white border-gray-200 hover:border-red-200',
    icon: 'bg-red-50 text-red-500',
    value: 'text-red-600',
  },
  warning: {
    card: 'bg-white border-gray-200 hover:border-amber-200',
    icon: 'bg-amber-50 text-amber-600',
    value: 'text-amber-700',
  },
  success: {
    card: 'bg-white border-gray-200 hover:border-emerald-200',
    icon: 'bg-emerald-50 text-emerald-600',
    value: 'text-emerald-700',
  },
  info: {
    card: 'bg-white border-gray-200 hover:border-sky-200',
    icon: 'bg-sky-50 text-sky-600',
    value: 'text-sky-700',
  },
  indigo: {
    card: 'bg-white border-gray-200 hover:border-indigo-200',
    icon: 'bg-indigo-50 text-indigo-600',
    value: 'text-indigo-700',
  },
}

const activeStyles: Record<KpiVariant, string> = {
  default: 'ring-2 ring-gray-400 border-gray-400',
  danger:  'ring-2 ring-red-400 border-red-300 bg-red-50/40',
  warning: 'ring-2 ring-amber-400 border-amber-300 bg-amber-50/40',
  success: 'ring-2 ring-emerald-400 border-emerald-300 bg-emerald-50/40',
  info:    'ring-2 ring-sky-400 border-sky-300 bg-sky-50/40',
  indigo:  'ring-2 ring-indigo-400 border-indigo-300 bg-indigo-50/40',
}

export function KpiCard({
  label,
  value,
  sublabel,
  icon: Icon,
  variant = 'default',
  active = false,
  onClick,
  className,
}: KpiCardProps) {
  const styles = variantStyles[variant]
  const isClickable = !!onClick

  return (
    <div
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => e.key === 'Enter' && onClick?.() : undefined}
      className={cn(
        'rounded-xl border p-4 transition-all duration-150 select-none',
        styles.card,
        active && activeStyles[variant],
        isClickable && 'cursor-pointer',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 truncate leading-none">{label}</p>
          <p className={cn('text-2xl font-bold mt-1.5 leading-none tracking-tight', styles.value)}>
            {typeof value === 'number' ? value.toLocaleString('es-AR') : value}
          </p>
          {sublabel && (
            <p className="text-[11px] text-gray-400 mt-1.5 leading-none">{sublabel}</p>
          )}
        </div>
        {Icon && (
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', styles.icon)}>
            <Icon size={15} />
          </div>
        )}
      </div>
    </div>
  )
}
