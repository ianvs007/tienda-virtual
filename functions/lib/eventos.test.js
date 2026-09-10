import test from 'node:test';
import assert from 'node:assert/strict';
import { deltaDeEvento, refPedido, sentenciaEventoStock, sentenciaEventoVentaEnCheckout } from './eventos.js';

const envCaptura = () => {
  const capturas = [];
  return {
    capturas,
    env: {
      DB: {
        prepare(sql) {
          const registro = { sql, args: [] };
          capturas.push(registro);
          return {
            bind(...args) {
              registro.args = args;
              return this;
            },
          };
        },
      },
    },
  };
};

test('deltaDeEvento: venta negativa, reposiciones positivas, sin signo heredado', () => {
  assert.equal(deltaDeEvento('venta', 2), -2);
  assert.equal(deltaDeEvento('venta', -2), -2);
  assert.equal(deltaDeEvento('cancelacion', 3), 3);
  assert.equal(deltaDeEvento('expiracion', '1'), 1);
  assert.equal(deltaDeEvento('venta', 'x'), -0);
});

test('refPedido: 8 primeros caracteres en mayúsculas', () => {
  assert.equal(refPedido('abcdef0123456789'), 'ABCDEF01');
  assert.equal(refPedido(null), '');
});

test('sentenciaEventoStock: inserta con INSERT OR IGNORE y delta según tipo', () => {
  const { env, capturas } = envCaptura();
  sentenciaEventoStock(env, {
    tipo: 'cancelacion',
    orderId: 7,
    orderItemId: 70,
    productId: 1,
    variantId: 10,
    globalId: 'g-1',
    codigo: '00001',
    nombre: 'Vestido',
    talla: 'M',
    color: 'Rojo',
    cantidad: 2,
    precioUnit: 150,
    pedidoCodigo: 'abcdef0123456789',
  });
  assert.equal(capturas.length, 1);
  assert.match(capturas[0].sql, /INSERT OR IGNORE INTO stock_eventos/);
  assert.deepEqual(capturas[0].args, [
    'cancelacion', 7, 70, 1, 10, 'g-1', '00001', 'Vestido', 'M', 'Rojo', 2, 150, 'ABCDEF01',
  ]);
});

test('sentenciaEventoStock: rechaza tipos desconocidos', () => {
  const { env } = envCaptura();
  assert.throws(() => sentenciaEventoStock(env, { tipo: 'ajuste', orderId: 1, orderItemId: 1, cantidad: 1 }));
});

test('sentenciaEventoVentaEnCheckout: resuelve el ítem por pedido+variante con delta negativo', () => {
  const { env, capturas } = envCaptura();
  sentenciaEventoVentaEnCheckout(env, {
    pedidoCodigo: 'abcdef0123456789',
    productId: 1,
    variantId: 10,
    globalId: 'g-1',
    codigo: '00001',
    nombre: 'Vestido',
    talla: 'M',
    color: 'Rojo',
    cantidad: 1,
    precioUnit: 150,
  });
  assert.match(capturas[0].sql, /SELECT 'venta', o\.id, oi\.id/);
  assert.match(capturas[0].sql, /ORDER BY oi\.id DESC\s+LIMIT 1/);
  const args = capturas[0].args;
  assert.equal(args[7], -1, 'delta de venta');
  assert.equal(args[9], 'ABCDEF01');
  assert.equal(args[10], 'abcdef0123456789');
  assert.equal(args[11], 10);
});
