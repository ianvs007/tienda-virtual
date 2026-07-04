// GET    /api/admin/productos/:id — detalle completo para editar.
// PUT    /api/admin/productos/:id — actualiza prenda y variantes.
// DELETE /api/admin/productos/:id — desactiva (no borra: los pedidos la referencian).
import { validarProducto } from '../productos.js';

export async function onRequestGet({ env, params }) {
  const id = Number(params.id);
  const producto = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!producto) return Response.json({ error: 'No encontrado' }, { status: 404 });

  const [variantes, imagenes] = await Promise.all([
    env.DB.prepare('SELECT id, talla, color, stock FROM product_variants WHERE product_id = ? ORDER BY id')
      .bind(id)
      .all(),
    env.DB.prepare('SELECT id, r2_key, orden FROM product_images WHERE product_id = ? ORDER BY orden')
      .bind(id)
      .all(),
  ]);

  return Response.json({ ...producto, variantes: variantes.results, imagenes: imagenes.results });
}

export async function onRequestPut({ env, params, request }) {
  const id = Number(params.id);
  const existe = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first();
  if (!existe) return Response.json({ error: 'No encontrado' }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }
  const datos = validarProducto(body);
  if (datos.error) return Response.json({ error: datos.error }, { status: 400 });

  await env.DB.prepare(
    'UPDATE products SET nombre = ?, descripcion = ?, precio = ?, categoria_id = ?, activo = ? WHERE id = ?'
  )
    .bind(datos.nombre, datos.descripcion, datos.precio, datos.categoriaId, body.activo ? 1 : 0, id)
    .run();

  // Variantes: actualiza las existentes, crea las nuevas, intenta borrar las quitadas.
  const { results: actuales } = await env.DB.prepare(
    'SELECT id FROM product_variants WHERE product_id = ?'
  )
    .bind(id)
    .all();
  const idsEnviados = new Set(datos.variantes.filter((v) => v.id).map((v) => v.id));

  for (const v of datos.variantes) {
    if (v.id) {
      await env.DB.prepare(
        'UPDATE product_variants SET talla = ?, color = ?, stock = ? WHERE id = ? AND product_id = ?'
      )
        .bind(v.talla, v.color, v.stock, v.id, id)
        .run();
    } else {
      await env.DB.prepare(
        'INSERT INTO product_variants (product_id, talla, color, stock) VALUES (?, ?, ?, ?)'
      )
        .bind(id, v.talla, v.color, v.stock)
        .run();
    }
  }
  for (const a of actuales) {
    if (!idsEnviados.has(a.id)) {
      try {
        await env.DB.prepare('DELETE FROM product_variants WHERE id = ?').bind(a.id).run();
      } catch {
        // Referenciada por pedidos antiguos: se deja con stock 0.
        await env.DB.prepare('UPDATE product_variants SET stock = 0 WHERE id = ?').bind(a.id).run();
      }
    }
  }

  return Response.json({ ok: true });
}

export async function onRequestDelete({ env, params }) {
  await env.DB.prepare('UPDATE products SET activo = 0 WHERE id = ?').bind(Number(params.id)).run();
  return Response.json({ ok: true });
}
