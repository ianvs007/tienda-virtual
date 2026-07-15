// POST /api/admin/password — cambia la contraseña del admin autenticado.
import { hashPassword, verificarPassword } from '../../lib/auth.js';

export async function onRequestPost({ env, request, data }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const actual = String(body.actual || '');
  const nueva = String(body.nueva || '');

  if (!actual || !nueva) {
    return Response.json({ error: 'Completa contraseña actual y nueva' }, { status: 400 });
  }
  if (nueva.length < 8) {
    return Response.json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' }, { status: 400 });
  }

  const email = data.adminEmail;
  const admin = await env.DB.prepare('SELECT password_hash FROM admins WHERE email = ?').bind(email).first();
  if (!admin) return Response.json({ error: 'Admin no encontrado' }, { status: 404 });

  const ok = await verificarPassword(actual, admin.password_hash);
  if (!ok) return Response.json({ error: 'La contraseña actual no coincide' }, { status: 401 });

  await env.DB.prepare('UPDATE admins SET password_hash = ? WHERE email = ?')
    .bind(await hashPassword(nueva), email)
    .run();

  return Response.json({ ok: true });
}
