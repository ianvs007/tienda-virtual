// GET /api/traslados/pendientes?destino=<SUCURSAL> — Lista envíos en tránsito hacia esa tienda.
import { validarTokenSync } from '../../lib/sincronizar.js';
import { jsonSync, preflightSync } from '../../lib/cors.js';
import { listarPendientesBuzon } from '../../lib/trasladosBuzon.js';

export function onRequestOptions() {
  return preflightSync();
}

export async function onRequestGet({ env, request }) {
  try {
    const rechazo = await validarTokenSync(env, request);
    if (rechazo) return rechazo;

    const url = new URL(request.url);
    const destino = url.searchParams.get('destino') || '';
    const res = await listarPendientesBuzon(env, destino);
    return jsonSync(res);
  } catch (err) {
    console.error('GET /api/traslados/pendientes:', err);
    return jsonSync(
      { error: err?.message || 'Error interno al consultar traslados' },
      { status: err?.status || 500 }
    );
  }
}
