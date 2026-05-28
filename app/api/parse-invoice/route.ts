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

REGLAS DE EXTRACCIÓN:

1. Estructura de ítems
   - Cada ítem real tiene UN código, UNA descripción y UNA cantidad asociada
   - Las facturas suelen distribuir un ítem en varias líneas físicas (descripción larga, subcategoría, sub-detalle entre paréntesis): unificalas en UN solo objeto
   - Si una línea no tiene cantidad ni precio, es continuación de la línea anterior — concatenala al campo "descripcion"

2. Costo unitario y bonificaciones
   - costo_unitario = importe NETO unitario después de aplicar bonificaciones, SIN IVA
   - Si la factura tiene columnas "Importe Bonif" y "Importe": usá el "Importe" final / cantidad
   - Si la factura aplica un % de bonificación implícito (ej: "0,26 0,00 28.867,35"), tomá el "Importe" final como verdad
   - NO sumes IVA al costo_unitario — eso lo calcula el sistema

3. IVA por ítem
   - Si la factura discrimina IVA por ítem, usá ese valor
   - Diet/Mayordiet: ítems que arrancan con ** son 10.5%, el resto 21%
   - Si no podés determinar, dejá 21
   - Devolvé el número (21 o 10.5), no string

4. Detección de bonificaciones encubiertas (CRÍTICO)
   - Algunos proveedores meten "regalos" como ítems con precio muy bajo (ej: si un SKU vale $9.000 normalmente y aparece otra línea del MISMO SKU a $850, es bonificación)
   - INCLUILOS en la lista pero con su precio real (no los descartes), las chicas los van a marcar manualmente

5. Códigos
   - Pueden ser EAN13 (13 dígitos), códigos internos (alfanuméricos con guiones como "GEO-VIT-C", "Ultratech-508-combo"), o números cortos (ej: "261", "3548")
   - Usá el código tal cual aparece en la primera columna del ítem
   - Si la primera columna está vacía, dejá "codigo" como ""

6. Combos / packs
   - Si el ítem es un combo (ej: "caja x 12 unidades", "Ultratech-XXX-combo"), tratalo como UN solo ítem
   - NO desgloses los componentes internos del combo en ítems separados (aunque aparezcan en sub-detalle)

7. Texto a IGNORAR (no son ítems)
   - "Transporte: XXX", "Continua en: X", "Hoja X de Y"
   - "Subtotal", "Total", "IVA", "Bonificación", "Recargo", "Otros Impuestos"
   - Cabeceras repetidas en cada página (datos del proveedor, CUIT, dirección)
   - Pie de factura: "Recibimos:", "Medios de pago:", "CAE N°:", "Fecha de Vto.:"
   - Datos del cliente (SHUK SRL, etc.)
   - Tablas de discriminación de impuestos al pie ("I.V.A. 21,00 %", "Base imp.", etc.)

8. Formato de números
   - Argentina: punto separador de miles, coma decimal ("14.471,0744" = 14471.0744)
   - "2,00" = 2 (cantidad), "9.012,3967" = 9012.3967 (precio)
   - Devolvé números, no strings

9. Descripciones
   - Reemplazá comillas internas por (") para no romper el JSON
   - Sin saltos de línea, todo en una sola línea
   - Si la descripción está partida en varias líneas, juntalas con espacios`

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
      model     : 'claude-opus-4-7',
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
