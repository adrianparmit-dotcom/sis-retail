'use client'

import { useState, useMemo } from 'react'
import { PAGE_SIZE } from '@/lib/constants'

export function usePagination<T>(items: T[], pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1)

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, page, pageSize])

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))

  // Reset to page 1 when items change (e.g. after filtering)
  const reset = () => setPage(1)

  return {
    page,
    setPage,
    paged,
    total: items.length,
    totalPages,
    pageSize,
    reset,
  }
}
