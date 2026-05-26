/**
 * This route is no longer used — PDF parsing moved to client-side with pdfjs-dist.
 * Kept as placeholder to avoid 404 on old cached requests.
 */
import { NextResponse } from 'next/server'
export async function POST() {
  return NextResponse.json({ error: 'Use client-side PDF parsing' }, { status: 410 })
}
