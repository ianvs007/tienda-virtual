// GET /api/admin/sincronizar/ventas — ventas en línea desde la última
// sincronización, para registrarlas en el sistema local (el navegador las
// convierte a Excel). Incluye pendientes de pago porque su stock está
// reservado (el sistema local también debe bajarlo); va la columna estado.
import { obtenerUltimaSincronizacion } from '../../../lib/sincronizar.js';

export async function onRequestGet({ env }) {
  const desde = await obtenerUltimaSincronizacion(env);

  const { results } = await env.DB.prepare(
    `SELECT p.codigo, p.nombre, v.talla, v.color, oi.cantidad, oi.precio_unit,
            o.estado, substr(o.codigo, 1, 8) AS pedido_ref, o.creado_en
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN product_variants v ON v.id = oi.variant_id
      WHERE o.estado != 'cancelado' AND o.creado_en > ?
      ORDER BY o.creado_en`
  )
    .bind(desde)
    .all();

  return Response.json({ ultima_sincronizacion: desde, ventas: results });
}
