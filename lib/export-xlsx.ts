import * as XLSX from 'xlsx'

/**
 * Utilidad única de exportación a Excel (.xlsx nativo).
 *
 * Genera un archivo binario .xlsx con columnas REALES separadas — a diferencia
 * de un CSV con `;`, que Excel puede meter todo en una sola columna según la
 * configuración regional. Usar siempre esto para exportar tablas.
 */

export interface ColumnaExport<T> {
  /** Encabezado de la columna */
  header: string
  /** Extrae el valor de la fila. Devolver number para que Excel lo trate como número. */
  value: (row: T) => string | number | null | undefined
}

/** Hoy en formato YYYY-MM-DD para nombres de archivo */
function hoyISO(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * Exporta `filas` a un .xlsx con las `columnas` dadas y dispara la descarga.
 *
 * @param baseName  nombre base del archivo (se le agrega la fecha y .xlsx)
 * @param columnas  definición de columnas (header + extractor de valor)
 * @param filas     datos
 * @param sheetName nombre de la hoja (default "Datos")
 */
export function exportTablaXlsx<T>(
  baseName: string,
  columnas: ColumnaExport<T>[],
  filas: T[],
  sheetName = 'Datos',
): void {
  // Matriz: primera fila = headers, resto = datos
  const aoa: (string | number)[][] = [columnas.map(c => c.header)]
  for (const row of filas) {
    aoa.push(columnas.map(c => {
      const v = c.value(row)
      return v == null ? '' : v
    }))
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Ancho de columnas automático (acotado entre 8 y 50 caracteres)
  ws['!cols'] = columnas.map(c => {
    let max = c.header.length
    for (const row of filas) {
      const v = c.value(row)
      const len = v == null ? 0 : String(v).length
      if (len > max) max = len
    }
    return { wch: Math.max(8, Math.min(max + 2, 50)) }
  })

  // Congelar la fila de encabezados
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)) // Excel limita a 31 chars
  XLSX.writeFile(wb, `${baseName}_${hoyISO()}.xlsx`)
}
