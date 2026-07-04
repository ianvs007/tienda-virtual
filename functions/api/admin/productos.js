// GET  /api/admin/productos — todas las prendas (incluye inactivas).
// POST /api/admin/productos — crea prenda con sus variantes.
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.nombre, p.precio, p.activo, p.categoria_id, c.nombre AS categoria,
            (SELECT COALESCE(SUM(v.stock), 0) FROM product_variants v WHERE v.product_id = p.id) AS stock_total,
            (SELECT r2_key FROM product_images i WHERE i.product_id = p.id ORDER BY i.orden LIMIT 1) AS imagen
       FROM products p
       LEFT JOIN categories c ON c.id = p.categoria_id
      ORDER BY p.creado_en DESC`
  ).all();
  return Response.json(results);
}

export function validarProducto(body) {
  const nombre = String(body.nombre || '').trim();
  const precio = Number(body.precio);
  const descripcion = String(body.descripcion || '').trim();
  const categoriaId = body.categoria_id ? Number(body.categoria_id) : null;
  const variantes = Array.isArray(body.variantes) ? body.variantes : [];

  if (nombre.length < 2 || nombre.length > 150) return { error: 'Nombre inválido' };
  if (!Number.isFinite(precio) || precio < 0) return { error: 'Precio inválido' };
  if (variantes.length === 0) return { error: 'Agrega al menos una talla/color' };

  const limpias = [];
  for (const v of variantes) {
    const stock = Number(v.stock);
    if (!Number.isInteger(stock) || stock < 0) return { error: 'Stock inválido' };
    limpias.push({
      id: v.id ? Number(v.id) : null,
      talla: String(v.talla || '').trim(),
      color: String(v.color || '').trim(),
      stock,
    });
  }
  return { nombre, precio, descripcion, categoriaId, variantes: limpias };
}

export async function onRequestPost({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }
  const datos = validarProducto(body);
  if (datos.error) return Response.json({ error: datos.error }, { status: 400 });

  const r = await env.DB.prepare(
    'INSERT INTO products (nombre, descripcion, precio, categoria_id) VALUES (?, ?, ?, ?)'
  )
    .bind(datos.nombre, datos.descripcion, datos.precio, datos.categoriaId)
    .run();
  const id = r.meta.last_row_id;

  await env.DB.batch(
    datos.variantes.map((v) =>
      env.DB.prepare(
        'INSERT INTO product_variants (product_id, talla, color, stock) VALUES (?, ?, ?, ?)'
      ).bind(id, v.talla, v.color, v.stock)
    )
  );

  return Response.json({ id }, { status: 201 });
}
