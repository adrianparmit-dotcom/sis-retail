export const SUCURSALES = {
  SOHO1_LOCAL:    'a0000000-0000-0000-0000-000000000001',
  SOHO1_PIEZA:    'a0000000-0000-0000-0000-000000000002',
  SOHO2_LOCAL:    'a0000000-0000-0000-0000-000000000003',
  SOHO2_DEPOSITO: 'a0000000-0000-0000-0000-000000000004',
} as const

export type SucursalId = typeof SUCURSALES[keyof typeof SUCURSALES]

export const SUCURSAL_LABELS: Record<string, string> = {
  [SUCURSALES.SOHO1_LOCAL]:    'SOHO 1 - Local',
  [SUCURSALES.SOHO1_PIEZA]:    'SOHO 1 - La Pieza',
  [SUCURSALES.SOHO2_LOCAL]:    'SOHO 2 - Local',
  [SUCURSALES.SOHO2_DEPOSITO]: 'SOHO 2 - Depósito',
}

export const SUCURSALES_OPERATIVAS = [
  { id: SUCURSALES.SOHO1_LOCAL,    nombre: 'SOHO 1 - Local' },
  { id: SUCURSALES.SOHO1_PIEZA,    nombre: 'SOHO 1 - La Pieza' },
  { id: SUCURSALES.SOHO2_LOCAL,    nombre: 'SOHO 2 - Local' },
  { id: SUCURSALES.SOHO2_DEPOSITO, nombre: 'SOHO 2 - Depósito' },
] as const

// Business rules
export const GONDOLA_MAX_UNITS    = 6   // Max units suggested for floor display
export const PAGE_SIZE            = 50  // Standard items per page
export const INVERSION_ALERTA_PESOS = 500_000

// Cobertura thresholds (days)
export const DIAS_COBERTURA = {
  CRITICA: 7,
  BAJA:    14,
  NORMAL:  30,
  ALTA:    60,
} as const

// Vencimiento state thresholds (days)
// Alineados con la vista v_vencimientos_fefo (fecha < hoy+N ⇒ dias_para_vencer < N).
// Si se cambian acá, hay que migrar la vista también.
export const DIAS_VENCIMIENTO = {
  CRITICO: 7,
  ALERTA:  30,
  PROXIMO: 90,
} as const

// Pedido mínimo de reactivación para productos sin stock y sin ventas 30d
export const REACTIVACION_UNIDADES = {
  GLOBAL:   4, // proveedor tipo 'global' (1 fila por producto)
  SUCURSAL: 2, // proveedor tipo 'sucursal' (por cada sucursal)
} as const

// Promotion workflow states (ordered)
export const PROMO_ESTADOS = [
  'propuesta',
  'preaprobada',
  'impacta_compras',
  'stock_recibido',
  'activa',
  'finalizada',
  'descartada',
] as const
export type PromoEstado = typeof PROMO_ESTADOS[number]

// ── Dux ERP ─────────────────────────────────────────────────────────
// Mapeo de sucursal propia → IDs de Dux usados en v2/compras.
// dux_deposito    = id_deposito (depósito físico en Dux)
// dux_sucursal_id = sucursal lógica de Dux (1 = SOHO 1, 3 = SOHO 2)
export const SUCURSALES_DUX: ReadonlyArray<{
  id: string
  nombre: string
  dux_deposito: number
  dux_sucursal_id: number
}> = [
  { id: SUCURSALES.SOHO1_LOCAL,    nombre: 'SOHO 1 - Local',    dux_deposito: 7951,  dux_sucursal_id: 1 },
  { id: SUCURSALES.SOHO1_PIEZA,    nombre: 'SOHO 1 - La Pieza', dux_deposito: 8545,  dux_sucursal_id: 1 },
  { id: SUCURSALES.SOHO2_LOCAL,    nombre: 'SOHO 2 - Local',    dux_deposito: 15289, dux_sucursal_id: 3 },
  { id: SUCURSALES.SOHO2_DEPOSITO, nombre: 'SOHO 2 - Depósito', dux_deposito: 15513, dux_sucursal_id: 3 },
]
