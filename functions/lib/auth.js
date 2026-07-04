// Utilidades de autenticación del panel admin.
// - Contraseña: PBKDF2-SHA256 con sal aleatoria (WebCrypto, nativo en Workers).
// - Sesión: token firmado con HMAC-SHA256 en cookie HttpOnly.

const ITERACIONES = 50000;
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

async function pbkdf2(password, sal) {
  const clave = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: sal, iterations: ITERACIONES, hash: 'SHA-256' },
    clave,
    256
  );
}

export async function hashPassword(password) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, sal);
  return `pbkdf2$${ITERACIONES}$${aB64url(sal)}$${aB64url(hash)}`;
}

export async function verificarPassword(password, guardado) {
  const partes = String(guardado).split('$');
  if (partes.length !== 4) return false;
  const hash = await pbkdf2(password, deB64url(partes[2]));
  const esperado = deB64url(partes[3]);
  const real = new Uint8Array(hash);
  if (real.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < real.length; i++) dif |= real[i] ^ esperado[i];
  return dif === 0;
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

export async function crearCookieSesion(email, secreto) {
  const payload = aB64url(enc.encode(JSON.stringify({ e: email, x: Date.now() + DURACION_MS })));
  const firma = await firmar(payload, secreto);
  const token = `${payload}.${firma}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${DURACION_MS / 1000}`;
}

export function cookieCerrarSesion() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

// Devuelve el email del admin si la sesión es válida, o null.
export async function sesionValida(request, env) {
  const galleta = request.headers.get('Cookie') || '';
  const m = galleta.match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, firma] = m[1].split('.');
  if (!payload || !firma) return null;
  const secreto = await obtenerSecreto(env);
  if ((await firmar(payload, secreto)) !== firma) return null;
  try {
    const datos = JSON.parse(new TextDecoder().decode(deB64url(payload)));
    if (Date.now() > datos.x) return null;
    return datos.e || null;
  } catch {
    return null;
  }
}
