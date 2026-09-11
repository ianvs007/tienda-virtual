// Cuota gratuita de D1 (11/09/2026): errores de /api/* siempre en JSON y caché
// de borde del catálogo público. Ver BITACORA.md ("Cuota D1 agotada").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as middlewareRaiz, respuestaDeError } from '../_middleware.js';
import { onRequestGet as catalogoPublico, SEGUNDOS_CACHE } from '../api/productos.js';
import { envConDB } from './fakeD1.js';

const MENSAJE_7500 =
  "Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.";

test('respuestaDeError: la cuota agotada de D1 es 503 con mensaje entendible; lo demás 500', () => {
  const cuota = respuestaDeError(new Error(MENSAJE_7500));
  assert.equal(cuota.status, 503);
  assert.equal(cuota.body.codigo, 'd1_sin_cuota');
  assert.match(cuota.body.error, /cuota diaria/);
  assert.match(cuota.body.error, /20:00/);

  const escritura = respuestaDeError(new Error("Your account has exceeded D1's free tier daily row write limit."));
  assert.equal(escritura.status, 503);

  const otro = respuestaDeError(new TypeError("Cannot read properties of undefined (reading 'x')"));
  assert.equal(otro.status, 500);
  assert.equal(otro.body.codigo, 'interno');
  assert.match(otro.body.detalle, /Cannot read/);
});

test('middleware raíz: una excepción en /api/* sale como JSON (nunca la página HTML 1101 de Cloudflare)', async () => {
  const contexto = (pathname, next) => ({
    request: new Request(`https://t.test${pathname}`, { method: 'POST' }),
    env: {},
    next,
  });

  const r = await middlewareRaiz(contexto('/api/admin/login', async () => { throw new Error(MENSAJE_7500); }));
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('content-type').split(';')[0], 'application/json');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const d = await r.json();
  assert.equal(d.codigo, 'd1_sin_cuota');

  // Sin error, la respuesta del handler pasa intacta.
  const ok = await middlewareRaiz(contexto('/api/categorias', async () => Response.json([1])));
  assert.deepEqual(await ok.json(), [1]);

  // Fuera de /api/* (SPA) el middleware no interviene en los errores.
  const spa = contexto('/admin', async () => new Response('html'));
  spa.request = new Request('https://t.test/admin');
  assert.equal(await (await middlewareRaiz(spa)).text(), 'html');
});

test('catálogo público: la segunda vista dentro de la ventana de caché no toca D1', async () => {
  const env = envConDB({
    products: [{ id: 1, nombre: 'Vestido', codigo: '00001', global_id: 'g-1', precio: 100, activo: 1, categoria_id: null }],
    variants: [{ id: 10, product_id: 1, talla: 'U', color: '', stock: 2 }],
  });
  let consultas = 0;
  const prepareOriginal = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => { consultas++; return prepareOriginal(sql); };

  // Cache API simulada (clave = URL).
  const almacen = new Map();
  const cachesPrevio = globalThis.caches;
  globalThis.caches = {
    default: {
      async match(req) { return almacen.get(req.url)?.clone() ?? undefined; },
      async put(req, res) { almacen.set(req.url, res); },
    },
  };
  try {
    const pedir = () => catalogoPublico({ env, request: new Request('https://t.test/api/productos', { headers: { Cookie: 'admin_sesion=x' } }), waitUntil: () => {} });
    const r1 = await pedir();
    assert.equal(r1.headers.get('cache-control'), `public, max-age=0, s-maxage=${SEGUNDOS_CACHE}`);
    assert.equal((await r1.json())[0].stock_total, 2);
    const consultasTrasPrimera = consultas;
    assert.ok(consultasTrasPrimera >= 1);

    // Cambia el stock en D1: la segunda vista sigue sirviendo la copia (a lo sumo SEGUNDOS_CACHE de atraso).
    env.DB.variants[0].stock = 1;
    const r2 = await pedir();
    assert.equal(consultas, consultasTrasPrimera, 'ninguna consulta nueva a D1');
    assert.equal((await r2.json())[0].stock_total, 2);

    // La clave ignora las cookies: la copia es la misma para cualquier visitante.
    assert.equal([...almacen.keys()].length, 1);
    assert.equal([...almacen.keys()][0], 'https://t.test/api/productos');
  } finally {
    if (cachesPrevio === undefined) delete globalThis.caches;
    else globalThis.caches = cachesPrevio;
  }
});

test('catálogo público: sin Cache API (tests en node) responde igual y no falla', async () => {
  const env = envConDB({
    products: [{ id: 1, nombre: 'Vestido', codigo: '00001', global_id: 'g-1', precio: 100, activo: 1, categoria_id: null }],
    variants: [{ id: 10, product_id: 1, talla: 'U', color: '', stock: 2 }],
  });
  assert.equal(typeof globalThis.caches, 'undefined');
  const r = await catalogoPublico({ env, request: new Request('https://t.test/api/productos?q=vestido') });
  assert.equal((await r.json()).length, 1);
});
