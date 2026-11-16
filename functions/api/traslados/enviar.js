// POST /api/traslados/enviar — Registra un paquete de traslado en tránsito en el buzón D1.
import { validarTokenSync } from '../../lib/sincronizar.js';
import { jsonSync, preflightSync } from '../../lib/cors.js';
import { registrarTrasladoBuzon } from '../../lib/trasladosBuzon.js';

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
      return jsonSync({ error: 'Solicitud JSON inválida' }, { status: 400 });
    }

    const res = await registrarTrasladoBuzon(env, body);
    return jsonSync(res);
  } catch (err) {
    console.error('POST /api/traslados/enviar:', err);
    return jsonSync(
      { error: err?.message || 'Error interno al registrar traslado' },
      { status: err?.status || 500 }
    );
  }
}
