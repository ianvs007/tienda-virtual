// GET /api/pedidos/:codigo — estado y detalle de un pedido.
// El código aleatorio largo hace de llave: solo quien hizo el pedido lo conoce.
export async function onRequestGet({ env, params }) {
  const codigo = String(params.codigo || '');
  if (!/^[a-f0-9]{32}$/.test(codigo))
    return Response.json({ error: 'Código inválido' }, { status: 400 });

  const pedido = await env.DB.prepare(
    `SELECT codigo, cliente_nombre, tipo_entrega, direccion, ciudad, total, estado, creado_en,
            comprobante_r2_key IS NOT NULL AS tiene_comprobante
       FROM orders WHERE codigo = ?`
  )
    .bind(codigo)
    .first();

  if (!pedido) return Response.json({ error: 'Pedido no encontrado' }, { status: 404 });

  const { results: items } = await env.DB.prepare(
    `SELECT oi.cantidad, oi.precio_unit, p.nombre, v.talla, v.color,
            (SELECT r2_key FROM product_images i WHERE i.product_id = p.id ORDER BY i.orden LIMIT 1) AS imagen
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN product_variants v ON v.id = oi.variant_id
      WHERE oi.order_id = (SELECT id FROM orders WHERE codigo = ?)`
  )
    .bind(codigo)
    .all();

  // Datos para la pantalla de pago.
  const { results: ajustes } = await env.DB.prepare(
    `SELECT clave, valor FROM settings WHERE clave IN ('qr_cobro_r2_key', 'whatsapp_tienda', 'nombre_tienda')`
  ).all();
  const conf = Object.fromEntries(ajustes.map((a) => [a.clave, a.valor]));

  return Response.json({
    ...pedido,
    tiene_comprobante: Boolean(pedido.tiene_comprobante),
    items,
    qr: conf.qr_cobro_r2_key || null,
    whatsapp_tienda: conf.whatsapp_tienda || null,
    nombre_tienda: conf.nombre_tienda || 'Tienda Virtual',
  });
}
