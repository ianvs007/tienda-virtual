// POST /api/admin/sync-token — genera un token nuevo para la sync directa del
// POS (POST /api/sync). Se devuelve completo UNA sola vez, acá; después la UI
// solo muestra una máscara (ver GET /api/admin/ajustes).
// DELETE /api/admin/sync-token — lo revoca: queda vacío y /api/sync responde
// 503 hasta que se genere uno nuevo.
// Protegido por el middleware de /api/admin (sesión), no valida nada propio.
export async function onRequestPost({ env }) {
  const token = crypto.randomUUID().replaceAll('-', '');
  await env.DB.prepare(
    `INSERT INTO settings (clave, valor) VALUES ('sync_token', ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
  )
    .bind(token)
    .run();
  return Response.json({ token });
}

export async function onRequestDelete({ env }) {
  await env.DB.prepare(
    `INSERT INTO settings (clave, valor) VALUES ('sync_token', '')
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
  ).run();
  return Response.json({ ok: true });
}
