// GET /api/img/<clave> — entrega una foto guardada en R2 (con caché de 1 año).
export async function onRequestGet({ env, params }) {
  const key = (params.key || []).join('/');
  if (!key) return new Response('Falta la clave', { status: 400 });

  // Los comprobantes de pago son privados: solo el panel admin puede verlos.
  if (key.startsWith('comprobantes/')) return new Response('No autorizado', { status: 403 });

  const objeto = await env.FOTOS.get(key);
  if (!objeto) return new Response('Imagen no encontrada', { status: 404 });

  const headers = new Headers();
  objeto.writeHttpMetadata(headers);
  headers.set('etag', objeto.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  return new Response(objeto.body, { headers });
}
