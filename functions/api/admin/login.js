// POST /api/admin/login — inicia sesión del dueño.
import { verificarPassword, obtenerSecreto, crearCookieSesion } from '../../lib/auth.js';

export async function onRequestPost({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const admin = await env.DB.prepare('SELECT email, password_hash FROM admins WHERE email = ?')
    .bind(email)
    .first();

  // Mismo mensaje exista o no el correo (no revelar cuáles existen).
  if (!admin || !(await verificarPassword(password, admin.password_hash)))
    return Response.json({ error: 'Correo o contraseña incorrectos' }, { status: 401 });

  const secreto = await obtenerSecreto(env);
  const secure = new URL(request.url).protocol === 'https:';
  return Response.json(
    { ok: true, email: admin.email },
    { headers: { 'Set-Cookie': await crearCookieSesion(admin.email, secreto, { secure }) } }
  );
}
