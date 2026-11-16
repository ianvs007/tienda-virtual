// POST /api/traslados/confirmar — Marca un traslado como recibido en la tienda destino.
import { validarTokenSync } from '../../lib/sincronizar.js';
import { jsonSync, preflightSync } from '../../lib/cors.js';
import { confirmarTrasladoBuzon } from '../../lib/trasladosBuzon.js';

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

    const res = await confirmarTrasladoBuzon(env, body);
    return jsonSync(res);
  } catch (err) {
    console.error('POST /api/traslados/confirmar:', err);
    return jsonSync(
      { error: err?.message || 'Error interno al confirmar traslado' },
      { status: err?.status || 500 }
    );
  }
}
