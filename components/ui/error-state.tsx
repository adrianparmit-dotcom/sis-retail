import { AlertCircle, RefreshCw } from 'lucide-react'

interface ErrorStateProps {
  message?: string
  onRetry?: () => void
  compact?: boolean
}

export function ErrorState({
  message = 'Error al cargar los datos.',
  onRetry,
  compact = false,
}: ErrorStateProps) {
  if (compact) {
    return (
      <tr>
        <td colSpan={99} className="px-4 py-8 text-center">
          <div className="flex flex-col items-center gap-2">
            <AlertCircle size={20} className="text-red-400" />
            <p className="text-sm text-red-500">{message}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
              >
                <RefreshCw size={11} /> Reintentar
              </button>
            )}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center">
        <AlertCircle size={22} className="text-red-500" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-gray-700">Algo salió mal</p>
        <p className="text-sm text-gray-400 mt-0.5">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
        >
          <RefreshCw size={13} /> Reintentar
        </button>
      )}
    </div>
  )
}
