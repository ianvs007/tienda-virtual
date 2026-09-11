// POST /api/sync/v2/etiquetas — un lote de etiquetas físicas del POS (máx 500).
// Body: { dispositivo, sesion, etiquetas: [{ etiqueta, globalId, disponible }] }
// La etiqueta es el shortCode de la UNIDAD (lo impreso en la prenda); se vincula
// al producto por globalId. Las filas aterrizan en sync_etiquetas_pendientes y
// se publican en bloque al finalizar la sesión (ver lib/etiquetas.js).
import { validarTokenSync } from '../../../lib/sincronizar.js';
import { recibirEtiquetas } from '../../../lib/syncV2.js';
import { MAX_ETIQUETAS_LOTE } from '../../../lib/etiquetas.js';
import { jsonSync, preflightSync } from '../../../lib/cors.js';

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

    const dispositivoId = String(body.dispositivo || '').trim();
    const sesion = String(body.sesion || '').trim();
    const etiquetas = Array.isArray(body.etiquetas) ? body.etiquetas : null;
    if (!dispositivoId) return jsonSync({ error: 'dispositivo es obligatorio' }, { status: 400 });
    if (!sesion) return jsonSync({ error: 'sesion es obligatoria' }, { status: 400 });
    if (!etiquetas || etiquetas.length === 0 || etiquetas.length > MAX_ETIQUETAS_LOTE)
      return jsonSync({ error: `El cuerpo no tiene etiquetas válidas (1 a ${MAX_ETIQUETAS_LOTE})` }, { status: 400 });

    const resumen = await recibirEtiquetas(env, { dispositivoId, sesion, etiquetas });
    return jsonSync({ ok: true, ...resumen });
  } catch (err) {
    console.error('POST /api/sync/v2/etiquetas:', err);
    return jsonSync({ error: err?.message || 'Error interno en etiquetas' }, { status: 500 });
  }
}
