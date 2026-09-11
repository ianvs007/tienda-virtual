import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planificarSnapshot,
  stockNube,
  aplicarSnapshot,
  confirmarEventos,
  finalizarSesion,
  listarEventos,
} from './syncV2.js';

import { FakeDB } from './fakeD1.js';

const fila = (extra) => ({
  globalId: 'g-1',
  codigo: '00001',
  nombre: 'Vestido Rojo',
  talla: 'M',
  color: 'Rojo',
  stock: 3,
  precio: 150,
  ...extra,
});

test('stockNube: stock POS más deltas pendientes, nunca negativo', () => {
  assert.equal(stockNube(5, 0), 5);
  assert.equal(stockNube(5, -2), 3);
  assert.equal(stockNube(1, 2), 3);
  assert.equal(stockNube(1, -5), 0);
  assert.equal(stockNube(4, undefined), 4);
});

test('fila sin globalId se rechaza (no se crea nada por código)', () => {
  const plan = planificarSnapshot({
    filas: [fila({ globalId: '' })],
    productos: [],
    variantes: [],
  });
  assert.equal(plan.resumen.rechazadas, 1);
  assert.equal(plan.productosNuevos.length, 0);
  assert.equal(plan.detalle[0].accion, 'rechazada');
});

test('crea producto + variante cuando el globalId no existe', () => {
  const plan = planificarSnapshot({ filas: [fila()], productos: [], variantes: [] });
  assert.equal(plan.productosNuevos.length, 1);
  assert.deepEqual(
    { ...plan.productosNuevos[0], variantesExtra: undefined },
    { globalId: 'g-1', codigo: '00001', nombre: 'Vestido Rojo', precio: 150, talla: 'M', color: 'Rojo', stock: 3, variantesExtra: undefined }
  );
  assert.equal(plan.resumen.creadasProductos, 1);
  assert.equal(plan.resumen.creadasVariantes, 1);
});

test('dos filas del mismo globalId nuevo son dos variantes de UN producto', () => {
  const plan = planificarSnapshot({
    filas: [fila({ talla: 'M' }), fila({ talla: 'L', stock: 1 })],
    productos: [],
    variantes: [],
  });
  assert.equal(plan.productosNuevos.length, 1);
  assert.equal(plan.productosNuevos[0].variantesExtra.length, 1);
  assert.equal(plan.productosNuevos[0].variantesExtra[0].talla, 'L');
  assert.equal(plan.resumen.creadasProductos, 1);
  assert.equal(plan.resumen.creadasVariantes, 2);
});

test('bootstrap: adopta por código SOLO si el producto de la nube no tiene global_id', () => {
  const productos = [{ id: 10, nombre: 'Vestido Rojo', codigo: '00001', global_id: null, precio: 150, activo: 1 }];
  const variantes = [{ id: 100, product_id: 10, talla: 'M', color: 'Rojo', stock: 3 }];
  const plan = planificarSnapshot({ filas: [fila()], productos, variantes });
  assert.deepEqual(plan.globalIdsAdoptados, [{ id: 10, globalId: 'g-1' }]);
  assert.equal(plan.productosNuevos.length, 0);
  assert.equal(plan.resumen.adoptados, 1);
  assert.equal(plan.detalle[0].accion, 'adoptado');
});

test('NO adopta por código si el producto de la nube ya tiene otro global_id: libera el código y crea', () => {
  const productos = [{ id: 10, nombre: 'Otra Prenda', codigo: '00001', global_id: 'g-otro', precio: 99, activo: 1 }];
  const variantes = [{ id: 100, product_id: 10, talla: 'M', color: 'Rojo', stock: 1 }];
  const plan = planificarSnapshot({ filas: [fila()], productos, variantes });
  assert.equal(plan.globalIdsAdoptados.length, 0);
  assert.deepEqual(plan.codigosLiberados, [{ id: 10, codigo: '00001', nombre: 'Otra Prenda' }]);
  assert.equal(plan.productosNuevos.length, 1);
  assert.equal(plan.productosNuevos[0].codigo, '00001');
  assert.match(plan.detalle[0].aviso, /liberado/);
});

test('el stock publicado resta los eventos que el POS aún no confirmó', () => {
  const productos = [{ id: 10, nombre: 'Vestido Rojo', codigo: '00001', global_id: 'g-1', precio: 150, activo: 1 }];
  const variantes = [{ id: 100, product_id: 10, talla: 'M', color: 'Rojo', stock: 9 }];
  // Venta web de 2 unidades sin ack → la nube debe mostrar 3 - 2 = 1
  const plan = planificarSnapshot({
    filas: [fila({ stock: 3 })],
    productos,
    variantes,
    deltasPendientes: new Map([[100, -2]]),
  });
  assert.equal(plan.stockUpdates.length, 1);
  assert.equal(plan.stockUpdates[0].nuevo, 1);
  assert.equal(plan.stockUpdates[0].anterior, 9);
  assert.equal(plan.resumen.actualizadas, 1);
});

test('una cancelación pendiente SUMA al stock publicado', () => {
  const productos = [{ id: 10, nombre: 'Vestido Rojo', codigo: '00001', global_id: 'g-1', precio: 150, activo: 1 }];
  const variantes = [{ id: 100, product_id: 10, talla: 'M', color: 'Rojo', stock: 0 }];
  const plan = planificarSnapshot({
    filas: [fila({ stock: 0 })],
    productos,
    variantes,
    deltasPendientes: new Map([[100, 1]]),
  });
  assert.equal(plan.stockUpdates[0].nuevo, 1);
});

test('sin cambios de stock no hay update (idempotente)', () => {
  const productos = [{ id: 10, nombre: 'Vestido Rojo', codigo: '00001', global_id: 'g-1', precio: 150, activo: 1 }];
  const variantes = [{ id: 100, product_id: 10, talla: 'M', color: 'Rojo', stock: 3 }];
  const plan = planificarSnapshot({ filas: [fila({ stock: 3 })], productos, variantes });
  assert.equal(plan.stockUpdates.length, 0);
  assert.equal(plan.updatesProducto.length, 1, 'nombre/precio/sesión se refrescan igual');
  assert.equal(plan.detalle[0].accion, 'sobrescrito');
});

test('código reasignado en el POS: se actualiza por globalId aunque el código cambie', () => {
  const productos = [{ id: 10, nombre: 'Vestido Rojo', codigo: '00001', global_id: 'g-1', precio: 150, activo: 1 }];
  const variantes = [{ id: 100, product_id: 10, talla: 'M', color: 'Rojo', stock: 3 }];
  const plan = planificarSnapshot({ filas: [fila({ codigo: '02818' })], productos, variantes });
  assert.equal(plan.updatesProducto[0].codigo, '02818');
  assert.equal(plan.productosNuevos.length, 0);
});

test('código que tiene OTRO producto (con identidad propia) se libera y pasa al legítimo', () => {
  const productos = [
    { id: 10, nombre: 'Vestido Victoriano', codigo: '02797', global_id: 'g-vic', precio: 338, activo: 1 },
    { id: 20, nombre: 'Vestido Brillo', codigo: '02786', global_id: 'g-bri', precio: 388, activo: 1 },
  ];
  const variantes = [
    { id: 100, product_id: 10, talla: 'S', color: 'CELESTE', stock: 1 },
    { id: 200, product_id: 20, talla: 'S', color: 'VARIOS', stock: 2 },
  ];
  // El POS alineó: VICTORIANO ahora es 02818; y alguien puso 02797 al BRILLO.
  const plan = planificarSnapshot({
    filas: [
      fila({ globalId: 'g-bri', codigo: '02797', nombre: 'Vestido Brillo', talla: 'S', color: 'VARIOS', stock: 2, precio: 388 }),
      fila({ globalId: 'g-vic', codigo: '02818', nombre: 'Vestido Victoriano', talla: 'S', color: 'CELESTE', stock: 1, precio: 338 }),
    ],
    productos,
    variantes,
  });
  assert.deepEqual(plan.codigosLiberados, [{ id: 10, codigo: '02797', nombre: 'Vestido Victoriano' }]);
  const upd = Object.fromEntries(plan.updatesProducto.map((u) => [u.id, u.codigo]));
  assert.equal(upd[20], '02797');
  assert.equal(upd[10], '02818');
});

test('código duplicado dentro del lote: la segunda fila no lo roba y se avisa', () => {
  const plan = planificarSnapshot({
    filas: [
      fila({ globalId: 'g-1', codigo: '00001', nombre: 'Prenda A' }),
      fila({ globalId: 'g-2', codigo: '00001', nombre: 'Prenda B' }),
    ],
    productos: [],
    variantes: [],
  });
  assert.equal(plan.productosNuevos.length, 2);
  assert.equal(plan.productosNuevos[0].codigo, '00001');
  assert.equal(plan.productosNuevos[1].codigo, null);
  assert.match(plan.detalle[1].aviso, /duplicado/);
  assert.equal(plan.codigosLiberados.length, 0);
});

test('variante nueva en producto existente y reactivación de inactivo', () => {
  const productos = [{ id: 10, nombre: 'Vestido Rojo', codigo: '00001', global_id: 'g-1', precio: 150, activo: 0 }];
  const variantes = [{ id: 100, product_id: 10, talla: 'M', color: 'Rojo', stock: 3 }];
  const plan = planificarSnapshot({ filas: [fila({ talla: 'L', stock: 2 })], productos, variantes });
  assert.equal(plan.variantesNuevas.length, 1);
  assert.equal(plan.variantesNuevas[0].talla, 'L');
  assert.equal(plan.variantesNuevas[0].stock, 2);
  assert.equal(plan.detalle[0].accion, 'reactivado');
});

test('fila sin talla/color cae en la única variante del producto', () => {
  const productos = [{ id: 10, nombre: 'Cartera', codigo: '00009', global_id: 'g-9', precio: 80, activo: 1 }];
  const variantes = [{ id: 900, product_id: 10, talla: 'U', color: 'Negro', stock: 1 }];
  const plan = planificarSnapshot({
    filas: [fila({ globalId: 'g-9', codigo: '00009', nombre: 'Cartera', talla: '', color: '', stock: 4, precio: 80 })],
    productos,
    variantes,
  });
  assert.equal(plan.variantesNuevas.length, 0);
  assert.equal(plan.stockUpdates[0].variantId, 900);
  assert.equal(plan.stockUpdates[0].nuevo, 4);
});

// ─────────────── integración con D1 simulada ───────────────

test('aplicarSnapshot: libera código antes de asignarlo, crea nuevos con variantes y ajusta stock por eventos sin ack', async () => {
  const env = {
    DB: new FakeDB({
      products: [
        { id: 10, nombre: 'Vestido Victoriano', codigo: '02797', global_id: 'g-vic', precio: 338, activo: 1, sesion_snapshot: null },
        { id: 20, nombre: 'Vestido Brillo', codigo: '02786', global_id: 'g-bri', precio: 388, activo: 1, sesion_snapshot: null },
        { id: 30, nombre: 'Fantasma', codigo: '09999', global_id: 'g-fan', precio: 1, activo: 1, sesion_snapshot: null },
      ],
      variants: [
        { id: 100, product_id: 10, talla: 'S', color: 'CELESTE', stock: 1 },
        { id: 200, product_id: 20, talla: 'S', color: 'VARIOS', stock: 2 },
        { id: 300, product_id: 30, talla: 'U', color: '', stock: 1 },
      ],
      // venta web de 1 BRILLO (id 5) que el POS aún no confirmó
      eventos: [{ id: 5, tipo: 'venta', variant_id: 200, delta: -1, global_id: 'g-bri', codigo: '02786', nombre: 'Vestido Brillo', talla: 'S', color: 'VARIOS', creado_en: 'x' }],
    }),
  };
  const r = await aplicarSnapshot(env, {
    dispositivoId: 'central',
    nombreDispositivo: 'Central',
    sesion: 'S1',
    filas: [
      { globalId: 'g-bri', codigo: '02797', nombre: 'Vestido Brillo', talla: 'S', color: 'VARIOS', stock: 2, precio: 388 },
      { globalId: 'g-vic', codigo: '02818', nombre: 'Vestido Victoriano', talla: 'S', color: 'CELESTE', stock: 1, precio: 338 },
      { globalId: 'g-new', codigo: '03000', nombre: 'Top Nuevo', talla: 'M', color: 'Negro', stock: 4, precio: 90 },
      { globalId: 'g-new', codigo: '03000', nombre: 'Top Nuevo', talla: 'L', color: 'Negro', stock: 1, precio: 90 },
    ],
  });
  const db = env.DB;
  const p = (id) => db.products.find((x) => x.id === id);
  assert.equal(p(20).codigo, '02797');
  assert.equal(p(10).codigo, '02818');
  assert.equal(p(20).sesion_snapshot, 'S1');
  assert.equal(p(30).sesion_snapshot, null, 'el fantasma no vino');
  // Stock BRILLO: POS 2 + venta pendiente (-1) = 1
  assert.equal(db.variants.find((v) => v.id === 200).stock, 1);
  const nuevo = db.products.find((x) => x.global_id === 'g-new');
  assert.ok(nuevo);
  assert.equal(nuevo.codigo, '03000');
  assert.equal(db.variants.filter((v) => v.product_id === nuevo.id).length, 2);
  assert.equal(r.creadasProductos, 1);
  assert.equal(r.creadasVariantes, 2);
  assert.equal(r.codigosLiberados, 1);
  assert.equal(db.dispositivos[0].sesion_snapshot, 'S1');
});

test('finalizarSesion: rechaza si la nube vio menos productos de los esperados; si cuadra desactiva ausentes', async () => {
  const env = {
    DB: new FakeDB({
      products: [
        { id: 1, nombre: 'A', codigo: '00001', global_id: 'g-a', precio: 1, activo: 1, sesion_snapshot: 'S1' },
        { id: 2, nombre: 'B', codigo: '00002', global_id: 'g-b', precio: 1, activo: 1, sesion_snapshot: null },
      ],
      dispositivos: [{ id: 'central', nombre: '', ultimo_evento_ack: 0, sesion_snapshot: 'S1', ultimo_snapshot_en: null }],
    }),
  };
  const incompleto = await finalizarSesion(env, { dispositivoId: 'central', sesion: 'S1', productosEsperados: 2 });
  assert.equal(incompleto.ok, false);
  assert.equal(env.DB.products[1].activo, 1, 'no desactivó nada');

  const ok = await finalizarSesion(env, { dispositivoId: 'central', sesion: 'S1', productosEsperados: 1 });
  assert.equal(ok.ok, true);
  assert.equal(ok.desactivados, 1);
  assert.equal(env.DB.products[1].activo, 0);
  assert.equal(env.DB.products[0].activo, 1);
});

test('confirmarEventos y listarEventos: el ack nunca retrocede y la paginación reporta hayMas', async () => {
  const env = {
    DB: new FakeDB({
      eventos: [1, 2, 3].map((id) => ({ id, tipo: 'venta', variant_id: 1, delta: -1, global_id: 'g', codigo: '', nombre: '', talla: '', color: '', creado_en: 'x' })),
    }),
  };
  const pag = await listarEventos(env, { desde: 0, limite: 2 });
  assert.equal(pag.eventos.length, 2);
  assert.equal(pag.ultimoId, 2);
  assert.equal(pag.hayMas, true);

  await confirmarEventos(env, { dispositivoId: 'central', hastaId: 2 });
  assert.equal(env.DB.dispositivos[0].ultimo_evento_ack, 2);
  await confirmarEventos(env, { dispositivoId: 'central', hastaId: 1 });
  assert.equal(env.DB.dispositivos[0].ultimo_evento_ack, 2, 'no retrocede');
  assert.equal(env.DB.eventos.filter((e) => e.aplicado_pos_en).length, 2);

  const resto = await listarEventos(env, { desde: 2, limite: 2 });
  assert.equal(resto.eventos.length, 1);
  assert.equal(resto.hayMas, false);
});

test('stock inválido y precio inválido en alta se rechazan; precio inválido en existente conserva el de la nube', () => {
  const productos = [{ id: 10, nombre: 'Vestido Rojo', codigo: '00001', global_id: 'g-1', precio: 150, activo: 1 }];
  const variantes = [{ id: 100, product_id: 10, talla: 'M', color: 'Rojo', stock: 3 }];
  const plan = planificarSnapshot({
    filas: [
      fila({ stock: -1 }),
      fila({ globalId: 'g-new', codigo: '00002', precio: 'abc' }),
      fila({ precio: NaN, stock: 3 }),
    ],
    productos,
    variantes,
  });
  assert.equal(plan.resumen.rechazadas, 2);
  assert.equal(plan.updatesProducto.length, 1);
  assert.equal(plan.updatesProducto[0].precio, 150);
});
