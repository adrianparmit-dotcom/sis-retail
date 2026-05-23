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
export const DIAS_VENCIMIENTO = {
  CRITICO: 7,
  ALERTA:  15,
  PROXIMO: 30,
} as const

// Purchase recommendation tiers (ordered by urgency)
export const RECOMENDACION = {
  NO_COMPRAR:      'no_comprar',
  COMPRAR_POCO:    'comprar_poco',
  COMPRAR_NORMAL:  'comprar_normal',
  COMPRAR_URGENTE: 'comprar_urgente',
  COMPRA_CRITICA:  'compra_critica',
} as const
export type Recomendacion = typeof RECOMENDACION[keyof typeof RECOMENDACION]

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

export const DIAS_SEMANA        = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const
export const DIAS_SEMANA_LARGO  = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const
