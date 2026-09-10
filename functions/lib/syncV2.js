// Sincronización v2 con el POS: snapshot por globalId + eventos confirmados.
// Diseño: tienda de ropas/docs/DISENO_SYNC_EVENTOS.md.
//
// Regla central: stock_nube = max(0, stock_pos + Σ delta de los eventos que el
// POS AÚN NO confirmó (id > ultimo_evento_ack del dispositivo)). El POS es la
// autoridad; la nube solo resta lo que vendió y aún no le contó al POS.
//
// `planificarSnapshot` es PURA (sin D1) y concentra toda la decisión; las
// funciones con `env` solo leen, ejecutan el plan en batches y devuelven el
// resumen. Así el comportamiento se prueba en node sin base de datos.
import { normalizarCodigo } from './codigo.js';
import { sentenciaLogStock } from './stockLog.js';

export const MAX_FILAS_SNAPSHOT = 250;
export const MAX_EVENTOS_PAGINA = 500;

export function stockNube(stockPos, deltaPendiente) {
  return Math.max(0, Number(stockPos) + Number(deltaPendiente || 0));
}

const texto = (v) => String(v ?? '').trim();

/**
 * Decide qué hacer con un lote de filas del POS. No toca la BD.
 *
 * @param {Object} p
 * @param {Array}  p.filas      [{ globalId, codigo, nombre, talla, color, stock, precio }]
 * @param {Array}  p.productos  [{ id, nombre, codigo, global_id, precio, activo }] (TODOS, activos o no)
 * @param {Array}  p.variantes  [{ id, product_id, talla, color, stock }]
 * @param {Map}    p.deltasPendientes  variant_id → Σ delta de eventos sin ack
 * @returns {{
 *   codigosLiberados: Array<{ id, codigo, nombre }>,
 *   globalIdsAdoptados: Array<{ id, globalId }>,
 *   updatesProducto: Array<{ id, nombre, precio, codigo }>,
 *   productosNuevos: Array<{ globalId, codigo, nombre, precio, talla, color, stock }>,
 *   variantesNuevas: Array<{ productId, codigo, nombre, talla, color, stock }>,
 *   stockUpdates: Array<{ variantId, productId, codigo, nombre, talla, color, anterior, nuevo }>,
 *   detalle: Array<{ globalId, codigo, nombre, talla, color, accion, aviso }>,
 *   resumen: { filas, rechazadas, creadasProductos, creadasVariantes, actualizadas, adoptados, codigosLiberados }
 * }}
 */
export function planificarSnapshot({ filas = [], productos = [], variantes = [], deltasPendientes = new Map() }) {
  const porGlobalId = new Map(productos.filter((p) => texto(p.global_id)).map((p) => [texto(p.global_id), p]));
  const porCodigo = new Map(productos.filter((p) => texto(p.codigo)).map((p) => [texto(p.codigo), p]));
  const variantesDe = new Map();
  for (const v of variantes) {
    if (!variantesDe.has(v.product_id)) variantesDe.set(v.product_id, []);
    variantesDe.get(v.product_id).push(v);
  }

  const plan = {
    codigosLiberados: [],
    globalIdsAdoptados: [],
    updatesProducto: [],
    productosNuevos: [],
    variantesNuevas: [],
    stockUpdates: [],
    detalle: [],
    resumen: {
      filas: filas.length,
      rechazadas: 0,
      creadasProductos: 0,
      creadasVariantes: 0,
      actualizadas: 0,
      adoptados: 0,
      codigosLiberados: 0,
    },
  };

  const globalIdsEnLote = new Map(); // globalId → índice del producto nuevo o id existente
  const codigosEnLote = new Map();   // codigo → globalId que lo reclamó primero en este lote
  const productosActualizados = new Set();

  const rechazar = (f, aviso) => {
    plan.resumen.rechazadas++;
    plan.detalle.push({
      globalId: texto(f?.globalId),
      codigo: texto(f?.codigo),
      nombre: texto(f?.nombre),
      talla: texto(f?.talla),
      color: texto(f?.color),
      accion: 'rechazada',
      aviso,
    });
  };

  for (const f of filas) {
    const globalId = texto(f?.globalId);
    const codigoCrudo = normalizarCodigo(f?.codigo);
    const nombre = texto(f?.nombre);
    const talla = texto(f?.talla);
    const color = texto(f?.color);
    const stock = Number(f?.stock);
    const precio = Number(f?.precio);
    const precioValido = Number.isFinite(precio) && precio >= 0;

    if (!globalId) {
      rechazar(f, 'Fila sin globalId: el POS debe enviar la identidad estable');
      continue;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      rechazar(f, 'Stock inválido');
      continue;
    }

    // Código: si otro globalId del MISMO lote ya lo reclamó, esta fila no lo
    // toma (el POS tiene duplicados; se avisa y se conserva el código previo).
    let codigo = codigoCrudo || null;
    let avisoCodigo = null;
    if (codigo) {
      const dueñoEnLote = codigosEnLote.get(codigo);
      if (dueñoEnLote && dueñoEnLote !== globalId) {
        avisoCodigo = `Código ${codigo} duplicado en el POS (ya vino con otra prenda en este lote): no se asignó`;
        codigo = null;
      } else {
        codigosEnLote.set(codigo, globalId);
      }
    }

    // ── Localizar el producto: globalId manda; bootstrap por código SOLO si el
    //    producto de la nube todavía no tiene global_id.
    let producto = porGlobalId.get(globalId) || null;
    let adoptado = false;
    if (!producto && codigo) {
      const candidato = porCodigo.get(codigo);
      if (candidato && !texto(candidato.global_id)) {
        producto = candidato;
        adoptado = true;
        plan.globalIdsAdoptados.push({ id: candidato.id, globalId });
        plan.resumen.adoptados++;
        candidato.global_id = globalId;
        porGlobalId.set(globalId, candidato);
      }
    }

    // El mismo globalId dos veces en un lote: la segunda fila es otra variante
    // (talla/color) del mismo producto → solo se trata la variante.
    const yaVistoEnLote = globalIdsEnLote.has(globalId);

    // ── Liberar el código si lo tiene OTRO producto (identidad distinta).
    if (codigo) {
      const otro = porCodigo.get(codigo);
      const esOtraIdentidad = otro && texto(otro.global_id) !== globalId && (!producto || otro.id !== producto.id);
      if (esOtraIdentidad) {
        plan.codigosLiberados.push({ id: otro.id, codigo, nombre: otro.nombre });
        plan.resumen.codigosLiberados++;
        avisoCodigo = `Código ${codigo} estaba en "${otro.nombre}" (liberado; esa prenda lo recupera si llega en esta sesión o se desactiva al finalizar)`;
        otro.codigo = null;
        porCodigo.delete(codigo);
      }
    }

    if (!producto) {
      if (yaVistoEnLote) {
        // Producto nuevo ya planificado en este lote: agregar variante.
        const idx = globalIdsEnLote.get(globalId);
        const nuevo = plan.productosNuevos[idx.indice];
        nuevo.variantesExtra.push({ talla, color, stock });
        plan.resumen.creadasVariantes++;
        plan.detalle.push({ globalId, codigo: codigo || '', nombre, talla, color, accion: 'creada_variante', aviso: avisoCodigo });
        continue;
      }
      if (nombre.length < 2) {
        rechazar(f, 'No se pudo crear: nombre inválido en el POS');
        continue;
      }
      if (!precioValido) {
        rechazar(f, 'No se pudo crear: precio inválido en el POS');
        continue;
      }
      plan.productosNuevos.push({ globalId, codigo, nombre, precio, talla, color, stock, variantesExtra: [] });
      globalIdsEnLote.set(globalId, { indice: plan.productosNuevos.length - 1 });
      if (codigo) porCodigo.set(codigo, { id: `nuevo:${globalId}`, nombre, codigo, global_id: globalId });
      plan.resumen.creadasProductos++;
      plan.resumen.creadasVariantes++;
      plan.detalle.push({ globalId, codigo: codigo || '', nombre, talla, color, accion: 'creado', aviso: avisoCodigo });
      continue;
    }

    // ── Producto existente: datos del POS mandan.
    if (!productosActualizados.has(producto.id)) {
      productosActualizados.add(producto.id);
      globalIdsEnLote.set(globalId, { id: producto.id });
      const nombreFinal = nombre || producto.nombre;
      const precioFinal = precioValido ? precio : producto.precio;
      const codigoFinal = codigo || producto.codigo;
      plan.updatesProducto.push({ id: producto.id, nombre: nombreFinal, precio: precioFinal, codigo: codigoFinal || null });
      if (texto(producto.codigo) && texto(producto.codigo) !== texto(codigoFinal)) porCodigo.delete(texto(producto.codigo));
      if (codigoFinal) porCodigo.set(codigoFinal, producto);
      producto.nombre = nombreFinal;
      producto.precio = precioFinal;
      producto.codigo = codigoFinal || null;
    }
    const reactivado = Number(producto.activo ?? 1) !== 1;
    producto.activo = 1;

    const lista = variantesDe.get(producto.id) || [];
    let variante = lista.find((v) => texto(v.talla) === talla && texto(v.color) === color) || null;
    if (!variante && !talla && !color && lista.length === 1) variante = lista[0];

    if (!variante) {
      plan.variantesNuevas.push({ productId: producto.id, codigo: producto.codigo || '', nombre: producto.nombre, talla, color, stock });
      lista.push({ id: null, product_id: producto.id, talla, color, stock });
      variantesDe.set(producto.id, lista);
      plan.resumen.creadasVariantes++;
      plan.detalle.push({
        globalId, codigo: producto.codigo || '', nombre: producto.nombre, talla, color,
        accion: adoptado ? 'adoptado' : reactivado ? 'reactivado' : 'creada_variante',
        aviso: avisoCodigo,
      });
      continue;
    }

    if (variante.id != null) {
      const nuevo = stockNube(stock, deltasPendientes.get(variante.id));
      if (nuevo !== Number(variante.stock)) {
        plan.stockUpdates.push({
          variantId: variante.id, productId: producto.id, codigo: producto.codigo || '', nombre: producto.nombre,
          talla: texto(variante.talla), color: texto(variante.color), anterior: Number(variante.stock), nuevo,
        });
        plan.resumen.actualizadas++;
        variante.stock = nuevo;
      }
    }
    plan.detalle.push({
      globalId, codigo: producto.codigo || '', nombre: producto.nombre, talla: texto(variante.talla), color: texto(variante.color),
      accion: adoptado ? 'adoptado' : reactivado ? 'reactivado' : 'sobrescrito',
      aviso: avisoCodigo,
    });
  }

  // Un producto cuyo código se liberó y que NO viene en este lote no se toca
  // más: si aparece en otro lote de la misma sesión recupera su código real.
  return plan;
}

// ─────────────────────────────── D1 ────────────────────────────────

/** Garantiza la fila del dispositivo y devuelve su estado. */
export async function obtenerDispositivo(env, { id, nombre = '' }) {
  const dispositivoId = texto(id);
  if (!dispositivoId) throw new Error('dispositivo es obligatorio');
  await env.DB.prepare(
    `INSERT INTO sync_dispositivos (id, nombre, ultima_actividad)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       nombre = CASE WHEN excluded.nombre != '' THEN excluded.nombre ELSE sync_dispositivos.nombre END,
       ultima_actividad = datetime('now')`
  )
    .bind(dispositivoId, texto(nombre))
    .run();
  const fila = await env.DB.prepare(
    'SELECT id, nombre, ultimo_evento_ack, sesion_snapshot, ultimo_snapshot_en FROM sync_dispositivos WHERE id = ?'
  )
    .bind(dispositivoId)
    .first();
  return fila;
}

/** Eventos con id > desde, en orden, paginados. */
export async function listarEventos(env, { desde = 0, limite = MAX_EVENTOS_PAGINA }) {
  const n = Math.min(Math.max(1, Number(limite) || MAX_EVENTOS_PAGINA), MAX_EVENTOS_PAGINA);
  const { results } = await env.DB.prepare(
    `SELECT id, tipo, global_id, codigo, nombre, talla, color, delta, precio_unit, pedido_ref, creado_en
       FROM stock_eventos
      WHERE id > ?
      ORDER BY id
      LIMIT ?`
  )
    .bind(Number(desde) || 0, n + 1)
    .all();
  const hayMas = results.length > n;
  const pagina = hayMas ? results.slice(0, n) : results;
  return {
    eventos: pagina.map((e) => ({
      id: e.id,
      tipo: e.tipo,
      globalId: e.global_id || '',
      codigo: e.codigo || '',
      nombre: e.nombre || '',
      talla: e.talla || '',
      color: e.color || '',
      delta: Number(e.delta),
      precioUnit: Number(e.precio_unit) || 0,
      pedidoRef: e.pedido_ref || '',
      creadoEn: e.creado_en,
    })),
    ultimoId: pagina.length ? pagina[pagina.length - 1].id : Number(desde) || 0,
    hayMas,
  };
}

/** Σ delta por variante de los eventos que el dispositivo no confirmó. */
export async function deltasPendientes(env, ultimoAck) {
  const { results } = await env.DB.prepare(
    `SELECT variant_id, SUM(delta) AS delta
       FROM stock_eventos
      WHERE id > ? AND variant_id IS NOT NULL
      GROUP BY variant_id`
  )
    .bind(Number(ultimoAck) || 0)
    .all();
  return new Map(results.map((r) => [r.variant_id, Number(r.delta)]));
}

/** Aplica un lote del snapshot. Devuelve el resumen del plan ejecutado. */
export async function aplicarSnapshot(env, { dispositivoId, nombreDispositivo = '', sesion, filas }) {
  const sesionId = texto(sesion);
  if (!sesionId) throw new Error('sesion es obligatoria');
  const dispositivo = await obtenerDispositivo(env, { id: dispositivoId, nombre: nombreDispositivo });

  const [{ results: productos }, { results: variantes }, deltas] = await Promise.all([
    env.DB.prepare('SELECT id, nombre, codigo, global_id, precio, activo FROM products').all(),
    env.DB.prepare('SELECT id, product_id, talla, color, stock FROM product_variants').all(),
    deltasPendientes(env, dispositivo.ultimo_evento_ack),
  ]);

  const plan = planificarSnapshot({ filas, productos, variantes, deltasPendientes: deltas });

  // Batch A: liberaciones de código ANTES de cualquier asignación (índice único),
  // adopciones de globalId, updates de producto y ajustes de stock con su log.
  const a = [];
  for (const l of plan.codigosLiberados) {
    a.push(env.DB.prepare('UPDATE products SET codigo = NULL WHERE id = ?').bind(l.id));
  }
  for (const g of plan.globalIdsAdoptados) {
    a.push(env.DB.prepare('UPDATE products SET global_id = ? WHERE id = ?').bind(g.globalId, g.id));
  }
  for (const u of plan.updatesProducto) {
    a.push(
      env.DB.prepare(
        'UPDATE products SET nombre = ?, precio = ?, codigo = ?, activo = 1, sesion_snapshot = ? WHERE id = ?'
      ).bind(u.nombre, u.precio, u.codigo, sesionId, u.id)
    );
  }
  for (const s of plan.stockUpdates) {
    a.push(env.DB.prepare('UPDATE product_variants SET stock = ? WHERE id = ?').bind(s.nuevo, s.variantId));
    a.push(
      sentenciaLogStock(env, {
        productId: s.productId,
        variantId: s.variantId,
        codigo: s.codigo,
        nombre: s.nombre,
        talla: s.talla,
        color: s.color,
        anterior: s.anterior,
        nuevo: s.nuevo,
        origen: 'sincronizacion',
        detalle: `snapshot ${sesionId}`,
      })
    );
  }
  if (a.length > 0) await env.DB.batch(a);

  // Batch B: productos nuevos (necesitamos sus ids para las variantes).
  const variantesNuevas = [...plan.variantesNuevas];
  if (plan.productosNuevos.length > 0) {
    const resultados = await env.DB.batch(
      plan.productosNuevos.map((n) =>
        env.DB.prepare(
          `INSERT INTO products (nombre, descripcion, precio, categoria_id, activo, codigo, global_id, sesion_snapshot)
           VALUES (?, '', ?, NULL, 1, ?, ?, ?)`
        ).bind(n.nombre, n.precio, n.codigo, n.globalId, sesionId)
      )
    );
    plan.productosNuevos.forEach((n, i) => {
      const productId = resultados[i]?.meta?.last_row_id;
      variantesNuevas.push({ productId, codigo: n.codigo || '', nombre: n.nombre, talla: n.talla, color: n.color, stock: n.stock });
      for (const extra of n.variantesExtra) {
        variantesNuevas.push({ productId, codigo: n.codigo || '', nombre: n.nombre, talla: extra.talla, color: extra.color, stock: extra.stock });
      }
    });
  }

  // Batch C: variantes nuevas con su log de stock inicial.
  if (variantesNuevas.length > 0) {
    const c = [];
    for (const v of variantesNuevas) {
      c.push(
        env.DB.prepare('INSERT INTO product_variants (product_id, talla, color, stock) VALUES (?, ?, ?, ?)').bind(
          v.productId, v.talla, v.color, v.stock
        )
      );
      c.push(
        sentenciaLogStock(env, {
          productId: v.productId,
          codigo: v.codigo,
          nombre: v.nombre,
          talla: v.talla,
          color: v.color,
          anterior: null,
          nuevo: v.stock,
          origen: 'sincronizacion',
          detalle: `snapshot ${sesionId} (alta)`,
        })
      );
    }
    await env.DB.batch(c);
  }

  await env.DB.prepare(
    `UPDATE sync_dispositivos SET sesion_snapshot = ?, ultima_actividad = datetime('now') WHERE id = ?`
  )
    .bind(sesionId, dispositivo.id)
    .run();

  return {
    dispositivo: dispositivo.id,
    sesion: sesionId,
    ultimoEventoAck: dispositivo.ultimo_evento_ack,
    ...plan.resumen,
    detalle: plan.detalle,
  };
}

/** Confirma que el POS aplicó los eventos hasta `hastaId` (idempotente). */
export async function confirmarEventos(env, { dispositivoId, hastaId }) {
  const dispositivo = await obtenerDispositivo(env, { id: dispositivoId });
  const hasta = Math.max(0, Number(hastaId) || 0);
  const nuevoAck = Math.max(Number(dispositivo.ultimo_evento_ack) || 0, hasta);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE sync_dispositivos SET ultimo_evento_ack = ?, ultima_actividad = datetime('now') WHERE id = ?`
    ).bind(nuevoAck, dispositivo.id),
    env.DB.prepare(
      `UPDATE stock_eventos SET aplicado_pos_en = datetime('now') WHERE id <= ? AND aplicado_pos_en IS NULL`
    ).bind(nuevoAck),
  ]);
  return { dispositivo: dispositivo.id, ultimoEventoAck: nuevoAck };
}

/**
 * Cierra la sesión de snapshot. Si `desactivarAusentes`, apaga los productos
 * que no vinieron en la sesión — pero SOLO si la nube vio al menos
 * `productosEsperados` productos de esa sesión (protege contra un push que se
 * cortó a mitad y luego "finaliza" por error).
 */
export async function finalizarSesion(env, { dispositivoId, sesion, productosEsperados = 0, desactivarAusentes = true }) {
  const sesionId = texto(sesion);
  if (!sesionId) throw new Error('sesion es obligatoria');
  const dispositivo = await obtenerDispositivo(env, { id: dispositivoId });

  const vistos = await env.DB.prepare('SELECT COUNT(*) AS n FROM products WHERE sesion_snapshot = ?')
    .bind(sesionId)
    .first();
  const n = Number(vistos?.n) || 0;
  const esperados = Math.max(0, Number(productosEsperados) || 0);
  if (n < esperados) {
    return { ok: false, motivo: 'snapshot_incompleto', vistos: n, esperados };
  }

  let desactivados = 0;
  if (desactivarAusentes) {
    const r = await env.DB.prepare(
      `UPDATE products SET activo = 0
        WHERE activo = 1 AND (sesion_snapshot IS NULL OR sesion_snapshot != ?)`
    )
      .bind(sesionId)
      .run();
    desactivados = Number(r?.meta?.changes) || 0;
  }

  const ahora = await env.DB.prepare(`SELECT datetime('now') AS ahora`).first();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE sync_dispositivos SET ultimo_snapshot_en = ?, ultima_actividad = ? WHERE id = ?`
    ).bind(ahora?.ahora, ahora?.ahora, dispositivo.id),
    env.DB.prepare(`UPDATE settings SET valor = ? WHERE clave = 'ultima_sincronizacion'`).bind(ahora?.ahora),
  ]);

  return { ok: true, vistos: n, esperados, desactivados, finalizadoEn: ahora?.ahora };
}
