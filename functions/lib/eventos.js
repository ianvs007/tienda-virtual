// Eventos de stock para la sincronización v2 con el POS (migración 006).
// Cada venta / cancelación / expiración deja UNA fila en stock_eventos por ítem
// del pedido, en el MISMO batch que el cambio de stock: el evento y el stock se
// aplican juntos o no se aplican.
//
// `delta` es lo que el POS debe sumar a su stock: negativo en ventas, positivo
// cuando la prenda vuelve al catálogo.

export const TIPOS_EVENTO = Object.freeze(['venta', 'cancelacion', 'expiracion']);

/** Referencia corta del pedido tal como la ve el cliente y el POS. */
export function refPedido(codigo) {
  return String(codigo || '').slice(0, 8).toUpperCase();
}

/** Delta de stock que implica un evento para el POS. */
export function deltaDeEvento(tipo, cantidad) {
  const n = Math.abs(Number(cantidad) || 0);
  return tipo === 'venta' ? -n : n;
}

/**
 * Sentencia preparada (SIN ejecutar) que inserta un evento para un ítem YA
 * insertado en order_items (se conoce su id).
 */
export function sentenciaEventoStock(
  env,
  {
    tipo,
    orderId,
    orderItemId,
    productId = null,
    variantId = null,
    globalId = '',
    codigo = '',
    nombre = '',
    talla = '',
    color = '',
    cantidad,
    precioUnit = 0,
    pedidoCodigo = '',
  }
) {
  if (!TIPOS_EVENTO.includes(tipo)) throw new Error(`Tipo de evento inválido: ${tipo}`);
  return env.DB.prepare(
    `INSERT OR IGNORE INTO stock_eventos
       (tipo, order_id, order_item_id, product_id, variant_id, global_id, codigo, nombre,
        talla, color, delta, precio_unit, pedido_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    tipo,
    orderId,
    orderItemId,
    productId,
    variantId,
    globalId || '',
    codigo || '',
    nombre || '',
    talla || '',
    color || '',
    deltaDeEvento(tipo, cantidad),
    Number(precioUnit) || 0,
    refPedido(pedidoCodigo)
  );
}

/**
 * Variante para el checkout: el ítem se inserta en el mismo batch y su id aún
 * no se conoce, así que se resuelve con un subselect (último ítem de ese pedido
 * y variante; el batch corre en orden dentro de una transacción).
 */
export function sentenciaEventoVentaEnCheckout(
  env,
  { pedidoCodigo, productId, variantId, globalId = '', codigo = '', nombre = '', talla = '', color = '', cantidad, precioUnit }
) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO stock_eventos
       (tipo, order_id, order_item_id, product_id, variant_id, global_id, codigo, nombre,
        talla, color, delta, precio_unit, pedido_ref)
     SELECT 'venta', o.id, oi.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
      WHERE o.codigo = ? AND oi.variant_id = ?
      ORDER BY oi.id DESC
      LIMIT 1`
  ).bind(
    productId,
    variantId,
    globalId || '',
    codigo || '',
    nombre || '',
    talla || '',
    color || '',
    deltaDeEvento('venta', cantidad),
    Number(precioUnit) || 0,
    refPedido(pedidoCodigo),
    pedidoCodigo,
    variantId
  );
}

/**
 * Ítems de un pedido con todo lo que necesita un evento de reposición
 * (cancelación / expiración). Incluye el id del ítem y el global_id.
 */
export async function itemsParaReponer(env, orderId) {
  const { results } = await env.DB.prepare(
    `SELECT oi.id AS order_item_id, oi.variant_id, oi.cantidad, oi.precio_unit,
            v.stock, v.talla, v.color,
            p.id AS product_id, p.nombre, p.codigo, p.global_id
       FROM order_items oi
       JOIN product_variants v ON v.id = oi.variant_id
       JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ? AND oi.variant_id IS NOT NULL`
  )
    .bind(orderId)
    .all();
  return results;
}
