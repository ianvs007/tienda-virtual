// GET /api/ajustes — configuración pública de la tienda (para checkout y pie de página).
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT clave, valor FROM settings
      WHERE clave IN ('nombre_tienda', 'whatsapp_tienda', 'costo_envio_local', 'costo_envio_nacional')`
  ).all();

  return Response.json(Object.fromEntries(results.map((a) => [a.clave, a.valor])));
}
