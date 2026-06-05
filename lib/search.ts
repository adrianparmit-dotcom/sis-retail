// Utilidades de búsqueda tolerante para productos (y listas de texto en general).
//
// Objetivo: que las chicas puedan tipear términos sueltos, en cualquier orden y
// sin preocuparse por tildes. Ej: "gel ultra tech" debe encontrar
// "ENERGY GEL FRUTILLA SIN CAFEINA X 32G ULTRATECH".
//
// Regla: se parte la query en tokens y se exige que TODOS aparezcan (como
// substring) en el texto combinado de los campos. Orden indistinto, sin tildes.

/** Pasa a minúsculas y quita tildes (acentos del español + ü, ñ→n). */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/ñ/g, 'n')
}

/** Parte un texto en tokens alfanuméricos, ya normalizados (sin tildes). */
export function tokenize(s: string | null | undefined): string[] {
  return normalizeText(s)
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Devuelve true si TODOS los tokens de `query` aparecen en el texto combinado de
 * `fields`. Orden indistinto y sin tildes. Una query vacía matchea todo.
 */
export function matchesQuery(
  query: string,
  ...fields: Array<string | null | undefined>
): boolean {
  const tokens = tokenize(query)
  if (tokens.length === 0) return true
  const haystack = normalizeText(fields.join(' '))
  return tokens.every((t) => haystack.includes(t))
}
