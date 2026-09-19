'use client'

/**
 * El recuadro del navegador cuando entra un pedido de granel de Shuk.
 *
 * Es solo para eso. El WhatsApp es el otro lado del circuito —sale cuando las
 * chicas confirman que el pedido está armado, para el traslado de SOHO 2 al
 * depósito de Shuk— y no tiene nada que ver con esto.
 *
 * Vive en el AppShell y no en la pantalla de requerimientos: el aviso sirve
 * justamente cuando están en otra pantalla. Si hubiera que estar parado en
 * Requerimientos para enterarse, no haría falta el aviso.
 *
 * **La hora la decide el servidor**, en `notificar_at` (ver `lib/aviso-horario`).
 * Acá solo se pregunta qué pendientes ya tienen la hora cumplida. Por eso un
 * pedido que entró el sábado a la noche aparece el lunes cuando prenden la PC:
 * su hora ya pasó y este navegador todavía no lo mostró.
 */

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

/** Cada cuánto se pregunta. Realtime avisa del alta, pero no de que se hicieron
 *  las 16:15: eso solo lo puede ver alguien mirando el reloj. */
const CADA = 60 * 1000

const LLAVE = 'soho.avisos-pedidos-mostrados'
/** Se guardan los últimos, no todos: la lista no tiene por qué crecer para siempre. */
const RECORDAR = 200

/**
 * Qué pedidos ya mostró ESTE navegador.
 *
 * Es por navegador a propósito. Si se marcara en la base, el pedido saltaría en
 * la primera PC que lo viera y en las otras no — y la que lo vio puede ser la
 * que no tiene a nadie sentado adelante. Así salta en todas las que estén
 * abiertas, una vez en cada una.
 */
function yaMostrados(): Set<string> {
  try {
    const crudo = localStorage.getItem(LLAVE)
    return new Set(crudo ? JSON.parse(crudo) as string[] : [])
  } catch {
    // Modo incógnito o storage bloqueado: se muestra de nuevo, que es mejor que
    // no mostrar nada.
    return new Set()
  }
}

function recordar(ids: Set<string>) {
  try {
    localStorage.setItem(LLAVE, JSON.stringify([...ids].slice(-RECORDAR)))
  } catch { /* sin storage el aviso se repite; no es motivo para romper nada */ }
}

interface PedidoAvisable {
  id: string
  pedido: string
  shuk_requerimiento_items: { cantidad: number }[]
}

export function useAvisoPedidos() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return

    let vivo = true

    const revisar = async () => {
      // Sin permiso no se pide nada: pedirlo sin que lo hayan apretado lo
      // bloquea Chrome, y encima quema el permiso para siempre si dan "Bloquear".
      if (Notification.permission !== 'granted') return

      const { data, error } = await supabase
        .from('shuk_requerimientos')
        .select('id, pedido, shuk_requerimiento_items(cantidad)')
        .eq('estado', 'pendiente')
        .lte('notificar_at', new Date().toISOString())
        .order('notificar_at', { ascending: true })
        .limit(20)

      if (error || !vivo || !data) return

      const mostrados = yaMostrados()
      const nuevos = (data as PedidoAvisable[]).filter(p => !mostrados.has(p.id))
      if (nuevos.length === 0) return

      for (const p of nuevos) {
        const paquetes = p.shuk_requerimiento_items.reduce((s, i) => s + (i.cantidad ?? 0), 0)
        const n = new Notification('Pedido de granel de Shuk', {
          body: `${p.pedido} · ${paquetes} ${paquetes === 1 ? 'paquete' : 'paquetes'} para armar`,
          // Con el tag, si el mismo pedido se avisara dos veces el navegador
          // reemplaza el recuadro en vez de apilar uno arriba del otro.
          tag : `shuk-pedido-${p.id}`,
          icon: '/favicon.ico',
        })
        n.onclick = () => {
          window.focus()
          window.location.href = '/ecommerce/requerimientos'
        }
        mostrados.add(p.id)
      }
      recordar(mostrados)
    }

    revisar()

    // El alta la avisa realtime; la hora cumplida la encuentra el intervalo.
    const canal = supabase
      .channel('aviso-pedidos-granel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shuk_requerimientos' }, revisar)
      .subscribe()

    const reloj = setInterval(revisar, CADA)

    return () => {
      vivo = false
      supabase.removeChannel(canal)
      clearInterval(reloj)
    }
  }, [])
}
