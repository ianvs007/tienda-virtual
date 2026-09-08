import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularSincronizacionDesde,
  stockFinalConVentasPostCutoff,
  upsertCatalogoParaSync,
} from './sincronizar.js';

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async all() {
    if (
      this.sql.includes('FROM products WHERE codigo IS NOT NULL') ||
      this.sql.includes('global_id, precio, activo')
    ) {
      return {
        results: this.db.products
          .filter((p) => p.codigo !== null && p.codigo !== '')
          .map((p) => ({
            id: p.id,
            nombre: p.nombre,
            codigo: p.codigo,
            global_id: p.global_id ?? null,
            precio: p.precio,
            activo: p.activo ?? 1,
          })),
      };
    }
    if (this.sql === 'SELECT id, product_id, talla, color, stock FROM product_variants') {
      return { results: [...this.db.variants] };
    }
    if (this.sql.includes('SUM(oi.cantidad) AS cantidad')) {
      const [desde, hasta] = this.args;
      const ventas = new Map();
      for (const o of this.db.orders) {
        if (o.estado === 'cancelado') continue;
        if (!(o.creado_en > desde && o.creado_en <= hasta)) continue;
        for (const item of this.db.order_items.filter((x) => x.order_id === o.id && x.variant_id)) {
          ventas.set(item.variant_id, (ventas.get(item.variant_id) || 0) + item.cantidad);
        }
      }
      return {
        results: [...ventas.entries()].map(([variant_id, cantidad]) => ({ variant_id, cantidad })),
      };
    }
    throw new Error(`Unsupported all() SQL: ${this.sql}`);
  }
  async run() {
    if (this.sql.startsWith('INSERT INTO products')) {
      const [nombre, precio, codigo, global_id] = this.args;
      const id = this.db.nextProductId++;
      this.db.products.push({ id, nombre, precio, codigo, global_id: global_id ?? null, activo: 1 });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (this.sql.startsWith('INSERT INTO product_variants')) {
      const [product_id, talla, color, stock] = this.args;
      const id = this.db.nextVariantId++;
      this.db.variants.push({ id, product_id, talla, color, stock });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (this.sql.startsWith('UPDATE products SET nombre = ?, precio = ?, activo = 1')) {
      const [nombre, precio, id] = this.args;
      const p = this.db.products.find((x) => x.id === id);
      if (p) {
        p.nombre = nombre;
        p.precio = precio;
        p.activo = 1;
      }
      return { meta: { changes: p ? 1 : 0 } };
    }
    if (this.sql.startsWith('DELETE FROM product_variants WHERE product_id = ?')) {
      const [product_id] = this.args;
      const antes = this.db.variants.length;
      this.db.variants = this.db.variants.filter((v) => v.product_id !== product_id);
      return { meta: { changes: antes - this.db.variants.length } };
    }
    if (this.sql.startsWith('DELETE FROM products WHERE id = ?')) {
      const [id] = this.args;
      const antes = this.db.products.length;
      this.db.products = this.db.products.filter((p) => p.id !== id);
      return { meta: { changes: antes - this.db.products.length } };
    }
    if (this.sql.startsWith('UPDATE products SET codigo = ?')) {
      const [codigo, id] = this.args;
      const p = this.db.products.find((x) => x.id === id);
      if (p) p.codigo = codigo;
      return { meta: { changes: p ? 1 : 0 } };
    }
    if (this.sql.startsWith('UPDATE products SET global_id = ?')) {
      const [global_id, id] = this.args;
      const p = this.db.products.find((x) => x.id === id);
      if (p) p.global_id = global_id;
      return { meta: { changes: p ? 1 : 0 } };
    }
    throw new Error(`Unsupported run() SQL: ${this.sql}`);
  }
}

class FakeDB {
  constructor({ products = [], variants = [], images = [], orders = [], order_items = [] } = {}) {
    this.products = products.map((p) => ({ ...p }));
    this.variants = variants.map((v) => ({ ...v }));
    this.images = images.map((i) => ({ ...i }));
    this.orders = orders.map((o) => ({ ...o }));
    this.order_items = order_items.map((oi) => ({ ...oi }));
    this.nextProductId = (Math.max(0, ...this.products.map((p) => p.id || 0)) || 0) + 1;
    this.nextVariantId = (Math.max(0, ...this.variants.map((v) => v.id || 0)) || 0) + 1;
  }
  prepare(sql) {
    return new FakeStatement(this, sql);
  }
  async batch(statements) {
    const results = [];
    for (const st of statements) results.push(await st.run());
    return results;
  }
}

test('crea producto y variante cuando el codigo no existe', async () => {
  const env = { DB: new FakeDB() };
  const filas = [{ codigo: '2418', nombre: 'Polera Basic', talla: 'M', color: 'Negro', stock: 7, precio: 99 }];
  const r = await upsertCatalogoParaSync(env, filas);

  assert.equal(r.creadas, 1);
  assert.equal(r.creadasProductos, 1);
  assert.equal(r.creadasVariantes, 0);
  assert.equal(env.DB.products.length, 1);
  assert.equal(env.DB.products[0].codigo, '02418');
  assert.equal(env.DB.variants.length, 1);
  assert.deepEqual(r.detalle[0].accion, 'creado');
});

test('crea variante faltante cuando el codigo ya existe', async () => {
  const env = {
    DB: new FakeDB({
      products: [{ id: 10, nombre: 'Polera Basic', codigo: '02418', precio: 80 }],
      variants: [{ id: 100, product_id: 10, talla: 'S', color: 'Negro', stock: 3 }],
    }),
  };
  const filas = [{ codigo: '02418', nombre: 'Polera Basic', talla: 'M', color: 'Negro', stock: 9, precio: 95 }];
  const r = await upsertCatalogoParaSync(env, filas);

  assert.equal(r.creadas, 1);
  assert.equal(r.creadasProductos, 0);
  assert.equal(r.creadasVariantes, 1);
  assert.equal(env.DB.variants.length, 2);
  assert.equal(env.DB.products[0].precio, 95);
  assert.deepEqual(r.detalle[0].accion, 'creado');
});

test('reemplaza el producto conflictivo en la nube por el registro del POS', async () => {
  const env = {
    DB: new FakeDB({
      products: [{ id: 5, nombre: 'Vestido Gala', codigo: '02418', precio: 120 }],
      variants: [{ id: 50, product_id: 5, talla: 'M', color: 'Rojo', stock: 2 }],
      images: [{ id: 1, product_id: 5, r2_key: 'foto-existente.jpg', orden: 0 }],
    }),
  };
  const filas = [{ codigo: '02418', globalId: 'new-pos-id', nombre: 'Pantalon Cargo', talla: 'M', color: 'Rojo', stock: 6, precio: 120 }];
  const r = await upsertCatalogoParaSync(env, filas);

  assert.equal(r.creadas, 1);
  assert.equal(env.DB.products.length, 1);
  assert.equal(env.DB.products[0].nombre, 'Pantalon Cargo');
  assert.equal(env.DB.products[0].global_id, 'new-pos-id');
  assert.equal(env.DB.variants.length, 1);
  assert.equal(env.DB.variants[0].stock, 6);
  assert.equal(r.detalle[0].cruce, true);
  assert.equal(r.detalle[0].accion, 'reemplazado_por_pos');
});

test('reemplaza el producto conflictivo en la nube por el registro del POS con codigo real', async () => {
  const env = {
    DB: new FakeDB({
      products: [{ id: 8, nombre: 'Vestido Victoriano', codigo: '02797', precio: 300, global_id: 'old-uuid' }],
      variants: [{ id: 80, product_id: 8, talla: 'S', color: 'BRILLO', stock: 1 }],
    }),
  };
  const filas = [{ codigo: '02797', globalId: 'new-pos-id', nombre: 'Vistido Brillo', talla: 'S', color: 'BRILLO', stock: 2, precio: 388 }];

  const r = await upsertCatalogoParaSync(env, filas);

  assert.equal(r.creadas, 1);
  assert.equal(env.DB.products.length, 1);
  assert.equal(env.DB.products[0].codigo, '02797');
  assert.equal(env.DB.products[0].nombre, 'Vistido Brillo');
  assert.equal(env.DB.products[0].global_id, 'new-pos-id');
  assert.equal(env.DB.variants.length, 1);
  assert.equal(env.DB.variants[0].stock, 2);
  assert.equal(r.detalle[0].accion, 'reemplazado_por_pos');
});

test('reactiva producto inactivo aunque no haya cruce', async () => {
  const env = {
    DB: new FakeDB({
      products: [{ id: 9, nombre: 'Camisa Lino', codigo: '01377', precio: 140, activo: 0 }],
      variants: [{ id: 90, product_id: 9, talla: 'L', color: 'Blanco', stock: 4 }],
    }),
  };
  const filas = [{ codigo: '01377', nombre: 'Camisa Lino', talla: 'L', color: 'Blanco', stock: 8, precio: 140 }];
  const r = await upsertCatalogoParaSync(env, filas);

  assert.equal(r.creadas, 0);
  assert.equal(env.DB.products[0].activo, 1);
  assert.equal(env.DB.products[0].nombre, 'Camisa Lino');
  assert.equal(env.DB.products[0].precio, 140);
});

test('stock final respeta ventas web post-cutoff', async () => {
  const env = {
    DB: new FakeDB({
      products: [{ id: 20, nombre: 'Polo', codigo: '09999', precio: 50, activo: 1 }],
      variants: [{ id: 200, product_id: 20, talla: 'M', color: 'Azul', stock: 10 }],
      orders: [{ id: 1, codigo: 'PED001', estado: 'confirmado', creado_en: '2026-08-19 10:05:00' }],
      order_items: [{ id: 1, order_id: 1, product_id: 20, variant_id: 200, cantidad: 3, precio_unit: 50 }],
    }),
  };
  const filas = [{ codigo: '09999', nombre: 'Polo', talla: 'M', color: 'Azul', stock: 8, precio: 50 }];
  const { resultado } = await calcularSincronizacionDesde(
    env,
    filas,
    '2026-08-19 10:00:00',
    '2026-08-19 10:10:00'
  );

  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].vendidas, 3);
  assert.equal(resultado[0].stockNuevo, 5);
  assert.equal(stockFinalConVentasPostCutoff(8, 3), 5);
});

test('reasigna codigo por globalId sin duplicar la prenda', async () => {
  const env = {
    DB: new FakeDB({
      products: [
        { id: 7, nombre: 'Body Bebe', codigo: '00075', global_id: 'uuid-body', precio: 45, activo: 1 },
      ],
      variants: [{ id: 70, product_id: 7, talla: 'U', color: 'Rosa', stock: 2 }],
    }),
  };
  // El POS reasignó el shortCode (reparación de duplicados): misma prenda, nuevo código.
  const filas = [
    { globalId: 'uuid-body', codigo: '02253', nombre: 'Body Bebe', talla: 'U', color: 'Rosa', stock: 5, precio: 45 },
  ];
  const r = await upsertCatalogoParaSync(env, filas);

  assert.equal(r.creadas, 0);
  assert.equal(env.DB.products.length, 1);
  assert.equal(env.DB.products[0].codigo, '02253');
  assert.equal(env.DB.products[0].nombre, 'Body Bebe');
});

test('calcularSincronizacionDesde resuelve por globalId aunque el codigo de la fila pertenezca a OTRO producto', async () => {
  // Simula el caso en que upsertCatalogoParaSync no pudo reasignar el codigo
  // (porque ya lo tenía otro producto) y la fila sigue llegando con el codigo
  // NUEVO más el globalId real: el stock debe aplicarse al producto correcto
  // (A, por globalId), no al que hoy tiene ese codigo en la BD (B).
  const env = {
    DB: new FakeDB({
      products: [
        { id: 1, nombre: 'Vestido A', codigo: '00001', global_id: 'uuid-a', precio: 100 },
        { id: 2, nombre: 'Vestido B', codigo: '00002', global_id: 'uuid-b', precio: 200 },
      ],
      variants: [
        { id: 10, product_id: 1, talla: 'M', color: 'Rojo', stock: 5 },
        { id: 20, product_id: 2, talla: 'M', color: 'Azul', stock: 9 },
      ],
    }),
  };
  // La fila trae el codigo '00002' (que hoy es de B) pero el globalId de A.
  const filas = [
    { globalId: 'uuid-a', codigo: '00002', nombre: 'Vestido A', talla: 'M', color: 'Rojo', stock: 3 },
  ];
  const { resultado } = await calcularSincronizacionDesde(
    env,
    filas,
    '2026-08-19 10:00:00',
    '2026-08-19 10:10:00'
  );

  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].varianteId, 10); // variante de A, no de B
  assert.equal(resultado[0].nombre, 'Vestido A');
});

test('adopta el globalId del POS en un producto legado con backfill aleatorio', async () => {
  const env = {
    DB: new FakeDB({
      products: [
        { id: 3, nombre: 'Chamarra', codigo: '02253', global_id: 'uuid-random-backfill', precio: 200, activo: 1 },
      ],
      variants: [{ id: 30, product_id: 3, talla: 'M', color: 'Negro', stock: 4 }],
    }),
  };
  const filas = [
    { globalId: 'uuid-real-pos', codigo: '02253', nombre: 'Chamarra', talla: 'M', color: 'Negro', stock: 4, precio: 200 },
  ];
  const r = await upsertCatalogoParaSync(env, filas);

  assert.equal(r.creadas, 0);
  assert.equal(env.DB.products[0].global_id, 'uuid-real-pos');
});
