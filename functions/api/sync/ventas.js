// GET /api/sync/ventas — ventas en línea desde la última sincronización, en el
// formato del POS. Sirve de recuperación: si un POST /api/sync falló a mitad
// (corte de red, etc.), el POS pide acá las ventas que ya quedaron aplicadas.
import {
  obtenerUltimaSincronizacion,
  validarTokenSync,
  ventasEnLineaDesde,
  ventasParaPOS,
} from '../../lib/sincronizar.js';
import { jsonSync, preflightSync } from '../../lib/cors.js';

// Preflight CORS (mismo motivo que /api/sync: el POS es una app local).
export function onRequestOptions() {
  return preflightSync();
}

export async function onRequestGet({ env, request }) {
  const rechazo = await validarTokenSync(env, request);
  if (rechazo) return rechazo;

  const desde = await obtenerUltimaSincronizacion(env);
  const ventas = ventasParaPOS(await ventasEnLineaDesde(env, desde));

  return jsonSync({ ultima_sincronizacion: desde, ventas });
}
