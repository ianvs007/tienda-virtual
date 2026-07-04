// POST /api/pedidos — crea un pedido.
// Seguridad: los precios y el total se recalculan aquí con los datos de la BD
// (el navegador solo envía IDs y cantidades). El stock se descuenta de forma
// atómica: si no alcanza, el CHECK (stock >= 0) revierte todo el pedido.
export async function onRequestPost({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const nombre = String(body.nombre || '').trim();
  const whatsapp = String(body.whatsapp || '').trim();
  const tipoEntrega = String(body.tipo_entrega || '');
  const direccion = String(body.direccion || '').trim();
  const ciudad = String(body.ciudad || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];

  if (nombre.length < 2 || nombre.length > 100)
    return Response.json({ error: 'Ingresa tu nombre' }, { status: 400 });
  if (!/^\+?\d{7,15}$/.test(whatsapp.replace(/[\s-]/g, '')))
    return Response.json({ error: 'Ingresa un número de WhatsApp válido' }, { status: 400 });
  if (!['local', 'nacional', 'recojo'].includes(tipoEntrega))
    return Response.json({ error: 'Elige el tipo de entrega' }, { status: 400 });
  if (tipoEntrega !== 'recojo' && direccion.length < 3)
    return Response.json({ error: 'Ingresa la dirección de entrega' }, { status: 400 });
  if (tipoEntrega === 'nacional' && ciudad.length < 2)
    return Response.json({ error: 'Ingresa la ciudad de destino' }, { status: 400 });
  if (items.length === 0 || items.length > 50)
    return Response.json({ error: 'El carrito está vacío' }, { status: 400 });

  // Verificar cada ítem contra la BD (precio real, variante válida, stock).
  const detalle = [];
  for (const it of items) {
    const cantidad = Number(it.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99)
      return Response.json({ error: 'Cantidad inválida' }, { status: 400 });

    const fila = await env.DB.prepare(
      `SELECT p.id AS product_id, p.nombre, p.precio, v.id AS variant_id, v.stock
         FROM products p
         JOIN product_variants v ON v.product_id = p.id
        WHERE p.id = ? AND v.id = ? AND p.activo = 1`
    )
      .bind(Number(it.productId), Number(it.variantId))
      .first();

    if (!fila)
      return Response.json({ error: 'Una prenda del carrito ya no está disponible' }, { status: 409 });
    if (fila.stock < cantidad)
      return Response.json(
        { error: `Stock insuficiente de "${fila.nombre}" (quedan ${fila.stock})` },
        { status: 409 }
      );

    detalle.push({ ...fila, cantidad });
  }

  // Costo de envío desde ajustes.
  const claveEnvio =
    tipoEntrega === 'local' ? 'costo_envio_local' : tipoEntrega === 'nacional' ? 'costo_envio_nacional' : null;
  let envio = 0;
  if (claveEnvio) {
    const ajuste = await env.DB.prepare('SELECT valor FROM settings WHERE clave = ?')
      .bind(claveEnvio)
      .first();
    envio = Number(ajuste?.valor) || 0;
  }

  const subtotal = detalle.reduce((s, d) => s + d.precio * d.cantidad, 0);
  const total = subtotal + envio;

  // Código aleatorio largo: es la "llave" del pedido para el cliente.
  const codigo = crypto.randomUUID().replaceAll('-', '');

  const sentencias = [
    env.DB.prepare(
      `INSERT INTO orders (codigo, cliente_nombre, cliente_whatsapp, tipo_entrega, direccion, ciudad, total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(codigo, nombre, whatsapp, tipoEntrega, direccion, ciudad, total),
  ];

  for (const d of detalle) {
    sentencias.push(
      env.DB.prepare(
        `INSERT INTO order_items (order_id, product_id, variant_id, cantidad, precio_unit)
         VALUES ((SELECT id FROM orders WHERE codigo = ?), ?, ?, ?, ?)`
      ).bind(codigo, d.product_id, d.variant_id, d.cantidad, d.precio)
    );
    sentencias.push(
      env.DB.prepare('UPDATE product_variants SET stock = stock - ? WHERE id = ?').bind(
        d.cantidad,
        d.variant_id
      )
    );
  }

  try {
    await env.DB.batch(sentencias);
  } catch {
    return Response.json(
      { error: 'El stock cambió mientras comprabas. Revisa tu carrito e intenta de nuevo.' },
      { status: 409 }
    );
  }

  return Response.json({ codigo, subtotal, envio, total }, { status: 201 });
}
