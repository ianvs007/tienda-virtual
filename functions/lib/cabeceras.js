// Cabeceras de seguridad. Dos capas complementarias:
//  - public/_headers: las recibe todo lo ESTÁTICO (SPA, assets); Cloudflare
//    Pages NO aplica _headers a respuestas de Functions.
//  - este módulo: las agrega el middleware raíz a las respuestas dinámicas
//    (/api/* y el HTML Open Graph).
// Mantener sincronizado el CSP de la SPA con public/_headers.

export const CSP_SPA = [
  "default-src 'self'",
  "script-src 'self'",
  // React usa style={{...}} en barras de progreso: requiere 'unsafe-inline' solo en estilos.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// Las respuestas de la API nunca deben ejecutar nada si alguien las abre como página.
export const CSP_API = "default-src 'none'; frame-ancestors 'none'";

const BASE = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000',
};

/**
 * Devuelve una copia de `response` con las cabeceras de seguridad. No pisa las
 * que el handler ya haya fijado. `tipo`: 'api' | 'html'.
 */
export function aplicarCabecerasSeguridad(response, tipo = 'api') {
  const headers = new Headers(response.headers);
  const deseadas = { ...BASE, 'Content-Security-Policy': tipo === 'html' ? CSP_SPA : CSP_API };
  for (const [nombre, valor] of Object.entries(deseadas)) {
    if (!headers.has(nombre)) headers.set(nombre, valor);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
    // Conserva webSocket/encodeBody etc. cuando existan (Workers).
    ...(response.webSocket ? { webSocket: response.webSocket } : {}),
  });
}
