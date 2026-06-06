/**
 * POST /api/ayuda
 * Asistente de ayuda interno. Responde dudas de USO del sistema, en base al
 * manual (web/lib/ayuda/manual.ts). No accede a datos en vivo.
 *
 * Body: { messages: { role: 'user' | 'assistant'; content: string }[] }
 * Respuesta: { reply: string }
 *
 * Modelo: claude-haiku-4-5 (económico — Q&A corto basado en manual).
 * El manual va como bloque de system con prompt caching (cache_control ephemeral):
 * se reescribe en cada pregunta pero se sirve cacheado (~0,1x el costo de input).
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { MANUAL } from '@/lib/ayuda/manual'

export const runtime = 'nodejs'

// Strip BOM que a veces se cuela al copiar la key desde ciertos editores/terminales
const rawKey = (process.env.ANTHROPIC_API_KEY ?? '').replace(/^﻿/, '').trim()
const client = new Anthropic({ apiKey: rawKey })

const MODEL = 'claude-haiku-4-5'
const MAX_HISTORY = 20      // últimos N mensajes que mandamos (acota contexto y costo)
const MAX_CHARS = 4000      // largo máximo por mensaje del usuario

const SYSTEM = `Sos el asistente de ayuda del sistema interno "SOHO Retail OS", una dietética en Argentina. Te escriben las chicas que operan el sistema cuando tienen dudas de CÓMO USARLO.

Reglas:
- Respondé SIEMPRE en español rioplatense (tratá de "vos"), con tono simple, amable y concreto, como para alguien que recién aprende.
- Respondé ÚNICAMENTE con información del MANUAL de más abajo. NO inventes funciones, botones ni pasos que no estén en el manual.
- Si la pregunta NO está cubierta por el manual, o no estás seguro, decilo claramente y sugerí consultar con Adrian. No adivines.
- Respuestas CORTAS. Si hay pasos, usá una lista numerada breve. Nada de relleno.
- No respondas preguntas que no sean sobre el uso del sistema SOHO.
- Nunca pidas ni reveles datos sensibles, contraseñas ni claves.

=== MANUAL ===
${MANUAL}`

type ChatMsg = { role: 'user' | 'assistant'; content: string }

function parseMessages(input: unknown): ChatMsg[] | null {
  if (!Array.isArray(input)) return null
  const out: ChatMsg[] = []
  for (const m of input) {
    if (!m || typeof m !== 'object') return null
    const role = (m as { role?: unknown }).role
    const content = (m as { content?: unknown }).content
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null
    const text = content.trim()
    if (!text) continue
    out.push({ role, content: text.slice(0, MAX_CHARS) })
  }
  // Anthropic exige que el primer mensaje sea 'user'
  while (out.length > 0 && out[0].role !== 'user') out.shift()
  return out
}

export async function POST(req: NextRequest) {
  if (!rawKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY no configurada' }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  const messages = parseMessages((body as { messages?: unknown } | null)?.messages)
  if (!messages || messages.length === 0) {
    return NextResponse.json({ error: 'Faltan mensajes válidos' }, { status: 400 })
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      messages: messages.slice(-MAX_HISTORY),
    })

    const reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim()

    return NextResponse.json({
      reply: reply || 'No pude generar una respuesta. Probá de nuevo o consultá con Adrian.',
    })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'El asistente está ocupado. Probá en unos segundos.' }, { status: 429 })
    }
    console.error('[ayuda] error:', (e as Error).message)
    return NextResponse.json({ error: 'No se pudo conectar con el asistente.' }, { status: 500 })
  }
}
