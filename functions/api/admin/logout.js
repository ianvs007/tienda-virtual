// POST /api/admin/logout — cierra la sesión.
import { cookieCerrarSesion } from '../../lib/auth.js';

export async function onRequestPost({ request }) {
  const secure = new URL(request.url).protocol === 'https:';
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookieCerrarSesion({ secure }) } });
}
