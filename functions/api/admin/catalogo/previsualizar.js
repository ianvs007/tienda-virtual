// POST /api/admin/catalogo/previsualizar — calcula la importación de catálogo
// SIN aplicarla (para la vista previa del admin).
import { calcularImportacionCatalogo } from '../../../lib/catalogo.js';

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

  const detalle = await calcularImportacionCatalogo(env, filas);

  return Response.json({
    filas: detalle.length,
    creadas: detalle.filter((r) => r.accion === 'crear').length,
    omitidas: detalle.filter((r) => r.accion !== 'crear').length,
    detalle,
  });
}
