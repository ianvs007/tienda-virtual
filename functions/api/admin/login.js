// POST /api/admin/login — inicia sesión del dueño.
// Protegido contra fuerza bruta (lib/intentos.js: 429 tras demasiados fallos) y
// con migración transparente de hashes PBKDF2 a más iteraciones.
import {
  verificarPassword,
  necesitaRehash,
  hashPassword,
  gastarTiempoDeVerificacion,
  obtenerSecreto,
  crearCookieSesion,
} from '../../lib/auth.js';
import {
  estaBloqueado,
  registrarFallo,
  limpiarFallos,
  llavesLogin,
  respuestaBloqueado,
} from '../../lib/intentos.js';

const ACCION = 'login_fallo';

export async function onRequestPost({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const llaves = llavesLogin(request, email);

  if (await estaBloqueado(env, ACCION, llaves)) {
    return respuestaBloqueado('Demasiados intentos fallidos. Espera 15 minutos antes de volver a intentar.');
  }

  const admin = await env.DB.prepare('SELECT email, password_hash FROM admins WHERE email = ?')
    .bind(email)
    .first();

  // Mismo mensaje (y mismo costo de CPU) exista o no el correo.
  let correcto = false;
  if (admin) correcto = await verificarPassword(password, admin.password_hash);
  else await gastarTiempoDeVerificacion(password);

  if (!correcto) {
    await registrarFallo(env, ACCION, llaves);
    return Response.json({ error: 'Correo o contraseña incorrectos' }, { status: 401 });
  }

  await limpiarFallos(env, ACCION, llaves.ipCorreo.llave);

  // Migración transparente: si el hash usa menos iteraciones que el vigente, se
  // re-guarda ahora que conocemos la contraseña en claro. El WHERE sobre el hash
  // viejo evita pisar un cambio de contraseña concurrente.
  if (necesitaRehash(admin.password_hash)) {
    await env.DB.prepare('UPDATE admins SET password_hash = ? WHERE email = ? AND password_hash = ?')
      .bind(await hashPassword(password), admin.email, admin.password_hash)
      .run();
  }

  const secreto = await obtenerSecreto(env);
  const secure = new URL(request.url).protocol === 'https:';
  return Response.json(
    { ok: true, email: admin.email },
    { headers: { 'Set-Cookie': await crearCookieSesion(admin.email, secreto, { secure }) } }
  );
}
