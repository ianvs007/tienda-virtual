// Protege el uso de los índices parciales en leerProductosDelLote.
// Sin las condiciones AND global_id/codigo IS NOT NULL..., SQLite hace SCAN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONDICION_CODIGO, CONDICION_GLOBAL_ID, leerProductosDelLote } from './syncV2.js';
import { envConDB } from './fakeD1.js';

test('condiciones parciales coinciden con las migraciones 003 y 005', () => {
  assert.equal(CONDICION_GLOBAL_ID, "global_id IS NOT NULL AND global_id != ''");
  assert.equal(CONDICION_CODIGO, "codigo IS NOT NULL AND codigo != ''");
});

test('leerProductosDelLote incluye la condición parcial en el SQL (índice usable)', async () => {
  const env = envConDB({
    products: [
      { id: 1, nombre: 'Vestido', codigo: '00001', global_id: 'g-1', precio: 100, activo: 1 },
      { id: 2, nombre: 'Pollera', codigo: '00002', global_id: 'g-2', precio: 80, activo: 1 },
    ],
    variants: [
      { id: 10, product_id: 1, talla: 'U', color: '', stock: 2 },
      { id: 11, product_id: 2, talla: 'U', color: '', stock: 1 },
    ],
  });
  const sqls = [];
  const prepareOriginal = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    sqls.push(sql);
    return prepareOriginal(sql);
  };

  const { productos } = await leerProductosDelLote(env, [
    { globalId: 'g-1', codigo: '00001' },
    { globalId: 'g-2', codigo: '00002' },
  ]);
  assert.equal(productos.length, 2);

  const porGlobal = sqls.find((s) => s.includes('WHERE global_id IN'));
  const porCodigo = sqls.find((s) => s.includes('WHERE codigo IN'));
  assert.ok(porGlobal, 'debe consultar por global_id');
  assert.ok(porCodigo, 'debe consultar por codigo');
  assert.match(porGlobal, /global_id IS NOT NULL AND global_id != ''/);
  assert.match(porCodigo, /codigo IS NOT NULL AND codigo != ''/);
});
