// GET /api/admin/pedidos/:codigo — detalle con ítems.
// PUT /api/admin/pedidos/:codigo — cambia el estado. Al cancelar, repone el stock.
import { sentenciaLogStock } from '../../../lib/stockLog.js';
import { itemsParaReponer, sentenciaEventoStock } from '../../../lib/eventos.js';

const TRANSICIONES = {
  pendiente_pago: ['confirmado', 'cancelado'],
  comprobante_subido: ['confirmado', 'cancelado'],
  confirmado: ['entregado', 'cancelado'],
  entregado: [],
  cancelado: [],
};

export async function onRequestGet({ env, params }) {
  const codigo = String(params.codigo || '');
  const pedido = await env.DB.prepare('SELECT * FROM orders WHERE codigo = ?').bind(codigo).first();
  if (!pedido) return Response.json({ error: 'No encontrado' }, { status: 404 });

  const { results: items } = await env.DB.prepare(
    `SELECT oi.cantidad, oi.precio_unit, p.nombre, v.talla, v.color
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN product_variants v ON v.id = oi.variant_id
      WHERE oi.order_id = ?`
  )
    .bind(pedido.id)
    .all();

  return Response.json({ ...pedido, items });
}

export async function onRequestPut({ env, params, request }) {
  const codigo = String(params.codigo || '');
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }
  const nuevo = String(body.estado || '');

  const pedido = await env.DB.prepare('SELECT id, estado FROM orders WHERE codigo = ?')
    .bind(codigo)
    .first();
  if (!pedido) return Response.json({ error: 'No encontrado' }, { status: 404 });

  const permitidos = TRANSICIONES[pedido.estado] || [];
  if (!permitidos.includes(nuevo))
    return Response.json(
      { error: `No se puede pasar de "${pedido.estado}" a "${nuevo}"` },
      { status: 409 }
    );

  // Primero la transición atómica. Solo si ganamos la carrera (1 fila) se
  // repone stock — si stock+ fuera en el mismo batch, un UPDATE de 0 cambios
  // igual ejecutaría las reposiciones (doble clic / dos pestañas).
  const rEstado = await env.DB.prepare(
    'UPDATE orders SET estado = ? WHERE id = ? AND estado = ?'
  )
    .bind(nuevo, pedido.id, pedido.estado)
    .run();
  if ((rEstado?.meta?.changes || 0) !== 1) {
    return Response.json(
      { error: 'El pedido ya cambió de estado. Recarga e intenta de nuevo.' },
      { status: 409 }
    );
  }

  if (nuevo === 'cancelado') {
    const items = await itemsParaReponer(env, pedido.id);
    const sentencias = [];
    for (const it of items) {
      sentencias.push(
        env.DB.prepare('UPDATE product_variants SET stock = stock + ? WHERE id = ?').bind(
          it.cantidad,
          it.variant_id
        )
      );
      sentencias.push(
        sentenciaLogStock(env, {
          productId: it.product_id,
          variantId: it.variant_id,
          codigo: it.codigo || '',
          nombre: it.nombre,
          talla: it.talla,
          color: it.color,
          anterior: it.stock,
          nuevo: it.stock + it.cantidad,
          origen: 'cancelacion',
          detalle: `Pedido ${codigo.slice(0, 8).toUpperCase()}`,
        })
      );
      // Sync v2: la prenda vuelve al catálogo → evento positivo para el POS.
      sentencias.push(
        sentenciaEventoStock(env, {
          tipo: 'cancelacion',
          orderId: pedido.id,
          orderItemId: it.order_item_id,
          productId: it.product_id,
          variantId: it.variant_id,
          globalId: it.global_id || '',
          codigo: it.codigo || '',
          nombre: it.nombre,
          talla: it.talla,
          color: it.color,
          cantidad: it.cantidad,
          precioUnit: it.precio_unit,
          pedidoCodigo: codigo,
        })
      );
    }
    if (sentencias.length > 0) await env.DB.batch(sentencias);
  }

  return Response.json({ ok: true, estado: nuevo });
}
