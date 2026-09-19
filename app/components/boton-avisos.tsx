'use client'

/**
 * El botón para habilitar el recuadro del navegador.
 *
 * Existe porque el permiso hay que darlo **una vez en cada PC y en cada
 * navegador** — no es una configuración del sistema. Y porque Chrome ignora el
 * pedido de permiso si no viene de un clic: preguntarlo solo al cargar la
 * página no funciona y, peor, si alguien contesta "Bloquear" **no se puede
 * volver a preguntar por código nunca más**, hay que ir a mano a la
 * configuración del navegador. Por eso el estado bloqueado se muestra
 * explícitamente en vez de dejar un botón que no hace nada.
 */

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Bell, BellOff, BellRing } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Estado = 'sin-soporte' | 'default' | 'granted' | 'denied'

export function BotonAvisos() {
  const [estado, setEstado] = useState<Estado>('default')

  // Se lee en un effect y no al inicializar: en el servidor no existe
  // `Notification` y el render tiene que coincidir con el del cliente.
  useEffect(() => {
    setEstado(
      typeof window === 'undefined' || !('Notification' in window)
        ? 'sin-soporte'
        : Notification.permission as Estado,
    )
  }, [])

  if (estado === 'sin-soporte') return null

  if (estado === 'granted') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
        <BellRing size={13} />
        Avisos activados en esta PC
      </span>
    )
  }

  if (estado === 'denied') {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400"
        title="Los avisos están bloqueados para este sitio. Se habilitan desde el candado de la barra de direcciones del navegador."
      >
        <BellOff size={13} />
        Avisos bloqueados en esta PC
      </span>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        const r = await Notification.requestPermission()
        setEstado(r as Estado)
        if (r === 'granted') {
          new Notification('Listo', { body: 'Los pedidos de granel van a avisar en esta pantalla.' })
        } else if (r === 'denied') {
          toast.error('Quedaron bloqueados. Para volver a activarlos hay que entrar al candado de la barra de direcciones del navegador.')
        }
      }}
    >
      <Bell size={13} className="mr-1" />
      Activar avisos
    </Button>
  )
}
