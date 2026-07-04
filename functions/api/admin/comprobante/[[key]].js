// GET /api/admin/comprobante/<clave> — ver un comprobante de pago (solo admin;
// el middleware de /api/admin ya validó la sesión).
export async function onRequestGet({ env, params }) {
  const key = (params.key || []).join('/');
  if (!key.startsWith('comprobantes/')) return new Response('Clave inválida', { status: 400 });

  const objeto = await env.FOTOS.get(key);
  if (!objeto) return new Response('No encontrado', { status: 404 });

  const headers = new Headers();
  objeto.writeHttpMetadata(headers);
  headers.set('cache-control', 'private, no-store');
  return new Response(objeto.body, { headers });
}
