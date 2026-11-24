// GET /api/traslados/pendientes?destino=<SUCURSAL> — Lista envíos en tránsito hacia esa tienda.
import { autenticarTokenMaquina } from '../../lib/tokens.js';
import { errorSync } from '../../lib/errores.js';
import { jsonSync, preflightSync } from '../../lib/cors.js';
import { listarPendientesBuzon } from '../../lib/trasladosBuzon.js';

export function onRequestOptions() {
  return preflightSync();
}

export async function onRequestGet({ env, request }) {
  try {
    const auth = await autenticarTokenMaquina(env, request, 'traslados');
    if (!auth.ok) return auth.respuesta;
    const opciones = { sucursal: auth.principal.sucursal };

    const url = new URL(request.url);
    const destino = url.searchParams.get('destino') || '';
    const res = await listarPendientesBuzon(env, destino, opciones);
    return jsonSync(res);
  } catch (err) {
    return errorSync('GET /api/traslados/pendientes', err);
  }
}
