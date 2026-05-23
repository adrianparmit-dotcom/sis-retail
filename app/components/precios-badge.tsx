'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { NavLink } from './nav-link'
import { Printer } from 'lucide-react'

export function PreciosBadge() {
  const [sinVer, setSinVer] = useState(0)

  useEffect(() => {
    const fetchCount = async () => {
      const { count } = await supabase
        .from('price_changes')
        .select('id', { count: 'exact', head: true })
        .eq('visto', false)
      setSinVer(count ?? 0)
    }

    fetchCount()

    // Realtime — fires whenever price_changes rows are inserted/updated
    const channel = supabase
      .channel('price-changes-badge')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'price_changes' },
        fetchCount,
      )
      .subscribe()

    // Fallback polling every 5 min (in case realtime isn't enabled on this table)
    const poll = setInterval(fetchCount, 5 * 60 * 1000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(poll)
    }
  }, [])

  return (
    <div className="relative">
      <NavLink href="/precios" icon={<Printer size={14} />}>
        Precios
      </NavLink>
      {sinVer > 0 && (
        <span className="absolute top-1 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[9px] font-bold text-white leading-none pointer-events-none select-none">
          {sinVer > 99 ? '99+' : sinVer}
        </span>
      )}
    </div>
  )
}
