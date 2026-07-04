// POST   /api/admin/productos/:id/imagenes — sube una foto de la prenda a R2.
// DELETE /api/admin/productos/:id/imagenes — quita una foto (body: { imageId }).
const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export async function onRequestPost({ env, params, request }) {
  const id = Number(params.id);
  const producto = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first();
  if (!producto) return Response.json({ error: 'Producto no encontrado' }, { status: 404 });

  let archivo;
  try {
    archivo = (await request.formData()).get('archivo');
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }
  if (!archivo || typeof archivo === 'string')
    return Response.json({ error: 'Adjunta una imagen' }, { status: 400 });
  const ext = TIPOS[archivo.type];
  if (!ext) return Response.json({ error: 'Solo JPG, PNG o WebP' }, { status: 400 });
  if (archivo.size > MAX_BYTES)
    return Response.json({ error: 'La imagen no debe superar 8 MB' }, { status: 400 });

  const key = `productos/${id}-${Date.now()}.${ext}`;
  await env.FOTOS.put(key, archivo.stream(), { httpMetadata: { contentType: archivo.type } });

  const orden = await env.DB.prepare(
    'SELECT COALESCE(MAX(orden), -1) + 1 AS sig FROM product_images WHERE product_id = ?'
  )
    .bind(id)
    .first();
  const r = await env.DB.prepare(
    'INSERT INTO product_images (product_id, r2_key, orden) VALUES (?, ?, ?)'
  )
    .bind(id, key, orden.sig)
    .run();

  return Response.json({ id: r.meta.last_row_id, r2_key: key }, { status: 201 });
}

export async function onRequestDelete({ env, params, request }) {
  const id = Number(params.id);
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const img = await env.DB.prepare(
    'SELECT id, r2_key FROM product_images WHERE id = ? AND product_id = ?'
  )
    .bind(Number(body.imageId), id)
    .first();
  if (!img) return Response.json({ error: 'Imagen no encontrada' }, { status: 404 });

  await env.FOTOS.delete(img.r2_key);
  await env.DB.prepare('DELETE FROM product_images WHERE id = ?').bind(img.id).run();
  return Response.json({ ok: true });
}
