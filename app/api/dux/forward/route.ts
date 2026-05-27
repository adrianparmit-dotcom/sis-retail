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
  const secret = req.headers.get('x-sync-secret') ?? ''
  if (!SYNC_SECRET || secret !== SYNC_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { searchParams } = new URL(req.url)
  const path = searchParams.get('path') ?? ''
  if (!path || !path.startsWith('/')) {
    return new Response(JSON.stringify({ error: 'Missing path param' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const duxUrl = new URL(`${DUX_BASE}${path}`)
  searchParams.forEach((v, k) => {
    if (k !== 'path') duxUrl.searchParams.set(k, v)
  })

  const duxRes = await fetch(duxUrl.toString(), {
    headers: { 'Authorization': DUX_TOKEN, 'Accept': 'application/json' },
  })

  const body = await duxRes.text()
  return new Response(body, {
    status: duxRes.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
