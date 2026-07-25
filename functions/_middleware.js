// Middleware de Open Graph para /producto/:id.
//
// La tienda es una SPA: el HTML real lo arma React en el navegador, así que los
// rastreadores (WhatsApp, Facebook, Twitter, etc.) no verían nada al pedir la
// URL de un producto. Este middleware detecta esos rastreadores por su
// User-Agent y les devuelve un HTML mínimo con las meta etiquetas OG del
// producto (nombre, precio, descripción y foto). Los visitantes humanos pasan
// directo a la aplicación normal (next()).

const RASTREADORES = /whatsapp|facebookexternalhit|facebot|twitterbot|slackbot|telegrambot|discordbot|linkedinbot|googlebot|bingbot|pinterest|vkshare|w3c_validator/i;

function esc(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bs(monto) {
  const n = Number(monto);
  return `Bs ${n.toFixed(2).replace(/\.00$/, '')}`;
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // Solo GET de /producto/<número> hechos por un rastreador.
  const coincide = /^\/producto\/(\d+)$/.exec(url.pathname);
  const ua = request.headers.get('user-agent') || '';
  if (request.method !== 'GET' || !coincide || !RASTREADORES.test(ua)) {
    return next();
  }

  const id = Number(coincide[1]);
  const producto = await context.env.DB.prepare(
    `SELECT p.nombre, p.descripcion, p.precio, c.nombre AS categoria
       FROM products p
       LEFT JOIN categories c ON c.id = p.categoria_id
      WHERE p.id = ? AND p.activo = 1`
  )
    .bind(id)
    .first();

  // Producto inexistente: que responda la SPA (mostrará "no encontrado").
  if (!producto) return next();

  const foto = await context.env.DB.prepare(
    `SELECT r2_key FROM product_images WHERE product_id = ? ORDER BY orden LIMIT 1`
  )
    .bind(id)
    .first();

  const nombreTienda = await context.env.DB.prepare(
    `SELECT valor FROM settings WHERE clave = 'nombre_tienda'`
  ).first();

  const tienda = nombreTienda?.valor || 'Tienda Virtual';
  const titulo = `${producto.nombre} — ${bs(producto.precio)}`;
  const descripcion = (producto.descripcion || `Disponible en ${tienda}.`)
    .replace(/\s+/g, ' ')
    .slice(0, 200);
  const imagen = foto ? `${url.origin}/api/img/${foto.r2_key}` : `${url.origin}/og.jpg`;

  const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>${esc(titulo)} | ${esc(tienda)}</title>
    <meta name="description" content="${esc(descripcion)}" />
    <meta property="og:type" content="product" />
    <meta property="og:site_name" content="${esc(tienda)}" />
    <meta property="og:title" content="${esc(titulo)}" />
    <meta property="og:description" content="${esc(descripcion)}" />
    <meta property="og:url" content="${esc(url.origin + url.pathname)}" />
    <meta property="og:image" content="${esc(imagen)}" />
    <meta property="og:locale" content="es_BO" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(titulo)}" />
    <meta name="twitter:description" content="${esc(descripcion)}" />
    <meta name="twitter:image" content="${esc(imagen)}" />
    <meta http-equiv="refresh" content="0; url=${esc(url.pathname)}" />
  </head>
  <body>
    <p>${esc(titulo)} — <a href="${esc(url.pathname)}">ver en ${esc(tienda)}</a></p>
  </body>
</html>`;

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
