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

// ── D1 simulada mínima para las funciones con env (cableado SQL real) ──
class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async first() {
    if (this.sql.startsWith("SELECT datetime('now')")) return { ahora: '2026-09-10 20:00:00' };
    if (this.sql.startsWith('SELECT id, nombre, ultimo_evento_ack')) {
      return this.db.dispositivos.find((d) => d.id === this.args[0]) || null;
    }
    if (this.sql.startsWith('SELECT COUNT(*) AS n FROM products WHERE sesion_snapshot')) {
      return { n: this.db.products.filter((p) => p.sesion_snapshot === this.args[0]).length };
    }
    if (this.sql.startsWith("SELECT valor FROM settings WHERE clave = 'sync_token'")) return { valor: 'tok' };
    throw new Error(`first() sin soporte: ${this.sql}`);
  }
  async all() {
    if (this.sql.startsWith('SELECT id, nombre, codigo, global_id, precio, activo FROM products')) {
      return { results: this.db.products.map((p) => ({ ...p })) };
    }
    if (this.sql.startsWith('SELECT id, product_id, talla, color, stock FROM product_variants')) {
      return { results: this.db.variants.map((v) => ({ ...v })) };
    }
    if (this.sql.startsWith('SELECT variant_id, SUM(delta) AS delta FROM stock_eventos')) {
      const [ack] = this.args;
      const m = new Map();
      for (const e of this.db.eventos) {
        if (e.id > ack && e.variant_id != null) m.set(e.variant_id, (m.get(e.variant_id) || 0) + e.delta);
      }
      return { results: [...m.entries()].map(([variant_id, delta]) => ({ variant_id, delta })) };
    }
    if (this.sql.startsWith('SELECT id, tipo, global_id, codigo, nombre, talla, color, delta')) {
      const [desde, limite] = this.args;
      const lista = this.db.eventos.filter((e) => e.id > desde).sort((a, b) => a.id - b.id).slice(0, limite);
      return { results: lista.map((e) => ({ ...e, precio_unit: e.precio_unit ?? 0, pedido_ref: e.pedido_ref ?? '' })) };
    }
    throw new Error(`all() sin soporte: ${this.sql}`);
  }
  async run() {
    const s = this.sql;
    const a = this.args;
    if (s.startsWith('INSERT INTO sync_dispositivos')) {
      const [id, nombre] = a;
      const d = this.db.dispositivos.find((x) => x.id === id);
      if (d) {
        if (nombre) d.nombre = nombre;
      } else {
        this.db.dispositivos.push({ id, nombre, ultimo_evento_ack: 0, sesion_snapshot: null, ultimo_snapshot_en: null });
      }
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('UPDATE products SET codigo = NULL WHERE id = ?')) {
      const p = this.db.products.find((x) => x.id === a[0]);
      if (p) p.codigo = null;
      return { meta: { changes: p ? 1 : 0 } };
    }
    if (s.startsWith('UPDATE products SET global_id = ? WHERE id = ?')) {
      const p = this.db.products.find((x) => x.id === a[1]);
      if (p) p.global_id = a[0];
      return { meta: { changes: p ? 1 : 0 } };
    }
    if (s.startsWith('UPDATE products SET nombre = ?, precio = ?, codigo = ?, activo = 1, sesion_snapshot = ? WHERE id = ?')) {
      const [nombre, precio, codigo, sesion, id] = a;
      if (codigo && this.db.products.some((x) => x.id !== id && x.codigo === codigo)) {
        throw new Error(`UNIQUE constraint failed: products.codigo (${codigo})`);
      }
      const p = this.db.products.find((x) => x.id === id);
      Object.assign(p, { nombre, precio, codigo, activo: 1, sesion_snapshot: sesion });
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('UPDATE product_variants SET stock = ? WHERE id = ?')) {
      const v = this.db.variants.find((x) => x.id === a[1]);
      v.stock = a[0];
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('INSERT INTO stock_log')) {
      this.db.log.push(a);
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('INSERT INTO products')) {
      const [nombre, precio, codigo, global_id, sesion] = a;
      if (codigo && this.db.products.some((x) => x.codigo === codigo)) {
        throw new Error(`UNIQUE constraint failed: products.codigo (${codigo})`);
      }
      const id = Math.max(0, ...this.db.products.map((p) => p.id)) + 1;
      this.db.products.push({ id, nombre, precio, codigo, global_id, activo: 1, sesion_snapshot: sesion });
      return { meta: { changes: 1, last_row_id: id } };
    }
    if (s.startsWith('INSERT INTO product_variants')) {
      const [product_id, talla, color, stock] = a;
      const id = Math.max(0, ...this.db.variants.map((v) => v.id)) + 1;
      this.db.variants.push({ id, product_id, talla, color, stock });
      return { meta: { changes: 1, last_row_id: id } };
    }
    if (s.startsWith('UPDATE sync_dispositivos SET sesion_snapshot = ?')) {
      const d = this.db.dispositivos.find((x) => x.id === a[1]);
      d.sesion_snapshot = a[0];
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('UPDATE sync_dispositivos SET ultimo_evento_ack = ?')) {
      const d = this.db.dispositivos.find((x) => x.id === a[1]);
      d.ultimo_evento_ack = a[0];
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('UPDATE stock_eventos SET aplicado_pos_en')) {
      let n = 0;
      for (const e of this.db.eventos) if (e.id <= a[0] && !e.aplicado_pos_en) { e.aplicado_pos_en = 'now'; n++; }
      return { meta: { changes: n } };
    }
    if (s.startsWith('UPDATE products SET activo = 0 WHERE activo = 1 AND (sesion_snapshot IS NULL OR sesion_snapshot != ?)')) {
      let n = 0;
      for (const p of this.db.products) if (p.activo === 1 && p.sesion_snapshot !== a[0]) { p.activo = 0; n++; }
      return { meta: { changes: n } };
    }
    if (s.startsWith('UPDATE sync_dispositivos SET ultimo_snapshot_en')) {
      const d = this.db.dispositivos.find((x) => x.id === a[2]);
      d.ultimo_snapshot_en = a[0];
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('UPDATE settings SET valor = ?')) return { meta: { changes: 1 } };
    throw new Error(`run() sin soporte: ${s}`);
  }
}

class FakeDB {
  constructor(data) {
    this.products = data.products || [];
    this.variants = data.variants || [];
    this.eventos = data.eventos || [];
    this.dispositivos = data.dispositivos || [];
    this.log = [];
  }
  prepare(sql) {
    return new FakeStatement(this, sql);
  }
  async batch(sts) {
    const out = [];
    for (const st of sts) out.push(await st.run());
    return out;
  }
}

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
