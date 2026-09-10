// POST /api/sync/v2/snapshot — un lote del stock del POS (máx 250 filas).
// Body: { dispositivo, nombreDispositivo?, sesion, filas: [{ globalId, codigo,
//         nombre, talla, color, stock, precio }] }
// Identidad por globalId; el stock publicado = stock_pos + Σ eventos sin ack.
import { validarTokenSync } from '../../../lib/sincronizar.js';
import { aplicarSnapshot, MAX_FILAS_SNAPSHOT } from '../../../lib/syncV2.js';
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
    const filas = Array.isArray(body.filas) ? body.filas : [];
    if (!dispositivoId) return jsonSync({ error: 'dispositivo es obligatorio' }, { status: 400 });
    if (!sesion) return jsonSync({ error: 'sesion es obligatoria' }, { status: 400 });
    if (filas.length === 0 || filas.length > MAX_FILAS_SNAPSHOT)
      return jsonSync({ error: `El cuerpo no tiene filas válidas (1 a ${MAX_FILAS_SNAPSHOT})` }, { status: 400 });
    if (filas.every((f) => !String(f?.globalId || '').trim()))
      return jsonSync(
        { error: 'Ninguna fila trae globalId: el POS debe estar en schema v23 o superior' },
        { status: 400 }
      );

    const resumen = await aplicarSnapshot(env, {
      dispositivoId,
      nombreDispositivo: String(body.nombreDispositivo || '').trim(),
      sesion,
      filas,
    });
    return jsonSync({ ok: true, ...resumen });
  } catch (err) {
    console.error('POST /api/sync/v2/snapshot:', err);
    return jsonSync({ error: err?.message || 'Error interno en snapshot' }, { status: 500 });
  }
}
