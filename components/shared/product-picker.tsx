'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Search, X, Barcode } from 'lucide-react'
import { useOutsideClick } from '@/lib/hooks/use-outside-click'
import type { ProductoStock } from '@/lib/types'
import { cn } from '@/lib/utils'

interface ProductPickerProps {
  productos: ProductoStock[]
  placeholder?: string
  disabled?: boolean
  value?: string
  onSelect: (producto: ProductoStock) => void
  onClear?: () => void
  className?: string
}

export function ProductPicker({
  productos,
  placeholder = 'Buscar producto o código de barras…',
  disabled = false,
  value,
  onSelect,
  onClear,
  className,
}: ProductPickerProps) {
  const [query, setQuery] = useState(value ?? '')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Build barcode map once
  const barcodeMap = useRef<Map<string, ProductoStock>>(new Map())
  useEffect(() => {
    const map = new Map<string, ProductoStock>()
    for (const p of productos) {
      if (p.codigo_barras) map.set(p.codigo_barras.trim(), p)
      map.set(p.sku.trim(), p)
    }
    barcodeMap.current = map
  }, [productos])

  useOutsideClick(containerRef, () => setOpen(false))

  // Sync external value
  useEffect(() => {
    if (value !== undefined) setQuery(value)
  }, [value])

  const filtered = query.trim().length < 1
    ? []
    : productos
        .filter((p) => {
          const q = query.toLowerCase()
          return (
            p.nombre?.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q) ||
            p.codigo_barras?.toLowerCase().includes(q) ||
            p.categoria?.toLowerCase().includes(q)
          )
        })
        .slice(0, 60)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        const exact = barcodeMap.current.get(query.trim())
        if (exact) {
          handleSelect(exact)
          return
        }
        if (filtered.length === 1) {
          handleSelect(filtered[0])
        }
      }
      if (e.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
      }
    },
    [query, filtered],
  )

  const handleSelect = (producto: ProductoStock) => {
    setQuery(producto.nombre ?? producto.sku)
    setOpen(false)
    onSelect(producto)
  }

  const handleClear = () => {
    setQuery('')
    setOpen(false)
    onClear?.()
    inputRef.current?.focus()
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative flex items-center">
        <Search size={14} className="absolute left-3 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => { if (query.length > 0) setOpen(true) }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className={cn(
            'w-full h-9 pl-8 pr-8 rounded-lg border border-gray-200 bg-white text-sm',
            'text-gray-900 placeholder:text-gray-400',
            'focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400',
            'transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        />
        {query && (
          <button
            onClick={handleClear}
            type="button"
            className="absolute right-2.5 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && filtered.length > 0 && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(p) }}
                  className="w-full text-left px-3 py-2 hover:bg-indigo-50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900 truncate leading-tight">{p.nombre}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{p.sku} · {p.categoria}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] text-gray-500">
                        Stock: {p.stock_dux}
                      </p>
                      {p.codigo_barras && (
                        <div className="flex items-center gap-0.5 justify-end mt-0.5">
                          <Barcode size={9} className="text-gray-300" />
                          <span className="text-[10px] text-gray-300">{p.codigo_barras}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {filtered.length === 60 && (
            <p className="px-3 py-1.5 text-[11px] text-gray-400 border-t border-gray-100">
              Mostrando los primeros 60 resultados. Afiná la búsqueda.
            </p>
          )}
        </div>
      )}

      {open && query.length > 1 && filtered.length === 0 && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl px-4 py-3">
          <p className="text-sm text-gray-400">Sin resultados para <span className="font-medium text-gray-700">"{query}"</span></p>
        </div>
      )}
    </div>
  )
}
