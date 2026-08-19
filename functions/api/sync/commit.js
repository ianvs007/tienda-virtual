import { reconciliarSyncPOS, marcarUltimaSincronizacion, validarTokenSync } from '../../lib/sincronizar.js';
import { sentenciaLogStock } from '../../lib/stockLog.js';
import { jsonSync, preflightSync } from '../../lib/cors.js';

const MAX_FILAS = 5000;

export function onRequestOptions() {
  return preflightSync();
}

export async function onRequestPost({ env, request }) {
  const rechazo = await validarTokenSync(env, request);
  if (rechazo) return rechazo;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonSync({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const cutoff = String(body.cutoff || '').trim();
  if (!cutoff) return jsonSync({ error: 'cutoff es obligatorio' }, { status: 400 });

  const filas = Array.isArray(body.filas) ? body.filas : [];
  if (filas.length === 0 || filas.length > MAX_FILAS)
    return jsonSync({ error: 'El cuerpo no tiene filas válidas (1 a 5000)' }, { status: 400 });

  const finalizar = body.finalizar !== false;
  const { ahora, upsert, resultado, ventasPostCutoff } = await reconciliarSyncPOS(env, { cutoff, filas });
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
    env.DB.prepare('UPDATE product_variants SET stock = ? WHERE id = ?').bind(r.stockNuevo, r.varianteId)
  );
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
  if (sentencias.length > 0) await env.DB.batch(sentencias);
  if (finalizar) await marcarUltimaSincronizacion(env, ahora);

  return jsonSync({
    ok: true,
    cutoff,
    creadas: upsert.creadas,
    actualizadas: cambios.length,
    advertencias: detalle.filter((r) => r.aviso).length,
    detalle,
    cruces: upsert.detalle.filter((r) => r.cruce),
    duplicados: upsert.detalle.filter((r) => r.duplicado),
    ventasPostCutoff,
    ultima_sincronizacion: finalizar ? ahora : cutoff,
  });
}
