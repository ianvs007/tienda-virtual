// GET /api/admin/pedidos/:codigo — detalle con ítems.
// PUT /api/admin/pedidos/:codigo — cambia el estado. Al cancelar, repone el stock.
import { sentenciaLogStock } from '../../../lib/stockLog.js';

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

  const sentencias = [
    env.DB.prepare('UPDATE orders SET estado = ? WHERE id = ?').bind(nuevo, pedido.id),
  ];

  // Cancelar devuelve las prendas al stock.
  if (nuevo === 'cancelado') {
    const { results: items } = await env.DB.prepare(
      `SELECT oi.variant_id, oi.cantidad, v.stock, v.talla, v.color,
              p.id AS product_id, p.nombre, p.codigo AS codigo_prenda
         FROM order_items oi
         JOIN product_variants v ON v.id = oi.variant_id
         JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ? AND oi.variant_id IS NOT NULL`
    )
      .bind(pedido.id)
      .all();
    for (const it of items) {
      sentencias.push(
        env.DB.prepare('UPDATE product_variants SET stock = stock + ? WHERE id = ?').bind(
          it.cantidad,
          it.variant_id
        )
      );
      // Auditoría: el stock vuelve al catálogo por cancelación.
      sentencias.push(
        sentenciaLogStock(env, {
          productId: it.product_id,
          variantId: it.variant_id,
          codigo: it.codigo_prenda || '',
          nombre: it.nombre,
          talla: it.talla,
          color: it.color,
          anterior: it.stock,
          nuevo: it.stock + it.cantidad,
          origen: 'cancelacion',
          detalle: `Pedido ${codigo.slice(0, 8).toUpperCase()}`,
        })
      );
    }
  }

  await env.DB.batch(sentencias);
  return Response.json({ ok: true, estado: nuevo });
}
