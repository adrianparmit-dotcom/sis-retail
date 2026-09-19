/**
 * A qué hora corresponde avisar por pantalla que entró un pedido de granel.
 *
 * Definido por Adrián el 18/09/2026: los pedidos que caen mientras el local
 * está cerrado no se avisan en el momento —no hay nadie— sino cuando vuelve a
 * haber gente. Un recuadro que aparece a las tres de la mañana no lo ve nadie y
 * encima se pierde, porque cuando llegan a la mañana ya no está en pantalla.
 *
 *   13:00 – 16:00  →  se avisa 16:15
 *   20:00 – 09:15  →  se avisa 09:15 (del día siguiente si entró de noche)
 *   el resto       →  se avisa al toque
 *
 * Esto corre en el servidor, al entrar el pedido, y el resultado se guarda en
 * `shuk_requerimientos.notificar_at`. No se recalcula en el navegador.
 */

/** Argentina. Vercel corre en UTC, así que la zona va explícita siempre. */
const ZONA = 'America/Argentina/Buenos_Aires'

const SIESTA_DESDE = 13 * 60          // 13:00
const SIESTA_HASTA = 16 * 60          // 16:00
const SIESTA_AVISO = 16 * 60 + 15     // 16:15

const NOCHE_DESDE  = 20 * 60          // 20:00
const MANIANA      =  9 * 60 + 15     // 09:15

interface ParedArg {
  anio: number
  mes: number
  dia: number
  minutosDelDia: number
}

/** La hora de pared en Argentina para un instante dado. */
function paredArgentina(instante: Date): ParedArg {
  // 'en-CA' da el año-mes-día en formato ISO, que es lo que hace parseable esto.
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    hour12  : false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(instante)

  const leer = (tipo: string) => Number(partes.find(p => p.type === tipo)?.value ?? '0')
  // A medianoche algunos runtimes devuelven la hora 24 en vez de 0.
  const hora = leer('hour') % 24

  return {
    anio         : leer('year'),
    mes          : leer('month'),
    dia          : leer('day'),
    minutosDelDia: hora * 60 + leer('minute'),
  }
}

/**
 * Cuántos milisegundos está Argentina adelante de UTC en ese instante.
 *
 * Se lee del runtime en vez de hardcodear −3 h: Argentina no cambia la hora
 * desde 2009, pero si algún día vuelve el horario de verano esto sigue dando
 * bien sin que haya que acordarse de este archivo.
 */
function desfasajeArgentina(instante: Date): number {
  const enZona = new Date(instante.toLocaleString('en-US', { timeZone: ZONA }))
  const enUtc  = new Date(instante.toLocaleString('en-US', { timeZone: 'UTC' }))
  return enZona.getTime() - enUtc.getTime()
}

/** El instante en que son las `minutosDelDia` de ese día argentino. */
function instanteArgentino(anio: number, mes: number, dia: number, minutosDelDia: number): Date {
  const comoSiFueraUtc = Date.UTC(anio, mes - 1, dia, 0, minutosDelDia)
  // Argentina va detrás de UTC, así que al restar el desfasaje (negativo) el
  // instante se corre para adelante, que es lo correcto.
  return new Date(comoSiFueraUtc - desfasajeArgentina(new Date(comoSiFueraUtc)))
}

/**
 * Cuándo avisar un pedido que entró en `entrada` (por defecto, ahora).
 *
 * Devuelve la misma `entrada` cuando hay que avisar en el momento, así quien
 * llama puede guardar el resultado sin preguntarse nada.
 */
export function horaDeAviso(entrada: Date = new Date()): Date {
  const { anio, mes, dia, minutosDelDia } = paredArgentina(entrada)

  // Cerrado al mediodía: se junta para la reapertura de la tarde.
  if (minutosDelDia >= SIESTA_DESDE && minutosDelDia < SIESTA_HASTA) {
    return instanteArgentino(anio, mes, dia, SIESTA_AVISO)
  }

  // Cerrado de noche. Si entró después de las 20 es para mañana a la mañana;
  // si entró de madrugada, el "mañana" es hoy mismo.
  if (minutosDelDia >= NOCHE_DESDE) {
    return instanteArgentino(anio, mes, dia + 1, MANIANA)
  }
  if (minutosDelDia < MANIANA) {
    return instanteArgentino(anio, mes, dia, MANIANA)
  }

  return entrada
}
