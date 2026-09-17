/**
 * Etiqueta autoadhesiva de los paquetes de granel del ecommerce.
 *
 * Medida 100 × 150 mm, una etiqueta por página: es el tamaño de rollo estándar
 * de las Zebra (4 × 6 pulgadas), así que el PDF sale listo para mandar a la
 * impresora sin escalar. Imprimir "tamaño real" / 100%, sin ajustar a la hoja:
 * si la impresora reescala, el vencimiento deja de quedar donde tiene que estar.
 *
 * Lo que va en la etiqueta lo definió Adrián: nombre completo del producto tal
 * como figura, el formato, y el vencimiento. El vencimiento va grande porque es
 * lo que mira el cliente y lo que trae problemas si no se lee.
 */

/** Los datos de una etiqueta. Una etiqueta = un paquete. */
export interface EtiquetaGranel {
  /** Nombre completo del producto, tal cual viene de La Pyme. */
  nombre: string
  /** El formato armado: '1 kg', '3 kg', 'Bulto 11,34 kg'. */
  formato: string
  /** Vencimiento en ISO (YYYY-MM-DD). */
  vencimiento: string
  /** SKU del producto padre. Va chico, para poder rastrear el paquete. */
  sku?: string
}

const ANCHO = 100
const ALTO  = 150
const MARGEN = 8

/** 'YYYY-MM-DD' → '12/03/2027'. Sin Date de por medio: no hay zona horaria que corra el día. */
function fechaARg(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—')
}

/**
 * Genera el PDF y lo abre para imprimir. Una página por etiqueta.
 *
 * `copias` repite cada etiqueta: al fraccionar un bulto en 12 paquetes de 1 kg
 * hacen falta 12 etiquetas iguales, y nadie va a apretar el botón 12 veces.
 */
export async function generarEtiquetasGranel(
  etiquetas: EtiquetaGranel[],
  copias = 1,
): Promise<void> {
  if (etiquetas.length === 0) return

  // Import dinámico: el bundle de jspdf solo se baja cuando alguien imprime.
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [ANCHO, ALTO] })

  const paginas: EtiquetaGranel[] = []
  for (const e of etiquetas) {
    for (let c = 0; c < Math.max(1, copias); c++) paginas.push(e)
  }

  paginas.forEach((e, i) => {
    if (i > 0) pdf.addPage([ANCHO, ALTO], 'portrait')
    dibujarEtiqueta(pdf, e)
  })

  // Se abre en una pestaña con el diálogo de impresión: la operaria imprime y
  // cierra, sin archivos sueltos en Descargas.
  pdf.autoPrint()
  const url = pdf.output('bloburl')
  window.open(url, '_blank')
}

/** Descarga el PDF en vez de abrirlo. Para guardarlo o mandarlo por WhatsApp. */
export async function descargarEtiquetasGranel(
  etiquetas: EtiquetaGranel[],
  copias = 1,
  nombreArchivo = 'etiquetas-granel.pdf',
): Promise<void> {
  if (etiquetas.length === 0) return
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [ANCHO, ALTO] })

  const paginas: EtiquetaGranel[] = []
  for (const e of etiquetas) {
    for (let c = 0; c < Math.max(1, copias); c++) paginas.push(e)
  }
  paginas.forEach((e, i) => {
    if (i > 0) pdf.addPage([ANCHO, ALTO], 'portrait')
    dibujarEtiqueta(pdf, e)
  })
  pdf.save(nombreArchivo)
}

// deno-lint-ignore-file
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Dibuja una etiqueta en la página actual. */
function dibujarEtiqueta(pdf: any, e: EtiquetaGranel): void {
  const anchoUtil = ANCHO - MARGEN * 2

  // ── Marca ───────────────────────────────────────────────
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(13)
  pdf.setTextColor(20)
  pdf.text('SHUK', MARGEN, 14)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7.5)
  pdf.setTextColor(120)
  pdf.text('granel', MARGEN + 16, 14)

  pdf.setDrawColor(30)
  pdf.setLineWidth(0.6)
  pdf.line(MARGEN, 18, ANCHO - MARGEN, 18)

  // ── Producto ────────────────────────────────────────────
  // El nombre completo puede ser largo ("ALMENDRA NON PAREIL 27/30 CHIL"), así
  // que se achica la tipografía hasta que entre en cuatro renglones en vez de
  // cortarlo: el nombre es lo que identifica la bolsa.
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(10)
  let tam = 22
  let lineas: string[] = []
  for (; tam >= 12; tam -= 1) {
    pdf.setFontSize(tam)
    lineas = pdf.splitTextToSize(e.nombre.toUpperCase(), anchoUtil)
    if (lineas.length <= 4) break
  }
  let y = 32
  for (const l of lineas.slice(0, 4)) {
    pdf.text(l, MARGEN, y)
    y += tam * 0.42
  }

  // ── Formato ─────────────────────────────────────────────
  y = Math.max(y + 6, 62)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(120)
  pdf.text('FORMATO', MARGEN, y)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(20)
  pdf.setTextColor(20)
  pdf.text(e.formato, MARGEN, y + 10)

  // ── Vencimiento ─────────────────────────────────────────
  // Recuadro para que salte a la vista: es el dato que mira el cliente.
  const yCaja = 96
  pdf.setFillColor(242, 242, 242)
  pdf.setDrawColor(30)
  pdf.setLineWidth(0.8)
  pdf.rect(MARGEN, yCaja, anchoUtil, 34, 'FD')

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor(90)
  pdf.text('VENCIMIENTO', MARGEN + 5, yCaja + 10)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(28)
  pdf.setTextColor(10)
  pdf.text(fechaARg(e.vencimiento), MARGEN + 5, yCaja + 27)

  // ── Pie ─────────────────────────────────────────────────
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(140)
  if (e.sku) pdf.text(e.sku, MARGEN, ALTO - 8)
  pdf.text('shuk.ar', ANCHO - MARGEN, ALTO - 8, { align: 'right' })
}
