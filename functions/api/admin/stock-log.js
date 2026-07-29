// GET /api/admin/stock-log?q=texto&limite=300 — auditoría de cambios de stock.
// `q` filtra por nombre de prenda o código del sistema local (POS).
export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 60);
  const limite = Math.min(Number(url.searchParams.get('limite')) || 300, 1000);

  let sql = `SELECT id, product_id, codigo, nombre, variante, stock_anterior, stock_nuevo,
                    origen, detalle, creado_en
               FROM stock_log`;
  const params = [];
  if (q) {
    sql += ' WHERE nombre LIKE ? OR codigo LIKE ? OR detalle LIKE ?';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limite);

  const { results } = await env.DB.prepare(sql)
    .bind(...params)
    .all();
  return Response.json(results);
}
