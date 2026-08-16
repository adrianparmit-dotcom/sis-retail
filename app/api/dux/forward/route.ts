/**
 * GET /api/dux/forward?path=/items&offset=0&limit=50&...
 * Internal proxy: forwards requests to Dux ERP API using Vercel's IPs.
 * Used by Supabase dux-sync Edge Function to avoid IP blocks.
 *
 * Auth: x-sync-secret header must match SYNC_SECRET env var.
 */

import { NextRequest } from 'next/server'

const DUX_BASE   = 'https://erp.duxsoftware.com.ar/WSERP/rest/services'
const DUX_TOKEN  = process.env.DUX_API_TOKEN ?? ''
const SYNC_SECRET = process.env.SYNC_SECRET ?? 'soho-internal-2026'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  // Accept secret via header OR query param (header may be stripped by some proxies)
  const secret = req.headers.get('x-sync-secret') ?? searchParams.get('_s') ?? ''
  if (!SYNC_SECRET || secret !== SYNC_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized', hint: 'x-sync-secret header or _s param required' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const path = searchParams.get('path') ?? ''
  if (!path || !path.startsWith('/')) {
    return new Response(JSON.stringify({ error: 'Missing path param' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const duxUrl = new URL(`${DUX_BASE}${path}`)
  searchParams.forEach((v, k) => {
    if (k !== 'path' && k !== '_s') duxUrl.searchParams.set(k, v)
  })

  // Dux tiene dos APIs con formatos de auth distintos:
  //   v1 (/items, /facturas, /compras) → token crudo
  //   v2 (/v2/...)                     → "Bearer <token>"
  // Mandar el crudo a v2 devuelve 401 NO_AUTORIZADO ("Token ausente o mal formado").
  const esV2 = path.startsWith('/v2/')
  const authHeader = esV2 ? `Bearer ${DUX_TOKEN}` : DUX_TOKEN

  // Timeout de 30s + 1 reintento: si Dux se cuelga, el consumidor (dux-sync)
  // no debe quedar bloqueado hasta el límite del runtime y perder la ventana.
  let duxRes: Response | null = null
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000))
    try {
      duxRes = await fetch(duxUrl.toString(), {
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(30_000),
      })
      if (duxRes.status < 500) break // 5xx de Dux: vale la pena reintentar
      lastError = `Dux respondió ${duxRes.status}`
    } catch (err) {
      duxRes = null
      lastError = err instanceof Error ? err.message : 'error de red'
    }
  }

  if (!duxRes) {
    return new Response(JSON.stringify({ error: 'Dux no responde', detail: lastError }), {
      status: 504, headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await duxRes.text()
  return new Response(body, {
    status: duxRes.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
