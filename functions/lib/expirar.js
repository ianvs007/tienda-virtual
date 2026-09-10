// Cancela los pedidos que llevan demasiado tiempo en "pendiente_pago" sin que
// el cliente pague: liberan su stock de vuelta al catálogo. Se ejecuta de forma
// perezosa (lazy) al listar pedidos en el admin y al consultar un pedido,
// así no hace falta infraestructura extra (cron).
import { sentenciaLogStock } from './stockLog.js';

const HORAS_EXPIRACION = 24;

/**
 * Cancela un pedido vencido y repone stock SOLO si esta corrida ganó la carrera
 * (UPDATE ... AND estado = 'pendiente_pago' afectó exactamente 1 fila).
 * Evita doble reposición cuando dos requests llaman a expirar a la vez.
 *
 * @returns {Promise<boolean>} true si este proceso canceló y repuso stock
 */
export async function cancelarPedidoExpiradoYReponer(env, pedido) {
  const rCancel = await env.DB.prepare(
    `UPDATE orders SET estado = 'cancelado' WHERE id = ? AND estado = 'pendiente_pago'`
  )
    .bind(pedido.id)
    .run();
  if ((rCancel?.meta?.changes || 0) !== 1) return false;

  const { results: items } = await env.DB.prepare(
    `SELECT oi.variant_id, oi.cantidad, v.stock, v.talla, v.color,
            p2.id AS product_id, p2.nombre, p2.codigo
       FROM order_items oi
       JOIN product_variants v ON v.id = oi.variant_id
       JOIN products p2 ON p2.id = oi.product_id
      WHERE oi.order_id = ? AND oi.variant_id IS NOT NULL`
  )
    .bind(pedido.id)
    .all();

  const sentencias = [];
  for (const it of items) {
    sentencias.push(
      env.DB.prepare('UPDATE product_variants SET stock = stock + ? WHERE id = ?').bind(
        it.cantidad,
        it.variant_id
      )
    );
    sentencias.push(
      sentenciaLogStock(env, {
        productId: it.product_id,
        variantId: it.variant_id,
        codigo: it.codigo || '',
        nombre: it.nombre,
        talla: it.talla,
        color: it.color,
        anterior: it.stock,
        nuevo: it.stock + it.cantidad,
        origen: 'expiracion',
        detalle: `Pedido ${String(pedido.codigo || '').slice(0, 8).toUpperCase()} expirado`,
      })
    );
  }
  if (sentencias.length > 0) await env.DB.batch(sentencias);
  return true;
}

export async function expirarPedidosPendientes(env) {
  const { results: vencidos } = await env.DB.prepare(
    `SELECT id, codigo FROM orders
      WHERE estado = 'pendiente_pago'
        AND creado_en < datetime('now', ?)`
  )
    .bind(`-${HORAS_EXPIRACION} hours`)
    .all();

  let cancelados = 0;
  for (const p of vencidos) {
    if (await cancelarPedidoExpiradoYReponer(env, p)) cancelados++;
  }

  // Mantenimiento aprovechado: limpia el rate_log viejo.
  await env.DB.prepare(`DELETE FROM rate_log WHERE creado_en < datetime('now', '-1 day')`).run();

  return cancelados;
}
