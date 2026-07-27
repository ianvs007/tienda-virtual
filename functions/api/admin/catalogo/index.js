// POST /api/admin/catalogo — aplica la importación inicial de catálogo.
// Recibe las filas del Excel ya parseadas en el navegador, RECALCULA todo en
// este instante (no confía en la vista previa) y crea las prendas que no
// existen con su única variante talla/color.
import { aplicarImportacionCatalogo } from '../../../lib/catalogo.js';

const MAX_FILAS = 5000;

export async function onRequestPost({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const filas = Array.isArray(body.filas) ? body.filas : [];
  if (filas.length === 0 || filas.length > MAX_FILAS)
    return Response.json({ error: 'El Excel no tiene filas válidas' }, { status: 400 });

  const { creadas, omitidas, detalle } = await aplicarImportacionCatalogo(env, filas);

  return Response.json({
    ok: true,
    filas: detalle.length,
    creadas,
    omitidas,
    detalle,
  });
}
