import { normalizeText } from './search'

/**
 * Clave única de proveedor: minúsculas, sin tildes y **sin puntuación ni
 * espacios**. Sirve para que la misma empresa escrita de distintas formas caiga
 * siempre en la misma casilla.
 *
 *   "SHUK S.R.L."  →  "shuksrl"
 *   "SHUK SRL"     →  "shuksrl"
 *   "Shuk S.R.L"   →  "shuksrl"
 *
 * Por qué: `proveedor_sku_map` se indexaba por el nombre crudo que sale del PDF.
 * Una factura que vino como "Shuk S.R.L" (sin el punto final) contaba como un
 * proveedor nuevo y los 53 mapeos ya aprendidos de Shuk no se aplicaban — la
 * recepción quedaba con 21 ítems sin mapear y la compra no se enviaba a Dux.
 *
 * OJO: no reemplaza a los alias. Esto resuelve variantes de escritura del mismo
 * nombre; nombres genuinamente distintos de la misma empresa (ej. "SEDRAN, RAUL
 * HUGO" vs "Distribuidora Saludable - Raul Hugo Sedran") necesitan
 * `proveedores_aliases`. Ver `mismoProveedor`.
 */
export function claveProveedor(nombre: string | null | undefined): string {
  return normalizeText(nombre).replace(/[^a-z0-9]/g, '')
}

/** Un alias declarado a mano: dos nombres que son la misma empresa. */
export interface ProveedorAlias {
  nombre_normalizado: string | null
  config_nombre: string | null
}

/**
 * Índice de alias → clave canónica, para resolver nombres que no se parecen
 * entre sí. Se arma una vez con lo que haya en `proveedores_aliases`.
 */
export function construirIndiceAlias(aliases: ProveedorAlias[]): Map<string, string> {
  const idx = new Map<string, string>()
  for (const a of aliases) {
    const desde = claveProveedor(a.nombre_normalizado)
    const hacia = claveProveedor(a.config_nombre)
    if (desde && hacia) idx.set(desde, hacia)
  }
  return idx
}

/** Clave canónica de un proveedor, resolviendo alias si hay. */
export function claveCanonica(nombre: string | null | undefined, alias?: Map<string, string>): string {
  const k = claveProveedor(nombre)
  return alias?.get(k) ?? k
}

/** ¿Son el mismo proveedor? Tolera grafías distintas y alias declarados. */
export function mismoProveedor(
  a: string | null | undefined,
  b: string | null | undefined,
  alias?: Map<string, string>,
): boolean {
  const ka = claveCanonica(a, alias)
  return ka !== '' && ka === claveCanonica(b, alias)
}
