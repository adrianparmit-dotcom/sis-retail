/**
 * Reenvío de una recepción ya confirmada a Dux.
 *
 * La pantalla de carga de factura arma el payload desde su estado en memoria y
 * ofrece un "Reintentar" que solo vive mientras no salgas de esa pantalla. Si la
 * operaria cerraba la página, la recepción quedaba marcada "Falló Dux" para
 * siempre y no había forma de reenviarla (ago-2026: 10 recepciones así).
 *
 * Acá el payload se reconstruye desde la base, así que se puede reintentar
 * cuando sea y desde donde sea. El schema exacto que espera Dux (nombre completo
 * del comprobante, formato del número, campos de cada línea) lo resuelve
 * /api/dux/compras, que es el punto único: este módulo solo junta los datos.
 */

import { supabase } from '@/lib/supabase'
import { SUCURSALES_DUX } from '@/lib/constants'

export type LetraComprobante = 'A' | 'B' | 'C' | 'X'

/**
 * Cómo nombra Dux cada comprobante al registrar la compra.
 *
 * El tipo es `FACTURA` a secas, SIN la letra. Dux no tiene un tipo por letra:
 * la letra viaja adentro del número (ver `nroComprobanteDux`). Mandar
 * "FACTURA A" devuelve 400 "Comprobante no reconocido" — es lo que venía
 * haciendo la app y por lo que ninguna compra llegó nunca al ERP.
 *
 * Comprobado sobre las 200 compras reales de la empresa 4065: los únicos
 * tipos que existen son FACTURA (14), COMPROBANTE_COMPRA (185) y
 * NOTA_CREDITO (1).
 *
 * Los documentos X —remitos y comprobantes internos que no se envían a AFIP—
 * no son facturas: en Dux figuran como COMPROBANTE_COMPRA, que es el tipo con
 * el que ya se cargan a mano hoy.
 */
export function tipoComprobanteDux(letra: LetraComprobante): string {
  return letra === 'X' ? 'COMPROBANTE_COMPRA' : 'FACTURA'
}

/**
 * Número de comprobante en el formato del ERP: `LETRA-PPPPP-NNNNNNNN`.
 *
 * Dux no tiene un tipo por letra: guarda `tipo_comp = "FACTURA"` y la letra
 * viaja adentro del número. Verificado contra las 14 facturas reales del ERP
 * (A-00001-00005118, A-00007-00014797, …). Mandar la letra en el tipo devuelve
 * 400 "Comprobante no reconocido".
 */
export function nroComprobanteDux(nro: string, letra: LetraComprobante): string {
  const limpio = (nro ?? '').trim().replace(/\s+/g, '')
  // Si ya viene con letra adelante, se respeta la que trae.
  const conLetra = /^([ABCEM])-?(\d.*)$/.exec(limpio)
  const cuerpo   = conLetra ? conLetra[2] : limpio
  const partes   = /^(\d{1,5})-(\d{1,8})$/.exec(cuerpo)
  if (!partes) return limpio
  const numero = `${partes[1].padStart(5, '0')}-${partes[2].padStart(8, '0')}`
  // Los documentos X no son fiscales y no llevan letra.
  const letraFinal = conLetra?.[1] ?? (letra === 'X' ? null : letra)
  return letraFinal ? `${letraFinal}-${numero}` : numero
}

/**
 * Si el comprobante discrimina IVA, y por lo tanto si el costo de la línea
 * viene neto y hay que sumarle el IVA para llegar al costo real.
 *
 * Solo la Factura A lo discrimina. En B y C el IVA ya está adentro del importe
 * (el proveedor no lo separa) y en X no hay IVA que sumar: en los tres casos
 * agregarlo otra vez inflaría el precio de venta un 21%.
 */
export function discriminaIva(letra: LetraComprobante): boolean {
  return letra === 'A'
}

export type ReenvioResultado =
  | { ok: true }
  | { ok: false; motivo: string; detalle?: string }

interface RecepcionRow {
  id: string
  sucursal_id: string | null
  proveedor_nombre: string | null
  numero_comprobante: string | null
  fecha_factura: string | null
  comprobante_letra: string | null
  remito_numero: string | null
}

interface ItemRow {
  id: string
  producto_id: string | null
  sku: string | null
  es_granel: boolean | null
  cantidad_esperada: number | null
  cantidad_recibida: number | null
  costo_unitario: number | null
  iva_porcentaje: number | null
  sin_factura: boolean | null
}

/** Una línea ya lista para el payload de Dux. */
interface LineaDux {
  id_item          : string
  cantidad         : number
  precio_unitario  : number
  iva_porcentaje   : number
  cantidad_recibida: number
}

/**
 * Gramos que trae una unidad vendida. `unidad_medida` numérico = gramos;
 * `'kg'` = 1000. Mismo criterio que usa Fraccionamiento para el progreso.
 */
function gramosPorUnidad(unidad: string | null): number {
  if (!unidad) return 0
  if (unidad.trim().toLowerCase() === 'kg') return 1000
  return Number(unidad) || 0
}

/** Deja constancia del intento en la recepción, igual que la pantalla de carga. */
async function marcarSync(
  recepcionId: string,
  estado: 'ok' | 'error' | 'omitida',
  detalle?: string,
): Promise<void> {
  await supabase.from('recepciones').update({
    dux_sync_estado : estado,
    dux_sync_at     : new Date().toISOString(),
    dux_sync_detalle: detalle ?? null,
  }).eq('id', recepcionId)
}

/**
 * Resuelve el proveedor de Dux con la misma prioridad que usa la pantalla de
 * carga: primero el ID configurado a mano en /compras/proveedores, y si no hay,
 * el proveedor_id_dux más frecuente entre los productos de la factura (cubre a
 * los distribuidores que traen varias marcas).
 */
async function resolverProveedorDux(
  proveedorNombre: string | null,
  productoIds: string[],
): Promise<number | null> {
  if (proveedorNombre) {
    const { data } = await supabase.from('proveedores_config')
      .select('dux_proveedor_id')
      .ilike('nombre', `%${proveedorNombre}%`)
      .not('dux_proveedor_id', 'is', null)
      .limit(1)
      .maybeSingle()
    const id = (data as { dux_proveedor_id: number } | null)?.dux_proveedor_id
    if (id) return id
  }

  if (productoIds.length === 0) return null
  const { data: prods } = await supabase.from('productos')
    .select('proveedor_id_dux')
    .in('id', productoIds)
    .not('proveedor_id_dux', 'is', null)

  const freq = new Map<number, number>()
  for (const p of (prods ?? []) as { proveedor_id_dux: number }[]) {
    freq.set(p.proveedor_id_dux, (freq.get(p.proveedor_id_dux) ?? 0) + 1)
  }
  if (freq.size === 0) return null
  return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

/**
 * Rearma la compra desde la base y la manda a Dux. Marca el resultado en la
 * recepción, así que el estado de la lista queda al día sin recargar nada.
 *
 * `letra` pisa la guardada en la recepción; sirve para las recepciones viejas,
 * anteriores a que se persistiera comprobante_letra.
 */
export async function reenviarCompraADux(
  recepcionId: string,
  letra?: LetraComprobante,
): Promise<ReenvioResultado> {
  const { data: recRaw, error: recErr } = await supabase.from('recepciones')
    .select('id,sucursal_id,proveedor_nombre,numero_comprobante,fecha_factura,comprobante_letra,remito_numero')
    .eq('id', recepcionId)
    .maybeSingle()

  if (recErr || !recRaw) {
    return { ok: false, motivo: 'No se pudo leer la recepción.' }
  }
  const rec = recRaw as RecepcionRow

  const sucursal = SUCURSALES_DUX.find(s => s.id === rec.sucursal_id)
  if (!sucursal) {
    return { ok: false, motivo: 'La recepción no tiene una sucursal válida asignada.' }
  }
  if (!rec.fecha_factura) {
    return { ok: false, motivo: 'La recepción no tiene fecha de factura.' }
  }

  const { data: itemsRaw } = await supabase.from('recepcion_items')
    .select('producto_id,sku,es_granel,cantidad_esperada,cantidad_recibida,costo_unitario,iva_porcentaje,sin_factura')
    .eq('recepcion_id', recepcionId)

  const items = (itemsRaw ?? []) as ItemRow[]

  // El granel queda afuera igual que en la carga: el bulto madre no existe como
  // producto en el ERP y en qué se fracciona se decide días después.
  const lineas = items.filter(i =>
    !i.es_granel && i.sku && Number(i.cantidad_esperada) > 0 && Number(i.costo_unitario) > 0
  )

  if (lineas.length === 0) {
    const motivo = 'Ningún ítem sirve para Dux: hacen falta SKU, cantidad y costo mayores a cero.'
    await marcarSync(recepcionId, 'omitida', motivo)
    return { ok: false, motivo }
  }

  const provId = await resolverProveedorDux(
    rec.proveedor_nombre,
    items.map(i => i.producto_id).filter((id): id is string => Boolean(id)),
  )
  if (!provId) {
    const motivo = 'No se pudo determinar el proveedor en Dux. Configuralo en Compras → Proveedores, campo "ID Dux".'
    await marcarSync(recepcionId, 'omitida', motivo)
    return { ok: false, motivo }
  }

  const letraFinal = letra ?? (rec.comprobante_letra as LetraComprobante | null) ?? 'A'

  /**
   * Una entrega puede necesitar DOS comprobantes.
   *
   * Hay proveedores (Sedran) que mandan un remito con TODA la mercadería a
   * precio neto y una factura por solo una parte. Lo facturado ya está adentro
   * del remito. Los renglones marcados `sin_factura` salen aparte, como
   * COMPROBANTE_COMPRA con el número de remito, sin letra y con IVA 0: mandarlos
   * junto con la factura les aplicaría un IVA que no se pagó.
   */
  const armarPayload = (ls: ItemRow[], nro: string, l: LetraComprobante) => ({
    id_sucursal     : sucursal.dux_sucursal_id,
    id_proveedor    : provId,
    id_deposito     : sucursal.dux_deposito,
    fecha           : rec.fecha_factura,
    nro_comprobante : nroComprobanteDux(nro, l) || 'S/N',
    tipo_comprobante: tipoComprobanteDux(l),
    productos: ls.map(i => ({
      id_item          : i.sku!,
      cantidad         : Number(i.cantidad_esperada),
      precio_unitario  : Number(i.costo_unitario),
      iva_porcentaje   : l === 'X' ? 0 : Number(i.iva_porcentaje),
      cantidad_recibida: Number(i.cantidad_recibida ?? i.cantidad_esperada),
    })),
  })

  const conFactura = lineas.filter(i => !i.sin_factura)
  const sinFactura = lineas.filter(i =>  i.sin_factura)
  const nroRemito  = (rec.remito_numero ?? '').trim()

  const envios: Array<{ etiqueta: string; payload: ReturnType<typeof armarPayload> }> = []
  if (conFactura.length > 0) {
    envios.push({
      etiqueta: `factura ${rec.numero_comprobante ?? 'S/N'}`,
      payload : armarPayload(conFactura, rec.numero_comprobante ?? '', letraFinal),
    })
  }
  if (sinFactura.length > 0) {
    // Sin número de remito no se manda: quedaría un comprobante 'S/N' en Dux,
    // imposible de cruzar contra el papel y colisionable con cualquier otro.
    if (!nroRemito) {
      const motivo = `${sinFactura.length} ítems marcados "sin factura" no se pueden mandar: falta el número de remito en la recepción.`
      await marcarSync(recepcionId, 'error', motivo)
      return { ok: false, motivo }
    }
    envios.push({
      etiqueta: `remito ${nroRemito}`,
      payload : armarPayload(sinFactura, nroRemito, 'X'),
    })
  }

  const fallidos: string[] = []
  let ultimoFallo: { res: Response; payload: ReturnType<typeof armarPayload> } | null = null
  for (const envio of envios) {
    let res: Response
    try {
      res = await fetch('/api/dux/compras', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify(envio.payload),
      })
    } catch {
      // Sin respuesta de Dux no sabemos si la compra entró o no, así que no se
      // toca dux_sync_estado: pisarlo con 'error' podría tapar un envío que sí
      // llegó y llevar a cargarla dos veces.
      return { ok: false, motivo: 'No se pudo contactar a Dux. Probá de nuevo en un rato.' }
    }
    if (!res.ok) { fallidos.push(envio.etiqueta); ultimoFallo = { res, payload: envio.payload } }
  }

  if (fallidos.length === 0) {
    await marcarSync(recepcionId, 'ok')
    return { ok: true }
  }

  const { res, payload } = ultimoFallo!

  const e = await res.json().catch(() => ({})) as Record<string, unknown>
  const duxResp = e.dux_response as Record<string, unknown> | null | undefined
  const mensaje = (duxResp?.error as Record<string, unknown>)?.mensaje as string
               ?? (duxResp?.mensaje as string)
               ?? (e.error as string)
               ?? 'error desconocido'
  // Con dos comprobantes en juego hay que decir cuál falló: si entró la factura
  // y no el remito, reintentar a ciegas duplicaría la factura.
  const motivo = `Dux ${res.status}: ${mensaje} (${fallidos.join(', ')})`

  const enviados = (e.payload_sent as { productos?: unknown[] } | undefined)?.productos
  const detalle = Array.isArray(enviados)
    ? `${enviados.length} ítems enviados · comprobante ${payload.nro_comprobante} · ${payload.tipo_comprobante}`
    : undefined

  await marcarSync(recepcionId, 'error', motivo)
  return { ok: false, motivo, detalle }
}

/**
 * Cómo se compara un número de comprobante para saber si es el mismo papel.
 *
 * `0001-90153823` y `00001-90153823` son la MISMA factura de Karen Previotto, y
 * así entraron dos veces a Dux. Se saca la letra de adelante y los ceros a la
 * izquierda de cada tramo, que es lo único que cambia según quién la tipeó.
 */
export function claveComprobante(nro: string | null | undefined): string {
  return String(nro ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^[A-Z]-/, '')
    .split('-')
    .map(p => p.replace(/^0+/, ''))
    .join('-')
}

export interface RecepcionPrevia {
  id                : string
  proveedor_nombre  : string | null
  numero_comprobante: string | null
  fecha_factura     : string | null
  total_factura     : number | null
  dux_sync_estado   : string | null
  dux_sync_at       : string | null
}

/**
 * Recepciones anteriores que ya mandaron ESTE comprobante a Dux.
 *
 * Existe porque la app dejaba cargar dos veces la misma factura sin decir nada.
 * Entre agosto y septiembre de 2026 pasó tres veces —Sedran, Karen Previotto y
 * Shuk— por $429.137,16 de deuda que no existía, y hubo que borrarlas a mano
 * del ERP porque la API de Dux **no tiene endpoint para borrar una compra**:
 * el módulo Compras solo expone listar y registrar. Todo lo que entra, queda.
 *
 * ⚠️ NO se filtra por proveedor. Las dos veces que se duplicó, el nombre estaba
 * escrito distinto en cada carga (`Algo Dulce` / `KAREN PREVIOTTO`, `Shuk S.R.L`
 * / `SHUK SRL`): filtrar por proveedor habría dejado pasar justo los casos que
 * esto tiene que atajar. Se compara por número y se le muestra a la operaria
 * quién y cuánto, que es lo que le permite decidir.
 *
 * Solo cuenta lo que Dux aceptó (`ok`): una recepción que falló o se omitió no
 * dejó nada en el ERP y volver a mandarla es exactamente lo que se quiere.
 */
export async function recepcionesConMismoComprobante(
  nroComprobante: string,
  excluirId?: string | null,
): Promise<RecepcionPrevia[]> {
  const clave = claveComprobante(nroComprobante)
  if (!clave) return []

  const { data, error } = await supabase
    .from('recepciones')
    .select('id, proveedor_nombre, numero_comprobante, fecha_factura, total_factura, dux_sync_estado, dux_sync_at')
    .eq('dux_sync_estado', 'ok')
    .not('numero_comprobante', 'is', null)
    .order('dux_sync_at', { ascending: false })
    .limit(1000)

  // Si la consulta falla NO se inventa "no hay duplicados": se deja pasar y que
  // decida la operaria, pero el error sube para que se vea. Bloquear una
  // recepción por un problema de red sería peor que el duplicado.
  if (error) throw error

  return (data ?? [])
    .filter(r => r.id !== excluirId && claveComprobante(r.numero_comprobante) === clave)
}
