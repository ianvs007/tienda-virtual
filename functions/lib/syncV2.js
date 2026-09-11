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
import {
  planificarEtiquetas,
  planificarPublicacionEtiquetas,
  leerEtiquetasPublicadas,
  sentenciasAplicarPublicacion,
} from './etiquetas.js';
import {
  registrarProductosVistos,
  registrarEtiquetasVistas,
  productosVistos,
  etiquetasVistas,
  sentenciaLimpiarOtrasSesiones,
  trozos,
} from './sesionSync.js';

export const MAX_FILAS_SNAPSHOT = 250;
export const MAX_EVENTOS_PAGINA = 500;
// D1 admite 100 parámetros por sentencia: las lecturas por lote van en trozos.
export const PARAMS_POR_CONSULTA = 100;

export function stockNube(stockPos, deltaPendiente) {
  return Math.max(0, Number(stockPos) + Number(deltaPendiente || 0));
}

const texto = (v) => String(v ?? '').trim();

/**
 * Decide qué hacer con un lote de filas del POS. No toca la BD.
 *
 * @param {Object} p
 * @param {Array}  p.filas      [{ globalId, codigo, nombre, talla, color, stock, precio }]
 * @param {Array}  p.productos  [{ id, nombre, codigo, global_id, precio, activo }] activos o no.
 *                 Basta con los que tienen alguno de los globalId o códigos del
 *                 lote (`leerProductosDelLote`); el resto del catálogo no influye.
 * @param {Array}  p.variantes  [{ id, product_id, talla, color, stock }] de esos productos
 * @param {Map}    p.deltasPendientes  variant_id → Σ delta de eventos sin ack
 * @returns {{
 *   codigosLiberados: Array<{ id, codigo, nombre }>,
 *   globalIdsAdoptados: Array<{ id, globalId }>,
 *   updatesProducto: Array<{ id, nombre, precio, codigo }>   SOLO los que cambian (nombre, precio, código o reactivación),
 *   idsVistos: number[]                                        productos existentes que vinieron en el lote (cambien o no),
 *   productosNuevos: Array<{ globalId, codigo, nombre, precio, talla, color, stock }>,
 *   variantesNuevas: Array<{ productId, codigo, nombre, talla, color, stock }>,
 *   stockUpdates: Array<{ variantId, productId, codigo, nombre, talla, color, anterior, nuevo }>,
 *   detalle: Array<{ globalId, codigo, nombre, talla, color, accion, aviso }>,
 *   resumen: { filas, rechazadas, creadasProductos, creadasVariantes, actualizadas, adoptados, codigosLiberados, sinCambios }
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
    idsVistos: [],
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
      sinCambios: 0,
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

    // ── Producto existente: datos del POS mandan. Se escribe la fila SOLO si
    //    algo cambia (nombre, precio, código o reactivación): la presencia en la
    //    sesión se registra aparte (idsVistos), no marcando cada producto.
    const reactivado = Number(producto.activo ?? 1) !== 1;
    if (!productosActualizados.has(producto.id)) {
      productosActualizados.add(producto.id);
      globalIdsEnLote.set(globalId, { id: producto.id });
      plan.idsVistos.push(producto.id);
      const nombreFinal = nombre || producto.nombre;
      const precioFinal = precioValido ? precio : producto.precio;
      const codigoFinal = codigo || producto.codigo;
      const cambia =
        reactivado ||
        texto(nombreFinal) !== texto(producto.nombre) ||
        Number(precioFinal) !== Number(producto.precio) ||
        texto(codigoFinal) !== texto(producto.codigo);
      if (cambia) {
        plan.updatesProducto.push({ id: producto.id, nombre: nombreFinal, precio: precioFinal, codigo: codigoFinal || null });
      } else {
        plan.resumen.sinCambios++;
      }
      if (texto(producto.codigo) && texto(producto.codigo) !== texto(codigoFinal)) porCodigo.delete(texto(producto.codigo));
      if (codigoFinal) porCodigo.set(codigoFinal, producto);
      producto.nombre = nombreFinal;
      producto.precio = precioFinal;
      producto.codigo = codigoFinal || null;
    }
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

/**
 * Lee SOLO los productos que pueden verse afectados por un lote — los que ya
 * tienen alguno de sus globalId (identidad) o alguno de sus códigos (bootstrap
 * por código y liberación de códigos ajenos) — y las variantes de esos
 * productos. Antes se leía el catálogo completo en cada lote (~5.400 filas × 11
 * lotes por sync); esto baja a unas ~800 por lote.
 */
export async function leerProductosDelLote(env, filas) {
  const globalIds = [...new Set(filas.map((f) => texto(f?.globalId)).filter(Boolean))];
  const codigos = [...new Set(filas.map((f) => normalizarCodigo(f?.codigo)).filter(Boolean))];
  const consultas = [];
  for (const t of trozos(globalIds, PARAMS_POR_CONSULTA)) {
    consultas.push(
      env.DB.prepare(
        `SELECT id, nombre, codigo, global_id, precio, activo FROM products WHERE global_id IN (${t.map(() => '?').join(', ')})`
      ).bind(...t)
    );
  }
  for (const t of trozos(codigos, PARAMS_POR_CONSULTA)) {
    consultas.push(
      env.DB.prepare(
        `SELECT id, nombre, codigo, global_id, precio, activo FROM products WHERE codigo IN (${t.map(() => '?').join(', ')})`
      ).bind(...t)
    );
  }
  const productos = new Map();
  if (consultas.length > 0) {
    for (const r of await env.DB.batch(consultas)) {
      for (const p of r?.results || []) productos.set(Number(p.id), p);
    }
  }
  const ids = [...productos.keys()];
  const variantes = [];
  if (ids.length > 0) {
    const consultasVar = trozos(ids, PARAMS_POR_CONSULTA).map((t) =>
      env.DB.prepare(
        `SELECT id, product_id, talla, color, stock FROM product_variants WHERE product_id IN (${t.map(() => '?').join(', ')})`
      ).bind(...t)
    );
    for (const r of await env.DB.batch(consultasVar)) variantes.push(...(r?.results || []));
  }
  return { productos: [...productos.values()], variantes };
}

/** Aplica un lote del snapshot. Devuelve el resumen del plan ejecutado. */
export async function aplicarSnapshot(env, { dispositivoId, nombreDispositivo = '', sesion, filas }) {
  const sesionId = texto(sesion);
  if (!sesionId) throw new Error('sesion es obligatoria');
  const dispositivo = await obtenerDispositivo(env, { id: dispositivoId, nombre: nombreDispositivo });

  // Sesión nueva de este dispositivo: la anterior quedó cortada (si hubiera
  // finalizado, su presencia ya estaría limpia). Se descarta lo que acumuló;
  // lo PUBLICADO no se toca.
  const sesionPrevia = texto(dispositivo.sesion_snapshot);
  if (sesionPrevia && sesionPrevia !== sesionId) {
    await sentenciaLimpiarOtrasSesiones(env, sesionId).run();
  }

  const [{ productos, variantes }, deltas] = await Promise.all([
    leerProductosDelLote(env, filas),
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
  const idsVistos = [...plan.idsVistos];
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
      if (productId != null) idsVistos.push(productId);
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

  // Presencia de la sesión: una fila de settings (1 lectura + 1 escritura por
  // lote) en vez de marcar sesion_snapshot en cada producto.
  const vistosSesion = await registrarProductosVistos(env, sesionId, idsVistos);

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
    vistosSesion,
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
 * Recibe un lote de etiquetas físicas (shortCode de UNIDAD del POS) de la
 * sesión de snapshot y lo acumula en la presencia de la sesión (una fila de
 * settings: 1 lectura + 1 escritura por lote). Idempotente: repetir el lote
 * tras un corte no duplica nada. NO toca lo publicado: eso ocurre en
 * `finalizarSesion` cuando la lista completa llegó.
 */
export async function recibirEtiquetas(env, { dispositivoId, sesion, etiquetas }) {
  const sesionId = texto(sesion);
  if (!sesionId) throw new Error('sesion es obligatoria');
  const dispositivo = await obtenerDispositivo(env, { id: dispositivoId });
  const plan = planificarEtiquetas(etiquetas);
  let acumuladas = 0;
  if (plan.filas.length > 0) {
    acumuladas = await registrarEtiquetasVistas(env, sesionId, plan.filas);
  }
  return {
    dispositivo: dispositivo.id,
    sesion: sesionId,
    recibidas: plan.filas.length,
    acumuladas,
    rechazadas: plan.rechazadas.length,
    detalle: plan.rechazadas.slice(0, 50),
  };
}

/**
 * Cierra la sesión de snapshot. Si `desactivarAusentes`, apaga los productos
 * que no vinieron en la sesión — pero SOLO si la nube vio al menos
 * `productosEsperados` productos de esa sesión (protege contra un push que se
 * cortó a mitad y luego "finaliza" por error).
 *
 * Etiquetas (`etiquetas: { esperadas }`):
 *  - `undefined` (POS anterior, sin soporte): NO se toca lo publicado. Omitir el
 *    campo no es una lista vacía ni autoriza borrar.
 *  - `{ esperadas: N }`: si la presencia de la sesión tiene menos de N
 *    etiquetas, se rechaza TODO el cierre (`etiquetas_incompletas`) y nada
 *    cambia. Con N = 0 y lista vacía el POS pide explícitamente retirar todas.
 *  - Publicación en el MISMO batch que la desactivación: compara la presencia
 *    con lo publicado y escribe SOLO las diferencias (retiros por par
 *    etiqueta/product_id, altas y cambios de `disponible`).
 *
 * Costo por sync (D1 plan gratuito): una lectura del catálogo (id, global_id,
 * activo) + una de lo publicado; escrituras solo por lo que cambió.
 */
export async function finalizarSesion(
  env,
  { dispositivoId, sesion, productosEsperados = 0, desactivarAusentes = true, etiquetas = undefined }
) {
  const sesionId = texto(sesion);
  if (!sesionId) throw new Error('sesion es obligatoria');
  const dispositivo = await obtenerDispositivo(env, { id: dispositivoId });

  const vistos = await productosVistos(env, sesionId);
  const n = vistos.size;
  const esperados = Math.max(0, Number(productosEsperados) || 0);
  if (n < esperados) {
    return { ok: false, motivo: 'snapshot_incompleto', vistos: n, esperados };
  }

  const publicarEtiquetas = etiquetas !== undefined && etiquetas !== null;
  const esperadasEtq = Math.max(0, Number(etiquetas?.esperadas) || 0);
  let vistasEtq = null;
  if (publicarEtiquetas) {
    vistasEtq = await etiquetasVistas(env, sesionId);
    if (vistasEtq.size < esperadasEtq) {
      return {
        ok: false,
        motivo: 'etiquetas_incompletas',
        vistos: n,
        esperados,
        etiquetas: { vistas: vistasEtq.size, esperadas: esperadasEtq },
      };
    }
  }

  // Una sola lectura del catálogo (id, global_id, activo): sirve para hallar
  // los activos ausentes de la sesión y para resolver product_id de etiquetas.
  const { results: catalogo } = await env.DB.prepare('SELECT id, global_id, activo FROM products').all();
  const ausentes = desactivarAusentes
    ? catalogo.filter((p) => Number(p.activo) === 1 && !vistos.has(Number(p.id))).map((p) => Number(p.id))
    : [];

  let planEtq = null;
  if (publicarEtiquetas) {
    planEtq = planificarPublicacionEtiquetas({
      vistas: vistasEtq,
      productos: catalogo,
      publicadas: await leerEtiquetasPublicadas(env),
    });
  }

  const ahora = await env.DB.prepare(`SELECT datetime('now') AS ahora`).first();
  const sentencias = [];
  for (const t of trozos(ausentes, PARAMS_POR_CONSULTA)) {
    sentencias.push(
      env.DB.prepare(`UPDATE products SET activo = 0 WHERE id IN (${t.map(() => '?').join(', ')})`).bind(...t)
    );
  }
  if (planEtq) sentencias.push(...sentenciasAplicarPublicacion(env, planEtq));
  sentencias.push(
    env.DB.prepare(
      `UPDATE sync_dispositivos SET ultimo_snapshot_en = ?, ultima_actividad = ? WHERE id = ?`
    ).bind(ahora?.ahora, ahora?.ahora, dispositivo.id),
    env.DB.prepare(`UPDATE settings SET valor = ? WHERE clave = 'ultima_sincronizacion'`).bind(ahora?.ahora)
  );
  // La presencia de la sesión NO se borra aquí: así un `finalizar` repetido
  // (reintento tras un corte de red posterior al commit) vuelve a dar ok sin
  // cambios. Se limpia al empezar la siguiente sesión del dispositivo.
  await env.DB.batch(sentencias);

  const resumenEtiquetas = publicarEtiquetas
    ? {
        ok: true,
        vistas: vistasEtq.size,
        esperadas: esperadasEtq,
        publicadas: planEtq.publicadas,
        sinProducto: planEtq.sinProducto,
        retiradas: planEtq.retirar.length,
        actualizadas: planEtq.upsert.length,
      }
    : { ok: true, omitidas: true };

  return { ok: true, vistos: n, esperados, desactivados: ausentes.length, etiquetas: resumenEtiquetas, finalizadoEn: ahora?.ahora };
}
