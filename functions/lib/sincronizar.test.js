import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertCatalogoParaSync } from './sincronizar.js';

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
    if (this.sql.includes('FROM products WHERE codigo IS NOT NULL')) {
      return {
        results: this.db.products
          .filter((p) => p.codigo !== null && p.codigo !== '')
          .map((p) => ({ id: p.id, nombre: p.nombre, codigo: p.codigo, precio: p.precio })),
      };
    }
    if (this.sql === 'SELECT id, product_id, talla, color, stock FROM product_variants') {
      return { results: [...this.db.variants] };
    }
    throw new Error(`Unsupported all() SQL: ${this.sql}`);
  }
  async run() {
    if (this.sql.startsWith('INSERT INTO products')) {
      const [nombre, precio, codigo] = this.args;
      const id = this.db.nextProductId++;
      this.db.products.push({ id, nombre, precio, codigo, activo: 1 });
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
    throw new Error(`Unsupported run() SQL: ${this.sql}`);
  }
}

class FakeDB {
  constructor({ products = [], variants = [] } = {}) {
    this.products = products.map((p) => ({ ...p }));
    this.variants = variants.map((v) => ({ ...v }));
    this.nextProductId = (Math.max(0, ...this.products.map((p) => p.id || 0)) || 0) + 1;
    this.nextVariantId = (Math.max(0, ...this.variants.map((v) => v.id || 0)) || 0) + 1;
  }
  prepare(sql) {
    return new FakeStatement(this, sql);
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
  assert.deepEqual(r.detalle[0].accion, 'crear_producto');
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
  assert.deepEqual(r.detalle[0].accion, 'crear_variante');
});

test('corrige cruce de nombre por autoridad POS para mismo codigo', async () => {
  const env = {
    DB: new FakeDB({
      products: [{ id: 5, nombre: 'Vestido Gala', codigo: '02418', precio: 120 }],
      variants: [{ id: 50, product_id: 5, talla: 'M', color: 'Rojo', stock: 2 }],
    }),
  };
  const filas = [{ codigo: '02418', nombre: 'Pantalon Cargo', talla: 'M', color: 'Rojo', stock: 6, precio: 120 }];
  const r = await upsertCatalogoParaSync(env, filas);

  assert.equal(r.creadas, 0);
  assert.equal(env.DB.products.length, 1);
  assert.equal(env.DB.products[0].nombre, 'Pantalon Cargo');
  assert.equal(env.DB.variants.length, 1);
  assert.equal(r.detalle[0].cruce, true);
  assert.match(r.detalle[0].aviso, /sobrescrito por autoridad POS/);
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
