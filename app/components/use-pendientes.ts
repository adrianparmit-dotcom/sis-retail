'use client'

/**
 * Lo que está esperando que alguien lo haga, contado en un solo lugar.
 *
 * Vive acá y no dentro de cada badge porque los mismos números se muestran dos
 * veces: al lado del ítem del menú y en el panel "Pendientes" del pie. Contarlos
 * por separado abriría dos suscripciones a la misma tabla y, peor, permitiría
 * que el badge y el panel dijeran cosas distintas.
 *
 * El caso que motivó el panel son los pedidos de Shuk: caen solos por webhook,
 * sin que nadie los pida, así que si no saltan a la vista se pierden. Las
 * chicas no tienen por qué entrar a la pantalla a ver si hay algo.
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface Pendientes {
  /** Cambios de precio sin imprimir la etiqueta. */
  precios: number
  /** Pedidos de granel que Shuk mandó y todavía nadie armó. */
  requerimientos: number
}

const VACIO: Pendientes = { precios: 0, requerimientos: 0 }

export function usePendientes(): Pendientes {
  const [pendientes, setPendientes] = useState<Pendientes>(VACIO)

  useEffect(() => {
    let vivo = true

    const contar = async () => {
      const [precios, requerimientos] = await Promise.all([
        supabase.from('price_changes')
          .select('id', { count: 'exact', head: true })
          .eq('visto', false),
        supabase.from('shuk_requerimientos')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'pendiente'),
      ])
      // El componente se desmonta en cada navegación; sin esto React avisa por
      // consola de un setState sobre algo que ya no está.
      if (!vivo) return
      // Un error de red deja el contador como estaba en vez de mostrar 0: decir
      // "no hay nada pendiente" cuando no se pudo preguntar es justo el error
      // que hace que un pedido se pierda.
      setPendientes(prev => ({
        precios       : precios.count ?? prev.precios,
        requerimientos: requerimientos.count ?? prev.requerimientos,
      }))
    }

    contar()

    const canal = supabase
      .channel('pendientes-sidebar')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'price_changes' }, contar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shuk_requerimientos' }, contar)
      .subscribe()

    // Red de seguridad por si realtime no está habilitado en alguna de las dos
    // tablas: sin esto un pedido podría quedar invisible hasta recargar.
    const poll = setInterval(contar, 3 * 60 * 1000)

    return () => {
      vivo = false
      supabase.removeChannel(canal)
      clearInterval(poll)
    }
  }, [])

  return pendientes
}
