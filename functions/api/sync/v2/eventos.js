// GET /api/sync/v2/eventos?dispositivo=<id>&desde=<n>&limite=500
// Eventos de stock (venta/cancelación/expiración) con id > desde, en orden.
// El POS los aplica y luego confirma con POST /api/sync/v2/ack.
import { validarTokenSync } from '../../../lib/sincronizar.js';
import { listarEventos, obtenerDispositivo, MAX_EVENTOS_PAGINA } from '../../../lib/syncV2.js';
import { jsonSync, preflightSync } from '../../../lib/cors.js';

export function onRequestOptions() {
  return preflightSync();
}

export async function onRequestGet({ env, request }) {
  try {
    const rechazo = await validarTokenSync(env, request);
    if (rechazo) return rechazo;

    const url = new URL(request.url);
    const dispositivoId = String(url.searchParams.get('dispositivo') || '').trim();
    if (!dispositivoId) return jsonSync({ error: 'dispositivo es obligatorio' }, { status: 400 });

    const dispositivo = await obtenerDispositivo(env, { id: dispositivoId });
    const desdeParam = url.searchParams.get('desde');
    // Si el POS no manda `desde`, se parte del ack registrado en la nube.
    const desde = desdeParam === null ? Number(dispositivo.ultimo_evento_ack) || 0 : Number(desdeParam) || 0;
    const limite = Number(url.searchParams.get('limite')) || MAX_EVENTOS_PAGINA;

    const pagina = await listarEventos(env, { desde, limite });
    return jsonSync({
      ok: true,
      dispositivo: dispositivo.id,
      ultimoEventoAck: Number(dispositivo.ultimo_evento_ack) || 0,
      desde,
      ...pagina,
    });
  } catch (err) {
    console.error('GET /api/sync/v2/eventos:', err);
    return jsonSync({ error: err?.message || 'Error interno' }, { status: 500 });
  }
}
