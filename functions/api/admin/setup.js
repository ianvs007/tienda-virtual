// Primera puesta en marcha del panel:
// GET  → indica si falta crear el admin.
// POST → crea el ÚNICO admin inicial (solo funciona si no existe ninguno).
import { hashPassword, obtenerSecreto, crearCookieSesion } from '../../lib/auth.js';

export async function onRequestGet({ env }) {
  const fila = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
  return Response.json({ necesitaSetup: fila.n === 0 });
}

export async function onRequestPost({ env, request }) {
  const fila = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
  if (fila.n > 0) return Response.json({ error: 'El panel ya está configurado' }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return Response.json({ error: 'Correo inválido' }, { status: 400 });
  if (password.length < 8)
    return Response.json({ error: 'La contraseña debe tener al menos 8 caracteres' }, { status: 400 });

  await env.DB.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)')
    .bind(email, await hashPassword(password))
    .run();

  const secreto = await obtenerSecreto(env);
  const secure = new URL(request.url).protocol === 'https:';
  return Response.json(
    { ok: true, email },
    { status: 201, headers: { 'Set-Cookie': await crearCookieSesion(email, secreto, { secure }) } }
  );
}
