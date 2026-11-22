// Manejo de errores hacia el cliente: NUNCA se devuelve el mensaje interno de
// una excepción (SQL, rutas, nombres de tabla). El detalle va solo a los logs
// del Worker (console.error); el cliente recibe un mensaje genérico y un código.

import { jsonSync } from './cors.js';

// Mensaje real de D1 (código 7500): "Your account has exceeded D1's free tier
// daily row read limit. Upgrade to a paid plan or wait until tomorrow ...".
const SIN_CUOTA = /exceeded .*(row read|row write|daily|limit)|D1_ERROR.*(limit|exceeded|overloaded)/i;

/** Error con mensaje APTO para el cliente (validaciones y reglas de negocio). */
export class ErrorHttp extends Error {
  constructor(status, message, codigo) {
    super(message);
    this.name = 'ErrorHttp';
    this.status = status;
    this.codigo = codigo;
  }
}

/**
 * PURA. Traduce una excepción a { status, body } sin filtrar el mensaje interno.
 * Los ErrorHttp conservan su mensaje (lo escribimos nosotros para el cliente).
 */
export function respuestaDeError(err) {
  if (err instanceof ErrorHttp) {
    return { status: err.status, body: { error: err.message, ...(err.codigo ? { codigo: err.codigo } : {}) } };
  }
  const mensaje = String(err?.message || err || '');
  if (SIN_CUOTA.test(mensaje)) {
    return {
      status: 503,
      body: {
        error:
          'La base de datos de la tienda alcanzó su cuota diaria (plan gratuito de Cloudflare D1). ' +
          'Vuelve a intentar más tarde; la cuota se reinicia a las 20:00 (hora de Bolivia).',
        codigo: 'd1_sin_cuota',
      },
    };
  }
  return {
    status: 500,
    body: { error: 'Error interno del servidor. Intenta de nuevo en unos minutos.', codigo: 'interno' },
  };
}

/** Response JSON con CORS para los endpoints del POS (sync / traslados). */
export function errorSync(ruta, err) {
  console.error(`${ruta}:`, err);
  const { status, body } = respuestaDeError(err);
  return jsonSync(body, { status });
}
