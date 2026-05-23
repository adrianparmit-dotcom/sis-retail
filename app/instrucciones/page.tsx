'use client'

/**
 * /instrucciones
 * Instructivo para el personal — recepción de facturas de proveedores.
 * Escrito simple, como para alguien que recién empieza.
 */

import Link from 'next/link'
import { ArrowLeft, ChevronRight } from 'lucide-react'

interface Step {
  numero : number
  titulo : string
  icono  : string
  pasos  : string[]
  nota   ?: string
  warning?: string
}

const PASOS_RECEPCION: Step[] = [
  {
    numero: 1,
    icono : '📄',
    titulo: 'Abrí el PDF de la factura en la compu',
    pasos : [
      'Abrí el archivo PDF de la factura del proveedor (Diet, Ankas o EPN).',
      'Hacé clic adentro del PDF y presioná Ctrl+A para seleccionar todo el texto.',
      'Después presioná Ctrl+C para copiar.',
    ],
    nota  : 'Si no podés seleccionar el texto, el PDF está escaneado como imagen. Avisale a Adrian.',
  },
  {
    numero: 2,
    icono : '📋',
    titulo: 'Pegá el texto en el sistema',
    pasos : [
      'Entrá al sistema SOHO: Recepciones → Nueva recepción desde factura.',
      'En el cuadro grande de texto, hacé clic y presioná Ctrl+V para pegar.',
      'Elegí la sucursal destino (dónde va la mercadería).',
      'Hacé clic en el botón verde "Procesar factura".',
    ],
    nota  : 'Si la factura tiene varias páginas, copiá todo de una vez — el sistema las une automáticamente.',
  },
  {
    numero: 3,
    icono : '🔍',
    titulo: 'Revisá los productos',
    pasos : [
      'El sistema muestra una tabla con todos los productos de la factura.',
      'Los verdes ✅ son automáticos — no necesitás hacer nada.',
      'Los amarillos ⚠️ son coincidencias por nombre — verificá que sea el producto correcto.',
      'Los rojos ❌ no se encontraron — hacé clic en "+ Asignar producto" y buscalo manualmente.',
    ],
    warning: 'IMPORTANTE: los productos que dicen "Sin match" no van a registrar fecha de vencimiento. Siempre intentá asignarlos.',
  },
  {
    numero: 4,
    icono : '📦',
    titulo: 'Completá la cantidad recibida',
    pasos : [
      'Para cada producto, escribí cuántas unidades llegaron realmente.',
      'Si llegó todo lo que dice la factura, el número ya está cargado — no hagas nada.',
      'Si faltó algo, cambiá el número a la cantidad que realmente recibiste.',
    ],
    nota  : 'La diferencia entre la cantidad de la factura y lo que recibiste queda registrada automáticamente.',
  },
  {
    numero: 5,
    icono : '📅',
    titulo: 'Cargá la fecha de vencimiento',
    pasos : [
      'Para cada producto, hacé clic en "Seleccionar" en la columna de vencimiento.',
      'Elegí el año → el mes → el día que dice el producto.',
      'Si el producto no vence, no pongas fecha.',
    ],
    warning: 'Los vencimientos son MUY IMPORTANTES. Sin fecha, el sistema no puede avisarte cuando algo está por vencer.',
  },
  {
    numero: 6,
    icono : '🔷',
    titulo: 'Blisters: ingresá cuántas unidades hay por caja',
    pasos : [
      'Los productos que llegan en caja blister aparecen con un ícono 🔷 azul.',
      'En el campo "ud/caja" escribí cuántas unidades individuales hay dentro de cada caja.',
      'Por ejemplo: si un blister de barras tiene 12 barras adentro, escribí 12.',
    ],
    nota  : 'Después de confirmar, el sistema te va a recordar fraccionar estos productos en el área de Fraccionamiento.',
  },
  {
    numero: 7,
    icono : '✅',
    titulo: 'Confirmá la recepción',
    pasos : [
      'Cuando todo esté revisado, hacé clic en "Confirmar recepción →".',
      'El sistema guarda todo en SOHO, avisa a Dux y calcula los precios actualizados.',
      'Si hay precios para actualizar, aparece un botón para descargar un Excel.',
    ],
  },
  {
    numero: 8,
    icono : '💰',
    titulo: 'Subí el Excel de precios a Dux (si aparece)',
    pasos : [
      'Si el sistema detectó cambios de precio, descargá el archivo Excel.',
      'En Dux: Configuración → Artículos → Actualización masiva de precios.',
      'Subí el archivo Excel que descargaste.',
      'Confirmá en Dux.',
    ],
    nota  : 'Esto tarda menos de 2 minutos. Si no aparece el botón de Excel, es que los precios no cambiaron.',
  },
]

const ERRORES_COMUNES = [
  {
    problema : 'El PDF no me deja copiar el texto',
    solucion : 'El PDF está escaneado como imagen. Avisale a Adrian — puede que haya que procesarlo de otra manera.',
  },
  {
    problema : 'El sistema no reconoció ningún producto',
    solucion : 'Verificá que elegiste el proveedor correcto. Si el problema sigue, puede que el formato del PDF haya cambiado. Avisale a Adrian.',
  },
  {
    problema : 'Aparecieron productos que no existen',
    solucion : 'El parser a veces malinterpreta líneas de encabezado o totales. Si ves productos raros con precios muy altos o cantidades de 0, podés ignorarlos — dejalos con cantidad recibida = 0.',
  },
  {
    problema : 'Confirmé y apareció un error de Dux',
    solucion : 'La recepción se guardó en SOHO. Solo faltó registrarla en Dux automáticamente. Avisale a Adrian y mientras tanto cargala manualmente en Dux como siempre.',
  },
  {
    problema : 'No sé cuántas unidades tiene el blister',
    solucion : 'Mirá la caja o preguntale a la persona que hizo el pedido. Si no sabés, anotá 1 por ahora y avisale a Adrian para que lo configure correctamente.',
  },
]

export default function InstruccionesPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8 pb-20">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/" className="text-zinc-400 hover:text-zinc-700">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Cómo recibir una factura de proveedor</h1>
          <p className="text-zinc-500 text-sm mt-0.5">Guía paso a paso — todo lo que necesitás saber para procesar una factura</p>
        </div>
      </div>

      {/* Quick start */}
      <div className="rounded-xl bg-green-50 border border-green-200 px-5 py-4">
        <p className="text-green-800 font-semibold text-lg mb-1">⚡ Resumen rápido</p>
        <ol className="text-green-700 text-sm space-y-1 list-none">
          {['Abrí el PDF → Ctrl+A → Ctrl+C', 'Entrá al sistema → Recepciones → Nueva recepción desde factura → Ctrl+V', 'Revisá los productos (verdes = OK, rojo = buscar a mano)', 'Completá cantidades recibidas y fechas de vencimiento', 'Confirmá → descargá Excel de precios si aparece → subilo a Dux'].map((s, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="font-bold text-green-600 shrink-0">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <Link href="/recepciones/factura">
          <button className="mt-3 bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-1.5">
            Ir al proceso de recepción <ChevronRight size={15} />
          </button>
        </Link>
      </div>

      {/* Detailed steps */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-800 mb-4">Pasos detallados</h2>
        <div className="space-y-4">
          {PASOS_RECEPCION.map(s => (
            <div key={s.numero} className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 bg-zinc-50 border-b border-zinc-100">
                <span className="text-2xl">{s.icono}</span>
                <div>
                  <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Paso {s.numero}</span>
                  <h3 className="font-semibold text-zinc-800">{s.titulo}</h3>
                </div>
              </div>
              <div className="px-5 py-4 space-y-3">
                <ol className="space-y-2">
                  {s.pasos.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-zinc-700">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-zinc-100 text-zinc-500 text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ol>
                {s.nota && (
                  <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">
                    💡 <strong>Tip:</strong> {s.nota}
                  </div>
                )}
                {s.warning && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                    ⚠️ <strong>Importante:</strong> {s.warning}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Errores comunes */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-800 mb-4">Si algo sale mal...</h2>
        <div className="space-y-3">
          {ERRORES_COMUNES.map((e, i) => (
            <div key={i} className="rounded-xl border border-zinc-200 bg-white px-5 py-4">
              <p className="font-medium text-zinc-800 text-sm mb-1">❓ {e.problema}</p>
              <p className="text-sm text-zinc-600">→ {e.solucion}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer note */}
      <div className="rounded-xl bg-zinc-50 border border-zinc-200 px-5 py-4 text-sm text-zinc-600">
        <p className="font-semibold text-zinc-800 mb-1">📞 ¿Dudas o problemas?</p>
        <p>Si algo no funciona como esperás, no cambies ni borres nada — avisale a Adrian con una foto de la pantalla y del error que aparece.</p>
      </div>
    </div>
  )
}
