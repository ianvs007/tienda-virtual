import { iniciarSincronizacionPOS, validarTokenSync } from '../../lib/sincronizar.js';
import { jsonSync, preflightSync } from '../../lib/cors.js';

export function onRequestOptions() {
  return preflightSync();
}

export async function onRequestPost({ env, request }) {
  const rechazo = await validarTokenSync(env, request);
  if (rechazo) return rechazo;

  const inicio = await iniciarSincronizacionPOS(env);
  return jsonSync({
    ok: true,
    cutoff: inicio.cutoff,
    ventasPendientesHastaCutoff: inicio.ventasPendientesHastaCutoff,
    resumen: {
      ...inicio.resumen,
      ultima_sincronizacion: inicio.ultima_sincronizacion,
    },
  });
}
