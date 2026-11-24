// Autenticación y control de sucursal de /api/traslados/* y alcance de /api/sync/v2/*
// sobre el esquema real (migraciones 001–010).
import test from 'node:test';
import assert from 'node:assert/strict';
import { entornoSqlite } from '../../lib/d1Sqlite.js';
import { onRequestPost as enviar } from './enviar.js';
import { onRequestGet as pendientes } from './pendientes.js';
import { onRequestPost as confirmar } from './confirmar.js';
import { onRequestGet as eventosV2 } from '../sync/v2/eventos.js';
import { onRequestPost as crearToken, onRequestGet as listarTokens, onRequestDelete as revocarToken, onRequestPut as ajustarLegacy } from '../admin/api-tokens.js';

const BASE = 'https://t.test';
const paquete = (uid, origen = 'SUCURSAL 1', destino = 'TIENDA PRINCIPAL') => ({
  transferUid: uid,
  originBranch: origen,
  destinationBranch: destino,
  sentBy: 'Cajera',
  items: [{ shortCode: '120', name: 'BLUSA', price: 100, qty: 1 }],
});

function req(ruta, { metodo = 'GET', token, cuerpo } = {}) {
  return new Request(BASE + ruta, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
}
const llamar = (fn, env, request) => fn({ env, request });

async function emitir(env, datos) {
  const r = await crearToken({ env, request: req('/api/admin/api-tokens', { metodo: 'POST', cuerpo: datos }) });
  return { status: r.status, ...(await r.json()) };
}

function entorno() {
  const t = entornoSqlite();
  t.db.prepare("INSERT INTO settings (clave, valor) VALUES ('sync_token', 'token-heredado-123')").run();
  return t;
}

test('token heredado: sigue funcionando en traslados como antes (compatibilidad con el POS actual)', async () => {
  const { env } = entorno();
  const e = await llamar(enviar, env, req('/api/traslados/enviar', { metodo: 'POST', token: 'token-heredado-123', cuerpo: paquete('u1') }));
  assert.equal(e.status, 200);
  const p = await (await llamar(pendientes, env, req('/api/traslados/pendientes?destino=tienda%20principal', { token: 'token-heredado-123' }))).json();
  assert.equal(p.traslados.length, 1);
  const c = await llamar(confirmar, env, req('/api/traslados/confirmar', { metodo: 'POST', token: 'token-heredado-123', cuerpo: { transferUid: 'u1', receivedBranch: 'TIENDA PRINCIPAL' } }));
  assert.equal(c.status, 200);
});

test('sin token o token inválido: 401; sin ningún token configurado: 503', async () => {
  const { env, db } = entorno();
  assert.equal((await llamar(pendientes, env, req('/api/traslados/pendientes'))).status, 401);
  assert.equal((await llamar(pendientes, env, req('/api/traslados/pendientes', { token: 'token-heredado-124' }))).status, 401);
  assert.equal((await llamar(pendientes, env, req('/api/traslados/pendientes', { token: 'tok-heredado' }))).status, 401);
  db.prepare("UPDATE settings SET valor = '' WHERE clave = 'sync_token'").run();
  assert.equal((await llamar(pendientes, env, req('/api/traslados/pendientes'))).status, 503);
});

test('token con sucursal: solo envía desde su sucursal, solo lista y confirma lo dirigido a ella', async () => {
  const { env, db } = entorno();
  const suc1 = await emitir(env, { nombre: 'POS Sucursal 1', alcance: ['traslados'], sucursal: 'sucursal 1' });
  const central = await emitir(env, { nombre: 'POS Central', alcance: ['traslados'], sucursal: 'TIENDA PRINCIPAL' });
  const otra = await emitir(env, { nombre: 'POS Sucursal 2', alcance: ['traslados'], sucursal: 'SUCURSAL 2' });
  assert.equal(suc1.status, 201);
  assert.match(suc1.token, /^tv_/);
  // En BD solo vive el hash, nunca el token.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE token_hash = ?').get(suc1.token).n, 0);

  // Suplantación de origen: SUCURSAL 1 intenta enviar como SUCURSAL 2 → 403.
  const falso = await llamar(enviar, env, req('/api/traslados/enviar', { metodo: 'POST', token: suc1.token, cuerpo: paquete('u2', 'SUCURSAL 2') }));
  assert.equal(falso.status, 403);
  assert.equal((await falso.json()).codigo, 'sucursal_no_autorizada');

  const ok = await llamar(enviar, env, req('/api/traslados/enviar', { metodo: 'POST', token: suc1.token, cuerpo: paquete('u3') }));
  assert.equal(ok.status, 200);

  // La central ve el envío (sin pasar destino: se fuerza el suyo); la otra sucursal no.
  const verCentral = await (await llamar(pendientes, env, req('/api/traslados/pendientes', { token: central.token }))).json();
  assert.deepEqual(verCentral.traslados.map((t) => t.transferUid), ['u3']);
  const verOtra = await (await llamar(pendientes, env, req('/api/traslados/pendientes', { token: otra.token }))).json();
  assert.equal(verOtra.traslados.length, 0);

  // Pedir la bandeja de otra sucursal → 403 (no se puede espiar el buzón ajeno).
  const espia = await llamar(pendientes, env, req('/api/traslados/pendientes?destino=TIENDA%20PRINCIPAL', { token: otra.token }));
  assert.equal(espia.status, 403);

  // Confirmar un traslado ajeno → 404 y NO cambia de estado; el destino legítimo sí puede.
  const robo = await llamar(confirmar, env, req('/api/traslados/confirmar', { metodo: 'POST', token: otra.token, cuerpo: { transferUid: 'u3', receivedBranch: 'SUCURSAL 2' } }));
  assert.equal(robo.status, 404);
  assert.equal(db.prepare("SELECT status FROM traslados_buzon WHERE transfer_uid = 'u3'").get().status, 'en_transito');
  const conf = await llamar(confirmar, env, req('/api/traslados/confirmar', { metodo: 'POST', token: central.token, cuerpo: { transferUid: 'u3', receivedBranch: 'LO QUE SEA', receivedBy: 'Ana' } }));
  assert.equal(conf.status, 200);
  const fila = db.prepare("SELECT status, received_branch FROM traslados_buzon WHERE transfer_uid = 'u3'").get();
  assert.deepEqual({ ...fila }, { status: 'recibido', received_branch: 'TIENDA PRINCIPAL' });
});

test('alcance: un token solo "traslados" no sirve para sync v2 y uno solo "sync" no sirve para traslados', async () => {
  const { env } = entorno();
  const soloTraslados = await emitir(env, { nombre: 'a', alcance: ['traslados'], sucursal: 'SUCURSAL 1' });
  const soloSync = await emitir(env, { nombre: 'b', alcance: ['sync'] });
  const ambos = await emitir(env, { nombre: 'c', alcance: ['sync', 'traslados'], sucursal: 'TIENDA PRINCIPAL' });

  const v2 = (token) => llamar(eventosV2, env, req('/api/sync/v2/eventos?dispositivo=pc1', { token }));
  assert.equal((await v2(soloTraslados.token)).status, 403);
  assert.equal((await v2(soloSync.token)).status, 200);
  assert.equal((await v2(ambos.token)).status, 200);

  const tr = (token) => llamar(pendientes, env, req('/api/traslados/pendientes', { token }));
  assert.equal((await tr(soloSync.token)).status, 403);
  assert.equal((await tr(soloTraslados.token)).status, 200);
  assert.equal((await tr(ambos.token)).status, 200);
});

test('revocar un token lo invalida; validaciones de emisión', async () => {
  const { env } = entorno();
  const t = await emitir(env, { nombre: 'x', alcance: ['traslados'], sucursal: 'SUCURSAL 1' });
  assert.equal((await llamar(pendientes, env, req('/api/traslados/pendientes', { token: t.token }))).status, 200);

  const lista = await (await listarTokens({ env })).json();
  assert.equal(lista.tokens.length, 1);
  assert.equal(JSON.stringify(lista).includes('token_hash'), false);
  const rev = await revocarToken({ env, request: req(`/api/admin/api-tokens?id=${lista.tokens[0].id}`, { metodo: 'DELETE' }) });
  assert.equal(rev.status, 200);
  assert.equal((await llamar(pendientes, env, req('/api/traslados/pendientes', { token: t.token }))).status, 401);

  assert.equal((await emitir(env, { nombre: 'sin sucursal', alcance: ['traslados'] })).status, 400);
  assert.equal((await emitir(env, { nombre: 'mal', alcance: ['admin'] })).status, 400);
  assert.equal((await emitir(env, { nombre: '', alcance: ['sync'] })).status, 400);
});

test('se puede desactivar el token heredado en traslados (y sigue sirviendo para sync)', async () => {
  const { env } = entorno();
  const off = await ajustarLegacy({ env, request: req('/api/admin/api-tokens', { metodo: 'PUT', cuerpo: { legacySyncEnTraslados: false } }) });
  assert.equal(off.status, 200);
  const r = await llamar(pendientes, env, req('/api/traslados/pendientes?destino=X', { token: 'token-heredado-123' }));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).codigo, 'token_sin_alcance');
  assert.equal((await llamar(eventosV2, env, req('/api/sync/v2/eventos?dispositivo=pc1', { token: 'token-heredado-123' }))).status, 200);
});

test('migración 010 sin aplicar: el token heredado sigue funcionando y la gestión avisa', async () => {
  const { env } = entornoSqlite({}, { hasta: '009_traslados_buzon.sql' });
  env.DB.prepare("INSERT INTO settings (clave, valor) VALUES ('sync_token', 'token-heredado-123')").run();
  assert.equal((await llamar(pendientes, env, req('/api/traslados/pendientes?destino=X', { token: 'token-heredado-123' }))).status, 200);
  assert.equal((await llamar(pendientes, env, req('/api/traslados/pendientes?destino=X', { token: 'otro' }))).status, 401);
  const g = await (await listarTokens({ env })).json();
  assert.equal(g.migracionPendiente, true);
  assert.equal((await emitir(env, { nombre: 'x', alcance: ['sync'] })).status, 503);
});

test('errores internos no filtran el mensaje: 500 genérico en traslados', async () => {
  const { env, db } = entorno();
  db.exec('DROP TABLE traslados_buzon');
  const r = await llamar(pendientes, env, req('/api/traslados/pendientes?destino=X', { token: 'token-heredado-123' }));
  assert.equal(r.status, 500);
  const txt = await r.text();
  assert.equal(/traslados_buzon|no such table|SQLITE/i.test(txt), false, txt);
});
