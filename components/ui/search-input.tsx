'use client'

import { useRef } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Buscar...',
  className,
  autoFocus,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={cn('relative flex items-center', className)}>
      <Search size={14} className="absolute left-3 text-zinc-400 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={cn(
          'w-full h-9 pl-8 pr-7 rounded-lg border border-zinc-200 bg-white text-sm',
          'text-zinc-900 placeholder:text-zinc-400',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400',
          'transition-colors duration-100',
        )}
      />
      {value && (
        <button
          onClick={() => { onChange(''); inputRef.current?.focus() }}
          className="absolute right-2.5 text-zinc-300 hover:text-zinc-500 transition-colors"
          type="button"
          tabIndex={-1}
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}
