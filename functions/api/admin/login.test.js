import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { entornoSqlite, peticion } from '../../lib/d1Sqlite.js';
import { onRequestPost as login } from './login.js';
import { onRequestPost as setup, onRequestGet as setupGet } from './setup.js';
import { hashPassword, verificarPassword } from '../../lib/auth.js';

const URL_LOGIN = 'https://t.test/api/admin/login';
const URL_SETUP = 'https://t.test/api/admin/setup';
const intentar = (env, cuerpo, ip) => login({ env, request: peticion(URL_LOGIN, { cuerpo, ip }) });

async function conAdmin(password = 'clave-correcta-1') {
  const { db, env } = entornoSqlite();
  db.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)').run('dueno@tienda.test', await hashPassword(password));
  return { db, env };
}

test('login correcto abre sesión (cookie HttpOnly) y limpia los fallos del par IP+correo', async () => {
  const { db, env } = await conAdmin();
  await intentar(env, { email: 'dueno@tienda.test', password: 'mala' });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rate_log WHERE accion = 'login_fallo' AND ip LIKE 'ipc:%'").get().n, 1);
  const r = await intentar(env, { email: 'Dueno@Tienda.test', password: 'clave-correcta-1' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /admin_sesion=.*HttpOnly/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rate_log WHERE accion = 'login_fallo' AND ip LIKE 'ipc:%'").get().n, 0);
});

test('bloqueo: al 5.º fallo por IP+correo responde 429 con Retry-After, incluso con la clave correcta', async () => {
  const { env } = await conAdmin();
  for (let i = 0; i < 5; i++) {
    const r = await intentar(env, { email: 'dueno@tienda.test', password: `mala-${i}` });
    assert.equal(r.status, 401);
  }
  const bloqueado = await intentar(env, { email: 'dueno@tienda.test', password: 'clave-correcta-1' });
  assert.equal(bloqueado.status, 429);
  assert.equal(bloqueado.headers.get('retry-after'), '900');
  assert.equal((await bloqueado.json()).codigo, 'demasiados_intentos');

  // Otra IP no queda bloqueada por el par (solo por el contador por correo, que es mayor).
  const otra = await intentar(env, { email: 'dueno@tienda.test', password: 'clave-correcta-1' }, '10.9.9.9');
  assert.equal(otra.status, 200);
});

test('bloqueo por IP: barrer muchos correos desde la misma IP se corta a los 20 fallos', async () => {
  const { env } = await conAdmin();
  for (let i = 0; i < 20; i++) {
    assert.equal((await intentar(env, { email: `x${i}@t.test`, password: 'mala' })).status, 401);
  }
  assert.equal((await intentar(env, { email: 'nuevo@t.test', password: 'mala' })).status, 429);
});

test('los fallos viejos (> 15 min) dejan de contar', async () => {
  const { db, env } = await conAdmin();
  const ins = db.prepare("INSERT INTO rate_log (ip, accion, creado_en) VALUES (?, 'login_fallo', datetime('now', '-16 minutes'))");
  for (let i = 0; i < 5; i++) ins.run('ipc:186.5.1.1|dueno@tienda.test');
  const r = await intentar(env, { email: 'dueno@tienda.test', password: 'clave-correcta-1' });
  assert.equal(r.status, 200);
});

test('correo inexistente: mismo 401 genérico', async () => {
  const { env } = await conAdmin();
  const r = await intentar(env, { email: 'nadie@t.test', password: 'x' });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, 'Correo o contraseña incorrectos');
});

test('migración transparente: un hash de 50 000 iteraciones se re-guarda con 100 000 al entrar', async () => {
  const { db, env } = entornoSqlite();
  const sal = randomBytes(16);
  const viejo = `pbkdf2$50000$${sal.toString('base64url')}$${pbkdf2Sync('clave-vieja-1', sal, 50000, 32, 'sha256').toString('base64url')}`;
  db.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)').run('dueno@tienda.test', viejo);

  const r = await intentar(env, { email: 'dueno@tienda.test', password: 'clave-vieja-1' });
  assert.equal(r.status, 200);
  const nuevo = db.prepare('SELECT password_hash FROM admins').get().password_hash;
  assert.match(nuevo, /^pbkdf2\$100000\$/);
  assert.equal(await verificarPassword('clave-vieja-1', nuevo), true);

  // Con clave errónea NO se toca el hash.
  db.prepare('UPDATE admins SET password_hash = ?').run(viejo);
  await intentar(env, { email: 'dueno@tienda.test', password: 'mala' });
  assert.equal(db.prepare('SELECT password_hash FROM admins').get().password_hash, viejo);
});

const cuerpoSetup = { email: 'nuevo@tienda.test', password: 'una-clave-larga-1' };
const alta = (env, cuerpo = cuerpoSetup, headers = {}, ip) =>
  setup({ env, request: peticion(URL_SETUP, { cuerpo, headers, ip }) });

test('setup: sin ADMIN_SETUP_SECRET en el entorno queda deshabilitado (403) aunque la BD esté vacía', async () => {
  const { db, env } = entornoSqlite();
  const r = await alta(env);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).codigo, 'setup_deshabilitado');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admins').get().n, 0);
  const g = await (await setupGet({ env })).json();
  assert.deepEqual(g, { necesitaSetup: true, setupHabilitado: false });
});

test('setup: exige el secreto (cabecera o campo) y crea el admin una sola vez', async () => {
  const { db, env } = entornoSqlite({ ADMIN_SETUP_SECRET: 's3creto-largo' });
  assert.equal((await alta(env)).status, 403);
  assert.equal((await alta(env, { ...cuerpoSetup, setupSecret: 'otro' })).status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admins').get().n, 0);

  const ok = await alta(env, cuerpoSetup, { 'x-setup-secret': 's3creto-largo' });
  assert.equal(ok.status, 201);
  assert.match(ok.headers.get('set-cookie'), /admin_sesion=/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admins').get().n, 1);

  const segundo = await alta(env, { email: 'otro@t.test', password: 'clave-larga-22' }, { 'x-setup-secret': 's3creto-largo' });
  assert.equal(segundo.status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admins').get().n, 1);
});

test('setup: secreto por campo del cuerpo y bloqueo tras 5 secretos erróneos por IP', async () => {
  const { env } = entornoSqlite({ ADMIN_SETUP_SECRET: 's3creto-largo' });
  for (let i = 0; i < 5; i++) assert.equal((await alta(env, { ...cuerpoSetup, setupSecret: `x${i}` })).status, 403);
  const bloqueado = await alta(env, { ...cuerpoSetup, setupSecret: 's3creto-largo' });
  assert.equal(bloqueado.status, 429);
  const otraIp = await alta(env, { ...cuerpoSetup, setupSecret: 's3creto-largo' }, {}, '10.8.8.8');
  assert.equal(otraIp.status, 201);
});
