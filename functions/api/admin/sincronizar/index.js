// POST /api/admin/sincronizar — aplica la sincronización de stock.
// Recibe las filas del Excel ya parseadas en el navegador, RECALCULA todo en
// este instante (no confía en la vista previa) y actualiza el stock en batch.
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

  const cambios = resultado.filter((r) => r.varianteId && r.stockNuevo !== r.stockActual);
  const sentencias = cambios.map((r) =>
    env.DB.prepare('UPDATE product_variants SET stock = ? WHERE id = ?').bind(
      r.stockNuevo,
      r.varianteId
    )
  );
  sentencias.push(
    env.DB.prepare(
      `UPDATE settings SET valor = datetime('now') WHERE clave = 'ultima_sincronizacion'`
    )
  );
  await env.DB.batch(sentencias);

  return Response.json({
    ok: true,
    sincronizacionAnterior: desde,
    filas: resultado.length,
    actualizadas: cambios.length,
    advertencias: resultado.filter((r) => r.aviso).length,
    detalle: resultado,
  });
}
