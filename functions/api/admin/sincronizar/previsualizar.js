// POST /api/admin/sincronizar/previsualizar — calcula el resultado de la
// sincronización SIN aplicarla (para la vista previa del admin).
import { calcularSincronizacion } from '../../../lib/sincronizar.js';

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

  const { desde, resultado } = await calcularSincronizacion(env, filas);

  return Response.json({
    sincronizacionAnterior: desde,
    filas: resultado.length,
    cambios: resultado.filter((r) => r.varianteId && r.stockNuevo !== r.stockActual).length,
    advertencias: resultado.filter((r) => r.aviso).length,
    detalle: resultado,
  });
}
