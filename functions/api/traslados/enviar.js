// POST /api/traslados/enviar — Registra un paquete de traslado en tránsito en el buzón D1.
import { autenticarTokenMaquina } from '../../lib/tokens.js';
import { errorSync } from '../../lib/errores.js';
import { jsonSync, preflightSync } from '../../lib/cors.js';
import { registrarTrasladoBuzon } from '../../lib/trasladosBuzon.js';

export function onRequestOptions() {
  return preflightSync();
}

export async function onRequestPost({ env, request }) {
  try {
    const auth = await autenticarTokenMaquina(env, request, 'traslados');
    if (!auth.ok) return auth.respuesta;
    const opciones = { sucursal: auth.principal.sucursal };

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonSync({ error: 'Solicitud JSON inválida' }, { status: 400 });
    }

    const res = await registrarTrasladoBuzon(env, body, opciones);
    return jsonSync(res);
  } catch (err) {
    return errorSync('POST /api/traslados/enviar', err);
  }
}
