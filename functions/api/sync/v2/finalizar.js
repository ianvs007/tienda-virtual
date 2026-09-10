// POST /api/sync/v2/finalizar — cierra la sesión de snapshot.
// Body: { dispositivo, sesion, productosEsperados, desactivarAusentes = true }
// Desactiva los productos que NO llegaron en la sesión (reemplaza "Vaciar nube"),
// solo si la nube vio al menos `productosEsperados` productos de esa sesión.
import { validarTokenSync } from '../../../lib/sincronizar.js';
import { finalizarSesion } from '../../../lib/syncV2.js';
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
    if (!dispositivoId) return jsonSync({ error: 'dispositivo es obligatorio' }, { status: 400 });
    if (!sesion) return jsonSync({ error: 'sesion es obligatoria' }, { status: 400 });

    const r = await finalizarSesion(env, {
      dispositivoId,
      sesion,
      productosEsperados: Number(body.productosEsperados) || 0,
      desactivarAusentes: body.desactivarAusentes !== false,
    });
    if (!r.ok) {
      return jsonSync(
        {
          error: `Snapshot incompleto: la nube vio ${r.vistos} producto(s) de ${r.esperados}. No se desactivó nada; repite la sincronización.`,
          ...r,
        },
        { status: 409 }
      );
    }
    return jsonSync(r);
  } catch (err) {
    console.error('POST /api/sync/v2/finalizar:', err);
    return jsonSync({ error: err?.message || 'Error interno al finalizar' }, { status: 500 });
  }
}
