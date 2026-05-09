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
  sugerencia_compra: number
  inversion_sugerida: number
  dux_sync_at: string | null
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
