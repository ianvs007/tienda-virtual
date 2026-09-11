// Middleware raíz: (1) errores de /api/* siempre en JSON; (2) Open Graph para
// /producto/:id.
//
// (1) Si una Function lanza (p. ej. D1 sin cuota: "exceeded D1's free tier
// daily row read limit"), Cloudflare respondería su página HTML "Error 1101" y
// el panel/la tienda mostrarían `Unexpected token '<'` al intentar leer JSON.
// Aquí se captura y se responde JSON con un mensaje entendible: 503 si es un
// problema de capacidad de la base, 500 en cualquier otro caso.
//
// (2) La tienda es una SPA: el HTML real lo arma React en el navegador, así que
// los rastreadores (WhatsApp, Facebook, Twitter, etc.) no verían nada al pedir
// la URL de un producto. Se los detecta por User-Agent y se les devuelve un HTML
// mínimo con las meta etiquetas OG del producto (nombre, precio, descripción y
// foto). Los visitantes humanos pasan directo a la aplicación normal (next()).

const RASTREADORES = /whatsapp|facebookexternalhit|facebot|twitterbot|slackbot|telegrambot|discordbot|linkedinbot|googlebot|bingbot|pinterest|vkshare|w3c_validator/i;

// Mensaje real de D1 (código 7500): "Your account has exceeded D1's free tier
// daily row read limit. Upgrade to a paid plan or wait until tomorrow ...".
const SIN_CUOTA = /exceeded .*(row read|row write|daily|limit)|D1_ERROR.*(limit|exceeded|overloaded)/i;

/**
 * PURA. Traduce una excepción de una Function de /api/* a { status, body }.
 * Exportada para probarla sin Cloudflare.
 */
export function respuestaDeError(err) {
  const mensaje = String(err?.message || err || '');
  if (SIN_CUOTA.test(mensaje)) {
    return {
      status: 503,
      body: {
        error:
          'La base de datos de la tienda alcanzó su cuota diaria (plan gratuito de Cloudflare D1). ' +
          'Vuelve a intentar más tarde; la cuota se reinicia a las 20:00 (hora de Bolivia).',
        codigo: 'd1_sin_cuota',
        detalle: mensaje.slice(0, 300),
      },
    };
  }
  return {
    status: 500,
    body: { error: 'Error interno del servidor. Intenta de nuevo en unos minutos.', codigo: 'interno', detalle: mensaje.slice(0, 300) },
  };
}

async function conErroresEnJson(context) {
  try {
    return await context.next();
  } catch (err) {
    console.error(`${context.request.method} ${new URL(context.request.url).pathname}:`, err);
    const { status, body } = respuestaDeError(err);
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

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

  if (url.pathname.startsWith('/api/')) return conErroresEnJson(context);

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
