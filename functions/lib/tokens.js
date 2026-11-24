// Autenticación de las integraciones máquina-a-máquina (POS): sync de stock y
// buzón de traslados.
//
// Dos orígenes de credencial, ambos como "Authorization: Bearer <token>":
//  1. settings.sync_token — token heredado (un solo secreto compartido). Sigue
//     funcionando para 'sync' y, mientras no se desactive, también para
//     'traslados' SIN validación de sucursal (compatibilidad con el POS actual).
//  2. api_tokens (migración 010) — tokens con alcance ('sync', 'traslados') y
//     sucursal. Se guardan hasheados (SHA-256).
// Toda comparación contra secretos es en tiempo constante (lib/seguridad.js).

import { jsonSync } from './cors.js';
import { iguales, sha256Hex, tokenBearer, esTablaFaltante } from './seguridad.js';

export const ALCANCES = Object.freeze(['sync', 'traslados']);
export const CLAVE_LEGACY_EN_TRASLADOS = 'traslados_aceptar_token_sync';

export function alcancesDeTexto(texto) {
  return String(texto || '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
}

async function legacyAceptadoEnTraslados(env) {
  const fila = await env.DB.prepare('SELECT valor FROM settings WHERE clave = ?')
    .bind(CLAVE_LEGACY_EN_TRASLADOS)
    .first();
  return String(fila?.valor ?? '1') !== '0';
}

async function buscarTokenConAlcance(env, recibido) {
  try {
    return await env.DB.prepare(
      'SELECT id, nombre, alcance, sucursal FROM api_tokens WHERE token_hash = ? AND activo = 1'
    )
      .bind(await sha256Hex(recibido))
      .first();
  } catch (err) {
    if (esTablaFaltante(err)) return null; // migración 010 aún sin aplicar
    throw err;
  }
}

function marcarUso(env, id) {
  // Como máximo 1 escritura por hora y token (cuota de escrituras de D1).
  return env.DB.prepare(
    `UPDATE api_tokens SET ultimo_uso = datetime('now')
      WHERE id = ? AND (ultimo_uso IS NULL OR ultimo_uso < datetime('now', '-1 hour'))`
  )
    .bind(id)
    .run()
    .catch(() => {});
}

/**
 * Autentica una petición del POS para un alcance ('sync' | 'traslados').
 * Devuelve { ok: true, principal: { tipo, id, nombre, sucursal } } o
 * { ok: false, respuesta } con la Response (con CORS) ya armada.
 * principal.sucursal es null para el token heredado (sin restricción de sucursal).
 */
export async function autenticarTokenMaquina(env, request, alcance) {
  const fila = await env.DB.prepare(`SELECT valor FROM settings WHERE clave = 'sync_token'`).first();
  const legacy = (fila?.valor || '').trim();
  const recibido = tokenBearer(request);

  if (recibido) {
    if (legacy && (await iguales(recibido, legacy))) {
      if (alcance === 'traslados' && !(await legacyAceptadoEnTraslados(env))) {
        return {
          ok: false,
          respuesta: jsonSync(
            {
              error: 'El token de sincronización general ya no sirve para traslados: usa un token con alcance "traslados".',
              codigo: 'token_sin_alcance',
            },
            { status: 403 }
          ),
        };
      }
      return { ok: true, principal: { tipo: 'legacy', id: null, nombre: 'sync_token', sucursal: null } };
    }

    const t = await buscarTokenConAlcance(env, recibido);
    if (t) {
      if (!alcancesDeTexto(t.alcance).includes(alcance)) {
        return {
          ok: false,
          respuesta: jsonSync(
            { error: 'El token no tiene permiso para esta operación.', codigo: 'token_sin_alcance' },
            { status: 403 }
          ),
        };
      }
      await marcarUso(env, t.id);
      return {
        ok: true,
        principal: { tipo: 'token', id: t.id, nombre: t.nombre, sucursal: t.sucursal || null },
      };
    }
  }

  if (!legacy && !recibido) {
    return { ok: false, respuesta: jsonSync({ error: 'Sincronización directa no configurada' }, { status: 503 }) };
  }
  return { ok: false, respuesta: jsonSync({ error: 'Token inválido' }, { status: 401 }) };
}

export function tokenNuevo() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return `tv_${b64}`;
}
