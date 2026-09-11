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
//  - Publicación atómica por sesión: los lotes aterrizan en
//    `sync_etiquetas_pendientes`; `finalizar` valida el conteo y publica en un
//    solo batch. Un corte nunca deja lo publicado a medias ni borra lo previo.
//  - Una etiqueta en varios productos se guarda tal cual y se muestra como
//    CONFLICTO; nunca se elige una en silencio ni se cae al código de modelo.
import { normalizarEtiqueta } from './codigo.js';

export const MAX_ETIQUETAS_LOTE = 500;
// 4 parámetros por fila → 80 por sentencia (D1 admite 100 como máximo).
export const FILAS_POR_INSERT = 20;

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

/** Sentencias (SIN ejecutar) que aterrizan filas ya planificadas en la sesión. Idempotentes. */
export function sentenciasAterrizarEtiquetas(env, sesion, filas) {
  const sentencias = [];
  for (let i = 0; i < filas.length; i += FILAS_POR_INSERT) {
    const trozo = filas.slice(i, i + FILAS_POR_INSERT);
    const valores = trozo.map(() => '(?, ?, ?, ?)').join(', ');
    const params = [];
    for (const f of trozo) params.push(sesion, f.etiqueta, f.globalId, f.disponible);
    sentencias.push(
      env.DB.prepare(
        `INSERT INTO sync_etiquetas_pendientes (sesion, etiqueta, global_id, disponible)
         VALUES ${valores}
         ON CONFLICT(sesion, etiqueta, global_id) DO UPDATE SET disponible = excluded.disponible`
      ).bind(...params)
    );
  }
  return sentencias;
}

/** Cuántas filas de etiquetas aterrizaron en la sesión y cuántas no tienen producto en la nube. */
export async function contarEtiquetasPendientes(env, sesion) {
  const [vistas, sinProducto] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM sync_etiquetas_pendientes WHERE sesion = ?').bind(sesion).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sync_etiquetas_pendientes s
        WHERE s.sesion = ? AND NOT EXISTS (SELECT 1 FROM products p WHERE p.global_id = s.global_id)`
    )
      .bind(sesion)
      .first(),
  ]);
  return { vistas: Number(vistas?.n) || 0, sinProducto: Number(sinProducto?.n) || 0 };
}

/**
 * Sentencias (SIN ejecutar, van en el MISMO batch que el cierre de sesión) que
 * publican las etiquetas de la sesión: retiran las ausentes, insertan o
 * actualizan las presentes resolviendo product_id por global_id, y limpian la
 * zona de aterrizaje (de esta sesión y de sesiones cortadas hace >2 días).
 * Orden de los resultados: [retiradas, publicadas, limpieza].
 */
export function sentenciasPublicarEtiquetas(env, sesion) {
  return [
    env.DB.prepare(
      `DELETE FROM product_etiquetas
        WHERE NOT EXISTS (
          SELECT 1 FROM sync_etiquetas_pendientes s
           WHERE s.sesion = ? AND s.etiqueta = product_etiquetas.etiqueta AND s.global_id = product_etiquetas.global_id
        )`
    ).bind(sesion),
    env.DB.prepare(
      `INSERT INTO product_etiquetas (etiqueta, product_id, global_id, disponible, actualizado_en)
       SELECT s.etiqueta, p.id, s.global_id, s.disponible, datetime('now')
         FROM sync_etiquetas_pendientes s
         JOIN products p ON p.global_id = s.global_id
        WHERE s.sesion = ?
       ON CONFLICT(etiqueta, product_id) DO UPDATE SET
         disponible = excluded.disponible,
         global_id = excluded.global_id,
         actualizado_en = excluded.actualizado_en
       WHERE product_etiquetas.disponible != excluded.disponible
          OR product_etiquetas.global_id != excluded.global_id`
    ).bind(sesion),
    env.DB.prepare(
      `DELETE FROM sync_etiquetas_pendientes WHERE sesion = ? OR creado_en < datetime('now', '-2 days')`
    ).bind(sesion),
  ];
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
