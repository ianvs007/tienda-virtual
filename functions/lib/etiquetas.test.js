// Recorrido completo de las etiquetas físicas: tablas `products` + `barcodes`
// del POS → payload del POS → nube (snapshot, lotes de etiquetas, finalizar) →
// búsqueda pública y admin. Caso real del dump del 09/09/2026: 02797 es
// etiqueta de una unidad de VESTIDO BRILLO y a la vez código de MODELO de
// VESTIDO VICTORIANO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { normalizarEtiqueta } from './codigo.js';
import { planificarEtiquetas, resolverEtiqueta, buscarPorEtiqueta, etiquetasDeProducto, MAX_ETIQUETAS_LOTE } from './etiquetas.js';
import { buscarEnCatalogo } from './busqueda.js';
import { aplicarSnapshot, recibirEtiquetas, finalizarSesion, listarEventos, confirmarEventos } from './syncV2.js';
import { FakeDB, envConDB } from './fakeD1.js';
import { onRequestGet as catalogoPublico } from '../api/productos.js';
import { onRequestGet as etiquetasAdmin } from '../api/admin/etiquetas.js';
import { onRequestPost as postEtiquetas } from '../api/sync/v2/etiquetas.js';
import { onRequestPost as postFinalizar } from '../api/sync/v2/finalizar.js';

// ── Punto de partida: las tablas del POS, no un payload ya resuelto ──────────
const POS_PRODUCTS = [
  { id: 2087, globalId: 'g-brillo', name: 'VESTIDO BRILLO', shortCode: '02786', size: 'S', color: 'VARIOS', stock: 2, price: 388, active: true },
  { id: 2098, globalId: 'g-victoriano', name: 'VESTIDO VICTORIANO', shortCode: '02797', size: 'S', color: 'CELESTE', stock: 1, price: 338, active: true },
];
const POS_BARCODES = [
  { id: 2774, productId: 2087, barcode: '2007054225104', shortCode: '02796', used: false },
  { id: 2775, productId: 2087, barcode: '2007054226118', shortCode: '02797', used: false },
  { id: 2776, productId: 2087, barcode: '2007054226125', shortCode: '02798', used: true },
  { id: 2796, productId: 2098, barcode: '2007952407329', shortCode: '02818', used: false },
];

// El módulo PURO del POS (`src/utils/syncV2.js`) construye el payload real. Si
// el repo hermano no está al lado, se usa una réplica mínima con las MISMAS
// reglas, para que la suite de la nube siga corriendo sola.
const RUTA_POS = new URL('../../../tienda de ropas/src/utils/syncV2.js', import.meta.url);
async function cargarArmadoresPOS() {
  if (existsSync(fileURLToPath(RUTA_POS))) {
    const m = await import(RUTA_POS.href);
    return { armarFilasSnapshot: m.armarFilasSnapshot, armarFilasEtiquetas: m.armarFilasEtiquetas, origen: 'pos' };
  }
  return {
    origen: 'replica',
    armarFilasSnapshot: (products) => ({
      filas: products
        .filter((p) => p.active !== false && p.shortCode && p.globalId)
        .map((p) => ({ globalId: p.globalId, codigo: p.shortCode, nombre: p.name, talla: p.size ?? '', color: p.color ?? '', stock: p.stock, precio: p.price })),
    }),
    armarFilasEtiquetas: (products, barcodes) => {
      const pub = new Map(products.filter((p) => p.active !== false && p.shortCode && p.globalId).map((p) => [p.id, p]));
      const filas = new Map();
      for (const u of barcodes) {
        const p = pub.get(u.productId);
        const etiqueta = p && normalizarEtiqueta(u.shortCode);
        if (!etiqueta) continue;
        const k = `${etiqueta}|${p.globalId}`;
        const prev = filas.get(k);
        filas.set(k, { etiqueta, globalId: p.globalId, disponible: (prev?.disponible ?? false) || !u.used });
      }
      return { filas: [...filas.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta)) };
    },
  };
}
const POS = await cargarArmadoresPOS();

const DISPOSITIVO = 'central';

/** Sube el snapshot completo del POS + sus etiquetas y finaliza. Devuelve el resumen de finalizar. */
async function sincronizarDesdePOS(env, { sesion, products = POS_PRODUCTS, barcodes = POS_BARCODES, conEtiquetas = true } = {}) {
  const snap = POS.armarFilasSnapshot(products);
  await aplicarSnapshot(env, { dispositivoId: DISPOSITIVO, sesion, filas: snap.filas });
  let etiquetas;
  if (conEtiquetas) {
    const { filas } = POS.armarFilasEtiquetas(products, barcodes);
    for (let i = 0; i < filas.length; i += MAX_ETIQUETAS_LOTE) {
      await recibirEtiquetas(env, { dispositivoId: DISPOSITIVO, sesion, etiquetas: filas.slice(i, i + MAX_ETIQUETAS_LOTE) });
    }
    etiquetas = { esperadas: filas.length };
  }
  return finalizarSesion(env, {
    dispositivoId: DISPOSITIVO,
    sesion,
    productosEsperados: new Set(snap.filas.map((f) => f.globalId)).size,
    etiquetas,
  });
}

const porGlobal = (env, g) => env.DB.products.find((p) => p.global_id === g);
const publicadas = (env) => env.DB.etiquetas.map((e) => `${e.etiqueta}|${e.global_id}|${e.disponible}`).sort();

// ─────────────────────────── normalización ───────────────────────────────

test('normalizarEtiqueta: estricta, conserva ceros a la izquierda y nunca vuelve válido lo inválido', () => {
  assert.equal(normalizarEtiqueta('02797'), '02797');
  assert.equal(normalizarEtiqueta(' 2797 '), '02797');
  assert.equal(normalizarEtiqueta('1'), '00001');
  assert.equal(normalizarEtiqueta('027970'), null); // 6 dígitos
  assert.equal(normalizarEtiqueta('2797a'), null);
  assert.equal(normalizarEtiqueta('2007054226118'), null); // EAN, no etiqueta
  assert.equal(normalizarEtiqueta(''), null);
  assert.equal(normalizarEtiqueta(null), null);
});

test('planificarEtiquetas: deduplica (etiqueta, globalId), disponible si alguna unidad lo está, rechaza inválidas', () => {
  const { filas, rechazadas } = planificarEtiquetas([
    { etiqueta: '02797', globalId: 'g-brillo', disponible: false },
    { etiqueta: '2797', globalId: 'g-brillo', disponible: true },
    { etiqueta: 'ABC', globalId: 'g-brillo', disponible: true },
    { etiqueta: '00001', globalId: '', disponible: true },
  ]);
  assert.deepEqual(filas, [{ etiqueta: '02797', globalId: 'g-brillo', disponible: 1 }]);
  assert.equal(rechazadas.length, 2);
});

test('resolverEtiqueta: una prenda → etiqueta; varias → conflicto explícito; ninguna → ninguna', () => {
  const una = resolverEtiqueta('02797', [{ product_id: 1, global_id: 'g', nombre: 'A', codigo: '00001', activo: 1, disponible: 1 }]);
  assert.equal(una.tipo, 'etiqueta');
  const varias = resolverEtiqueta('02797', [
    { product_id: 1, global_id: 'g1', nombre: 'A', activo: 1, disponible: 1 },
    { product_id: 2, global_id: 'g2', nombre: 'B', activo: 1, disponible: 0 },
  ]);
  assert.equal(varias.tipo, 'etiqueta_conflicto');
  assert.equal(varias.productos.length, 2);
  assert.equal(resolverEtiqueta('02797', []).tipo, 'ninguna');
  assert.equal(resolverEtiqueta(null, []).tipo, 'no_es_etiqueta');
});

// ───────────────────── recorrido completo POS → nube ─────────────────────

test(`recorrido completo (${POS.origen}): products+barcodes del POS → nube → 02796/02797 → BRILLO, 02818 → VICTORIANO, 02798 vendida`, async () => {
  const env = envConDB();
  const r = await sincronizarDesdePOS(env, { sesion: 's1' });

  assert.equal(r.ok, true);
  assert.deepEqual(r.etiquetas, { ok: true, vistas: 4, esperadas: 4, publicadas: 4, sinProducto: 0, retiradas: 0, actualizadas: 4 });

  const brillo = porGlobal(env, 'g-brillo');
  const victoriano = porGlobal(env, 'g-victoriano');
  // El código de MODELO sigue intacto: 02797 es VICTORIANO en products.codigo
  assert.equal(brillo.codigo, '02786');
  assert.equal(victoriano.codigo, '02797');
  assert.deepEqual(publicadas(env), [
    `02796|g-brillo|1`, `02797|g-brillo|1`, `02798|g-brillo|0`, `02818|g-victoriano|1`,
  ]);

  for (const etq of ['02796', '02797']) {
    const res = await buscarPorEtiqueta(env, etq);
    assert.equal(res.tipo, 'etiqueta', etq);
    assert.equal(res.productos[0].id, brillo.id, etq);
    assert.equal(res.productos[0].disponible, true, etq);
  }
  const v = await buscarPorEtiqueta(env, '02818');
  assert.equal(v.productos[0].id, victoriano.id);
  const vendida = await buscarPorEtiqueta(env, '02798');
  assert.equal(vendida.tipo, 'etiqueta');
  assert.equal(vendida.productos[0].id, brillo.id);
  assert.equal(vendida.productos[0].disponible, false);
  // La presencia de la sesión queda en settings hasta la sesión siguiente (finalizar es repetible)
  assert.deepEqual(env.DB.clavesSesion(), ['sync_sesion:s1:etiquetas', 'sync_sesion:s1:productos']);
  assert.equal(env.DB.escrituras.etiquetas, 4, 'primera publicación: 4 altas');

  // Misma sincronización otra vez, sin cambios: nada se reescribe.
  const r2 = await sincronizarDesdePOS(env, { sesion: 's2' });
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.etiquetas, { ok: true, vistas: 4, esperadas: 4, publicadas: 4, sinProducto: 0, retiradas: 0, actualizadas: 0 });
  assert.equal(env.DB.escrituras.etiquetas, 4, 'sin cambios no hay escrituras de etiquetas');
  assert.deepEqual(env.DB.clavesSesion(), ['sync_sesion:s2:etiquetas', 'sync_sesion:s2:productos'], 's1 se limpió al empezar s2');
});

test('búsqueda pública: la etiqueta 02797 gana al código de modelo 02797; 02786 cae al código de modelo; 02798 se muestra como vendida', async () => {
  const env = envConDB();
  await sincronizarDesdePOS(env, { sesion: 's1' });
  const brillo = porGlobal(env, 'g-brillo');
  const victoriano = porGlobal(env, 'g-victoriano');

  const buscar = async (q) => {
    const resp = await catalogoPublico({ env, request: new Request(`https://t.test/api/productos?q=${q}`) });
    return resp.json();
  };

  const r2797 = await buscar('02797');
  assert.equal(r2797.length, 1);
  assert.equal(r2797[0].id, brillo.id);
  assert.deepEqual(r2797[0].coincidencia, { tipo: 'etiqueta', etiqueta: '02797', disponible: true, prendas: 1 });

  const r2818 = await buscar('2818'); // sin cero a la izquierda: normaliza, no adivina
  assert.equal(r2818.length, 1);
  assert.equal(r2818[0].id, victoriano.id);

  const r2786 = await buscar('02786'); // no es etiqueta de nadie → código de modelo
  assert.equal(r2786.length, 1);
  assert.equal(r2786[0].id, brillo.id);
  assert.deepEqual(r2786[0].coincidencia, { tipo: 'codigo', codigo: '02786' });

  const r2798 = await buscar('02798');
  assert.equal(r2798.length, 1);
  assert.equal(r2798[0].id, brillo.id);
  assert.equal(r2798[0].coincidencia.disponible, false);
  assert.equal(r2798[0].stock_total, 2, 'la etiqueta vendida no altera el stock del snapshot');

  const texto = await buscar('victoriano');
  assert.equal(texto.length, 1);
  assert.equal(texto[0].id, victoriano.id);
  assert.equal(texto[0].coincidencia, undefined);

  assert.deepEqual(await buscar('99999'), []);
});

test('admin: /api/admin/etiquetas resuelve incluyendo inactivas y marca disponible/vendida', async () => {
  const env = envConDB();
  await sincronizarDesdePOS(env, { sesion: 's1' });
  const brillo = porGlobal(env, 'g-brillo');

  const pedir = async (q) => (await etiquetasAdmin({ env, request: new Request(`https://t.test/api/admin/etiquetas?q=${q}`) })).json();

  const r = await pedir('02797');
  assert.equal(r.tipo, 'etiqueta');
  assert.equal(r.productos[0].id, brillo.id);
  assert.equal(r.productos[0].codigo, '02786');
  assert.equal((await pedir('02798')).productos[0].disponible, false);
  assert.equal((await pedir('VESTIDO')).tipo, 'no_es_etiqueta');
  assert.equal((await pedir('00001')).tipo, 'ninguna');

  // Ficha del producto: etiquetas ordenadas con su estado
  assert.deepEqual(await etiquetasDeProducto(env, brillo.id), [
    { etiqueta: '02796', disponible: true },
    { etiqueta: '02797', disponible: true },
    { etiqueta: '02798', disponible: false },
  ]);

  // Prenda desactivada en la nube (p.ej. archivada en el POS y aún con etiquetas
  // publicadas): el público NO la muestra y tampoco cae al código de modelo
  // 02797 (sería VICTORIANO, otra prenda); el admin sí la resuelve como inactiva.
  brillo.activo = 0;
  const publico = await (await catalogoPublico({ env, request: new Request('https://t.test/api/productos?q=02797') })).json();
  assert.deepEqual(publico, [], 'público: etiqueta de prenda inactiva → sin resultados, sin caer a VICTORIANO por código');
  const admin = await pedir('02797');
  assert.equal(admin.tipo, 'etiqueta');
  assert.equal(admin.productos[0].activo, false);
});

test('conflicto: la misma etiqueta en dos productos se publica tal cual y la búsqueda NUNCA elige ni cae al código de modelo', async () => {
  const env = envConDB();
  // El POS tiene la etiqueta 02797 repetida en BRILLO y VICTORIANO (error de etiquetado)
  const barcodes = [...POS_BARCODES, { id: 9000, productId: 2098, barcode: '2009999999999', shortCode: '02797', used: false }];
  await sincronizarDesdePOS(env, { sesion: 's1', barcodes });
  const brillo = porGlobal(env, 'g-brillo');
  const victoriano = porGlobal(env, 'g-victoriano');

  const res = await buscarPorEtiqueta(env, '02797');
  assert.equal(res.tipo, 'etiqueta_conflicto');
  assert.deepEqual(res.productos.map((p) => p.id).sort(), [brillo.id, victoriano.id].sort());

  const publico = await (await catalogoPublico({ env, request: new Request('https://t.test/api/productos?q=02797') })).json();
  assert.equal(publico.length, 2);
  assert.ok(publico.every((p) => p.coincidencia.tipo === 'etiqueta_conflicto'));

  // Con uno de los dos inactivo el público sigue marcando CONFLICTO (no elige la
  // activa en silencio: el error de etiquetado se repara en el POS) e informa
  // cuántas prendas llevan la etiqueta; el admin lo ve completo.
  victoriano.activo = 0;
  const parcial = await (await catalogoPublico({ env, request: new Request('https://t.test/api/productos?q=02797') })).json();
  assert.equal(parcial.length, 1);
  assert.equal(parcial[0].id, brillo.id);
  assert.deepEqual(parcial[0].coincidencia, { tipo: 'etiqueta_conflicto', etiqueta: '02797', disponible: true, prendas: 2 });
  assert.equal((await buscarPorEtiqueta(env, '02797', { soloActivos: false })).tipo, 'etiqueta_conflicto');
  // La variante `soloActivos` (uso interno) sí acota a activos.
  assert.equal((await buscarPorEtiqueta(env, '02797', { soloActivos: true })).tipo, 'etiqueta');
});

test('buscarEnCatalogo: conflicto no cae al código aunque ningún producto de la lista lo tenga', () => {
  const r = buscarEnCatalogo({
    q: '02797',
    productos: [{ id: 5, nombre: 'OTRA', descripcion: '', codigo: '02797' }],
    etiqueta: { tipo: 'etiqueta_conflicto', etiqueta: '02797', productos: [{ id: 1, disponible: true }, { id: 2, disponible: true }] },
  });
  assert.equal(r.modo, 'etiqueta_conflicto');
  assert.deepEqual(r.resultados, []);
});

// ────────────────── sesión: repetición, interrupción, cierre ──────────────────

test('repetir un lote (reintento tras corte) es idempotente: mismo conteo, misma publicación', async () => {
  const env = envConDB();
  const snap = POS.armarFilasSnapshot(POS_PRODUCTS);
  await aplicarSnapshot(env, { dispositivoId: DISPOSITIVO, sesion: 's1', filas: snap.filas });
  const { filas } = POS.armarFilasEtiquetas(POS_PRODUCTS, POS_BARCODES);

  await recibirEtiquetas(env, { dispositivoId: DISPOSITIVO, sesion: 's1', etiquetas: filas });
  const repetido = await recibirEtiquetas(env, { dispositivoId: DISPOSITIVO, sesion: 's1', etiquetas: filas });
  assert.equal(repetido.recibidas, 4);
  assert.equal(repetido.acumuladas, 4, 'sin duplicados en la presencia de la sesión');

  const r = await finalizarSesion(env, { dispositivoId: DISPOSITIVO, sesion: 's1', productosEsperados: 2, etiquetas: { esperadas: 4 } });
  assert.equal(r.ok, true);
  assert.equal(env.DB.etiquetas.length, 4);
});

test('interrupción: si llegan menos etiquetas que las esperadas el cierre se rechaza y NADA cambia (ni publicación ni desactivación)', async () => {
  const env = envConDB();
  await sincronizarDesdePOS(env, { sesion: 's1' });
  const antes = publicadas(env);

  // Nueva sesión: snapshot completo pero solo llegó 1 de 4 etiquetas (corte de red)
  const snap = POS.armarFilasSnapshot(POS_PRODUCTS);
  await aplicarSnapshot(env, { dispositivoId: DISPOSITIVO, sesion: 's2', filas: snap.filas });
  const { filas } = POS.armarFilasEtiquetas(POS_PRODUCTS, POS_BARCODES);
  await recibirEtiquetas(env, { dispositivoId: DISPOSITIVO, sesion: 's2', etiquetas: filas.slice(0, 1) });

  const batchesAntes = env.DB.batches;
  const r = await finalizarSesion(env, { dispositivoId: DISPOSITIVO, sesion: 's2', productosEsperados: 2, etiquetas: { esperadas: 4 } });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'etiquetas_incompletas');
  assert.deepEqual(r.etiquetas, { vistas: 1, esperadas: 4 });
  assert.equal(env.DB.batches, batchesAntes, 'no se ejecutó ningún batch');
  assert.deepEqual(publicadas(env), antes, 'lo publicado en s1 sigue intacto');
  assert.deepEqual(JSON.parse(env.DB.settings['sync_sesion:s2:etiquetas']), { [`${filas[0].etiqueta}|${filas[0].globalId}`]: 1 }, 'la presencia parcial queda para el reintento');

  // Volver a sincronizar completo resuelve: la sesión nueva del mismo dispositivo
  // descarta la presencia cortada de s2 y publica lo suyo.
  const ok = await sincronizarDesdePOS(env, { sesion: 's3' });
  assert.equal(ok.ok, true);
  assert.deepEqual(env.DB.clavesSesion(), ['sync_sesion:s3:etiquetas', 'sync_sesion:s3:productos'], 'se limpian también los restos de s2');
  assert.equal(env.DB.etiquetas.length, 4);
});

test('endpoint finalizar: 409 con motivo etiquetas_incompletas; 400 si esperadas no es entero', async () => {
  const env = envConDB();
  const snap = POS.armarFilasSnapshot(POS_PRODUCTS);
  await aplicarSnapshot(env, { dispositivoId: DISPOSITIVO, sesion: 's1', filas: snap.filas });
  const req = (body) =>
    new Request('https://t.test/api/sync/v2/finalizar', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ dispositivo: DISPOSITIVO, sesion: 's1', productosEsperados: 2, ...body }),
    });

  const r409 = await postFinalizar({ env, request: req({ etiquetas: { esperadas: 4 } }) });
  assert.equal(r409.status, 409);
  const d = await r409.json();
  assert.equal(d.motivo, 'etiquetas_incompletas');
  assert.match(d.error, /Etiquetas incompletas/);

  const r400 = await postFinalizar({ env, request: req({ etiquetas: { esperadas: -1 } }) });
  assert.equal(r400.status, 400);

  const r200 = await postFinalizar({ env, request: req({ etiquetas: { esperadas: 0 } }) });
  assert.equal(r200.status, 200);
});

test('endpoint etiquetas: rechaza lotes vacíos o mayores al máximo y aterriza los válidos', async () => {
  const env = envConDB();
  const req = (etiquetas) =>
    new Request('https://t.test/api/sync/v2/etiquetas', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ dispositivo: DISPOSITIVO, sesion: 's1', etiquetas }),
    });
  assert.equal((await postEtiquetas({ env, request: req([]) })).status, 400);
  const grande = Array.from({ length: MAX_ETIQUETAS_LOTE + 1 }, (_, i) => ({ etiqueta: String(i), globalId: 'g' }));
  assert.equal((await postEtiquetas({ env, request: req(grande) })).status, 400);

  const ok = await postEtiquetas({ env, request: req([{ etiqueta: '02797', globalId: 'g-brillo', disponible: true }, { etiqueta: 'x', globalId: 'g' }]) });
  assert.equal(ok.status, 200);
  const d = await ok.json();
  assert.equal(d.recibidas, 1);
  assert.equal(d.rechazadas, 1);
});

test('producto con muchas etiquetas: varios lotes de la misma sesión se publican juntos al finalizar', async () => {
  const env = envConDB();
  const barcodes = Array.from({ length: 1100 }, (_, i) => ({ id: i + 1, productId: 2087, shortCode: String(i + 1).padStart(5, '0'), used: i % 3 === 0 }));
  const r = await sincronizarDesdePOS(env, { sesion: 's1', barcodes });
  assert.equal(r.etiquetas.publicadas, 1100);
  assert.equal(env.DB.etiquetas.length, 1100);
  const brillo = porGlobal(env, 'g-brillo');
  assert.ok(env.DB.etiquetas.every((e) => e.product_id === brillo.id));
});

// ─────────────── compatibilidad: cliente antiguo y retiro explícito ───────────────

test('cliente antiguo (finalizar sin `etiquetas`): lo publicado NO se toca; omitir el campo no es lista vacía', async () => {
  const env = envConDB();
  await sincronizarDesdePOS(env, { sesion: 's1' });
  const antes = publicadas(env);

  const r = await sincronizarDesdePOS(env, { sesion: 's2', conEtiquetas: false });
  assert.equal(r.ok, true);
  assert.deepEqual(r.etiquetas, { ok: true, omitidas: true });
  assert.deepEqual(publicadas(env), antes);
});

test('retiro explícito: esperadas 0 sin lotes retira todas las asociaciones publicadas', async () => {
  const env = envConDB();
  await sincronizarDesdePOS(env, { sesion: 's1' });
  assert.equal(env.DB.etiquetas.length, 4);

  const r = await sincronizarDesdePOS(env, { sesion: 's2', barcodes: [] });
  assert.equal(r.ok, true);
  assert.equal(r.etiquetas.retiradas, 4);
  assert.equal(env.DB.etiquetas.length, 0);
  assert.equal((await buscarPorEtiqueta(env, '02797')).tipo, 'ninguna');
});

test('cambios entre sesiones: venta en mostrador → disponible 0; unidad eliminada → retirada; etiqueta reasignada a otra prenda → cambia de producto', async () => {
  const env = envConDB();
  await sincronizarDesdePOS(env, { sesion: 's1' });
  const brillo = porGlobal(env, 'g-brillo');
  const victoriano = porGlobal(env, 'g-victoriano');

  const barcodes = POS_BARCODES.map((b) => ({ ...b }));
  barcodes.find((b) => b.shortCode === '02796').used = true;      // vendida en mostrador
  const sinVict = barcodes.filter((b) => b.shortCode !== '02818'); // unidad eliminada
  sinVict.find((b) => b.shortCode === '02798').productId = 2098;   // etiqueta (vendida) reasignada a VICTORIANO
  const r = await sincronizarDesdePOS(env, { sesion: 's2', barcodes: sinVict });

  assert.equal(r.ok, true);
  assert.equal(r.etiquetas.retiradas, 2, '02818 y 02798→brillo');
  assert.deepEqual(publicadas(env), [`02796|g-brillo|0`, `02797|g-brillo|1`, `02798|g-victoriano|0`]);
  assert.equal((await buscarPorEtiqueta(env, '02798')).productos[0].id, victoriano.id);
  assert.equal((await buscarPorEtiqueta(env, '02798')).productos[0].disponible, false, 'sigue vendida');
  assert.equal((await buscarPorEtiqueta(env, '02796')).productos[0].disponible, false);
  assert.equal((await buscarPorEtiqueta(env, '02796')).productos[0].id, brillo.id);
});

test('etiqueta de un producto que la nube no conoce (sin global_id) no se publica y se reporta en sinProducto', async () => {
  const env = envConDB();
  const products = [...POS_PRODUCTS, { id: 3000, globalId: 'g-fantasma', name: 'X', shortCode: '09999', size: '', color: '', stock: 1, price: 10, active: true }];
  const barcodes = [...POS_BARCODES, { id: 9001, productId: 3000, shortCode: '09998', used: false }];
  // Se sube el snapshot SIN el fantasma (simula un lote perdido) pero sí sus etiquetas.
  const snap = POS.armarFilasSnapshot(POS_PRODUCTS);
  await aplicarSnapshot(env, { dispositivoId: DISPOSITIVO, sesion: 's1', filas: snap.filas });
  const { filas } = POS.armarFilasEtiquetas(products, barcodes);
  await recibirEtiquetas(env, { dispositivoId: DISPOSITIVO, sesion: 's1', etiquetas: filas });
  const r = await finalizarSesion(env, { dispositivoId: DISPOSITIVO, sesion: 's1', productosEsperados: 2, etiquetas: { esperadas: 5 } });
  assert.equal(r.ok, true);
  assert.equal(r.etiquetas.sinProducto, 1);
  assert.equal(r.etiquetas.publicadas, 4);
  assert.equal((await buscarPorEtiqueta(env, '09998')).tipo, 'ninguna');
});

// ──────────────── stock: las etiquetas no lo tocan; eventos v2 intactos ────────────────

test('stock y eventos: una venta web sin ack se conserva sobre el snapshot; las etiquetas no suman ni restan stock', async () => {
  const env = envConDB();
  await sincronizarDesdePOS(env, { sesion: 's1' });
  const brillo = porGlobal(env, 'g-brillo');
  const varianteBrillo = env.DB.variants.find((v) => v.product_id === brillo.id);
  assert.equal(varianteBrillo.stock, 2);

  // Venta web de 1 BRILLO (evento sin ack del POS)
  env.DB.eventos.push({ id: 1, tipo: 'venta', variant_id: varianteBrillo.id, global_id: 'g-brillo', codigo: '02786', nombre: 'VESTIDO BRILLO', talla: 'S', color: 'VARIOS', delta: -1, pedido_ref: 'P-1' });
  varianteBrillo.stock = 1;

  // El POS vuelve a mandar stock 2 (aún no aplicó el evento) con las mismas etiquetas
  const r = await sincronizarDesdePOS(env, { sesion: 's2' });
  assert.equal(r.ok, true);
  assert.equal(varianteBrillo.stock, 1, 'stock_nube = stock_pos + Σ eventos sin ack, las etiquetas disponibles (2) no lo reemplazan');

  const publico = await (await catalogoPublico({ env, request: new Request('https://t.test/api/productos?q=02797') })).json();
  assert.equal(publico[0].stock_total, 1);
  assert.equal(publico[0].coincidencia.disponible, true, 'disponible es informativo del último snapshot: identifica la prenda, no reserva la unidad');

  // El POS baja y confirma el evento; el siguiente snapshot ya trae 1
  const { eventos } = await listarEventos(env, { desde: 0 });
  assert.equal(eventos.length, 1);
  await confirmarEventos(env, { dispositivoId: DISPOSITIVO, hastaId: 1 });
  const products = POS_PRODUCTS.map((p) => (p.globalId === 'g-brillo' ? { ...p, stock: 1 } : p));
  const barcodes = POS_BARCODES.map((b) => (b.shortCode === '02796' ? { ...b, used: true, usedRef: 'WEB #P-1' } : b));
  await sincronizarDesdePOS(env, { sesion: 's3', products, barcodes });
  assert.equal(varianteBrillo.stock, 1);
  assert.equal((await buscarPorEtiqueta(env, '02796')).productos[0].disponible, false);
  assert.equal((await buscarPorEtiqueta(env, '02797')).productos[0].disponible, true);
});