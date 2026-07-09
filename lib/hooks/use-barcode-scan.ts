'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Estado compartido para búsqueda por escáner de código de barras:
 * resalta la fila encontrada por 3s, o muestra "no encontrado" por 1.5s.
 * Reemplaza los timers duplicados en compras/vencimientos/reposicion.
 */
export function useBarcodeScan() {
  const [scanHighlight, setScanHighlight] = useState<string | null>(null)
  const [scanMiss, setScanMiss] = useState(false)
  const hitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const missTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (hitTimer.current) clearTimeout(hitTimer.current)
      if (missTimer.current) clearTimeout(missTimer.current)
    }
  }, [])

  function markHit(id: string) {
    setScanHighlight(id)
    if (hitTimer.current) clearTimeout(hitTimer.current)
    hitTimer.current = setTimeout(() => setScanHighlight(null), 3000)
  }

  function markMiss() {
    setScanMiss(true)
    if (missTimer.current) clearTimeout(missTimer.current)
    missTimer.current = setTimeout(() => setScanMiss(false), 1500)
  }

  return { scanHighlight, scanMiss, markHit, markMiss }
}
