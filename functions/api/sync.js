// POST /api/sync — sincronización directa de stock desde el POS (sin Excel).
// Endpoint machine-to-machine: NO pasa por el middleware de /api/admin, se
// autentica con el token de settings.sync_token (Bearer).
// Body: { filas: [{ codigo, nombre, talla, color, stock, precio }] }.
// 1) Upsert de catálogo por código+talla+color: si el código no existe crea
//    prenda+variante; si existe y falta la variante, la crea.
// 2) El resto sigue el flujo de sincronización de stock (functions/api/admin/
//    sincronizar/index.js), más las ventas en línea capturadas ANTES de
//    aplicar, para que el POS las descuente localmente.
import {
  reconciliarSyncPOS,
  obtenerUltimaSincronizacion,
  marcarUltimaSincronizacion,
  validarTokenSync,
} from '../lib/sincronizar.js';
import { sentenciaLogStock } from '../lib/stockLog.js';
import { jsonSync, preflightSync } from '../lib/cors.js';

const MAX_FILAS = 5000;

// Preflight CORS: el POS es una app local (otro origen) y el navegador lo
// exige antes del POST con Authorization.
export function onRequestOptions() {
  return preflightSync();
}

export async function onRequestPost({ env, request }) {
  try {
    const rechazo = await validarTokenSync(env, request);
    if (rechazo) return rechazo;

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonSync({ error: 'Solicitud inválida' }, { status: 400 });
    }

    const filas = Array.isArray(body.filas) ? body.filas : [];
    if (filas.length === 0 || filas.length > MAX_FILAS)
      return jsonSync({ error: 'El cuerpo no tiene filas válidas (1 a 5000)' }, { status: 400 });

    // Compatibilidad histórica: /api/sync sigue funcionando como commit en una
    // sola fase, con cutoff = ultima_sincronizacion.
    const finalizar = body.finalizar !== false;
    const cutoff = await obtenerUltimaSincronizacion(env);

    const { ahora, upsert, resultado, ventasPostCutoff } = await reconciliarSyncPOS(env, {
      cutoff,
      filas,
    });
    const porClaveCatalogo = new Map(
      upsert.detalle.map((d) => [`${d.codigo}|${d.talla || ''}|${d.color || ''}`, d])
    );
    const usadas = new Set();
    const detalle = resultado.map((r) => {
      const k = `${r.codigo}|${r.talla || ''}|${r.color || ''}`;
      const c = porClaveCatalogo.get(k);
      if (!c) return r;
      usadas.add(k);
      return {
        ...r,
        accion: c.accion,
        cruce: c.cruce || r.cruce,
        duplicado: c.duplicado || r.duplicado,
        aviso: c.aviso || r.aviso || null,
      };
    });
    for (const [k, c] of porClaveCatalogo.entries()) {
      if (!usadas.has(k)) detalle.push(c);
    }
    const cambios = resultado.filter((r) => r.varianteId && r.stockNuevo !== r.stockActual);
    const sentencias = cambios.map((r) =>
      env.DB.prepare('UPDATE product_variants SET stock = ? WHERE id = ?').bind(
        r.stockNuevo,
        r.varianteId
      )
    );
    // Auditoría: cada variante ajustada por la sincronización.
    for (const r of cambios) {
      sentencias.push(
        sentenciaLogStock(env, {
          variantId: r.varianteId,
          codigo: r.codigo,
          nombre: r.nombre || '',
          talla: r.talla,
          color: r.color,
          anterior: r.stockActual,
          nuevo: r.stockNuevo,
          origen: 'sincronizacion',
        })
      );
    }
    // Un lote intermedio sin cambios dejaría el batch vacío y D1 lanza (1101).
    if (sentencias.length > 0) await env.DB.batch(sentencias);
    if (finalizar) await marcarUltimaSincronizacion(env, ahora);

    return jsonSync({
      ok: true,
      cutoff,
      filas: filas.length,
      creadas: upsert.creadas,
      actualizadas: cambios.length,
      advertencias: detalle.filter((r) => r.aviso).length,
      duplicados: upsert.detalle.filter((r) => r.duplicado),
      cruces: upsert.detalle.filter((r) => r.cruce),
      detalle,
      ventasPostCutoff: ventasPostCutoff,
      ultima_sincronizacion: finalizar ? ahora : cutoff,
      // Compatibilidad hacia atrás:
      ventas: ventasPostCutoff,
    });
  } catch (err) {
    console.error('POST /api/sync:', err);
    // Siempre con CORS: si el Worker explota sin headers, el navegador del POS
    // solo ve "CORS error" / "Failed to fetch" y oculta el 500 real.
    return jsonSync(
      { error: err?.message || String(err) || 'Error interno en sincronización' },
      { status: 500 }
    );
  }
}
