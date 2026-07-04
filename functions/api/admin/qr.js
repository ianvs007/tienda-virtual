// POST /api/admin/qr — sube la imagen del QR de cobro (banco/billetera del dueño).
const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 5 * 1024 * 1024;

export async function onRequestPost({ env, request }) {
  let archivo;
  try {
    archivo = (await request.formData()).get('archivo');
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }
  if (!archivo || typeof archivo === 'string')
    return Response.json({ error: 'Adjunta la imagen del QR' }, { status: 400 });
  const ext = TIPOS[archivo.type];
  if (!ext) return Response.json({ error: 'Solo JPG, PNG o WebP' }, { status: 400 });
  if (archivo.size > MAX_BYTES)
    return Response.json({ error: 'La imagen no debe superar 5 MB' }, { status: 400 });

  const key = `config/qr-cobro-${Date.now()}.${ext}`;
  await env.FOTOS.put(key, archivo.stream(), { httpMetadata: { contentType: archivo.type } });

  await env.DB.prepare(
    "INSERT INTO settings (clave, valor) VALUES ('qr_cobro_r2_key', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor"
  )
    .bind(key)
    .run();

  return Response.json({ ok: true, r2_key: key });
}
