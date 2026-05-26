/**
 * POST /api/parse-invoice
 * Sends a PDF invoice to Claude and returns structured invoice data.
 * Body: multipart/form-data with field "file" (PDF)
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

// Strip BOM (﻿) that can sneak in from env vars copied from certain editors/terminals
const rawKey = (process.env.ANTHROPIC_API_KEY ?? '').replace(/^﻿/, '').trim()
const client = new Anthropic({ apiKey: rawKey })

const SYSTEM_PROMPT = `Sos un sistema de extracción de datos de facturas de proveedores para una dietética/naturista argentina.
Extraé los datos de la factura y respondé ÚNICAMENTE con un objeto JSON válido y bien formado.
REGLAS ABSOLUTAS:
- Respondé SOLO con el JSON, sin texto antes ni después, sin markdown, sin bloques de código
- Todos los strings deben tener las comillas y caracteres especiales correctamente escapados
- Los números deben ser números (sin comillas), sin símbolos de moneda
- No uses caracteres de control ni saltos de línea dentro de los strings`

const USER_PROMPT = `Analizá esta factura y extraé todos los ítems. Respondé con este JSON exacto (sin nada más):

{"proveedor":"nombre del proveedor","nro_comprobante":"número de factura (ej: 0001-00012345)","fecha":"DD/MM/YYYY","items":[{"codigo":"código del proveedor o EAN13 o vacío","descripcion":"descripción sin comillas internas","cantidad":1,"costo_unitario":0.00,"iva_porcentaje":21}]}

Reglas:
- costo_unitario = importe neto / cantidad (sin IVA, ya con descuentos aplicados), como número decimal
- iva_porcentaje = 21 o 10.5 (número, no string)
- Para Diet/Mayordiet: productos con ** al inicio tienen IVA 10.5%, el resto 21%
- No incluyas subtotales, totales ni encabezados repetidos
- Si el código tiene 13 dígitos numéricos es EAN13, usalo como codigo
- Incluí TODOS los ítems, incluyendo granel
- En las descripciones, reemplazá comillas internas por (") para no romper el JSON`

/** Intenta extraer el primer objeto JSON válido del texto */
function extractJson(text: string): string {
  // Strip BOM and whitespace
  const clean = text.replace(/^﻿/, '').trim()

  // Strip markdown fences
  const noFence = clean
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  // If it starts with { try directly
  if (noFence.startsWith('{')) return noFence

  // Otherwise find the first { ... } block
  const start = noFence.indexOf('{')
  const end   = noFence.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    return noFence.slice(start, end + 1)
  }

  return noFence
}

export async function POST(req: NextRequest) {
  if (!rawKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY no configurada' }, { status: 500 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const base64 = buffer.toString('base64')

    const message = await client.messages.create({
      model     : 'claude-opus-4-5',
      max_tokens: 16000,           // aumentado para facturas largas
      system    : SYSTEM_PROMPT,
      messages  : [{
        role   : 'user',
        content: [
          {
            type  : 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          { type: 'text', text: USER_PROMPT },
        ],
      }],
    })

    const raw     = (message.content[0] as { type: string; text: string }).text
    const jsonStr = extractJson(raw)

    let data: unknown
    try {
      data = JSON.parse(jsonStr)
    } catch (parseErr) {
      // Log first 500 chars of raw response to help debug
      console.error('[parse-invoice] JSON parse failed. Raw start:', raw.slice(0, 500))
      console.error('[parse-invoice] Parse error:', parseErr)
      return NextResponse.json(
        { error: `Claude devolvió JSON inválido: ${(parseErr as Error).message}`, raw: raw.slice(0, 1000) },
        { status: 422 }
      )
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('[parse-invoice]', err)
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
