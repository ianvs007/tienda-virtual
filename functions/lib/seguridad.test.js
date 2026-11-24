import test from 'node:test';
import assert from 'node:assert/strict';
import { iguales, sha256Hex, tokenBearer } from './seguridad.js';
import { aplicarCabecerasSeguridad } from './cabeceras.js';
import { ErrorHttp, respuestaDeError } from './errores.js';

test('iguales: coincide solo con el mismo texto (cualquier largo y vacío)', async () => {
  assert.equal(await iguales('abc123', 'abc123'), true);
  assert.equal(await iguales('abc123', 'abc124'), false);
  assert.equal(await iguales('abc', 'abcd'), false);
  assert.equal(await iguales('', 'x'), false);
  assert.equal(await iguales('', ''), true);
  assert.equal(await iguales(undefined, 'x'), false);
});

test('sha256Hex y tokenBearer', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const r = new Request('https://t.test', { headers: { Authorization: 'Bearer   tok123  ' } });
  assert.equal(tokenBearer(r), 'tok123');
  assert.equal(tokenBearer(new Request('https://t.test')), '');
});

test('respuestaDeError: nunca filtra el mensaje interno; ErrorHttp conserva el suyo', () => {
  const secreto = 'SQLITE_ERROR: no such table: admins en /var/task/x.js';
  const r = respuestaDeError(new Error(secreto));
  assert.equal(r.status, 500);
  assert.equal(JSON.stringify(r.body).includes('SQLITE'), false);
  assert.equal(JSON.stringify(r.body).includes('admins'), false);

  const e = respuestaDeError(new ErrorHttp(403, 'No autorizado para esa sucursal', 'sucursal_no_autorizada'));
  assert.deepEqual(e, { status: 403, body: { error: 'No autorizado para esa sucursal', codigo: 'sucursal_no_autorizada' } });
});

test('cabeceras de seguridad: se agregan, no pisan las del handler y conservan cuerpo y cookies', async () => {
  const original = new Response(JSON.stringify({ ok: 1 }), {
    status: 201,
    headers: { 'Cache-Control': 'no-store', 'X-Frame-Options': 'SAMEORIGIN' },
  });
  original.headers.append('Set-Cookie', 'a=1; Path=/');
  original.headers.append('Set-Cookie', 'b=2; Path=/');
  const r = aplicarCabecerasSeguridad(original, 'api');
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { ok: 1 });
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(r.headers.getSetCookie().length, 2);

  const html = aplicarCabecerasSeguridad(new Response('x'), 'html');
  assert.match(html.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);

  const preflight = aplicarCabecerasSeguridad(new Response(null, { status: 204 }), 'api');
  assert.equal(preflight.status, 204);
});

test('middleware raíz: las respuestas de /api/* (también las de error) llevan cabeceras de seguridad', async () => {
  const { onRequest } = await import('../_middleware.js');
  const ctx = (next) => ({ request: new Request('https://t.test/api/categorias'), env: {}, next });
  const ok = await onRequest(ctx(async () => Response.json([1])));
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.match(ok.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const falla = await onRequest(ctx(async () => { throw new Error('SQLITE_ERROR secreto'); }));
  assert.equal(falla.status, 500);
  assert.equal(falla.headers.get('x-frame-options'), 'DENY');
  assert.equal((await falla.text()).includes('SQLITE'), false);
});
