import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelarPedidoExpiradoYReponer } from './expirar.js';

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
    if (this.sql.includes('FROM order_items')) {
      const [orderId] = this.args;
      return {
        results: this.db.order_items
          .filter((oi) => oi.order_id === orderId && oi.variant_id)
          .map((oi) => {
            const v = this.db.variants.find((x) => x.id === oi.variant_id);
            const p = this.db.products.find((x) => x.id === oi.product_id);
            return {
              variant_id: oi.variant_id,
              cantidad: oi.cantidad,
              stock: v?.stock ?? 0,
              talla: v?.talla ?? '',
              color: v?.color ?? '',
              product_id: p?.id,
              nombre: p?.nombre,
              codigo: p?.codigo,
            };
          }),
      };
    }
    throw new Error(`Unsupported all(): ${this.sql}`);
  }
  async run() {
    if (this.sql.includes("SET estado = 'cancelado'")) {
      const [id] = this.args;
      const o = this.db.orders.find((x) => x.id === id);
      if (o && o.estado === 'pendiente_pago') {
        o.estado = 'cancelado';
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (this.sql.startsWith('UPDATE product_variants SET stock = stock +')) {
      const [qty, id] = this.args;
      const v = this.db.variants.find((x) => x.id === id);
      if (v) v.stock += qty;
      return { meta: { changes: v ? 1 : 0 } };
    }
    if (this.sql.includes('INSERT INTO stock_log') || this.sql.includes('stock_log')) {
      return { meta: { changes: 1 } };
    }
    // sentenciaLogStock puede ser un prepare genérico
    return { meta: { changes: 1 } };
  }
}

class FakeDB {
  constructor(data) {
    Object.assign(this, data);
  }
  prepare(sql) {
    return new FakeStatement(this, sql);
  }
  async batch(statements) {
    const out = [];
    for (const st of statements) out.push(await st.run());
    return out;
  }
}

// stockLog.js construye prepares reales; stub mínimo vía import mock no disponible
// en node:test sin loader. cancelarPedidoExpiradoYReponer importa sentenciaLogStock
// que hace env.DB.prepare(...).bind(...). Probamos con FakeDB que acepta cualquier SQL.

test('expirar: primera corrida cancela y repone stock una vez', async () => {
  const env = {
    DB: new FakeDB({
      orders: [{ id: 1, codigo: 'abcdef0123456789', estado: 'pendiente_pago' }],
      products: [{ id: 10, nombre: 'Vestido', codigo: '00001' }],
      variants: [{ id: 100, product_id: 10, talla: 'M', color: 'Rojo', stock: 0 }],
      order_items: [{ order_id: 1, product_id: 10, variant_id: 100, cantidad: 1 }],
    }),
  };
  const ok = await cancelarPedidoExpiradoYReponer(env, env.DB.orders[0]);
  assert.equal(ok, true);
  assert.equal(env.DB.orders[0].estado, 'cancelado');
  assert.equal(env.DB.variants[0].stock, 1);
});

test('expirar: segunda corrida NO vuelve a reponer stock', async () => {
  const env = {
    DB: new FakeDB({
      orders: [{ id: 1, codigo: 'abcdef0123456789', estado: 'pendiente_pago' }],
      products: [{ id: 10, nombre: 'Vestido', codigo: '00001' }],
      variants: [{ id: 100, product_id: 10, talla: 'M', color: 'Rojo', stock: 0 }],
      order_items: [{ order_id: 1, product_id: 10, variant_id: 100, cantidad: 1 }],
    }),
  };
  assert.equal(await cancelarPedidoExpiradoYReponer(env, { id: 1, codigo: 'abcdef01' }), true);
  assert.equal(env.DB.variants[0].stock, 1);
  assert.equal(await cancelarPedidoExpiradoYReponer(env, { id: 1, codigo: 'abcdef01' }), false);
  assert.equal(env.DB.variants[0].stock, 1);
});
