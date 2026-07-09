'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'

/**
 * Banner de error de carga de datos. Distinguir "no hay datos" de "falló la
 * carga" es crítico: una tabla vacía por error de red no debe leerse como
 * "no hay nada urgente hoy".
 */
export function ErrorBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-md bg-red-50 border border-red-300 px-4 py-3 text-sm text-red-800 flex items-center gap-3">
      <AlertCircle size={16} className="shrink-0 text-red-500" />
      <span className="flex-1">
        <strong>No se pudieron cargar los datos.</strong> Puede ser un problema de conexión — los números en pantalla pueden estar incompletos.
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-red-300 text-red-700 font-medium hover:bg-red-100 transition-colors shrink-0"
      >
        <RefreshCw size={13} />
        Reintentar
      </button>
    </div>
  )
}
