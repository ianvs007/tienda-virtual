// GET /api/productos           — lista prendas activas con su primera foto.
// GET /api/productos?categoria=3 — filtradas por categoría.
import { adminDesdeRequest } from '../lib/auth.js';

export async function onRequestGet({ env, request }) {
  const categoria = new URL(request.url).searchParams.get('categoria');

  let sql = `SELECT p.id, p.nombre, p.descripcion, p.precio, p.categoria_id,
                    (SELECT r2_key FROM product_images i
                      WHERE i.product_id = p.id ORDER BY i.orden LIMIT 1) AS imagen,
                    (SELECT COALESCE(SUM(v.stock), 0) FROM product_variants v
                      WHERE v.product_id = p.id) AS stock_total
               FROM products p
              WHERE p.activo = 1`;
  const params = [];

  if (categoria) {
    sql += ' AND p.categoria_id = ?';
    params.push(categoria);
  }
  sql += ' ORDER BY p.creado_en DESC';

  const { results } = await env.DB.prepare(sql)
    .bind(...params)
    .all();

  return Response.json(results);
}

// POST /api/productos — alta de prenda (requiere admin por cookie o Bearer).
export async function onRequestPost({ env, request }) {
  const adminEmail = await adminDesdeRequest(request, env);
  if (!adminEmail) return Response.json({ error: 'No autorizado' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const nombre = String(body.nombre || '').trim();
  const precio = Number(body.precio);
  const descripcion = String(body.descripcion || '').trim();
  const categoriaId = body.categoria_id ? Number(body.categoria_id) : null;
  const codigo = String(body.codigo || '').trim();

  if (!nombre || !Number.isFinite(precio) || precio < 0) {
    return Response.json({ error: 'nombre y precio son obligatorios' }, { status: 400 });
  }
  if (codigo.length > 50) {
    return Response.json({ error: 'código demasiado largo' }, { status: 400 });
  }
  if (categoriaId !== null && (!Number.isInteger(categoriaId) || categoriaId <= 0)) {
    return Response.json({ error: 'categoria_id inválida' }, { status: 400 });
  }

  const variantesEntrada = Array.isArray(body.variantes) ? body.variantes : [];
  let variantes = variantesEntrada
    .map((v) => ({
      talla: String(v.talla || '').trim(),
      color: String(v.color || '').trim(),
      stock: Number(v.stock),
    }))
    .filter((v) => Number.isInteger(v.stock) && v.stock >= 0);

  if (variantes.length === 0) {
    const stock = Number(body.stock ?? 0);
    if (!Number.isInteger(stock) || stock < 0) {
      return Response.json({ error: 'stock inválido' }, { status: 400 });
    }
    variantes = [{ talla: '', color: '', stock }];
  }

  let r;
  try {
    r = await env.DB.prepare(
      'INSERT INTO products (nombre, descripcion, precio, categoria_id, codigo) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(nombre, descripcion, precio, categoriaId, codigo || null)
      .run();
  } catch {
    return Response.json({ error: 'Ese código ya está en uso en otra prenda' }, { status: 409 });
  }

  const id = r.meta.last_row_id;
  await env.DB.batch(
    variantes.map((v) =>
      env.DB.prepare(
        'INSERT INTO product_variants (product_id, talla, color, stock) VALUES (?, ?, ?, ?)'
      ).bind(id, v.talla, v.color, v.stock)
    )
  );

  return Response.json({ ok: true, id }, { status: 201 });
}
