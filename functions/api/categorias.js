// GET /api/categorias — categorías activas para los filtros del catálogo.
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, nombre FROM categories WHERE activa = 1 ORDER BY orden, nombre`
  ).all();

  return Response.json(results);
}
