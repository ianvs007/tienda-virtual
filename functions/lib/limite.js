// Rate limiting sobre D1. Cuenta acciones YA hechas (pedido creado, comprobante
// guardado), no intentos. Consultar el cupo no escribe: un 429, un dato inválido
// o un stock que no alcanza no consumen cupo ni alargan el bloqueo.
// La llave es la IP pública (CF-Connecting-IP). En CGNAT o en el Wi-Fi de la
// tienda varias personas comparten el mismo contador.
// Pensado contra bots de pedidos basura; no reemplaza el WAF de Cloudflare.

export function ipCliente(request) {
  return request.headers.get('CF-Connecting-IP') || 'desconocida';
}

/**
 * true si esa IP ya alcanzó `maxPorHora` acciones de `accion` en la última hora.
 * No inserta nada.
 */
export async function excedeLimite(env, request, accion, maxPorHora) {
  const fila = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM rate_log
      WHERE ip = ? AND accion = ? AND creado_en > datetime('now', '-1 hour')`
  )
    .bind(ipCliente(request), accion)
    .first();

  return (fila?.n || 0) >= maxPorHora;
}

/**
 * INSERT para meter en el MISMO batch que la acción exitosa. Si el batch
 * aborta (p. ej. stock insuficiente), esta fila se revierte con él.
 */
export function sentenciaRegistro(env, request, accion) {
  return env.DB.prepare('INSERT INTO rate_log (ip, accion) VALUES (?, ?)').bind(
    ipCliente(request),
    accion
  );
}
