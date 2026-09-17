/**
 * POST /api/shuk-pedidos/aviso
 *
 * Dispara el WhatsApp a David y Adrián avisando que un pedido de granel quedó
 * armado, para que hagan el traslado interno de SOHO al depósito de Shuk.
 *
 * Existe para que el secreto NO salga al navegador: la pantalla llama acá, y
 * acá se le agrega `SYNC_SECRET` antes de llamar a la edge function `shuk-aviso`,
 * que es la que tiene el token de WhatsApp.
 *
 * A diferencia de `/api/shuk-pedidos/requerimiento`, esta ruta NO está en
 * PUBLIC_PATHS: la usan las chicas con su sesión iniciada.
 *
 * El aviso es best-effort: si falla, el pedido igual queda marcado como armado.
 * Un mensaje que no salió se ve en `shuk_requerimientos.aviso_estado` y se puede
 * reintentar; lo que no se puede es perder el trabajo de armado por un WhatsApp.
 */

import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SYNC_SECRET  = process.env.SYNC_SECRET ?? 'soho-internal-2026'

export async function POST(req: NextRequest) {
  let body: { requerimiento_id?: unknown }
  try {
    body = await req.json() as { requerimiento_id?: unknown }
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const id = String(body.requerimiento_id ?? '').trim()
  if (!id) return NextResponse.json({ error: 'Falta requerimiento_id' }, { status: 400 })
  if (!SUPABASE_URL) return NextResponse.json({ error: 'Falta NEXT_PUBLIC_SUPABASE_URL' }, { status: 503 })

  const url = `${SUPABASE_URL}/functions/v1/shuk-aviso?secret=${encodeURIComponent(SYNC_SECRET)}`

  let res: Response
  try {
    res = await fetch(url, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ requerimiento_id: id }),
    })
  } catch {
    return NextResponse.json({ error: 'No se pudo contactar al servicio de avisos.' }, { status: 502 })
  }

  const cuerpo = await res.json().catch(() => ({}))
  return NextResponse.json(cuerpo, { status: res.status })
}
