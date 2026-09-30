import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { excedeLimite } from './limite.js';
import { onRequestPost as crearPedido } from '../api/pedidos.js';
import { onRequestPost as subirComprobante } from '../api/pedidos/[codigo]/comprobante.js';

const IP = '186.5.1.1';
const MIGRACIONES = [
  '001_init.sql',
  '002_mejoras_pago.sql',
  '003_sincronizacion.sql',
  '004_auditoria_stock.sql',
  '005_global_id.sql',
  '006_sync_eventos.sql',
];

function entorno() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const nombre of MIGRACIONES) {
    db.exec(readFileSync(new URL('../../migrations/' + nombre, import.meta.url), 'utf8'));
  }
  db.prepare(
    `INSERT INTO products (id, nombre, precio, activo, codigo, global_id)
     VALUES (1, 'Vestido', 428, 1, '02786', '11111111-1111-4111-8111-111111111111')`
  ).run();
  db.prepare(
    `INSERT INTO product_variants (id, product_id, talla, color, stock) VALUES (1, 1, 'M', 'NEGRO', 20)`
  ).run();

  const env = {
    DB: {
      prepare(sql) {
        const sentencia = (args) => ({
          sql,
          args,
          async first() {
            return db.prepare(sql).get(...args) ?? null;
          },
          async all() {
            return { results: db.prepare(sql).all(...args) };
          },
          async run() {
            return { meta: db.prepare(sql).run(...args) };
          },
        });
        return { ...sentencia([]), bind(...args) { return sentencia(args); } };
      },
      async batch(sentencias) {
        db.exec('BEGIN');
        try {
          const salida = sentencias.map(({ sql, args }) => ({ meta: db.prepare(sql).run(...args) }));
          db.exec('COMMIT');
          return salida;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
    },
    FOTOS: {
      async put() {},
      async delete() {},
    },
  };
  return { db, env };
}

function cupo(db, ip = IP, accion = 'pedido') {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM rate_log
        WHERE ip = ? AND accion = ? AND creado_en > datetime('now', '-1 hour')`
    )
    .get(ip, accion).n;
}

function llenar(db, n, accion = 'pedido', ip = IP) {
  const ins = db.prepare('INSERT INTO rate_log (ip, accion) VALUES (?, ?)');
  for (let i = 0; i < n; i++) ins.run(ip, accion);
}

function clave(n) {
  return n.toString(16).padStart(32, '0');
}

function pedido(body, ip = IP) {
  return new Request('https://tienda.example/api/pedidos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

function compra(idempotencia = clave(1)) {
  return {
    nombre: 'Ana Pérez',
    whatsapp: '70000000',
    tipo_entrega: 'recojo',
    items: [{ productId: 1, variantId: 1, cantidad: 1 }],
    idempotencia,
  };
}

test('consultar el límite no escribe y un rechazo no alarga el bloqueo', async () => {
  const { db, env } = entorno();
  llenar(db, 10);
  const request = pedido(compra());
  assert.equal(await excedeLimite(env, request, 'pedido', 10), true);
  assert.equal(await excedeLimite(env, request, 'pedido', 10), true);
  assert.equal(cupo(db), 10);
});

test('filas de hace más de una hora no cuentan', async () => {
  const { db, env } = entorno();
  const ins = db.prepare(
    "INSERT INTO rate_log (ip, accion, creado_en) VALUES (?, 'pedido', datetime('now', '-2 hours'))"
  );
  for (let i = 0; i < 10; i++) ins.run(IP);
  assert.equal(await excedeLimite(env, pedido(compra()), 'pedido', 10), false);
});

test('un dato inválido no consume cupo de pedidos', async () => {
  const { db, env } = entorno();
  const r = await crearPedido({
    env,
    request: pedido({ ...compra(), nombre: 'A' }),
  });
  assert.equal(r.status, 400);
  assert.equal(cupo(db), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
});

test('crear un pedido cuenta una vez; el undécimo se rechaza sin sumar', async () => {
  const { db, env } = entorno();
  for (let i = 1; i <= 10; i++) {
    const r = await crearPedido({ env, request: pedido(compra(clave(i))) });
    assert.equal(r.status, 201, await r.clone().text());
  }
  assert.equal(cupo(db), 10);
  assert.equal(db.prepare('SELECT stock FROM product_variants WHERE id = 1').get().stock, 10);

  const bloqueado = await crearPedido({ env, request: pedido(compra(clave(11))) });
  assert.equal(bloqueado.status, 429);
  const repetido = await crearPedido({ env, request: pedido(compra(clave(12))) });
  assert.equal(repetido.status, 429);
  assert.equal(cupo(db), 10);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 10);

  const otraIp = await crearPedido({ env, request: pedido(compra(clave(13)), '10.1.1.1') });
  assert.equal(otraIp.status, 201);
  assert.equal(cupo(db, '10.1.1.1'), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 11);
});

test('reintentar la misma compra no cuenta de nuevo y pasa aunque el cupo esté lleno', async () => {
  const { db, env } = entorno();
  const primero = await crearPedido({ env, request: pedido(compra(clave(1))) });
  assert.equal(primero.status, 201);
  const { codigo } = await primero.json();
  llenar(db, 9);

  const reintento = await crearPedido({ env, request: pedido(compra(clave(1))) });
  assert.equal(reintento.status, 200);
  assert.equal((await reintento.json()).codigo, codigo);
  assert.equal(cupo(db), 10);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
});

test('si el batch de stock aborta, el intento no queda registrado', async () => {
  const { db, env } = entorno();
  db.prepare('UPDATE product_variants SET stock = 0 WHERE id = 1').run();
  const realPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    const st = realPrepare(sql);
    return {
      ...st,
      bind(...args) {
        const bound = st.bind(...args);
        if (sql.includes('FROM products p')) {
          const original = bound.first.bind(bound);
          bound.first = async () => {
            const fila = await original();
            return fila ? { ...fila, stock: 5 } : fila;
          };
        }
        return bound;
      },
    };
  };

  const r = await crearPedido({ env, request: pedido(compra()) });
  assert.equal(r.status, 409);
  assert.equal(cupo(db), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  assert.equal(db.prepare('SELECT stock FROM product_variants WHERE id = 1').get().stock, 0);
});

test('un comprobante inválido no cuenta y el 429 no escribe', async () => {
  const { db, env } = entorno();
  const codigo = clave(7);
  db.prepare(
    `INSERT INTO orders (codigo, cliente_nombre, cliente_whatsapp, tipo_entrega, total, estado)
     VALUES (?, 'Ana', '70000000', 'recojo', 428, 'pendiente_pago')`
  ).run(codigo);
  llenar(db, 30, 'comprobante');
  let subidas = 0;
  env.FOTOS.put = async () => {
    subidas++;
  };

  const r = await subirComprobante({
    env,
    params: { codigo },
    request: new Request(`https://tienda.example/api/pedidos/${codigo}/comprobante`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': IP },
      body: new FormData(),
    }),
  });
  assert.equal(r.status, 429);
  assert.equal(subidas, 0);
  assert.equal(cupo(db, IP, 'comprobante'), 30);
});

test('guardar un comprobante cuenta una sola vez', async () => {
  const { db, env } = entorno();
  const codigo = clave(8);
  db.prepare(
    `INSERT INTO orders (codigo, cliente_nombre, cliente_whatsapp, tipo_entrega, total, estado)
     VALUES (?, 'Ana', '70000000', 'recojo', 428, 'pendiente_pago')`
  ).run(codigo);

  const malo = await subirComprobante({
    env,
    params: { codigo },
    request: new Request(`https://tienda.example/api/pedidos/${codigo}/comprobante`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'CF-Connecting-IP': IP },
      body: 'no es una foto',
    }),
  });
  assert.equal(malo.status, 400);
  assert.equal(cupo(db, IP, 'comprobante'), 0);

  const fd = new FormData();
  fd.set('archivo', new File([Uint8Array.from([0xff, 0xd8])], 'pago.jpg', { type: 'image/jpeg' }));
  const ok = await subirComprobante({
    env,
    params: { codigo },
    request: new Request(`https://tienda.example/api/pedidos/${codigo}/comprobante`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': IP },
      body: fd,
    }),
  });
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.equal(cupo(db, IP, 'comprobante'), 1);
  assert.equal(
    db.prepare('SELECT estado FROM orders WHERE codigo = ?').get(codigo).estado,
    'comprobante_subido'
  );
});
