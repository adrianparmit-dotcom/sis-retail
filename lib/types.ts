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

export interface LoteVencimiento {
  lote_id: string
  producto_id: string
  sku: string
  nombre: string | null
  categoria: string | null
  sucursal_id: string
  sucursal: string
  numero_lote: string
  deposito: string | null
  cantidad: number
  fecha_vencimiento: string | null
  origen: string | null
  updated_at: string | null
  dias_para_vencer: number | null
  estado: 'vencido' | 'critico' | 'alerta' | 'proximo' | 'ok' | 'sin_fecha'
}
