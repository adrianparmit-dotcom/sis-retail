/**
 * GET /api/dux/debug-personal
 * Temporary endpoint: fetches recent Dux v2/compras to find the id_personal
 * linked to the API token. DELETE after use.
 */
import { NextResponse } from 'next/server'

export const maxDuration = 60

const DUX_BASE  = 'https://erp.duxsoftware.com.ar/WSERP/rest/services'
const DUX_TOKEN = process.env.DUX_API_TOKEN ?? ''

export async function GET() {
  if (!DUX_TOKEN) return NextResponse.json({ error: 'no token' }, { status: 503 })

  const results: Record<string, unknown> = {}

  // Try v2/compras GET to find id_personal from existing records
  try {
    const url = new URL(`${DUX_BASE}/v2/compras`)
    url.searchParams.set('fecha_desde', '2026-01-01')
    url.searchParams.set('fecha_hasta', '2026-06-02')
    url.searchParams.set('id_sucursal', '3')
    url.searchParams.set('limit', '3')

    const r = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${DUX_TOKEN}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    })
    const text = await r.text()
    results['v2_compras'] = { status: r.status, body: text.slice(0, 2000) }
  } catch (e) { results['v2_compras'] = { error: (e as Error).message } }

  // Try v1/compras
  try {
    const url2 = new URL(`${DUX_BASE}/compras`)
    url2.searchParams.set('fecha_desde', '2026-01-01')
    url2.searchParams.set('fecha_hasta', '2026-06-02')
    url2.searchParams.set('limit', '2')

    const r2 = await fetch(url2.toString(), {
      headers: { 'Authorization': DUX_TOKEN, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    })
    const text2 = await r2.text()
    results['v1_compras'] = { status: r2.status, body: text2.slice(0, 2000) }
  } catch (e) { results['v1_compras'] = { error: (e as Error).message } }

  return NextResponse.json(results)
}
