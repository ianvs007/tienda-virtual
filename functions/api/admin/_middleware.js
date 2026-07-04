// Protege todo /api/admin/* — solo pasa con sesión válida.
// Excepciones: login y setup (necesarios para entrar la primera vez).
import { sesionValida } from '../../lib/auth.js';

const LIBRES = ['/api/admin/login', '/api/admin/setup'];

export async function onRequest(context) {
  const ruta = new URL(context.request.url).pathname;
  if (LIBRES.includes(ruta)) return context.next();

  const email = await sesionValida(context.request, context.env);
  if (!email) return Response.json({ error: 'No autorizado' }, { status: 401 });

  context.data.adminEmail = email;
  return context.next();
}
