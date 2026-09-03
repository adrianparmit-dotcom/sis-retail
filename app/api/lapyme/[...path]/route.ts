/**
 * Proxy a la API de La Pyme.
 *
 * Existe para que LAPYME_API_KEY no salga nunca del servidor. El navegador
 * llama /api/lapyme/<recurso> y esta ruta le agrega el Bearer.
 *
 * Queda cubierto por el middleware de sesión: /api/lapyme no está en
 * PUBLIC_PATHS, así que sin login no se llega. La lista de recursos permitidos
 * es la segunda barrera — la API key ya está acotada por permisos, pero acá se
 * corta antes de salir a la red.
 */

import { NextRequest, NextResponse } from 'next/server'
import { LAPYME_BASE, LAPYME_RECURSOS_PERMITIDOS } from '@/lib/lapyme'

export const maxDuration = 30

const API_KEY = process.env.LAPYME_API_KEY ?? ''

function recursoPermitido(path: string[]): boolean {
  const raiz = path[0] ?? ''
  return (LAPYME_RECURSOS_PERMITIDOS as readonly string[]).includes(raiz)
}

/** Arma la URL de La Pyme conservando los query params del pedido original. */
function construirUrl(req: NextRequest, path: string[]): string {
  const url = new URL(`${LAPYME_BASE}/${path.join('/')}`)
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v))
  return url.toString()
}

function sinKey() {
  return NextResponse.json(
    { error: { code: 'NO_API_KEY', message: 'Falta LAPYME_API_KEY en el entorno.' } },
    { status: 503 },
  )
}

function recursoNoPermitido(raiz: string) {
  return NextResponse.json(
    { error: { code: 'RECURSO_NO_PERMITIDO', message: `El proxy no expone "${raiz}".` } },
    { status: 403 },
  )
}

/** Reenvía la respuesta de La Pyme tal cual, incluido el código de estado. */
async function responder(duxRes: Response): Promise<NextResponse> {
  const texto = await duxRes.text()
  let cuerpo: unknown
  try { cuerpo = JSON.parse(texto) } catch { cuerpo = { raw: texto } }
  return NextResponse.json(cuerpo, { status: duxRes.status })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (!API_KEY) return sinKey()
  const { path } = await params
  if (!recursoPermitido(path)) return recursoNoPermitido(path[0] ?? '')

  try {
    const res = await fetch(construirUrl(req, path), {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(25_000),
    })
    return responder(res)
  } catch {
    return NextResponse.json(
      { error: { code: 'SIN_RESPUESTA', message: 'La Pyme no respondió a tiempo.' } },
      { status: 504 },
    )
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (!API_KEY) return sinKey()
  const { path } = await params
  if (!recursoPermitido(path)) return recursoNoPermitido(path[0] ?? '')

  const cuerpo = await req.text()

  // La Pyme exige Idempotency-Key en toda mutación: si un reintento repite la
  // misma clave, no duplica el movimiento. Si el cliente no la manda, se genera
  // acá — vale para el reintento automático del fetch, no para dos clicks.
  const idem = req.headers.get('Idempotency-Key') ?? crypto.randomUUID()

  try {
    const res = await fetch(construirUrl(req, path), {
      method: 'POST',
      headers: {
        'Authorization' : `Bearer ${API_KEY}`,
        'Content-Type'  : 'application/json',
        'Accept'        : 'application/json',
        'Idempotency-Key': idem,
      },
      body: cuerpo,
      signal: AbortSignal.timeout(25_000),
    })
    return responder(res)
  } catch {
    return NextResponse.json(
      { error: { code: 'SIN_RESPUESTA', message: 'La Pyme no respondió a tiempo.' } },
      { status: 504 },
    )
  }
}
