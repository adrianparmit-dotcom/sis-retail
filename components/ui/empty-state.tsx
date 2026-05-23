import type { LucideIcon } from 'lucide-react'
import { PackageSearch } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title?: string
  description?: string
  action?: React.ReactNode
  compact?: boolean
}

export function EmptyState({
  icon: Icon = PackageSearch,
  title = 'Sin resultados',
  description = 'No se encontraron registros con los filtros actuales.',
  action,
  compact = false,
}: EmptyStateProps) {
  if (compact) {
    return (
      <tr>
        <td colSpan={99} className="px-4 py-8 text-center">
          <div className="flex flex-col items-center gap-1.5">
            <Icon size={20} className="text-gray-300" />
            <p className="text-sm text-gray-400">{title}</p>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mb-4">
        <Icon size={22} className="text-gray-400" />
      </div>
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {description && (
        <p className="mt-1 text-sm text-gray-400 max-w-xs">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
