export interface ProductoCompra {
  id: string
  sku: string
  nombre: string | null
  categoria: string | null
  sub_categoria: string | null
  marca: string | null
  costo: number | null
  precio_venta: number | null
  iva_porcentaje: number | null
  stock_actual: number
  stock_soho1: number
  stock_soho2: number
  ventas_7d: number
  ventas_30d: number
  ventas_90d: number
  vel_diaria: number
  dias_cobertura: number
  frecuencia_proveedor: number
  moq: number
  multiplo: number
  lead_time_dias: number
  costo_estimado: number | null
  // Intelligent buyer algorithm fields
  demanda_estimada: number
  necesidad_base: number
  compra_calculada: number
  vida_util_promedio: number | null
  cobertura_maxima: number | null
  qty_max_vencimiento: number | null
  tiene_quiebre: boolean
  motivos: string | null
  nivel_confianza: 'alto' | 'medio' | 'bajo' | 'sin_datos'
  sugerencia_compra: number
  es_granel: boolean
  sugerencia_kg: number | null
  inversion_sugerida: number
  dux_sync_at: string | null
  proveedor_nombre: string | null
  location_id: string | null
  location_nombre: string | null
}

// Used by v_vencimientos_fefo
export interface Vencimiento {
  lote_id: string
  producto_id: string
  sku: string
  nombre: string | null
  categoria: string | null
  sucursal_id: string
  sucursal: string
  origen: string | null
  cantidad: number
  fecha_vencimiento: string | null
  updated_at: string | null
  dias_para_vencer: number | null
  estado: 'vencido' | 'critico' | 'alerta' | 'proximo' | 'ok' | 'sin_fecha'
}

// Keep old name as alias for backward compat in compras page
export type LoteVencimiento = Vencimiento & { numero_lote: string; deposito: string | null }

export interface ProductoStock {
  id: string
  sku: string
  nombre: string | null
  categoria: string | null
  stock_dux: number
  codigo_barras: string | null
}

export interface ReconciliacionItem {
  producto_id: string
  sku: string
  nombre: string | null
  categoria: string | null
  stock_dux: number
  cantidad_vencimientos: number
  num_registros: number
  diferencia: number
  estado_reconciliacion: 'ok' | 'sin_carga' | 'faltante' | 'exceso'
}

export interface Recepcion {
  id: string
  numero_comprobante: string | null
  dux_compra_id: string | null
  proveedor_nombre: string | null
  fecha_factura: string | null
  fecha_recepcion: string | null
  estado: string
  sucursal_id: string | null
  operador: string | null
  observaciones: string | null
  texto_original: string | null
  created_at: string
}

export interface RecepcionItem {
  id: string
  recepcion_id: string
  producto_id: string | null
  sku: string
  nombre_producto: string | null
  cantidad_esperada: number
  cantidad_recibida: number | null
  fecha_vencimiento: string | null
  estado: string
  observacion: string | null
}

export interface ParsedInvoiceItem {
  codigo: string
  descripcion: string
  cantidad: number
  precio_unitario: number
  // matched from DB
  producto_id?: string
  nombre_app?: string | null
  // form fields (mutable during review)
  cantidad_recibida: number
  fecha_vencimiento: string
  estado_recepcion: 'ok' | 'faltante' | 'extra' | 'vencido_llegada'
}

export interface ParsedInvoice {
  comprobante: string
  fecha: string
  proveedor: string
  items: ParsedInvoiceItem[]
}

// ─── Invoice reception (PDF-based) ───────────────────────────────

export type MatchConfidence = 'exacto' | 'sku_map' | 'nombre' | 'manual' | 'sin_match'
export type EstadoRecepcion = 'ok' | 'faltante' | 'extra' | 'vencido_llegada'
export type ProveedorType   = 'diet' | 'ankas' | 'epn' | 'otro'

export interface GranelDerivado {
  producto_id        : string
  producto_sku       : string
  producto_nombre    : string | null
  cantidad_objetivo ?: number       // optional: target units to produce of this final SKU
}

export interface Lote {
  cantidad         : number
  fecha_vencimiento: string         // YYYY-MM-DD ('' if unknown)
  numero_lote     ?: string
}

export interface InvoiceLineItem {
  // DB primary key in recepcion_items (set once persisted as part of a borrador).
  // Lets us do per-item upserts instead of delete+reinsert, which is what makes
  // live multi-user collaboration possible.
  recepcion_item_id    ?: string

  // From supplier invoice
  sku_proveedor         : string      // supplier code or barcode
  descripcion_proveedor : string      // supplier description
  cantidad              : number      // qty on invoice
  costo_unitario        : number      // net unit cost after bonification (IMPORTE / CANT)
  iva_porcentaje        : number      // 21 or 10.5
  precio_venta_sugerido : number      // costo_unitario × (1 + margen) — filled after matching

  // Matched product in SOHO OS (single match — for non-granel items)
  producto_id           ?: string
  producto_sku          ?: string
  producto_nombre       ?: string
  producto_precio_actual?: number
  producto_id_dux       ?: number     // proveedor_id_dux from productos table
  match_confidence      : MatchConfidence

  // User fills during review
  cantidad_recibida : number          // when lotes is empty: editable; when not: derived sum of lotes
  fecha_vencimiento : string          // YYYY-MM-DD — single-lot legacy field, ignored when `lotes` has entries
  estado_recepcion  : EstadoRecepcion

  // Múltiples lotes con sus propias fechas/cantidades (FEFO).
  // Empty array → single-lot mode (use fecha_vencimiento + cantidad_recibida directly).
  // Non-empty → multi-lot mode (cantidad_recibida derives from sum of lotes.cantidad).
  lotes : Lote[]

  // Set when the supplier description on this invoice differs from the one saved
  // in proveedor_sku_map for the same sku_proveedor. UI shows a ⚠️ icon with tooltip.
  descripcion_anterior?: string

  // Blister / fraccionamiento
  es_blister          : boolean
  unidades_por_blister: number        // how many individual units per blister box

  // Transferencia interna S2 → S1 (opcional, 0 = sin transferencia)
  transferir_cantidad?: number

  // Granel (bulk by weight) — 1 supplier item → N final SKUs.
  // When es_granel = true, use `derivados` instead of producto_id.
  // Reception saved as draft; quantities updated as fractionation happens.
  // Vencimientos NOT created at confirmation — fraccionamiento creates them.
  es_granel : boolean
  derivados?: GranelDerivado[]
}

export interface ParsedFactura {
  proveedor_nombre  : string
  proveedor_type    : ProveedorType
  nro_comprobante   : string
  fecha             : string          // DD/MM/YYYY from invoice
  items             : InvoiceLineItem[]
}

export interface SkuMapEntry {
  id                   : string
  proveedor_nombre     : string
  sku_proveedor        : string
  descripcion_proveedor: string | null
  producto_id          : string | null
}

export interface ReposicionItem {
  producto_id: string
  sku: string
  nombre: string | null
  categoria: string | null
  stock_dux: number
  soho1_local: number
  soho1_pieza: number
  soho2_local: number
  soho2_deposito: number
  ventas_prom_dia: number
}
