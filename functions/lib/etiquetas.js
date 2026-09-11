// Etiquetas físicas (shortCode de UNIDAD del POS) como códigos adicionales de
// búsqueda. Migración 007. Ver tienda de ropas/docs/DISENO_SYNC_EVENTOS.md §8.
//
// El POS imprime en cada prenda el código de su unidad (`barcodes.shortCode`),
// que NO es el código del producto (`products.codigo`). El cliente busca en la
// web el número que tiene en la mano; sin esta tabla la nube encontraba otra
// prenda (02797 = etiqueta de VESTIDO BRILLO y a la vez código de modelo de
// VESTIDO VICTORIANO) o ninguna (prendas con varias unidades).
//
// Reglas:
//  - La identidad sigue siendo `global_id`; la etiqueta es un alias de búsqueda
//    vinculado al producto por esa identidad.
//  - `disponible` es INFORMATIVO (estado de la unidad en el POS al último
//    snapshot completo). No suma ni reemplaza el stock, que sigue siendo
//    snapshot + eventos sin ack. Identificar un producto por etiqueta NO reserva
//    esa unidad física: la web vende "1 unidad del producto" y el POS decide
//    qué unidad marca (FIFO) al aplicar el evento.
//  - Publicación atómica por sesión: los lotes se acumulan en la presencia de
//    la sesión (lib/sesionSync.js, dos filas de `settings`); `finalizar` valida
//    el conteo, compara contra lo publicado y escribe SOLO las diferencias en un
//    solo batch. Un corte nunca deja lo publicado a medias ni borra lo previo.
//    (Hasta el 11/09/2026 cada lote aterrizaba fila por fila en
//    `sync_etiquetas_pendientes`: ~3.600 escrituras por sync aunque nada
//    cambiara, incompatible con la cuota gratuita de D1. La tabla queda sin uso.)
//  - Una etiqueta en varios productos se guarda tal cual y se muestra como
//    CONFLICTO; nunca se elige una en silencio ni se cae al código de modelo.
import { normalizarEtiqueta } from './codigo.js';
import { trozos } from './sesionSync.js';

export const MAX_ETIQUETAS_LOTE = 500;
// 5 parámetros por fila → 100 por sentencia (máximo de D1).
export const FILAS_POR_INSERT = 20;
// 2 parámetros por par (etiqueta, product_id) → 100 por sentencia.
export const PARES_POR_DELETE = 50;

const texto = (v) => String(v ?? '').trim();

/**
 * PURA. Valida y deduplica un lote de etiquetas tal como lo manda el POS.
 * @param {Array<{ etiqueta, globalId, disponible }>} etiquetas
 * @returns {{ filas: Array<{ etiqueta, globalId, disponible: 0|1 }>, rechazadas: Array<{ etiqueta, globalId, motivo }> }}
 */
export function planificarEtiquetas(etiquetas = []) {
  const filas = new Map(); // `${etiqueta}|${globalId}` → fila
  const rechazadas = [];
  for (const e of etiquetas || []) {
    const etiqueta = normalizarEtiqueta(e?.etiqueta);
    const globalId = texto(e?.globalId);
    if (!etiqueta) {
      rechazadas.push({ etiqueta: texto(e?.etiqueta), globalId, motivo: 'Etiqueta inválida: se esperan 1 a 5 dígitos' });
      continue;
    }
    if (!globalId) {
      rechazadas.push({ etiqueta, globalId: '', motivo: 'Etiqueta sin globalId' });
      continue;
    }
    const disponible = e?.disponible === false || e?.disponible === 0 || e?.disponible === '0' ? 0 : 1;
    const clave = `${etiqueta}|${globalId}`;
    const previa = filas.get(clave);
    // Misma (etiqueta, producto) repetida: disponible si alguna unidad lo está.
    filas.set(clave, { etiqueta, globalId, disponible: previa ? Math.max(previa.disponible, disponible) : disponible });
  }
  return { filas: [...filas.values()], rechazadas };
}

/**
 * PURA. Clasifica el resultado de una búsqueda por etiqueta.
 * @param {string|null} etiqueta  ya normalizada (o null si el término no es una etiqueta)
 * @param {Array<{ product_id, global_id, disponible, nombre, codigo, activo }>} filas
 * @returns {{ tipo: 'no_es_etiqueta'|'ninguna'|'etiqueta'|'etiqueta_conflicto', etiqueta, productos }}
 */
export function resolverEtiqueta(etiqueta, filas = []) {
  if (!etiqueta) return { tipo: 'no_es_etiqueta', etiqueta: null, productos: [] };
  const porProducto = new Map();
  for (const f of filas) {
    const id = Number(f.product_id);
    const previa = porProducto.get(id);
    const disponible = Number(f.disponible) === 1;
    porProducto.set(id, {
      id,
      global_id: f.global_id || '',
      nombre: f.nombre || '',
      codigo: f.codigo || null,
      activo: Number(f.activo ?? 1) === 1,
      disponible: previa ? previa.disponible || disponible : disponible,
    });
  }
  const productos = [...porProducto.values()];
  if (productos.length === 0) return { tipo: 'ninguna', etiqueta, productos };
  if (productos.length === 1) return { tipo: 'etiqueta', etiqueta, productos };
  return { tipo: 'etiqueta_conflicto', etiqueta, productos };
}

// ─────────────────────────────── D1 ────────────────────────────────

/**
 * PURA. Compara las etiquetas vistas en la sesión con las publicadas y decide
 * qué escribir. Solo salen sentencias para lo que realmente cambia.
 * @param {Object} p
 * @param {Map<string, 0|1>} p.vistas      "<etiqueta>|<globalId>" → disponible
 * @param {Array<{ id, global_id }>} p.productos   catálogo (para resolver product_id)
 * @param {Array<{ etiqueta, product_id, global_id, disponible }>} p.publicadas
 * @returns {{ retirar: Array<{ etiqueta, productId }>, upsert: Array<{ etiqueta, productId, globalId, disponible }>, publicadas: number, sinProducto: number }}
 */
export function planificarPublicacionEtiquetas({ vistas = new Map(), productos = [], publicadas = [] }) {
  const idPorGlobal = new Map();
  for (const p of productos) {
    const g = texto(p.global_id);
    if (g) idPorGlobal.set(g, Number(p.id));
  }

  const deseadas = new Map(); // "<etiqueta>|<productId>" → fila
  let sinProducto = 0;
  for (const [clave, disponible] of vistas) {
    const sep = clave.indexOf('|');
    const etiqueta = sep >= 0 ? clave.slice(0, sep) : clave;
    const globalId = sep >= 0 ? clave.slice(sep + 1) : '';
    const productId = idPorGlobal.get(globalId);
    if (productId === undefined) {
      sinProducto++;
      continue;
    }
    const k = `${etiqueta}|${productId}`;
    const previa = deseadas.get(k);
    deseadas.set(k, {
      etiqueta,
      productId,
      globalId,
      disponible: Math.max(previa?.disponible ?? 0, Number(disponible) ? 1 : 0),
    });
  }

  const retirar = [];
  const yaIgual = new Set();
  for (const e of publicadas) {
    const k = `${e.etiqueta}|${Number(e.product_id)}`;
    const deseada = deseadas.get(k);
    if (!deseada) {
      retirar.push({ etiqueta: e.etiqueta, productId: Number(e.product_id) });
      continue;
    }
    if (Number(e.disponible) === deseada.disponible && texto(e.global_id) === deseada.globalId) yaIgual.add(k);
  }
  const upsert = [...deseadas.entries()].filter(([k]) => !yaIgual.has(k)).map(([, f]) => f);

  return { retirar, upsert, publicadas: deseadas.size, sinProducto };
}

/** Lo publicado hoy (una lectura por sync, ~una fila por etiqueta). */
export async function leerEtiquetasPublicadas(env) {
  const { results } = await env.DB.prepare(
    'SELECT etiqueta, product_id, global_id, disponible FROM product_etiquetas'
  ).all();
  return results;
}

/**
 * Sentencias (SIN ejecutar, van en el MISMO batch que el cierre de sesión) que
 * aplican un plan de publicación: retiros por pares (etiqueta, product_id) e
 * inserciones/actualizaciones multi-fila. Sin cambios → lista vacía.
 */
export function sentenciasAplicarPublicacion(env, plan) {
  const sentencias = [];
  for (const trozo of trozos(plan.retirar, PARES_POR_DELETE)) {
    const cond = trozo.map(() => '(etiqueta = ? AND product_id = ?)').join(' OR ');
    const params = [];
    for (const r of trozo) params.push(r.etiqueta, r.productId);
    sentencias.push(env.DB.prepare(`DELETE FROM product_etiquetas WHERE ${cond}`).bind(...params));
  }
  for (const trozo of trozos(plan.upsert, FILAS_POR_INSERT)) {
    const valores = trozo.map(() => "(?, ?, ?, ?, datetime('now'))").join(', ');
    const params = [];
    for (const f of trozo) params.push(f.etiqueta, f.productId, f.globalId, f.disponible);
    sentencias.push(
      env.DB.prepare(
        `INSERT INTO product_etiquetas (etiqueta, product_id, global_id, disponible, actualizado_en)
         VALUES ${valores}
         ON CONFLICT(etiqueta, product_id) DO UPDATE SET
           disponible = excluded.disponible,
           global_id = excluded.global_id,
           actualizado_en = excluded.actualizado_en`
      ).bind(...params)
    );
  }
  return sentencias;
}

/**
 * Busca los productos asociados a una etiqueta. `valor` se normaliza estricto:
 * si no es una etiqueta (letras, >5 dígitos) devuelve tipo 'no_es_etiqueta'.
 * @param {Object} [opts]
 * @param {boolean} [opts.soloActivos=true]  el catálogo público ignora productos inactivos
 */
export async function buscarPorEtiqueta(env, valor, { soloActivos = true } = {}) {
  const etiqueta = normalizarEtiqueta(valor);
  if (!etiqueta) return resolverEtiqueta(null, []);
  const { results } = await env.DB.prepare(
    `SELECT e.product_id, e.global_id, e.disponible, p.nombre, p.codigo, p.activo
       FROM product_etiquetas e
       JOIN products p ON p.id = e.product_id
      WHERE e.etiqueta = ?${soloActivos ? ' AND p.activo = 1' : ''}`
  )
    .bind(etiqueta)
    .all();
  return resolverEtiqueta(etiqueta, results);
}

/** Etiquetas publicadas de un producto (para la ficha del admin). */
export async function etiquetasDeProducto(env, productId) {
  const { results } = await env.DB.prepare(
    'SELECT etiqueta, disponible FROM product_etiquetas WHERE product_id = ? ORDER BY etiqueta'
  )
    .bind(productId)
    .all();
  return results.map((r) => ({ etiqueta: r.etiqueta, disponible: Number(r.disponible) === 1 }));
}
