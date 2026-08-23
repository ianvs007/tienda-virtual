// POST /api/admin/productos/eliminar-todas — vacía el catálogo cloud.
// Las prendas referenciadas por pedidos se conservan y solo se desactivan.
export async function onRequestPost({ env }) {
  const { results: productos } = await env.DB.prepare(
    `SELECT p.id,
            EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.id) AS tiene_pedidos
       FROM products p`
  ).all();

  const eliminables = productos.filter((p) => !p.tiene_pedidos).map((p) => p.id);
  const protegidas = productos.length - eliminables.length;
  let borradas = 0;
  let fallidas = 0;

  if (eliminables.length > 0) {
    const imagenes = [];
    for (let i = 0; i < eliminables.length; i += 500) {
      const ids = eliminables.slice(i, i + 500);
      const marcadores = ids.map(() => '?').join(', ');
      const resultado = await env.DB.prepare(
        `SELECT r2_key FROM product_images WHERE product_id IN (${marcadores})`
      )
        .bind(...ids)
        .all();
      imagenes.push(...resultado.results);
    }

    const claves = imagenes.map((imagen) => imagen.r2_key).filter(Boolean);
    for (let i = 0; i < claves.length; i += 1000) {
      await env.FOTOS.delete(claves.slice(i, i + 1000));
    }

    for (let i = 0; i < eliminables.length; i += 200) {
      const lote = eliminables.slice(i, i + 200);
      const resultados = await env.DB.batch(
        lote.map((id) => env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id))
      );
      for (const resultado of resultados) {
        if (resultado.meta?.changes) borradas++;
        else fallidas++;
      }
    }
  }

  if (protegidas > 0) {
    const idsProtegidas = productos.filter((p) => p.tiene_pedidos).map((p) => p.id);
    for (let i = 0; i < idsProtegidas.length; i += 500) {
      const lote = idsProtegidas.slice(i, i + 500);
      const marcadores = lote.map(() => '?').join(', ');
      await env.DB.prepare(`UPDATE products SET activo = 0 WHERE id IN (${marcadores})`).bind(...lote).run();
    }
  }

  return Response.json({
    ok: true,
    total: productos.length,
    borradas,
    ocultadas: protegidas,
    fallidas,
  });
}
