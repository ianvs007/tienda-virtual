// GET /api/admin/ajustes — configuración editable de la tienda.
// PUT /api/admin/ajustes — guarda cambios (solo claves permitidas).
const EDITABLES = ['nombre_tienda', 'whatsapp_tienda', 'costo_envio_local', 'costo_envio_nacional'];

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT clave, valor FROM settings WHERE clave IN ('nombre_tienda', 'whatsapp_tienda',
            'costo_envio_local', 'costo_envio_nacional', 'qr_cobro_r2_key')`
  ).all();
  return Response.json(Object.fromEntries(results.map((a) => [a.clave, a.valor])));
}

export async function onRequestPut({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const sentencias = [];
  for (const clave of EDITABLES) {
    if (clave in body) {
      sentencias.push(
        env.DB.prepare(
          'INSERT INTO settings (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor'
        ).bind(clave, String(body[clave] ?? ''))
      );
    }
  }
  if (sentencias.length > 0) await env.DB.batch(sentencias);
  return Response.json({ ok: true });
}
