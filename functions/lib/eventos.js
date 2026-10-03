// Eventos de stock / historial para la sincronización v2 con el POS
// (migraciones 006 + 008).
//
// Mueven stock: venta (delta −n), cancelacion/expiracion (delta +n).
// Solo historial (delta 0): confirmacion → alta "Venta en línea / Pendiente de
// entrega"; entrega → estado "Entregado". No tocan caja en el POS.

export const TIPOS_EVENTO = Object.freeze([
  'venta',
  'cancelacion',
  'expiracion',
  'confirmacion',
  'entrega',
]);

/** Tipos que solo informan historial (no cambian stock). */
export const TIPOS_HISTORIAL = Object.freeze(['confirmacion', 'entrega']);

/** Referencia corta del pedido tal como la ve el cliente y el POS. */
export function refPedido(codigo) {
  return String(codigo || '').slice(0, 8).toUpperCase();
}

/** Delta de stock que implica un evento para el POS. */
export function deltaDeEvento(tipo, cantidad) {
  if (TIPOS_HISTORIAL.includes(tipo)) return 0;
  const n = Math.abs(Number(cantidad) || 0);
  return tipo === 'venta' ? -n : n;
}

/** Estado de entrega que el POS muestra en historial (texto neutro). */
export function estadoEntregaDeEvento(tipo) {
  if (tipo === 'confirmacion') return 'pendiente_entrega';
  if (tipo === 'entrega') return 'entregado';
  return null;
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
  const n = Math.abs(Number(cantidad) || 0);
  return env.DB.prepare(
    `INSERT OR IGNORE INTO stock_eventos
       (tipo, order_id, order_item_id, product_id, variant_id, global_id, codigo, nombre,
        talla, color, delta, cantidad, precio_unit, pedido_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    n,
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
  const n = Math.abs(Number(cantidad) || 0);
  return env.DB.prepare(
    `INSERT OR IGNORE INTO stock_eventos
       (tipo, order_id, order_item_id, product_id, variant_id, global_id, codigo, nombre,
        talla, color, delta, cantidad, precio_unit, pedido_ref)
     SELECT 'venta', o.id, oi.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
    n,
    Number(precioUnit) || 0,
    refPedido(pedidoCodigo),
    pedidoCodigo,
    variantId
  );
}

/**
 * Ítems de un pedido con todo lo que necesita un evento de reposición
 * (cancelación / expiración) o de historial (confirmación / entrega).
 * Incluye el id del ítem y el global_id.
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

/**
 * Sentencias (sin ejecutar) de eventos de historial para todos los ítems
 * del pedido: tipo 'confirmacion' o 'entrega'.
 */
export function sentenciasEventosHistorial(env, { tipo, orderId, pedidoCodigo, items }) {
  if (!TIPOS_HISTORIAL.includes(tipo)) {
    throw new Error(`Tipo de historial inválido: ${tipo}`);
  }
  return items.map((it) =>
    sentenciaEventoStock(env, {
      tipo,
      orderId,
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
      pedidoCodigo,
    })
  );
}
