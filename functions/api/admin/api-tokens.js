// Gestión de tokens de máquina del POS (migración 010). Protegido por el
// middleware de /api/admin (sesión de admin).
//   GET    → lista (sin hashes) + estado del modo heredado en traslados.
//   POST   → crea { nombre, alcance: ['sync'|'traslados', ...], sucursal }.
//            El token completo se devuelve UNA sola vez.
//   DELETE → ?id=<n> revoca.
//   PUT    → { legacySyncEnTraslados: boolean } acepta o no el token heredado
//            (settings.sync_token) en /api/traslados/*.
import { ALCANCES, CLAVE_LEGACY_EN_TRASLADOS, alcancesDeTexto, tokenNuevo } from '../../lib/tokens.js';
import { normalizarSucursal } from '../../lib/trasladosBuzon.js';
import { sha256Hex, esTablaFaltante } from '../../lib/seguridad.js';

const MIGRACION_PENDIENTE = {
  error: 'Falta aplicar la migración 010 (api_tokens) en la base de datos.',
  codigo: 'migracion_pendiente',
};

async function legacyActivo(env) {
  const fila = await env.DB.prepare('SELECT valor FROM settings WHERE clave = ?')
    .bind(CLAVE_LEGACY_EN_TRASLADOS)
    .first();
  return String(fila?.valor ?? '1') !== '0';
}

export async function onRequestGet({ env }) {
  const legacySyncEnTraslados = await legacyActivo(env);
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, nombre, alcance, sucursal, activo, creado_en, ultimo_uso, revocado_en
         FROM api_tokens ORDER BY id DESC`
    ).all();
    return Response.json({
      tokens: (results || []).map((t) => ({ ...t, alcance: alcancesDeTexto(t.alcance) })),
      legacySyncEnTraslados,
    });
  } catch (err) {
    if (!esTablaFaltante(err)) throw err;
    return Response.json({ tokens: [], legacySyncEnTraslados, migracionPendiente: true });
  }
}

export async function onRequestPost({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }
  const nombre = String(body?.nombre || '').trim().slice(0, 60);
  const alcance = [...new Set(Array.isArray(body?.alcance) ? body.alcance : [])];
  const sucursal = normalizarSucursal(body?.sucursal).slice(0, 60);

  if (!nombre) return Response.json({ error: 'El nombre es obligatorio' }, { status: 400 });
  if (alcance.length === 0 || alcance.some((a) => !ALCANCES.includes(a)))
    return Response.json({ error: `alcance debe ser una lista de: ${ALCANCES.join(', ')}` }, { status: 400 });
  if (alcance.includes('traslados') && !sucursal)
    return Response.json({ error: 'Un token con alcance "traslados" necesita sucursal' }, { status: 400 });

  const token = tokenNuevo();
  try {
    await env.DB.prepare(
      'INSERT INTO api_tokens (nombre, token_hash, alcance, sucursal) VALUES (?, ?, ?, ?)'
    )
      .bind(nombre, await sha256Hex(token), alcance.join(','), sucursal || null)
      .run();
  } catch (err) {
    if (!esTablaFaltante(err)) throw err;
    return Response.json(MIGRACION_PENDIENTE, { status: 503 });
  }
  return Response.json({ token, nombre, alcance, sucursal: sucursal || null }, { status: 201 });
}

export async function onRequestDelete({ env, request }) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'id inválido' }, { status: 400 });
  try {
    const r = await env.DB.prepare(
      `UPDATE api_tokens SET activo = 0, revocado_en = datetime('now') WHERE id = ? AND activo = 1`
    )
      .bind(id)
      .run();
    if (!(r?.meta?.changes > 0)) return Response.json({ error: 'Token no encontrado' }, { status: 404 });
  } catch (err) {
    if (!esTablaFaltante(err)) throw err;
    return Response.json(MIGRACION_PENDIENTE, { status: 503 });
  }
  return Response.json({ ok: true });
}

export async function onRequestPut({ env, request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }
  if (typeof body?.legacySyncEnTraslados !== 'boolean')
    return Response.json({ error: 'legacySyncEnTraslados debe ser booleano' }, { status: 400 });
  await env.DB.prepare(
    'INSERT INTO settings (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor'
  )
    .bind(CLAVE_LEGACY_EN_TRASLADOS, body.legacySyncEnTraslados ? '1' : '0')
    .run();
  return Response.json({ ok: true, legacySyncEnTraslados: body.legacySyncEnTraslados });
}
