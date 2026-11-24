// Primera puesta en marcha del panel:
// GET  → indica si falta crear el admin y si el setup está habilitado.
// POST → crea el ÚNICO admin inicial. Exige DOS condiciones:
//   1) que no exista ningún admin (la inserción es atómica: INSERT ... WHERE NOT EXISTS);
//   2) que el entorno tenga el secreto ADMIN_SETUP_SECRET (variable/secret de
//      Cloudflare Pages) y que el cliente lo envíe (cabecera X-Setup-Secret o
//      campo setupSecret). Sin secreto configurado el setup queda DESHABILITADO:
//      una BD restaurada/reseteada vacía ya no permite que cualquiera cree el admin.
// Los secretos erróneos se limitan por IP (lib/intentos.js).
import { hashPassword, obtenerSecreto, crearCookieSesion } from '../../lib/auth.js';
import { iguales } from '../../lib/seguridad.js';
import {
  estaBloqueado,
  registrarFallo,
  llavesSetup,
  respuestaBloqueado,
} from '../../lib/intentos.js';

const ACCION = 'setup_fallo';

function secretoConfigurado(env) {
  return String(env.ADMIN_SETUP_SECRET || '').trim();
}

export async function onRequestGet({ env }) {
  const fila = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
  const necesitaSetup = fila.n === 0;
  return Response.json({
    necesitaSetup,
    // La UI pide el secreto solo si hay setup pendiente; si no está configurado
    // en el entorno, el POST responderá 403 setup_deshabilitado.
    setupHabilitado: necesitaSetup && secretoConfigurado(env) !== '',
  });
}

export async function onRequestPost({ env, request }) {
  const fila = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
  if (fila.n > 0) return Response.json({ error: 'El panel ya está configurado' }, { status: 403 });

  const esperado = secretoConfigurado(env);
  if (!esperado) {
    return Response.json(
      {
        error:
          'El alta inicial está deshabilitada: falta configurar ADMIN_SETUP_SECRET en el entorno de Cloudflare Pages.',
        codigo: 'setup_deshabilitado',
      },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const llaves = llavesSetup(request);
  if (await estaBloqueado(env, ACCION, llaves)) {
    return respuestaBloqueado('Demasiados intentos con un secreto incorrecto. Espera 15 minutos.');
  }
  const recibido = String(request.headers.get('x-setup-secret') || body?.setupSecret || '').trim();
  if (!(await iguales(recibido, esperado))) {
    await registrarFallo(env, ACCION, llaves);
    return Response.json({ error: 'Secreto de configuración incorrecto', codigo: 'setup_secreto' }, { status: 403 });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return Response.json({ error: 'Correo inválido' }, { status: 400 });
  if (password.length < 8)
    return Response.json({ error: 'La contraseña debe tener al menos 8 caracteres' }, { status: 400 });

  // Atómico: si otro setup ganó la carrera, no inserta nada (changes = 0).
  const r = await env.DB.prepare(
    'INSERT INTO admins (email, password_hash) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM admins)'
  )
    .bind(email, await hashPassword(password))
    .run();
  if (!(r?.meta?.changes > 0)) {
    return Response.json({ error: 'El panel ya está configurado' }, { status: 403 });
  }

  const secreto = await obtenerSecreto(env);
  const secure = new URL(request.url).protocol === 'https:';
  return Response.json(
    { ok: true, email },
    { status: 201, headers: { 'Set-Cookie': await crearCookieSesion(email, secreto, { secure }) } }
  );
}
