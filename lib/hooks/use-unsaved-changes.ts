'use client'

import { useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

export function useUnsavedChanges(hasChanges: boolean, message = 'Tenés cambios sin guardar. ¿Querés salir de todas formas?') {
  const router = useRouter()

  // Block browser navigation (refresh, close tab, etc.)
  useEffect(() => {
    if (!hasChanges) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = message
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasChanges, message])

  // Returns a safe-navigate function for in-app navigation
  const safeNavigate = useCallback(
    (href: string) => {
      if (!hasChanges || window.confirm(message)) {
        router.push(href)
      }
    },
    [hasChanges, message, router],
  )

  return { safeNavigate }
}
