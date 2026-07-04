// GET /api/productos           — lista prendas activas con su primera foto.
// GET /api/productos?categoria=3 — filtradas por categoría.
export async function onRequestGet({ env, request }) {
  const categoria = new URL(request.url).searchParams.get('categoria');

  let sql = `SELECT p.id, p.nombre, p.descripcion, p.precio, p.categoria_id,
                    (SELECT r2_key FROM product_images i
                      WHERE i.product_id = p.id ORDER BY i.orden LIMIT 1) AS imagen,
                    (SELECT COALESCE(SUM(v.stock), 0) FROM product_variants v
                      WHERE v.product_id = p.id) AS stock_total
               FROM products p
              WHERE p.activo = 1`;
  const params = [];

  if (categoria) {
    sql += ' AND p.categoria_id = ?';
    params.push(categoria);
  }
  sql += ' ORDER BY p.creado_en DESC';

  const { results } = await env.DB.prepare(sql)
    .bind(...params)
    .all();

  return Response.json(results);
}
