/**
 * Cliente de La Pyme — el ERP de la línea de granel de shuk.ar.
 *
 * OJO: no confundir con Dux. Son dos ERPs distintos y no se hablan entre sí.
 * Dux administra los locales de SOHO; La Pyme administra el ecommerce de Shuk.
 * Lo único que cruza de un lado al otro es el remanente de un bulto cuando cae
 * por debajo del kilo y pasa a góndola.
 *
 * Todas las llamadas van por /api/lapyme/*, que agrega la API key del lado del
 * servidor. La key nunca llega al navegador.
 */

/** Base de la API. El proxy la usa; el cliente no la toca. */
export const LAPYME_BASE = 'https://api.lapyme.com.ar/api/v1'

/**
 * Recursos que el proxy deja pasar. La API key ya está acotada por permisos
 * —no puede tocar pagos ni clientes— pero la lista corta el problema antes:
 * un bug en el front no puede llamar algo que no está acá.
 */
export const LAPYME_RECURSOS_PERMITIDOS = [
  'warehouses',
  'inventory',
  'products',
  'orders',
  'stock-movements',
  'stock-transfers',
  'sales',
  'purchases',
  'webhook-endpoints',
] as const

// ── Tipos ────────────────────────────────────────────────────────────

/** Toda respuesta de lista viene envuelta así. */
export interface LapymeLista<T> {
  data: T[]
  has_more: boolean
  next_cursor: string | null
  request_id: string
}

export interface LapymeError {
  code: string
  message: string
  retryable: boolean
  details?: { field: string; code: string; message: string }[]
}

export interface Deposito {
  id: string
  name: string
  is_default: boolean
  is_active: boolean
}

/**
 * El stock que devuelve La Pyme. Admite decimales —verificado el 02/09/2026
 * contra datos reales: hay existencias en 37.25 y 6.45— así que los kilos se
 * pueden llevar exactos, sin convertir a gramos.
 */
export interface StockLapyme {
  available: number
  on_hand: number
  reserved: number
  incoming: number
}

export interface ItemInventario {
  product_id: string
  variant_group_id: string | null
  product_name: string
  sku: string | null
  /** En centavos. Dividir por 100 para pesos. */
  cost: number
  /** En centavos. Dividir por 100 para pesos. */
  price: number
  product_type: string
  is_active: boolean
  option_names: string[]
  category: { id: string; name: string } | null
  stock: StockLapyme
}

/** El inventario no devuelve una lista plana: cuelga del depósito consultado. */
export interface RespuestaInventario {
  data: {
    warehouse: Deposito
    items: ItemInventario[]
  }
  has_more: boolean
  next_cursor: string | null
}

export interface Pedido {
  id: string
  number?: string | number
  status?: string
  created_at?: string
  customer?: { name?: string } | null
  total?: number
}

/** Una compra tal como la lista el ERP. Las líneas solo vienen en el detalle. */
export interface Compra {
  id: string
  supplier_invoice_number: string | null
  invoice_date: string
  /** En centavos. */
  total: number
  supplier: { id: string; name: string } | null
}

/**
 * Línea de una factura.
 *
 * `product` viene en null: la IA de La Pyme extrae el texto de la factura pero
 * no lo mapea al catálogo. El producto se asigna del lado de SOHO.
 */
export interface CompraItem {
  id: string
  name: string
  quantity: number
  /** En centavos. */
  unit_cost: number
  total: number
  product: { id: string; name: string; sku: string | null } | null
}

export interface CompraDetalle extends Compra {
  items: CompraItem[]
  /**
   * Si la compra ya movió stock en el ERP. En las facturas cargadas hasta ahora
   * viene 'none': cargar la factura NO toca el inventario, así que la habilitación
   * de venta desde SOHO no pisa nada que el ERP haya hecho antes.
   */
  inventory_effect: string
  products_received: boolean
  /** Para poder abrir el PDF original de la factura desde la pantalla. */
  document?: { status: string; url: string } | null
}

// ── Llamadas desde el navegador ──────────────────────────────────────

export class LapymeApiError extends Error {
  constructor(message: string, readonly status: number, readonly detalle?: string) {
    super(message)
    this.name = 'LapymeApiError'
  }
}

/**
 * Pide un recurso a La Pyme pasando por el proxy.
 * `recurso` es la parte de la ruta después de /api/v1 — por ejemplo
 * 'warehouses' o 'inventory'.
 */
export async function lapymeGet<T>(
  recurso: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v))
  const url = `/api/lapyme/${recurso}${qs.toString() ? `?${qs}` : ''}`

  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new LapymeApiError('No se pudo contactar a La Pyme.', 0)
  }

  const cuerpo = await res.json().catch(() => ({})) as Record<string, unknown>

  if (!res.ok) {
    const err = cuerpo.error as LapymeError | undefined
    // El 401 casi siempre es la key: vencida, rotada o sin el permiso del recurso.
    const msg = res.status === 401 || res.status === 403
      ? 'La Pyme rechazó la credencial. Revisá los permisos de la API key.'
      : err?.message ?? 'La Pyme devolvió un error.'
    const detalle = err?.details?.map(d => `${d.field}: ${d.message}`).join(' · ')
    throw new LapymeApiError(msg, res.status, detalle)
  }

  return cuerpo as T
}

/**
 * Trae TODAS las páginas de un recurso.
 *
 * La Pyme corta en 100 por página y devuelve `next_cursor`. Pedir una sola
 * página deja datos afuera sin avisar: el inventario son 356 ítems y la
 * pantalla mostraba los primeros 100 como si fueran todos.
 *
 * `extraer` hace falta porque las respuestas no tienen la misma forma: en
 * /products la lista cuelga de `data`, y en /inventory de `data.items`.
 */
export async function lapymeGetTodo<T>(
  recurso: string,
  extraer: (respuesta: Record<string, unknown>) => T[],
  params: Record<string, string | number> = {},
  maxPaginas = 40,
): Promise<T[]> {
  const out: T[] = []
  let cursor: string | null = null
  for (let i = 0; i < maxPaginas; i++) {
    const query: Record<string, string | number> = { ...params, limit: 100 }
    if (cursor) query.cursor = cursor
    const r: Record<string, unknown> = await lapymeGet<Record<string, unknown>>(recurso, query)
    out.push(...extraer(r))
    const siguiente = r.next_cursor
    cursor = typeof siguiente === 'string' ? siguiente : null
    if (r.has_more !== true || !cursor) break
  }
  return out
}

// ── Helpers de dominio ───────────────────────────────────────────────

/** La etiqueta con la que Shuk marca la línea de granel en La Pyme. */
export const TAG_GRANEL = 'GRANEL'

/** Un producto del catálogo. Solo los campos que se usan para filtrar. */
export interface ProductoLapyme {
  id: string
  name: string
  sku: string | null
  product_type: string
  category: { id: string; name: string } | null
  /** En centavos. Para el padre es el costo de UN kilo. */
  cost: number
  /** La API las manda como texto; se contempla objeto por si eso cambia. */
  tags: Array<string | { id?: string; name?: string }> | null
}

/** Un formato de venta de un producto de granel. */
export interface FormatoGranel {
  sku: string
  /** '1kg', '3kg', 'Bulto cerrado'. */
  etiqueta: string
  /** Kilos que lleva el formato. */
  kg: number
  /** Costo del formato, en pesos. */
  costo: number
}

/**
 * La línea de granel, separada en lo que mueve stock y lo que se vende.
 *
 * El **producto padre** (`product_type: 'product'`) es el que lleva el stock en
 * kilos y el único que se muestra en la pantalla de stock. Los **combos** son
 * los formatos de venta: se arman recién cuando entra el pedido, así que no
 * tienen stock propio.
 */
export interface CatalogoGranel {
  /** `product_id` de los padres — los que mueven stock. */
  padres: Set<string>
  /** `product_id` del padre → sus formatos, ordenados de menor a mayor. */
  formatos: Map<string, FormatoGranel[]>
}

/**
 * Cuántos kilos lleva un formato.
 *
 * Los numerados salen del sufijo del SKU (`GRA-009-3KG` → 3). El **bulto
 * cerrado** no lo dice en ningún lado, pero el costo de cada combo es múltiplo
 * exacto del costo por kilo del padre —verificado sobre los 19 productos el
 * 16/09/2026—, así que se deriva de ahí. Los bultos van de 4 kg (dátil) a 25 kg
 * (chía, coco, maíz); los importados vienen en libras: 11,34 kg el pistacho
 * (25 lb) y 22,68 kg la castaña (50 lb).
 */
function kgDelFormato(skuCombo: string, costoCombo: number, costoPadrePorKg: number): number {
  const m = /-(\d+)KG$/i.exec(skuCombo)
  if (m) return Number(m[1])
  if (costoPadrePorKg > 0) return costoCombo / costoPadrePorKg
  return 0
}

/**
 * Trae la línea de granel de La Pyme y la separa en padres y formatos.
 *
 * La etiqueta vive SOLO en /products: el inventario no la devuelve (verificado
 * el 16/09/2026 contra la API real), así que para saber qué mostrar hay que
 * cruzar las dos listas por `product_id`. Al 16/09/2026 son 93 de 356
 * productos: 19 padres y 74 formatos.
 */
export async function catalogoGranel(): Promise<CatalogoGranel> {
  const prods = await lapymeGetTodo<ProductoLapyme>(
    'products',
    r => (r.data as ProductoLapyme[] | undefined) ?? [],
  )

  const granel = prods.filter(p => {
    const tags = Array.isArray(p.tags) ? p.tags : []
    return tags.some(t => {
      const nombre = typeof t === 'string' ? t : (t?.name ?? '')
      return nombre.trim().toUpperCase() === TAG_GRANEL
    })
  })

  const padresPorSku = new Map<string, ProductoLapyme>()
  for (const p of granel) if (p.product_type === 'product' && p.sku) padresPorSku.set(p.sku, p)

  const formatos = new Map<string, FormatoGranel[]>()
  for (const c of granel) {
    if (c.product_type === 'product' || !c.sku) continue
    // 'GRA-009-3KG' y 'GRA-009-BC' cuelgan de 'GRA-009'.
    const skuPadre = c.sku.replace(/-(\d+KG|BC)$/i, '')
    const padre = padresPorSku.get(skuPadre)
    if (!padre) continue
    const lista = formatos.get(padre.id) ?? []
    lista.push({
      sku      : c.sku,
      etiqueta : /-BC$/i.test(c.sku) ? 'Bulto cerrado' : (/-(\d+)KG$/i.exec(c.sku)?.[1] ?? '?') + 'kg',
      kg       : kgDelFormato(c.sku, c.cost ?? 0, padre.cost ?? 0),
      costo    : centavosAPesos(c.cost ?? 0),
    })
    formatos.set(padre.id, lista)
  }
  for (const lista of formatos.values()) lista.sort((a, b) => a.kg - b.kg)

  return { padres: new Set([...padresPorSku.values()].map(p => p.id)), formatos }
}

/** Los importes vienen en centavos. */
export function centavosAPesos(centavos: number): number {
  return centavos / 100
}

/**
 * Cuántas unidades de un formato se pueden armar con los kilos disponibles.
 * Es piso, no redondeo: con 7 kg no se arman 2 paquetes de 5 aunque falte poco.
 */
export function unidadesPorFormato(kgDisponibles: number, kgDelFormato: number): number {
  if (kgDelFormato <= 0) return 0
  return Math.floor(kgDisponibles / kgDelFormato)
}
