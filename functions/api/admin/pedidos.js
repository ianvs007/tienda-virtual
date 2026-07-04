// GET /api/admin/pedidos[?estado=x] — bandeja de pedidos, más recientes primero.
export async function onRequestGet({ env, request }) {
  const estado = new URL(request.url).searchParams.get('estado');

  let sql = `SELECT id, codigo, cliente_nombre, cliente_whatsapp, tipo_entrega, direccion, ciudad,
                    total, estado, comprobante_r2_key, creado_en
               FROM orders`;
  const params = [];
  if (estado) {
    sql += ' WHERE estado = ?';
    params.push(estado);
  }
  sql += ' ORDER BY creado_en DESC LIMIT 200';

  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return Response.json(results);
}
