// Presencia de una sesión de snapshot guardada en `settings` (sin migración).
//
// Antes, cada lote marcaba `products.sesion_snapshot` en TODOS sus productos y
// cada etiqueta aterrizaba como fila en `sync_etiquetas_pendientes`: ~2.700 +
// ~3.600 filas ESCRITAS por sincronización aunque nada hubiera cambiado. Con el
// plan gratuito de D1 (100.000 filas escritas/día y 5.000.000 leídas/día) eso
// agota la cuota con la sync automática. Ahora la presencia de la sesión vive
// en dos filas de `settings` que se leen y reescriben una vez por lote:
//
//   sync_sesion:<sesion>:productos → JSON [product_id, ...]  (vistos en la sesión)
//   sync_sesion:<sesion>:etiquetas → JSON { "<etiqueta>|<globalId>": 0|1 }
//
// `finalizar` las lee una vez, calcula las diferencias contra lo publicado y
// escribe SOLO lo que cambió, en el mismo batch atómico de siempre.
export const PREFIJO_SESION = 'sync_sesion:';

const texto = (v) => String(v ?? '').trim();

export function claveProductos(sesion) {
  return `${PREFIJO_SESION}${texto(sesion)}:productos`;
}
export function claveEtiquetas(sesion) {
  return `${PREFIJO_SESION}${texto(sesion)}:etiquetas`;
}

/** Lee y parsea una fila de presencia; `porDefecto` si no existe o está corrupta. */
export async function leerPresencia(env, clave, porDefecto) {
  const fila = await env.DB.prepare('SELECT valor FROM settings WHERE clave = ?').bind(clave).first();
  if (!fila?.valor) return porDefecto;
  try {
    const v = JSON.parse(fila.valor);
    return v === null || typeof v !== 'object' ? porDefecto : v;
  } catch {
    return porDefecto;
  }
}

/** Sentencia (SIN ejecutar) que guarda una fila de presencia. Idempotente. */
export function sentenciaGuardarPresencia(env, clave, valor) {
  return env.DB.prepare(
    'INSERT INTO settings (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor'
  ).bind(clave, JSON.stringify(valor));
}

/** Sentencia (SIN ejecutar) que borra la presencia de UNA sesión. */
export function sentenciaLimpiarSesion(env, sesion) {
  return env.DB.prepare('DELETE FROM settings WHERE clave IN (?, ?)').bind(claveProductos(sesion), claveEtiquetas(sesion));
}

/**
 * Sentencia (SIN ejecutar) que borra la presencia de TODAS las sesiones salvo
 * la actual (restos de sesiones cortadas). `settings` es una tabla chica.
 */
export function sentenciaLimpiarOtrasSesiones(env, sesionActual) {
  return env.DB.prepare(
    `DELETE FROM settings WHERE clave LIKE ? AND clave NOT LIKE ?`
  ).bind(`${PREFIJO_SESION}%`, `${PREFIJO_SESION}${texto(sesionActual)}:%`);
}

/** Suma ids de producto a la presencia de la sesión (1 lectura + 1 escritura). */
export async function registrarProductosVistos(env, sesion, ids) {
  const clave = claveProductos(sesion);
  const previos = await leerPresencia(env, clave, []);
  const conjunto = new Set(Array.isArray(previos) ? previos.map(Number) : []);
  for (const id of ids) if (Number.isInteger(Number(id))) conjunto.add(Number(id));
  await sentenciaGuardarPresencia(env, clave, [...conjunto]).run();
  return conjunto.size;
}

/**
 * Suma filas de etiquetas planificadas a la presencia de la sesión. La misma
 * (etiqueta, globalId) repetida (otro lote, o reintento tras corte) queda
 * disponible si alguna unidad lo está. Devuelve el total acumulado.
 */
export async function registrarEtiquetasVistas(env, sesion, filas) {
  const clave = claveEtiquetas(sesion);
  const previas = await leerPresencia(env, clave, {});
  const mapa = Array.isArray(previas) ? {} : previas;
  for (const f of filas) {
    const k = `${f.etiqueta}|${f.globalId}`;
    mapa[k] = Math.max(Number(mapa[k]) || 0, f.disponible ? 1 : 0);
  }
  await sentenciaGuardarPresencia(env, clave, mapa).run();
  return Object.keys(mapa).length;
}

/** Lee la presencia de productos como Set de ids. */
export async function productosVistos(env, sesion) {
  const lista = await leerPresencia(env, claveProductos(sesion), []);
  return new Set((Array.isArray(lista) ? lista : []).map(Number));
}

/** Lee la presencia de etiquetas como Map "<etiqueta>|<globalId>" → 0|1. */
export async function etiquetasVistas(env, sesion) {
  const mapa = await leerPresencia(env, claveEtiquetas(sesion), {});
  return new Map(Object.entries(Array.isArray(mapa) ? {} : mapa).map(([k, v]) => [k, Number(v) ? 1 : 0]));
}

/** Parte una lista en trozos (D1 admite 100 parámetros por sentencia). */
export function trozos(lista, tam) {
  const out = [];
  for (let i = 0; i < lista.length; i += tam) out.push(lista.slice(i, i + tam));
  return out;
}
