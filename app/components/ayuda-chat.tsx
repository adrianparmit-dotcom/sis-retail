'use client'

/**
 * Burbuja de ayuda flotante (abajo a la derecha), presente en todas las pantallas.
 * Las chicas escriben una duda de uso y el asistente (/api/ayuda) responde en base
 * al manual. Es solo ayuda de uso — no accede a datos en vivo.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageCircleQuestion, X, Send, Loader2 } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string }

const SALUDO = '¡Hola! Soy la ayuda de SOHO. Preguntame cómo hacer algo en el sistema y te explico paso a paso. 🙂'

const SUGERENCIAS = [
  '¿Cómo imprimo las etiquetas de los aumentos?',
  '¿Cómo cargo un vencimiento con la pistola?',
  '¿Cómo recibo una factura de proveedor?',
]

export function AyudaChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const enviar = useCallback(async (texto: string) => {
    const pregunta = texto.trim()
    if (!pregunta || loading) return
    const nuevos: Msg[] = [...messages, { role: 'user', content: pregunta }]
    setMessages(nuevos)
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/ayuda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nuevos }),
      })
      const data = await res.json().catch(() => ({}))
      const reply = res.ok && data?.reply
        ? data.reply as string
        : (data?.error as string) ?? 'No pude responder. Probá de nuevo o consultá con Adrian.'
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'No me pude conectar. Revisá tu conexión o consultá con Adrian.' }])
    } finally {
      setLoading(false)
    }
  }, [messages, loading])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar(input)
    }
  }

  return (
    <div className="no-print">
      {/* Botón flotante */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir ayuda"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white pl-3.5 pr-4 py-3 shadow-xl shadow-indigo-600/30 transition-colors"
        >
          <MessageCircleQuestion size={20} />
          <span className="text-sm font-medium">¿Dudas?</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex flex-col w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-2rem)] rounded-2xl bg-white border border-zinc-200 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 h-14 bg-indigo-600 text-white shrink-0">
            <div className="flex items-center gap-2">
              <MessageCircleQuestion size={18} />
              <div className="leading-tight">
                <p className="text-sm font-semibold">Ayuda SOHO</p>
                <p className="text-[11px] text-indigo-200">Te explico cómo usar el sistema</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Cerrar" className="text-indigo-200 hover:text-white transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Mensajes */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3.5 py-4 space-y-3 bg-slate-50">
            {/* Saludo + sugerencias */}
            <Burbuja role="assistant" content={SALUDO} />
            {messages.length === 0 && (
              <div className="flex flex-col gap-1.5 pt-1">
                {SUGERENCIAS.map(s => (
                  <button
                    key={s}
                    onClick={() => enviar(s)}
                    className="text-left text-[13px] text-indigo-700 bg-white border border-indigo-100 hover:border-indigo-300 hover:bg-indigo-50 rounded-lg px-3 py-2 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) => <Burbuja key={i} role={m.role} content={m.content} />)}

            {loading && (
              <div className="flex items-center gap-2 text-zinc-400 text-sm px-1">
                <Loader2 size={15} className="animate-spin" />
                Pensando…
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-zinc-200 p-2.5 bg-white shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="Escribí tu duda…"
                className="flex-1 resize-none max-h-28 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
              />
              <button
                onClick={() => enviar(input)}
                disabled={loading || !input.trim()}
                aria-label="Enviar"
                className="shrink-0 h-9 w-9 flex items-center justify-center rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={16} />
              </button>
            </div>
            <p className="text-[10px] text-zinc-400 mt-1.5 px-1">
              Ayuda de uso. Para datos en vivo o errores, consultá con Adrian.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function Burbuja({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const esUser = role === 'user'
  return (
    <div className={`flex ${esUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
          esUser
            ? 'bg-indigo-600 text-white rounded-br-sm'
            : 'bg-white text-zinc-800 border border-zinc-200 rounded-bl-sm'
        }`}
      >
        {content}
      </div>
    </div>
  )
}
