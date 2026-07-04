// GET  /api/admin/categorias — todas (incluye inactivas).
// POST /api/admin/categorias — crea una categoría.
export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.nombre, c.orden, c.activa,
            (SELECT COUNT(*) FROM products p WHERE p.categoria_id = c.id) AS productos
       FROM categories c ORDER BY c.orden, c.nombre`
  ).all();
  return Response.json(results);
}

export async function onRequestPost({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }
  const nombre = String(body.nombre || '').trim();
  if (nombre.length < 2 || nombre.length > 60)
    return Response.json({ error: 'Nombre inválido' }, { status: 400 });

  try {
    const r = await env.DB.prepare('INSERT INTO categories (nombre) VALUES (?)').bind(nombre).run();
    return Response.json({ id: r.meta.last_row_id }, { status: 201 });
  } catch {
    return Response.json({ error: 'Esa categoría ya existe' }, { status: 409 });
  }
}
