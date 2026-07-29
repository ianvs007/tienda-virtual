// POST /api/admin/productos/eliminar-lote — borra varias prendas en una llamada.
// Body: { ids: [1, 2, …] } — máx 200 por llamada: el cliente trocea la lista
// para poder mostrar el avance en porcentaje (borrar 1700+ de una sola vez
// dejaría la pantalla "colgada" sin señal de vida).
// Misma regla que DELETE /:id: si un pedido referencia la prenda, no se puede
// borrar y solo se desactiva.
const MAX_IDS = 200;

export async function onRequestPost({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger) : [];
  if (ids.length === 0 || ids.length > MAX_IDS)
    return Response.json({ error: `Lista de ids inválida (1 a ${MAX_IDS})` }, { status: 400 });

  let borradas = 0;
  let ocultadas = 0;
  let fallidas = 0;
  for (const id of ids) {
    try {
      // Variantes y fotos caen en cascada; si algún pedido la referencia, falla.
      await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
      borradas++;
    } catch {
      try {
        await env.DB.prepare('UPDATE products SET activo = 0 WHERE id = ?').bind(id).run();
        ocultadas++;
      } catch {
        fallidas++;
      }
    }
  }

  return Response.json({ ok: true, borradas, ocultadas, fallidas });
}
