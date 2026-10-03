// Registro de comprobante de pago: avanza el pedido a "comprobante_subido"
// de forma atómica (sin carrera con la expiración de 24 h) y, si el pedido
// ya estaba cancelado (el cliente pagó pero no subió la foto a tiempo), lo
// reabre reservando stock de nuevo.
import { sentenciaLogStock } from './stockLog.js';
import { itemsParaReponer, sentenciaEventoStock } from './eventos.js';

const ESTADOS_NORMALES = ['pendiente_pago', 'comprobante_subido'];

/**
 * Persiste la clave R2 del comprobante y deja el pedido en comprobante_subido
 * (o cancelado con foto si no hay stock para reabrir).
 *
 * @param {object} env
 * @param {{ id: number, codigo: string, estado: string, comprobante_r2_key?: string|null }} pedido
 * @param {string} key clave R2 ya subida
 * @returns {Promise<{ ok: true, estado: string, reabierto: boolean, aviso?: string } | { ok: false, error: string, status: number }>}
 */
export async function registrarComprobante(env, pedido, key) {
  if (ESTADOS_NORMALES.includes(pedido.estado)) {
    const r = await env.DB.prepare(
      `UPDATE orders SET comprobante_r2_key = ?, estado = 'comprobante_subido'
        WHERE codigo = ? AND estado IN ('pendiente_pago', 'comprobante_subido')`
    )
      .bind(key, pedido.codigo)
      .run();
    if ((r?.meta?.changes || 0) === 1) {
      return { ok: true, estado: 'comprobante_subido', reabierto: false };
    }
    // Carrera: entre el SELECT y el UPDATE el pedido expiró a cancelado.
    // Releemos e intentamos reabrir como si el cliente hubiera llegado tarde.
    const actual = await env.DB.prepare(
      'SELECT id, codigo, estado, comprobante_r2_key FROM orders WHERE codigo = ?'
    )
      .bind(pedido.codigo)
      .first();
    if (!actual) return { ok: false, error: 'Pedido no encontrado', status: 404 };
    if (actual.estado !== 'cancelado') {
      return {
        ok: false,
        error:
          'El pedido ya no admite comprobante (fue confirmado o entregado). Si ya pagaste, escríbenos por WhatsApp con tu referencia.',
        status: 409,
      };
    }
    return reabrirCanceladoConComprobante(env, actual, key);
  }

  if (pedido.estado === 'cancelado') {
    return reabrirCanceladoConComprobante(env, pedido, key);
  }

  return {
    ok: false,
    error:
      'Este pedido ya fue procesado. Si ya pagaste, escríbenos por WhatsApp con tu referencia.',
    status: 409,
  };
}

/**
 * Pedido cancelado (expiración o admin) + cliente sube comprobante porque sí pagó.
 * Si hay stock: reabre a comprobante_subido y vuelve a reservar.
 * Si no hay stock: guarda la foto y deja cancelado para que el dueño vea el pago.
 */
async function reabrirCanceladoConComprobante(env, pedido, key) {
  const items = await itemsParaReponer(env, pedido.id);
  const sinStock = items.some((it) => Number(it.stock) < Number(it.cantidad));

  if (sinStock) {
    await env.DB.prepare(
      `UPDATE orders SET comprobante_r2_key = ? WHERE id = ? AND estado = 'cancelado'`
    )
      .bind(key, pedido.id)
      .run();
    return {
      ok: true,
      estado: 'cancelado',
      reabierto: false,
      aviso:
        'Recibimos tu comprobante, pero el stock ya no está disponible. Te contactaremos por WhatsApp con tu referencia.',
    };
  }

  const r = await env.DB.prepare(
    `UPDATE orders SET comprobante_r2_key = ?, estado = 'comprobante_subido'
      WHERE id = ? AND estado = 'cancelado'`
  )
    .bind(key, pedido.id)
    .run();
  if ((r?.meta?.changes || 0) !== 1) {
    return {
      ok: false,
      error: 'El pedido ya cambió de estado. Recarga e intenta de nuevo.',
      status: 409,
    };
  }

  const sentencias = [];
  for (const it of items) {
    sentencias.push(
      env.DB.prepare('UPDATE product_variants SET stock = stock - ? WHERE id = ?').bind(
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
        nuevo: it.stock - it.cantidad,
        origen: 'venta',
        detalle: `Reapertura pedido ${String(pedido.codigo || '').slice(0, 8).toUpperCase()}`,
      })
    );
    sentencias.push(
      sentenciaEventoStock(env, {
        tipo: 'venta',
        orderId: pedido.id,
        orderItemId: it.order_item_id,
        productId: it.product_id,
        variantId: it.variant_id,
        globalId: it.global_id || '',
        codigo: it.codigo || '',
        nombre: it.nombre,
        talla: it.talla,
        color: it.color,
        cantidad: it.cantidad,
        precioUnit: it.precio_unit,
        pedidoCodigo: pedido.codigo,
      })
    );
  }
  if (sentencias.length > 0) {
    try {
      await env.DB.batch(sentencias);
    } catch (err) {
      // Stock cambió entre el chequeo y el batch: dejamos el comprobante y
      // volvemos a cancelado para no vender de más.
      await env.DB.prepare(
        `UPDATE orders SET estado = 'cancelado' WHERE id = ? AND estado = 'comprobante_subido'`
      )
        .bind(pedido.id)
        .run();
      return {
        ok: true,
        estado: 'cancelado',
        reabierto: false,
        aviso:
          'Recibimos tu comprobante, pero el stock ya no está disponible. Te contactaremos por WhatsApp con tu referencia.',
      };
    }
  }

  return { ok: true, estado: 'comprobante_subido', reabierto: true };
}
