// Utilidades de autenticación del panel admin.
// - Contraseña: PBKDF2-SHA256 con sal aleatoria (WebCrypto, nativo en Workers).
// - Sesión: token firmado con HMAC-SHA256 en cookie HttpOnly.

import { iguales } from './seguridad.js';

// Máximo que permite WebCrypto en Cloudflare Workers (más de 100 000 lanza
// NotSupportedError). Los hashes guardados con menos iteraciones (p. ej. los
// 50 000 históricos) siguen verificando con SUS iteraciones y se re-guardan con
// este valor en el siguiente login correcto (ver necesitaRehash).
const MAX_WORKERS = 100000;
export const ITERACIONES = 100000;
const ITERACIONES_MIN = 1000;
const COOKIE = 'admin_sesion';
const DURACION_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

const enc = new TextEncoder();

function aB64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
function deB64url(s) {
  s = s.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(s.padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
}

async function pbkdf2(password, sal, iteraciones = ITERACIONES) {
  const clave = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: sal, iterations: iteraciones, hash: 'SHA-256' },
    clave,
    256
  );
}

export async function hashPassword(password) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, sal);
  return `pbkdf2$${ITERACIONES}$${aB64url(sal)}$${aB64url(hash)}`;
}

// Formato guardado: pbkdf2$<iteraciones>$<sal b64url>$<hash b64url>
function parsearHash(guardado) {
  const partes = String(guardado).split('$');
  if (partes.length !== 4 || partes[0] !== 'pbkdf2') return null;
  const iteraciones = Number(partes[1]);
  if (!Number.isInteger(iteraciones) || iteraciones < ITERACIONES_MIN || iteraciones > MAX_WORKERS) return null;
  return { iteraciones, sal: deB64url(partes[2]), esperado: deB64url(partes[3]) };
}

export async function verificarPassword(password, guardado) {
  let datos;
  try {
    datos = parsearHash(guardado);
  } catch {
    return false;
  }
  if (!datos) return false;
  const real = new Uint8Array(await pbkdf2(password, datos.sal, datos.iteraciones));
  if (real.length !== datos.esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < real.length; i++) dif |= real[i] ^ datos.esperado[i];
  return dif === 0;
}

/** true si el hash guardado usa menos iteraciones que el valor vigente. */
export function necesitaRehash(guardado) {
  try {
    const datos = parsearHash(guardado);
    return !!datos && datos.iteraciones < ITERACIONES;
  } catch {
    return false;
  }
}

// Hash de relleno para igualar el tiempo de respuesta del login cuando el correo
// no existe (no revelar qué correos existen midiendo la demora).
export async function gastarTiempoDeVerificacion(password) {
  await pbkdf2(password, new Uint8Array(16), ITERACIONES);
}

// Secreto de sesión: se genera una vez y se guarda en settings.
export async function obtenerSecreto(env) {
  const fila = await env.DB.prepare("SELECT valor FROM settings WHERE clave = 'session_secret'").first();
  if (fila?.valor) return fila.valor;
  const secreto = aB64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare(
    "INSERT INTO settings (clave, valor) VALUES ('session_secret', ?) ON CONFLICT(clave) DO NOTHING"
  )
    .bind(secreto)
    .run();
  return secreto;
}

async function firmar(datos, secreto) {
  const clave = await crypto.subtle.importKey(
    'raw',
    enc.encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return aB64url(await crypto.subtle.sign('HMAC', clave, enc.encode(datos)));
}

export async function crearCookieSesion(email, secreto, opciones = {}) {
  const payload = aB64url(enc.encode(JSON.stringify({ e: email, x: Date.now() + DURACION_MS })));
  const firma = await firmar(payload, secreto);
  const token = `${payload}.${firma}`;
  const secure = opciones.secure !== false;
  const secureAttr = secure ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly${secureAttr}; SameSite=Strict; Max-Age=${DURACION_MS / 1000}`;
}

export function cookieCerrarSesion(opciones = {}) {
  const secure = opciones.secure !== false;
  const secureAttr = secure ? '; Secure' : '';
  return `${COOKIE}=; Path=/; HttpOnly${secureAttr}; SameSite=Strict; Max-Age=0`;
}

// Devuelve el email del admin si la sesión es válida, o null.
export async function sesionValida(request, env) {
  const galleta = request.headers.get('Cookie') || '';
  const m = galleta.match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!m) return null;
  return emailDesdeTokenSesion(m[1], env);
}

async function emailDesdeTokenSesion(token, env) {
  const [payload, firma] = String(token || '').split('.');
  if (!payload || !firma) return null;
  const secreto = await obtenerSecreto(env);
  if (!(await iguales(await firmar(payload, secreto), firma))) return null;
  try {
    const datos = JSON.parse(new TextDecoder().decode(deB64url(payload)));
    if (Date.now() > datos.x) return null;
    return datos.e || null;
  } catch {
    return null;
  }
}

// Permite autenticar admin desde cookie de sesión o header Authorization: Bearer <token>.
export async function adminDesdeRequest(request, env) {
  const porCookie = await sesionValida(request, env);
  if (porCookie) return porCookie;

  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  return emailDesdeTokenSesion(m[1].trim(), env);
}
