// Utilidades de seguridad compartidas (solo WebCrypto: corre en Workers y en node).

const enc = new TextEncoder();

async function sha256(texto) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(texto ?? ''))));
}

export async function sha256Hex(texto) {
  return [...(await sha256(texto))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compara dos textos en tiempo constante respecto de su contenido: se comparan
 * sus digests SHA-256 (longitud fija, así tampoco se filtra el largo del
 * secreto) con un OR acumulado sin cortocircuito.
 */
export async function iguales(a, b) {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let dif = 0;
  for (let i = 0; i < ha.length; i++) dif |= ha[i] ^ hb[i];
  return dif === 0;
}

/** Extrae el token de "Authorization: Bearer <token>" ('' si no hay). */
export function tokenBearer(request) {
  const autorizacion = request.headers.get('authorization') || '';
  return autorizacion.replace(/^Bearer\s+/i, '').trim();
}

/** true si el error de D1 es "no existe la tabla" (migración sin aplicar). */
export function esTablaFaltante(err) {
  return /no such table|no such column/i.test(String(err?.message || err || ''));
}
