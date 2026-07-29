// GET /api/admin/sincronizar/ventas — ventas en línea desde la última
// sincronización, para registrarlas en el sistema local (el navegador las
// convierte a Excel). Incluye pendientes de pago porque su stock está
// reservado (el sistema local también debe bajarlo); va la columna estado.
import { obtenerUltimaSincronizacion, ventasEnLineaDesde } from '../../../lib/sincronizar.js';

export async function onRequestGet({ env }) {
  const desde = await obtenerUltimaSincronizacion(env);
  const results = await ventasEnLineaDesde(env, desde);

  return Response.json({ ultima_sincronizacion: desde, ventas: results });
}
