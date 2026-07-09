import { DIAS_VENCIMIENTO } from './constants'

export type EstadoVencimiento = 'vencido' | 'critico' | 'alerta' | 'proximo' | 'ok' | 'sin_fecha'

/**
 * Estado de un vencimiento según los días que faltan.
 * Misma lógica que la vista v_vencimientos_fefo — si se cambia acá,
 * hay que migrar la vista para que los estados no diverjan tras recargar.
 */
export function estadoVencimiento(diasParaVencer: number | null): EstadoVencimiento {
  if (diasParaVencer == null) return 'sin_fecha'
  if (diasParaVencer < 0) return 'vencido'
  if (diasParaVencer < DIAS_VENCIMIENTO.CRITICO) return 'critico'
  if (diasParaVencer < DIAS_VENCIMIENTO.ALERTA) return 'alerta'
  if (diasParaVencer < DIAS_VENCIMIENTO.PROXIMO) return 'proximo'
  return 'ok'
}
