/**
 * Cómo se leen las cantidades de una línea de recepción.
 *
 * Cuando la recepción se parte entre dos sucursales, la pantalla pide dos
 * números por renglón:
 *
 *   · `cantidad_recibida`   → lo que QUEDA en la sucursal que recibe
 *   · `transferir_cantidad` → lo que se manda a la otra sucursal
 *
 * Los dos juntos son lo que realmente entró por la puerta. Leer solo
 * `cantidad_recibida` hacía que todo lo repartido apareciera como faltante:
 * en la factura de EPN, 81 de 178 unidades se fueron a SOHO 2 y el documento
 * para el proveedor reclamaba 49 renglones que nunca faltaron.
 *
 * Sin sucursal destino elegida, `transferir_cantidad` es 0 y esto devuelve
 * exactamente lo recibido, así que las recepciones que no se parten no cambian.
 */

/** Forma mínima que necesitan estos cálculos. */
export interface CantidadesLinea {
  cantidad            : number
  cantidad_recibida   : number
  transferir_cantidad ?: number
}

/** Unidades que entraron por la puerta: lo que queda acá + lo que se reparte. */
export function recibidoTotal(item: CantidadesLinea): number {
  return (item.cantidad_recibida ?? 0) + (item.transferir_cantidad ?? 0)
}

/** Unidades facturadas que no llegaron. 0 si llegó todo o sobró. */
export function faltante(item: CantidadesLinea): number {
  return Math.max(0, item.cantidad - recibidoTotal(item))
}

/** Unidades que llegaron de más respecto de la factura. 0 si no sobró nada. */
export function sobrante(item: CantidadesLinea): number {
  return Math.max(0, recibidoTotal(item) - item.cantidad)
}
