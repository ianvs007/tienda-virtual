import test from 'node:test';
import assert from 'node:assert/strict';
import { registrarComprobante } from './comprobante.js';

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
          .map((oi, idx) => {
            const v = this.db.variants.find((x) => x.id === oi.variant_id);
            const p = this.db.products.find((x) => x.id === oi.product_id);
            return {
              order_item_id: oi.id ?? idx + 1,
              variant_id: oi.variant_id,
              cantidad: oi.cantidad,
              precio_unit: oi.precio_unit ?? 0,
              stock: v?.stock ?? 0,
              talla: v?.talla ?? '',
              color: v?.color ?? '',
              product_id: p?.id,
              nombre: p?.nombre,
              codigo: p?.codigo,
              global_id: p?.global_id ?? null,
            };
          }),
      };
    }
    throw new Error(`Unsupported all(): ${this.sql}`);
  }
  async run() {
    if (this.sql.includes("estado = 'comprobante_subido'") && this.sql.includes("estado IN")) {
      // UPDATE normal: pendiente_pago | comprobante_subido
      const [key, codigo] = this.args;
      const o = this.db.orders.find((x) => x.codigo === codigo);
      if (o && ['pendiente_pago', 'comprobante_subido'].includes(o.estado)) {
        o.comprobante_r2_key = key;
        o.estado = 'comprobante_subido';
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (this.sql.includes("estado = 'comprobante_subido'") && this.sql.includes("estado = 'cancelado'")) {
      const [key, id] = this.args;
      const o = this.db.orders.find((x) => x.id === id);
      if (o && o.estado === 'cancelado') {
        o.comprobante_r2_key = key;
        o.estado = 'comprobante_subido';
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (this.sql.includes('SET comprobante_r2_key') && this.sql.includes("estado = 'cancelado'")) {
      // Solo guarda la foto, deja cancelado (sin stock)
      const [key, id] = this.args;
      const o = this.db.orders.find((x) => x.id === id);
      if (o && o.estado === 'cancelado') {
        o.comprobante_r2_key = key;
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (this.sql.startsWith('UPDATE product_variants SET stock = stock -')) {
      const [qty, id] = this.args;
      const v = this.db.variants.find((x) => x.id === id);
      if (!v || v.stock < qty) throw new Error('CHECK constraint failed: stock');
      v.stock -= qty;
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes('INTO stock_eventos') || this.sql.includes('stock_log')) {
      this.db.eventos = this.db.eventos || [];
      this.db.eventos.push({ sql: this.sql, args: this.args });
      return { meta: { changes: 1 } };
    }
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

function pedidoBase(overrides = {}) {
  return {
    id: 1,
    codigo: 'd0a3bf32aaaaaaaaaaaaaaaaaaaaaaaa',
    estado: 'pendiente_pago',
    comprobante_r2_key: null,
    ...overrides,
  };
}

test('comprobante: pendiente_pago pasa a comprobante_subido de forma atómica', async () => {
  const env = {
    DB: new FakeDB({
      orders: [pedidoBase()],
      products: [],
      variants: [],
      order_items: [],
    }),
  };
  const r = await registrarComprobante(env, env.DB.orders[0], 'comprobantes/foto.jpg');
  assert.equal(r.ok, true);
  assert.equal(r.estado, 'comprobante_subido');
  assert.equal(r.reabierto, false);
  assert.equal(env.DB.orders[0].estado, 'comprobante_subido');
  assert.equal(env.DB.orders[0].comprobante_r2_key, 'comprobantes/foto.jpg');
});

test('comprobante: si el pedido ya está confirmado, rechaza sin tocar estado', async () => {
  const env = {
    DB: new FakeDB({
      orders: [pedidoBase({ estado: 'confirmado' })],
      products: [],
      variants: [],
      order_items: [],
    }),
  };
  const r = await registrarComprobante(env, env.DB.orders[0], 'comprobantes/foto.jpg');
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(env.DB.orders[0].estado, 'confirmado');
  assert.equal(env.DB.orders[0].comprobante_r2_key, null);
});

test('comprobante: carrera con expiración — si ya canceló, reabre y vuelve a reservar stock', async () => {
  // Simula: SELECT vio pendiente_pago, pero entre medio expirar canceló y repuso stock.
  // El cliente igual sube el comprobante: debe reabrir y descontar de nuevo.
  const pedido = pedidoBase({ estado: 'cancelado' }); // estado actual al momento de registrar
  const env = {
    DB: new FakeDB({
      orders: [pedido],
      products: [{ id: 10, nombre: 'Vestido', codigo: '00001', global_id: 'gid-1' }],
      variants: [{ id: 100, product_id: 10, talla: 'S', color: 'Beis', stock: 1 }],
      order_items: [
        { id: 55, order_id: 1, product_id: 10, variant_id: 100, cantidad: 1, precio_unit: 298 },
      ],
    }),
  };
  const r = await registrarComprobante(env, pedido, 'comprobantes/pago.jpg');
  assert.equal(r.ok, true);
  assert.equal(r.estado, 'comprobante_subido');
  assert.equal(r.reabierto, true);
  assert.equal(env.DB.orders[0].estado, 'comprobante_subido');
  assert.equal(env.DB.variants[0].stock, 0);
  assert.ok((env.DB.eventos || []).length >= 1);
});

test('comprobante: cancelado sin stock guarda la foto pero sigue cancelado', async () => {
  const pedido = pedidoBase({ estado: 'cancelado' });
  const env = {
    DB: new FakeDB({
      orders: [pedido],
      products: [{ id: 10, nombre: 'Vestido', codigo: '00001', global_id: 'gid-1' }],
      variants: [{ id: 100, product_id: 10, talla: 'S', color: 'Beis', stock: 0 }],
      order_items: [
        { id: 55, order_id: 1, product_id: 10, variant_id: 100, cantidad: 1, precio_unit: 298 },
      ],
    }),
  };
  const r = await registrarComprobante(env, pedido, 'comprobantes/pago.jpg');
  assert.equal(r.ok, true);
  assert.equal(r.estado, 'cancelado');
  assert.equal(r.reabierto, false);
  assert.match(r.aviso || '', /stock|WhatsApp/i);
  assert.equal(env.DB.orders[0].comprobante_r2_key, 'comprobantes/pago.jpg');
  assert.equal(env.DB.orders[0].estado, 'cancelado');
  assert.equal(env.DB.variants[0].stock, 0);
});

test('comprobante: UPDATE normal no revive un pedido ya cancelado sin pasar por reopen', async () => {
  // Si el SELECT vio pendiente_pago pero el UPDATE atómico no encuentra esa fila,
  // registrarComprobante intenta reopen (cancelado). Aquí el pedido ya es confirmado.
  const env = {
    DB: new FakeDB({
      orders: [pedidoBase({ estado: 'entregado' })],
      products: [],
      variants: [],
      order_items: [],
    }),
  };
  const r = await registrarComprobante(env, env.DB.orders[0], 'comprobantes/x.jpg');
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
});
