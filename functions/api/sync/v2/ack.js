// POST /api/sync/v2/ack — el POS confirma que aplicó los eventos hasta `hastaId`.
// Idempotente: el ack nunca retrocede (max con el anterior).
import { validarTokenSync } from '../../../lib/sincronizar.js';
import { confirmarEventos } from '../../../lib/syncV2.js';
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
    if (!dispositivoId) return jsonSync({ error: 'dispositivo es obligatorio' }, { status: 400 });
    const hastaId = Number(body.hastaId);
    if (!Number.isInteger(hastaId) || hastaId < 0)
      return jsonSync({ error: 'hastaId inválido' }, { status: 400 });

    const r = await confirmarEventos(env, { dispositivoId, hastaId });
    return jsonSync({ ok: true, ...r });
  } catch (err) {
    console.error('POST /api/sync/v2/ack:', err);
    return jsonSync({ error: err?.message || 'Error interno en ack' }, { status: 500 });
  }
}
