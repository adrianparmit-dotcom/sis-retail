# SOHO Retail OS — Reglas del proyecto

> Sistema de gestión retail para tienda de alimentos saludables (Argentina).
> Next.js + Supabase + integración con Dux ERP. **Está en producción y operando.**

---

## ⚠️ Reglas de oro (leer siempre primero)

1. **SISTEMA EN PRODUCCIÓN.** Las chicas operan en vivo. **No** rompas bases de datos activas, **no** borres datos, **no** dejes el sistema caído. Ante la duda, preguntar antes de ejecutar.
2. **No tocar un dato sin entenderlo primero.** Lección aprendida: nunca "capear" / recortar columnas (ej. `cantidad` en ventas) sin entender el dato. Si algo parece mal, investigar el origen antes de modificar.
3. **Typecheck obligatorio antes de commitear/deployar** (ver sección Typecheck).
4. **Commits y push solo cuando el usuario lo pide explícitamente.**
5. **Edge Functions: la versión desplegada manda.** El archivo local puede estar desactualizado. Antes de editar y redesplegar, **traer siempre la versión desplegada** con `get_edge_function`. Nunca redesplegar desde un archivo local sin verificar.
6. **Migraciones de DB con `apply_migration`** (no SQL suelto en `execute_sql` para cambios estructurales). Usar `execute_sql` solo para consultas/lecturas y verificaciones.

---

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 16 (App Router, Edge) + React 19 |
| Lenguaje | TypeScript (strict) |
| Estilos | Tailwind CSS v4 + shadcn/ui |
| Auth | NextAuth v5 (`web/auth.ts`, `web/middleware.ts`) |
| Backend | Supabase (Postgres + RLS + Edge Functions Deno + pg_cron + pg_net) |
| ERP | Dux Software API (vía proxy en `/api/dux/forward`) |
| Excel | `xlsx` (SheetJS 0.18.5) |
| PDF | `jspdf` + `jspdf-autotable`; lectura de PDF con `pdfjs-dist` |
| IA | `@anthropic-ai/sdk` (parseo de facturas) |

- **Proyecto Supabase:** `whbbpaainuwqzapaicpj`.
- **Cliente Supabase:** `import { supabase } from '@/lib/supabase'` — usa la **anon key** (rol `anon`).

---

## Typecheck obligatorio

Antes de **cualquier** commit, push o deploy del front:

```bash
cd web && npx tsc --noEmit -p tsconfig.json
```

Debe terminar **sin output** (sin errores). No hay script `typecheck` en package.json; correr el comando directo.

- **Prohibido** silenciar el compilador: nada de `// @ts-ignore`, `// @ts-nocheck`, ni `// @ts-expect-error` para tapar errores reales. Arreglar el tipo.
- **Prohibido** `any` para evadir tipado (`strict: true`). Si hace falta, tipar bien o usar `unknown` + narrowing.
- Las advertencias del **React Compiler** (`set-state-in-effect`, "Compilation Skipped: memoization") son benignas y **no** rompen el build — no perseguirlas.

---

## Estructura de carpetas

```
App soho/                      ← raíz del workspace (cwd de las sesiones)
├── CLAUDE.md                  ← este archivo
├── .claude/                   ← config + memoria persistente (MEMORY.md, project_*.md)
├── supabase/
│   └── functions/             ← Edge Functions (Deno). OJO: solo dux-sync está en repo;
│                                 dux-ventas-sync vive solo desplegada.
├── scripts/                   ← scripts utilitarios
└── web/                       ← app Next.js + **repo git** (origin: sis-retail, branch master)
    ├── app/                   ← rutas (App Router). 1 carpeta por feature, page.tsx por ruta
    │   ├── api/               ← route handlers (dux/forward, parse-invoice, parse-pdf, etc.)
    │   ├── compras/           ← comprador inteligente (+ proveedores, sin-proveedor)
    │   ├── recepciones/       ← recepción de facturas de proveedor
    │   ├── vencimientos/      ← FEFO / fechas de vencimiento
    │   ├── ubicaciones/       ← cajones/cajas por sucursal
    │   ├── reconciliacion/, reposicion/, precios/, promociones/, fraccionamiento/, tareas/ ...
    ├── lib/                   ← lógica compartida (ver abajo)
    └── components/
        ├── ui/                ← componentes shadcn/ui (button, table, badge, select, ...)
        └── shared/            ← componentes de dominio (sucursal-selector, product-picker)
```

**`web/lib/` (módulos clave):**
- `supabase.ts` — cliente anon.
- `types.ts` — tipos de dominio (`ProductoCompra`, `InvoiceLineItem`, `Lote`, `GranelDerivado`, etc.).
- `constants.ts` — **fuente única** de IDs de sucursal y umbrales de negocio.
- `format.ts` — formateo de moneda/números/fechas (es-AR) + `hoyISO()` (fecha local, NO usar `toISOString()` para "hoy").
- `export-xlsx.ts` — `exportTablaXlsx<T>(...)` para Excel nativo (usar SIEMPRE este).
- `export-orden.ts` — generación de Orden de Compra (CSV + PDF).
- `invoice-parsers.ts` / `dux-parser.ts` — parsers de facturas y datos Dux.
- `proveedor-doc.ts` — documento para proveedor al confirmar recepción.

---

## Convenciones

- **Path alias:** `@/*` → raíz de `web/`. Importar con `@/lib/...`, `@/components/...`.
- **Páginas:** `'use client'` arriba; data fetching con el cliente `supabase` anon.
- **IDs de sucursal y umbrales:** importarlos de `@/lib/constants` (`SUCURSALES`, `DIAS_COBERTURA`, `INVERSION_ALERTA_PESOS`, etc.). **Nunca** hardcodear UUIDs ni números mágicos en componentes.
- **Paginación de Supabase:** las vistas/tablas grandes superan el límite de 1000 filas. Traer en loop con `.range(from, from+PAGE-1)` hasta que la página venga incompleta (patrón `fetchAllFromView`). No asumir que un `select('*')` trae todo.
- **Exports a Excel:** usar `exportTablaXlsx` de `@/lib/export-xlsx`. **No** generar CSV separado por comas para tablas (rompe en una sola columna en Excel-AR). Si es CSV, usar `;` + `sep=;`.
- **UI en español.** Moneda y números con `es-AR`.
- **Componentes:** reutilizar `components/ui` (shadcn) y `components/shared`. No reinventar inputs/tablas/badges.
- **Commits:** mensajes tipo Conventional Commits (`fix(compras): ...`, `feat(...): ...`). Trailer `Co-Authored-By: Claude ...`. En PowerShell, los here-strings de git suelen romperse → usar mensaje de una línea o `git commit -F archivo`.

---

## Patrones PROHIBIDOS

- ❌ Hardcodear UUIDs de sucursal o umbrales → usar `constants.ts`.
- ❌ `// @ts-ignore` / `// @ts-nocheck` / `any` para evadir el compilador.
- ❌ CSV separado por comas para exports tabulares (bug de una columna) → `exportTablaXlsx`.
- ❌ Pedir a la API de Dux con `limit > 20` (devuelve **0 resultados en silencio**). Máximo 20 por página.
- ❌ Crear políticas RLS solo para el rol `authenticated` — **la app usa `anon`**. Las policies deben permitir `public`/`anon`.
- ❌ Redesplegar una Edge Function desde el archivo local sin traer antes la versión desplegada.
- ❌ Modificar/recortar datos históricos (ej. ventas) sin entender el origen del dato.
- ❌ Commitear o pushear sin pedido explícito del usuario, o con typecheck en rojo.
- ❌ Insertar columnas en medio de una vista con `CREATE OR REPLACE VIEW` (Postgres solo permite **agregar columnas al final** o mismo orden). Si hay que reordenar/insertar, `DROP` + `CREATE` (verificando dependencias).

---

## Integración Dux ERP

- **Proxy:** todas las llamadas pasan por `web/app/api/dux/forward` (auth interno `_s=soho-internal-2026`). No llamar a Dux directo desde el cliente.
- **idEmpresa:** `4065`.
- **Sucursales Dux → cadena:** `1` = SOHO (SOHO 1), `2` = ECOMMERCE, `3` = SOHO 2. Mapeo de ventas: `{1:'001', 2:'005', 3:'003'}`.
- **Paginación:** límite **máximo 20** por request (si pedís más, Dux devuelve 0).
- **Rate limit:** ~5 s entre llamadas.
- **Modelo de datos (FEFO):** **Dux es dueño de las cantidades de stock**; la app es dueña de las **fechas de vencimiento** (tabla `lotes`). No sobreescribir cantidades que vienen de Dux con datos de la app.
- **Sync:** `dux-sync` (productos/stock, desplegada v15, upsert por `sku`) y `dux-ventas-sync` (ventas desde `/facturas`, modo normal + backfill). Corren por `pg_cron`.

---

## Modelo de sucursales

UUIDs en `constants.ts` (`SUCURSALES`):

| Constante | UUID (sufijo) | Cadena |
|---|---|---|
| `SOHO1_LOCAL` | `...0001` | SOHO 1 |
| `SOHO1_PIEZA` | `...0002` | SOHO 1 (depósito "La Pieza") |
| `SOHO2_LOCAL` | `...0003` | SOHO 2 |
| `SOHO2_DEPOSITO` | `...0004` | SOHO 2 (depósito) |

- **Stock por cadena:** SOHO 1 = `0001 + 0002`; SOHO 2 = `0003 + 0004`.
- **Ventas por local:** se miden en los locales `0001` (SOHO 1) y `0003` (SOHO 2).

---

## Reglas de negocio

### Comprador inteligente (`v_compras_inteligentes_v4`)
Es la vista **activa** que alimenta `/compras`. Respeta dinámicamente el campo `tipo` de `proveedores_config`:
- **`tipo='global'`** → 1 fila por producto, `location_id` nulo, ventas y stock totales.
- **`tipo='sucursal'`** → 2 filas por producto (SOHO 1 / SOHO 2) con `location_id`/`location_nombre`; ventas del local y stock de la cadena. **El tipo es configurable por el usuario** desde `/compras/proveedores`; nunca hardcodear qué proveedor es de qué tipo.

**Fórmula de demanda y pedido:**
- `vel_diaria = ventas_30d / 30`
- Demanda ponderada: **50%** v30 + **30%** v60_30 + **20%** mismo mes año anterior (±15 días), escalada a la frecuencia del proveedor.
- `factor_tendencia` = clamp(v30 / v60_30, **0.80 – 1.50**).
- `factor_volatilidad` = clamp(1 + σ/vel, **1.00 – 1.10**) (margen de error máx **10%**).
- `stock_seguridad = vel_diaria × lead_time × factor_volatilidad`.
- **Cobertura objetivo total = frecuencia + lead_time + buffer 10%** (modelo de revisión periódica). Pedir más seguido ⇒ pedir menos cantidad.
- `frecuencia_dias` y `lead_time_dias` se leen de `proveedores_config` por proveedor.
- Tope por vencimiento: `qty_max_vencimiento` usa vida útil **P25** (percentil 25 de shelf life) × 0.80.
- `sin_rotacion` (sin ventas en 90d) ⇒ sugerencia 0.

### Granel / fraccionamiento
- `unidad_medida` numérico = **gramos por unidad** vendida; `'kg'` = 1000 g.
- **El costo se guarda SIEMPRE por kilo**; `precio_venta` es por unidad fraccionada.
- `sugerencia_kg = ceil(unidades × gramos / 1000)`. `capital_inmovilizado` e `inversion_sugerida` de granel se calculan por kg.
- Un ítem de proveedor a granel puede derivar en **N SKUs finales** (fraccionamiento).

### ABC
Clasificación por facturación: **A** = top 70% acumulado, **B** = siguiente 20%, **C** = 10% restante.

### Recepción de facturas
- Mapeo de SKU del proveedor **manual con aprendizaje** (`proveedor_sku_map`), no auto-match por `codigo_externo`.
- IVA editable (21% / 10.5%), aprendido por proveedor. Múltiples fechas de vencimiento por ítem. Alerta ⚠️ si cambia la descripción del producto.

### Vencimientos / Reconciliación
- Umbrales en `constants.ts` (`DIAS_VENCIMIENTO`: crítico 7 / alerta 30 / próximo 90 — alineados con `v_vencimientos_fefo`; el estado se calcula con `estadoVencimiento()` de `lib/vencimientos.ts`).
- Reactivación de productos sin venta: `REACTIVACION_UNIDADES` en `constants.ts` (global 4 ud / sucursal 2 ud por sucursal).
- Reconciliación compara stock Dux vs vencimientos cargados (estados ok / sin_carga / faltante / exceso).
- Productos deshabilitados en Dux ⇒ marcar **anulados** (discontinuado + stock 0), no borrar.

### Promociones
Workflow de estados (orden): `propuesta → preaprobada → impacta_compras → stock_recibido → activa → finalizada` (o `descartada`).

---

## Memoria persistente
Hay notas de estado en `.claude/.../memory/` (`MEMORY.md`, `project_estado.md`, `project_infraestructura.md`) con el estado actual del proyecto, IDs y migraciones. Consultarlas al inicio de tareas grandes.
