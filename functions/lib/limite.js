// Rate limiting simple sobre D1: registra la acción de la IP y cuenta cuántas
// hizo en la última hora. Devuelve true si se excedió el límite.
// Pensado contra bots de pedidos basura; no reemplaza el WAF de Cloudflare.
export async function excedeLimite(env, request, accion, maxPorHora) {
  const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';

  await env.DB.prepare('INSERT INTO rate_log (ip, accion) VALUES (?, ?)').bind(ip, accion).run();

  const fila = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM rate_log
      WHERE ip = ? AND accion = ? AND creado_en > datetime('now', '-1 hour')`
  )
    .bind(ip, accion)
    .first();

  return (fila?.n || 0) > maxPorHora;
}
