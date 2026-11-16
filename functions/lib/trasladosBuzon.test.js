import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarSucursal,
  validarPaqueteBuzon,
  registrarTrasladoBuzon,
  listarPendientesBuzon,
  confirmarTrasladoBuzon,
} from './trasladosBuzon.js';

function crearMockDB() {
  const rows = new Map();

  return {
    rows,
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...params) {
          args = params;
          return stmt;
        },
        async first() {
          if (sql.includes('SELECT transfer_uid, status FROM traslados_buzon WHERE transfer_uid = ?')) {
            const row = rows.get(args[0]);
            return row ? { transfer_uid: row.transfer_uid, status: row.status } : null;
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO traslados_buzon')) {
            const [uid, origin, dest, notes, sentBy, createdAt, payloadJson] = args;
            rows.set(uid, {
              transfer_uid: uid,
              origin_branch: origin,
              destination_branch: dest,
              status: 'en_transito',
              notes,
              sent_by: sentBy,
              created_at: createdAt,
              payload_json: payloadJson,
              received_by: null,
              received_at: null,
              received_branch: null,
            });
            return { success: true };
          }
          if (sql.includes('UPDATE traslados_buzon')) {
            const [receivedBy, receivedAt, receivedBranch, uid] = args;
            const row = rows.get(uid);
            if (row) {
              row.status = 'recibido';
              row.received_by = receivedBy;
              row.received_at = receivedAt;
              row.received_branch = receivedBranch;
            }
            return { success: true };
          }
          return { success: true };
        },
        async all() {
          if (sql.includes('FROM traslados_buzon')) {
            const hasDestino = sql.includes('destination_branch = ?');
            const destino = hasDestino ? args[0] : null;
            const results = [];
            for (const row of rows.values()) {
              if (row.status !== 'en_transito') continue;
              if (destino && row.destination_branch !== destino) continue;
              results.push({
                transfer_uid: row.transfer_uid,
                status: row.status,
                payload_json: row.payload_json,
              });
            }
            return { results };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
  };
}

test('normalizarSucursal normaliza mayúsculas y espacios', () => {
  assert.equal(normalizarSucursal('  tienda principal '), 'TIENDA PRINCIPAL');
  assert.equal(normalizarSucursal(undefined), '');
});

test('validarPaqueteBuzon valida estructura y normaliza shortCode a 5 dígitos', () => {
  const res = validarPaqueteBuzon({
    transferUid: 'uid-1',
    originBranch: 'sucursal 1',
    destinationBranch: 'tienda principal',
    sentBy: 'Ana',
    items: [{ shortCode: '450', name: 'vestido gala', price: 250 }],
  });
  assert.equal(res.valido, true);
  assert.equal(res.paquete.originBranch, 'SUCURSAL 1');
  assert.equal(res.paquete.destinationBranch, 'TIENDA PRINCIPAL');
  assert.equal(res.paquete.items[0].shortCode, '00450');
  assert.equal(res.paquete.items[0].name, 'VESTIDO GALA');
});

test('ciclo completo: enviar (idempotente) → listar pendientes por destino → confirmar recepción', async () => {
  const env = { DB: crearMockDB() };

  const paquete = {
    transferUid: 'uid-abc-1',
    originBranch: 'SUCURSAL 1',
    destinationBranch: 'TIENDA PRINCIPAL',
    sentBy: 'Cajera Suc1',
    notes: 'ENVIO DE PRUEBA',
    createdAt: '2026-11-15T15:00:00.000Z',
    items: [{ shortCode: '120', name: 'BLUSA SEDA', price: 140, cost: 70, qty: 1 }],
  };

  // 1. Enviar
  const envio1 = await registrarTrasladoBuzon(env, paquete);
  assert.equal(envio1.ok, true);
  assert.equal(envio1.duplicated, false);

  // Reintento idempotente
  const envio2 = await registrarTrasladoBuzon(env, paquete);
  assert.equal(envio2.ok, true);
  assert.equal(envio2.duplicated, true);

  // 2. Consultar pendientes de TIENDA PRINCIPAL y de otra sucursal
  const pendPrincipal = await listarPendientesBuzon(env, 'TIENDA PRINCIPAL');
  assert.equal(pendPrincipal.traslados.length, 1);
  assert.equal(pendPrincipal.traslados[0].items[0].shortCode, '00120');

  const pendSuc2 = await listarPendientesBuzon(env, 'SUCURSAL 2');
  assert.equal(pendSuc2.traslados.length, 0);

  // 3. Confirmar recepción
  const conf1 = await confirmarTrasladoBuzon(env, {
    transferUid: 'uid-abc-1',
    receivedBy: 'Admin Central',
    receivedBranch: 'TIENDA PRINCIPAL',
  });
  assert.equal(conf1.ok, true);
  assert.equal(conf1.status, 'recibido');
  assert.equal(conf1.alreadyConfirmed, false);

  // Ya no aparece en pendientes
  const pendDespues = await listarPendientesBuzon(env, 'TIENDA PRINCIPAL');
  assert.equal(pendDespues.traslados.length, 0);

  // Re-confirmación idempotente
  const conf2 = await confirmarTrasladoBuzon(env, { transferUid: 'uid-abc-1' });
  assert.equal(conf2.alreadyConfirmed, true);
});
