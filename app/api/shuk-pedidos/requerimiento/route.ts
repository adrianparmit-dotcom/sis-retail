/**
 * POST /api/shuk-pedidos/requerimiento
 *
 * Shuk Pedidos avisa acá cuando entra un pedido de Tienda Nube con líneas de
 * granel. El resto del ecommerce —el 80%, que sale del depósito de Shuk— lo
 * despacha Shuk Pedidos solo; lo único que administra SOHO es el granel.
 *
 * SOHO fracciona, rotula y avisa para el traslado interno. NO factura ni
 * descuenta stock: La Pyme descarga los kilos del producto padre cuando
 * factura la venta.
 *
 * Auth: header `X-Shuk-Secret`. La ruta está en PUBLIC_PATHS del middleware
 * porque del otro lado hay un servidor, no una persona con sesión de Google;
 * el secreto compartido es lo que la protege.
 *
 * Body:
 *   {
 *     "id_externo": "abc-123",           // id estable del lado de Shuk Pedidos
 *     "pedido": "TN-10234",              // nro de pedido de Tienda Nube
 *     "fecha": "2026-09-17T14:30:00Z",   // opcional
 *     "items": [
 *       { "sku": "GRA-009-3KG", "cantidad": 2, "descripcion": "..." }
 *     ]
 *   }
 *
 * `cantidad` va en PAQUETES, no en kilos: 2 = dos paquetes de 3 kg. Confirmado
 * con David el 17/09/2026. Confundirlo es el error más caro del circuito.
 *
 * Idempotente por `id_externo`: Shuk Pedidos reintenta si el llamado falla, así
 * que un id repetido devuelve 200 con el requerimiento que ya existe en vez de
 * crear otro. Reintentar tiene que ser seguro, si no el pedido se arma dos veces.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { horaDeAviso } from '@/lib/aviso-horario'

export const maxDuration = 30

const SECRETO = process.env.SHUK_PEDIDOS_SECRET ?? ''

interface ItemEntrada {
  sku?: unknown
  cantidad?: unknown
  descripcion?: unknown
}

function error(codigo: string, mensaje: string, status: number) {
  return NextResponse.json({ error: { codigo, mensaje } }, { status })
}

export async function POST(req: NextRequest) {
  if (!SECRETO) {
    return error('SIN_SECRETO', 'Falta SHUK_PEDIDOS_SECRET en el entorno.', 503)
  }
  if (req.headers.get('x-shuk-secret') !== SECRETO) {
    return error('NO_AUTORIZADO', 'Secreto inválido o ausente.', 401)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return error('JSON_INVALIDO', 'El cuerpo no es JSON válido.', 400)
  }

  const idExterno = String(body.id_externo ?? '').trim()
  const pedido    = String(body.pedido ?? '').trim()
  if (!idExterno) return error('FALTA_ID_EXTERNO', 'Falta id_externo, que es lo que evita duplicar el pedido al reintentar.', 400)
  if (!pedido)    return error('FALTA_PEDIDO', 'Falta pedido.', 400)

  const crudos = Array.isArray(body.items) ? body.items as ItemEntrada[] : []
  const items = crudos.map(i => ({
    sku        : String(i.sku ?? '').trim(),
    cantidad   : Number(i.cantidad ?? 0),
    descripcion: i.descripcion == null ? null : String(i.descripcion),
  }))

  const invalidos = items.filter(i => !i.sku || !Number.isFinite(i.cantidad) || i.cantidad <= 0)
  if (items.length === 0) return error('SIN_ITEMS', 'El requerimiento no trae ítems.', 400)
  if (invalidos.length > 0) {
    return error(
      'ITEM_INVALIDO',
      `Hay ${invalidos.length} ítem(s) sin sku o con cantidad menor o igual a cero.`,
      400,
    )
  }

  // ── Idempotencia ────────────────────────────────────────────────
  // Se mira ANTES de insertar. Si ya está, se devuelve 200: para Shuk Pedidos
  // el reintento fue exitoso y deja de reintentar, que es lo que queremos.
  const { data: yaEsta } = await supabase
    .from('shuk_requerimientos')
    .select('id, estado, created_at')
    .eq('id_externo', idExterno)
    .maybeSingle()

  if (yaEsta) {
    const r = yaEsta as { id: string; estado: string; created_at: string }
    return NextResponse.json({
      ok: true,
      duplicado: true,
      id: r.id,
      estado: r.estado,
      mensaje: 'Ese id_externo ya había entrado; no se creó un requerimiento nuevo.',
    })
  }

  const { data: creado, error: errReq } = await supabase
    .from('shuk_requerimientos')
    .insert({
      id_externo  : idExterno,
      pedido,
      fecha_pedido: body.fecha ? String(body.fecha) : null,
      estado      : 'pendiente',
      // Cuándo mostrar el recuadro en pantalla. Se decide ACÁ y no en el
      // navegador: un aviso diferido a las 16:15 decidido del lado del cliente
      // necesitaría que justo a esa hora hubiera una PC con la página abierta.
      notificar_at: horaDeAviso().toISOString(),
    })
    .select('id')
    .single()

  if (errReq || !creado) {
    // La restricción única puede saltar si dos reintentos entran a la vez: en
    // ese caso no es un error real, el requerimiento quedó creado igual.
    if (errReq?.code === '23505') {
      const { data: r } = await supabase
        .from('shuk_requerimientos')
        .select('id, estado')
        .eq('id_externo', idExterno)
        .maybeSingle()
      return NextResponse.json({ ok: true, duplicado: true, id: (r as { id: string } | null)?.id })
    }
    return error('NO_SE_PUDO_GUARDAR', errReq?.message ?? 'No se pudo guardar el requerimiento.', 500)
  }

  const reqId = (creado as { id: string }).id

  const { error: errItems } = await supabase
    .from('shuk_requerimiento_items')
    .insert(items.map(i => ({ requerimiento_id: reqId, ...i })))

  if (errItems) {
    // Un requerimiento sin ítems no sirve para nada y confundiría a las chicas:
    // se borra para que Shuk Pedidos pueda reintentar limpio.
    await supabase.from('shuk_requerimientos').delete().eq('id', reqId)
    return error('NO_SE_PUDO_GUARDAR', `No se pudieron guardar los ítems: ${errItems.message}`, 500)
  }

  return NextResponse.json({ ok: true, id: reqId, pedido, items: items.length })
}

/** Cualquier otro método: se contesta explícito para que del otro lado se vea. */
export async function GET() {
  return error('METODO_NO_PERMITIDO', 'Este endpoint solo acepta POST.', 405)
}
