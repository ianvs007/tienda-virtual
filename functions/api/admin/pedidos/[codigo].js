// GET /api/admin/pedidos/:codigo — detalle con ítems.
// PUT /api/admin/pedidos/:codigo — cambia el estado. Al cancelar, repone el stock.
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
      'SELECT variant_id, cantidad FROM order_items WHERE order_id = ? AND variant_id IS NOT NULL'
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
    }
  }

  await env.DB.batch(sentencias);
  return Response.json({ ok: true, estado: nuevo });
}
