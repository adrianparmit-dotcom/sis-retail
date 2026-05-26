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
Extraé los datos de la factura y respondé ÚNICAMENTE con un JSON válido, sin texto adicional, sin markdown, sin explicaciones.`

const USER_PROMPT = `Analizá esta factura y extraé todos los ítems. Respondé con este JSON exacto:

{
  "proveedor": "nombre del proveedor",
  "nro_comprobante": "número de factura (ej: 0001-00012345)",
  "fecha": "DD/MM/YYYY",
  "items": [
    {
      "codigo": "código interno del proveedor (vacío si no tiene)",
      "descripcion": "descripción del producto tal como aparece",
      "cantidad": número_entero,
      "costo_unitario": número_decimal (importe_neto / cantidad, sin IVA),
      "iva_porcentaje": 21 o 10.5
    }
  ]
}

Reglas importantes:
- costo_unitario = importe neto / cantidad (sin IVA, ya con descuentos aplicados)
- Para Diet/Mayordiet: productos con ** al inicio del nombre tienen IVA 10.5%, el resto 21%
- No incluyas líneas de subtotales, totales, ni encabezados
- Si el código es un EAN13 (13 dígitos), usalo como codigo
- Incluí TODOS los ítems de la factura, incluyendo granel`

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY no configurada' }, { status: 500 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const base64 = buffer.toString('base64')

    const message = await client.messages.create({
      model  : 'claude-opus-4-5',
      max_tokens: 8192,
      system : SYSTEM_PROMPT,
      messages: [{
        role   : 'user',
        content: [
          {
            type    : 'document',
            source  : { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          { type: 'text', text: USER_PROMPT },
        ],
      }],
    })

    const raw = (message.content[0] as { type: string; text: string }).text.trim()
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const data = JSON.parse(jsonStr)

    return NextResponse.json(data)
  } catch (err) {
    console.error('[parse-invoice]', err)
    const msg = err instanceof Error ? err.message : 'Error desconocido'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
