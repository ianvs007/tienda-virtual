// Lógica del buzón seguro de traslados entre sucursales (D1).
// Todas las operaciones son idempotentes para tolerar reintentos por cortes de red.

export function normalizarSucursal(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

export function validarPaqueteBuzon(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valido: false, error: 'El cuerpo del traslado es inválido.' };
  }
  const transferUid = String(raw.transferUid || '').trim();
  const originBranch = normalizarSucursal(raw.originBranch);
  const destinationBranch = normalizarSucursal(raw.destinationBranch);
  const items = Array.isArray(raw.items) ? raw.items : [];

  if (!transferUid) return { valido: false, error: 'transferUid es obligatorio.' };
  if (!originBranch) return { valido: false, error: 'originBranch es obligatorio.' };
  if (!destinationBranch) return { valido: false, error: 'destinationBranch es obligatorio.' };
  if (items.length === 0) return { valido: false, error: 'El paquete debe incluir al menos 1 prenda.' };

  const cleanItems = [];
  for (const item of items) {
    const shortCode = String(item?.shortCode ?? '').trim();
    if (!/^\d{1,5}$/.test(shortCode)) {
      return { valido: false, error: `Código corto inválido en ítem: "${shortCode}".` };
    }
    cleanItems.push({
      shortCode: shortCode.padStart(5, '0'),
      barcode: String(item?.barcode || '').trim(),
      globalId: String(item?.globalId || '').trim(),
      name: String(item?.name || 'PRENDA DE SUCURSAL').trim().toUpperCase(),
      category: String(item?.category || 'Otros').trim(),
      brand: String(item?.brand || '').trim(),
      size: String(item?.size || '').trim(),
      color: String(item?.color || '').trim(),
      cost: Number(item?.cost) || 0,
      price: Number(item?.price) || 0,
      qty: Math.max(1, Math.floor(Number(item?.qty) || 1)),
    });
  }

  return {
    valido: true,
    paquete: {
      version: Number(raw.version) || 1,
      transferUid,
      originBranch,
      destinationBranch,
      status: 'en_transito',
      notes: String(raw.notes || '').trim(),
      sentBy: String(raw.sentBy || 'Sucursal').trim(),
      createdAt: String(raw.createdAt || new Date().toISOString()),
      items: cleanItems,
    },
  };
}

export async function registrarTrasladoBuzon(env, rawBody) {
  const check = validarPaqueteBuzon(rawBody);
  if (!check.valido) {
    const err = new Error(check.error);
    err.status = 400;
    throw err;
  }

  const pkg = check.paquete;
  const existente = await env.DB.prepare(
    'SELECT transfer_uid, status FROM traslados_buzon WHERE transfer_uid = ?'
  )
    .bind(pkg.transferUid)
    .first();

  if (existente) {
    return {
      ok: true,
      transferUid: existente.transfer_uid,
      status: existente.status,
      duplicated: true,
    };
  }

  await env.DB.prepare(
    `INSERT INTO traslados_buzon (
      transfer_uid, origin_branch, destination_branch, status,
      notes, sent_by, created_at, payload_json
    ) VALUES (?, ?, ?, 'en_transito', ?, ?, ?, ?)`
  )
    .bind(
      pkg.transferUid,
      pkg.originBranch,
      pkg.destinationBranch,
      pkg.notes,
      pkg.sentBy,
      pkg.createdAt,
      JSON.stringify(pkg)
    )
    .run();

  return {
    ok: true,
    transferUid: pkg.transferUid,
    status: 'en_transito',
    duplicated: false,
  };
}

export async function listarPendientesBuzon(env, destinoRaw) {
  const destino = normalizarSucursal(destinoRaw);
  const query = destino
    ? env.DB.prepare(
        `SELECT transfer_uid, status, payload_json
         FROM traslados_buzon
         WHERE destination_branch = ? AND status = 'en_transito'
         ORDER BY created_at DESC
         LIMIT 100`
      ).bind(destino)
    : env.DB.prepare(
        `SELECT transfer_uid, status, payload_json
         FROM traslados_buzon
         WHERE status = 'en_transito'
         ORDER BY created_at DESC
         LIMIT 100`
      );

  const res = await query.all();
  const rows = Array.isArray(res?.results) ? res.results : [];
  const traslados = [];

  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload_json);
      traslados.push({ ...parsed, status: row.status || 'en_transito' });
    } catch {
      // Ignorar fila corrupta
    }
  }

  return { ok: true, traslados };
}

export async function confirmarTrasladoBuzon(env, body = {}) {
  const transferUid = String(body?.transferUid || '').trim();
  if (!transferUid) {
    const err = new Error('transferUid es obligatorio.');
    err.status = 400;
    throw err;
  }

  const existente = await env.DB.prepare(
    'SELECT transfer_uid, status FROM traslados_buzon WHERE transfer_uid = ?'
  )
    .bind(transferUid)
    .first();

  if (!existente) {
    const err = new Error('Traslado no encontrado en el buzón.');
    err.status = 404;
    throw err;
  }

  if (existente.status === 'recibido') {
    return {
      ok: true,
      transferUid,
      status: 'recibido',
      alreadyConfirmed: true,
    };
  }

  const receivedBy = String(body?.receivedBy || 'Sistema').trim();
  const receivedAt = String(body?.receivedAt || new Date().toISOString());
  const receivedBranch = normalizarSucursal(body?.receivedBranch);

  await env.DB.prepare(
    `UPDATE traslados_buzon
     SET status = 'recibido',
         received_by = ?,
         received_at = ?,
         received_branch = ?
     WHERE transfer_uid = ?`
  )
    .bind(receivedBy, receivedAt, receivedBranch || null, transferUid)
    .run();

  return {
    ok: true,
    transferUid,
    status: 'recibido',
    alreadyConfirmed: false,
  };
}
