/**
 * POST /api/parse-pdf
 * Accepts a PDF file and returns extracted plain text.
 * Body: multipart/form-data with field "file" (PDF)
 */

import { NextRequest, NextResponse } from 'next/server'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse')

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 })
    if (!file.name.toLowerCase().endsWith('.pdf'))
      return NextResponse.json({ error: 'El archivo debe ser un PDF' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await pdfParse(buffer)
    return NextResponse.json({ text: result.text as string, pages: result.numpages as number })
  } catch (err) {
    console.error('[parse-pdf]', err)
    return NextResponse.json({ error: 'Error al leer el PDF' }, { status: 500 })
  }
}
