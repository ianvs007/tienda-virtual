// Bloqueo temporal por intentos fallidos (login del admin y secreto de setup).
// Reutiliza la tabla existente rate_log (migración 002: ip, accion, creado_en),
// así que NO requiere migración: cada fallo inserta filas con una "llave" en la
// columna ip (la IP, el par IP+correo y el correo) y accion = 'login_fallo' |
// 'setup_fallo'. Un acceso correcto borra el contador del par IP+correo.
//
// Tres contadores por ventana de 15 min:
//  - por IP+correo (5): frena el ataque dirigido desde una misma IP;
//  - por IP (20): frena el barrido de muchos correos desde una IP;
//  - por correo (30): frena el ataque distribuido (muchas IP, un correo). Es
//    deliberadamente alto: un atacante podría bloquear al dueño unos minutos,
//    pero no adivinar su clave.
// Un bloqueo responde 429 + Retry-After SIN verificar la contraseña (no gasta
// CPU de PBKDF2 ni revela si la clave era correcta).

import { ipCliente } from './limite.js';

export const VENTANA_MINUTOS = 15;
export const LIMITES_LOGIN = Object.freeze({ ipCorreo: 5, ip: 20, correo: 30 });
export const LIMITES_SETUP = Object.freeze({ ip: 5, global: 20 });

const MAX_CORREO = 254;

export function llavesLogin(request, correo) {
  const ip = ipCliente(request);
  const c = String(correo || '').slice(0, MAX_CORREO);
  return {
    ip: { llave: `ip:${ip}`, limite: LIMITES_LOGIN.ip },
    ipCorreo: { llave: `ipc:${ip}|${c}`, limite: LIMITES_LOGIN.ipCorreo },
    correo: { llave: `c:${c}`, limite: LIMITES_LOGIN.correo },
  };
}

export function llavesSetup(request) {
  return {
    ip: { llave: `ip:${ipCliente(request)}`, limite: LIMITES_SETUP.ip },
    global: { llave: 'global', limite: LIMITES_SETUP.global },
  };
}

/** true si alguno de los contadores ya alcanzó su límite en la ventana. */
export async function estaBloqueado(env, accion, llaves) {
  const lista = Object.values(llaves);
  const marcas = lista.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(
    `SELECT ip AS llave, COUNT(*) AS n FROM rate_log
      WHERE accion = ? AND ip IN (${marcas})
        AND creado_en > datetime('now', '-${VENTANA_MINUTOS} minutes')
      GROUP BY ip`
  )
    .bind(accion, ...lista.map((l) => l.llave))
    .all();
  const conteo = new Map((results || []).map((r) => [r.llave, Number(r.n) || 0]));
  return lista.some((l) => (conteo.get(l.llave) || 0) >= l.limite);
}

/** Registra un fallo en todos los contadores y poda lo viejo (1 batch). */
export async function registrarFallo(env, accion, llaves) {
  const sentencias = Object.values(llaves).map((l) =>
    env.DB.prepare('INSERT INTO rate_log (ip, accion) VALUES (?, ?)').bind(l.llave, accion)
  );
  sentencias.push(
    env.DB.prepare(
      `DELETE FROM rate_log WHERE accion = ? AND creado_en < datetime('now', '-1 day')`
    ).bind(accion)
  );
  await env.DB.batch(sentencias);
}

/** Acceso correcto: reinicia el contador del par IP+correo. */
export async function limpiarFallos(env, accion, llave) {
  await env.DB.prepare('DELETE FROM rate_log WHERE accion = ? AND ip = ?').bind(accion, llave).run();
}

export function respuestaBloqueado(mensaje) {
  const segundos = VENTANA_MINUTOS * 60;
  return Response.json(
    { error: mensaje, codigo: 'demasiados_intentos', reintentarEnSegundos: segundos },
    { status: 429, headers: { 'Retry-After': String(segundos), 'Cache-Control': 'no-store' } }
  );
}
