// GET /api/productos/:id — ficha completa: producto + variantes (talla/color/stock) + fotos.
export async function onRequestGet({ env, params }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: 'ID inválido' }, { status: 400 });
  }

  const producto = await env.DB.prepare(
    `SELECT p.id, p.nombre, p.descripcion, p.precio, p.categoria_id, c.nombre AS categoria
       FROM products p
       LEFT JOIN categories c ON c.id = p.categoria_id
      WHERE p.id = ? AND p.activo = 1`
  )
    .bind(id)
    .first();

  if (!producto) {
    return Response.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  const [variantes, imagenes] = await Promise.all([
    env.DB.prepare(
      `SELECT id, talla, color, stock FROM product_variants
        WHERE product_id = ? ORDER BY talla, color`
    )
      .bind(id)
      .all(),
    env.DB.prepare(
      `SELECT r2_key FROM product_images WHERE product_id = ? ORDER BY orden`
    )
      .bind(id)
      .all(),
  ]);

  return Response.json({
    ...producto,
    variantes: variantes.results,
    imagenes: imagenes.results.map((i) => i.r2_key),
  });
}
