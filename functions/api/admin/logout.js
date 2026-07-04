// POST /api/admin/logout — cierra la sesión.
import { cookieCerrarSesion } from '../../lib/auth.js';

export async function onRequestPost() {
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookieCerrarSesion() } });
}
