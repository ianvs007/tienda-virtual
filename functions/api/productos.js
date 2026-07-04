// GET /api/productos — lista prendas activas con su primera foto.
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.nombre, p.descripcion, p.precio, p.categoria_id,
            (SELECT r2_key FROM product_images i
              WHERE i.product_id = p.id ORDER BY i.orden LIMIT 1) AS imagen
       FROM products p
      WHERE p.activo = 1
      ORDER BY p.creado_en DESC`
  ).all();

  return Response.json(results);
}
