// Lógica de la sincronización de stock con el sistema local (offline).
// Diseño aprobado en PROPUESTA_SINCRONIZACION.md:
//   stock nuevo en nube = stock del Excel (tras ventas locales)
//                       − ventas en línea desde la última sincronización
// "Ventas en línea" = ítems de pedidos NO cancelados creados después de la
// última sync. pendiente_pago cuenta: su stock está reservado (si expira,
// vuelve solo por functions/lib/expirar.js).
import { normalizarCodigo } from './codigo.js';
import { jsonSync } from './cors.js';

export async function obtenerUltimaSincronizacion(env) {
  const fila = await env.DB.prepare(
    `SELECT valor FROM settings WHERE clave = 'ultima_sincronizacion'`
  ).first();
  return fila?.valor || '1970-01-01 00:00:00';
}

function normalizarNombre(texto) {
  return String(texto || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

// Compara nombres para detectar códigos cruzados entre POS y nube.
function nubeDifiere(a, b) {
  return a && b && normalizarNombre(a) !== normalizarNombre(b);
}

// Cantidad vendida en línea por variante desde una fecha (pedidos no cancelados).
export async function ventasPorVariante(env, desde) {
  const { results } = await env.DB.prepare(
    `SELECT oi.variant_id, SUM(oi.cantidad) AS cantidad
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.estado != 'cancelado' AND o.creado_en > ? AND oi.variant_id IS NOT NULL
      GROUP BY oi.variant_id`
  )
    .bind(desde)
    .all();
  return new Map(results.map((r) => [r.variant_id, r.cantidad]));
}

export async function ventasPorVarianteEntre(env, desde, hasta) {
  const { results } = await env.DB.prepare(
    `SELECT oi.variant_id, SUM(oi.cantidad) AS cantidad
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.estado != 'cancelado'
        AND o.creado_en > ?
        AND o.creado_en <= ?
        AND oi.variant_id IS NOT NULL
      GROUP BY oi.variant_id`
  )
    .bind(desde, hasta)
    .all();
  return new Map(results.map((r) => [r.variant_id, r.cantidad]));
}

export function stockFinalConVentasPostCutoff(stockPOS, ventasPostCutoff) {
  return Math.max(0, Number(stockPOS) - Number(ventasPostCutoff || 0));
}

// Ítems vendidos en línea desde una fecha (pedidos no cancelados), con el
// detalle que necesita el sistema local para descontarlos. La usa el panel
// admin (descarga a Excel) y la sync directa del POS (functions/api/sync.js).
export async function ventasEnLineaDesde(env, desde) {
  const { results } = await env.DB.prepare(
    `SELECT p.codigo, p.nombre, v.talla, v.color, oi.cantidad, oi.precio_unit,
            o.estado, substr(o.codigo, 1, 8) AS pedido_ref, o.creado_en
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN product_variants v ON v.id = oi.variant_id
      WHERE o.estado != 'cancelado' AND o.creado_en > ?
      ORDER BY o.creado_en`
  )
    .bind(desde)
    .all();
  return results;
}

export async function ventasEnLineaEntre(env, desde, hasta) {
  const { results } = await env.DB.prepare(
    `SELECT p.codigo, p.nombre, v.talla, v.color, oi.cantidad, oi.precio_unit,
            o.estado, substr(o.codigo, 1, 8) AS pedido_ref, o.creado_en
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       LEFT JOIN product_variants v ON v.id = oi.variant_id
      WHERE o.estado != 'cancelado'
        AND o.creado_en > ?
        AND o.creado_en <= ?
      ORDER BY o.creado_en`
  )
    .bind(desde, hasta)
    .all();
  return results;
}

export async function marcarUltimaSincronizacion(env, marca) {
  await env.DB.prepare(`UPDATE settings SET valor = ? WHERE clave = 'ultima_sincronizacion'`)
    .bind(marca)
    .run();
}

export async function iniciarSincronizacionPOS(env) {
  const ultima = await obtenerUltimaSincronizacion(env);
  const filaAhora = await env.DB.prepare(`SELECT datetime('now') AS ahora`).first();
  const cutoff = filaAhora?.ahora || ultima;
  const ventasPendientesHastaCutoff = await ventasEnLineaEntre(env, ultima, cutoff);
  return {
    cutoff,
    ultima_sincronizacion: ultima,
    ventasPendientesHastaCutoff: ventasParaPOS(ventasPendientesHastaCutoff),
    resumen: {
      ventasPendientes: ventasPendientesHastaCutoff.length,
    },
  };
}

// Formato que consume el POS directo: renombra pedido_ref→pedido y
// creado_en→fecha respecto de lo que devuelve ventasEnLineaDesde.
export function ventasParaPOS(ventas) {
  return ventas.map((v) => ({
    codigo: v.codigo,
    nombre: v.nombre,
    talla: v.talla,
    color: v.color,
    cantidad: v.cantidad,
    precio_unit: v.precio_unit,
    estado: v.estado,
    pedido: v.pedido_ref,
    fecha: v.creado_en,
  }));
}

// Upsert de catálogo para la sync directa del POS:
// - Identidad por globalId (UUID estable del POS): si ya está vinculado en la
//   nube, se usa ese producto aunque el código haya cambiado (reasignación).
// - Si no existe código (ni globalId conocido): crea producto + variante.
// - Si existe código y falta variante: crea variante.
// - Si hay cruce fuerte de nombre: POS manda, se sobrescribe nube con aviso.
// Devuelve detalle por fila para diagnósticos y UX del POS.
export async function upsertCatalogoParaSync(env, filas) {
  const [{ results: productos }, { results: todasLasVariantes }] = await Promise.all([
    env.DB.prepare(
      `SELECT id, nombre, codigo, global_id, precio, activo
         FROM products
        WHERE (codigo IS NOT NULL AND codigo != '')
           OR (global_id IS NOT NULL AND global_id != '')`
    ).all(),
    env.DB.prepare('SELECT id, product_id, talla, color, stock FROM product_variants').all(),
  ]);
  const porCodigo = new Map(productos.filter((p) => p.codigo).map((p) => [p.codigo, p]));
  const porGlobalId = new Map(productos.filter((p) => p.global_id).map((p) => [p.global_id, p]));
  const variantesDe = new Map();
  for (const v of todasLasVariantes) {
    const lista = variantesDe.get(v.product_id);
    if (lista) lista.push(v);
    else variantesDe.set(v.product_id, [v]);
  }

  const vistos = new Map();
  const detalle = [];
  let creadas = 0;
  let creadasProductos = 0;
  let creadasVariantes = 0;

  // Las escrituras se acumulan y se aplican en UN solo env.DB.batch() al final:
  // una consulta por fila revienta el límite de CPU/subrequests del Worker
  // (error 1101/1102) con lotes de 250 filas.
  const nuevosProductos = [];   // {codigo, nombre, precio, globalId, talla, color, stock}
  const sentenciasUpdate = [];  // UPDATE products (nombre/precio/activo/codigo/global_id)
  const variantesNuevas = [];   // {productId, talla, color, stock}

  for (const f of filas) {
    const codigo = normalizarCodigo(f.codigo);
    const talla = String(f.talla ?? '').trim();
    const color = String(f.color ?? '').trim();
    const stock = Number(f.stock);
    const precio = Number(f.precio);
    const nombrePOS = String(f.nombre ?? '').trim();
    const globalId = String(f.globalId ?? '').trim();

    if (!codigo) {
      detalle.push({ codigo, nombre: nombrePOS, talla, color, aviso: 'Fila sin código: ignorada' });
      continue;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      detalle.push({ codigo, nombre: nombrePOS, talla, color, aviso: 'Stock inválido en el Excel' });
      continue;
    }
    if (vistos.has(codigo)) {
      detalle.push({
        codigo,
        nombre: nombrePOS,
        talla,
        color,
        duplicado: true,
        aviso: `Código duplicado en el POS: ya vino con "${vistos.get(codigo)}" — reparar códigos en el POS`,
      });
      continue;
    }
    vistos.set(codigo, nombrePOS);

    // Identidad estable: globalId gana sobre el código (que el POS reasigna al
    // reparar duplicados). Si el producto ya adoptó el globalId del POS, se
    // sigue por esa vía aunque el código haya cambiado.
    let producto = globalId ? porGlobalId.get(globalId) : null;
    const viaGlobalId = Boolean(producto);
    if (!producto) producto = porCodigo.get(codigo);

    if (producto && viaGlobalId && producto.codigo !== codigo) {
      // Código reasignado en el POS: se actualiza en la nube, salvo que el
      // nuevo código ya lo tenga otro producto (índice único).
      const otro = porCodigo.get(codigo);
      if (!otro || otro.id === producto.id) {
        sentenciasUpdate.push(
          env.DB.prepare('UPDATE products SET codigo = ? WHERE id = ?').bind(codigo, producto.id)
        );
        porCodigo.delete(producto.codigo);
        porCodigo.set(codigo, producto);
        producto.codigo = codigo;
      }
    } else if (producto && !viaGlobalId && globalId && producto.global_id !== globalId) {
      // Producto legado con global_id aleatorio del backfill (o NULL): adopta
      // el globalId real del POS para que las próximas syncs ya no dependan del
      // código. Si ese globalId ya está en OTRO producto, se omite (seguridad).
      if (!porGlobalId.has(globalId)) {
        sentenciasUpdate.push(
          env.DB.prepare('UPDATE products SET global_id = ? WHERE id = ?').bind(globalId, producto.id)
        );
        porGlobalId.set(globalId, producto);
        producto.global_id = globalId;
      }
    }

    if (!producto) {
      if (nombrePOS.length < 2) {
        detalle.push({
          codigo,
          nombre: nombrePOS,
          talla,
          color,
          aviso: 'No se pudo crear: nombre inválido en POS',
        });
        continue;
      }
      if (!Number.isFinite(precio) || precio < 0) {
        detalle.push({
          codigo,
          nombre: nombrePOS,
          talla,
          color,
          aviso: 'No se pudo crear: precio inválido en POS',
        });
        continue;
      }
      nuevosProductos.push({ codigo, nombre: nombrePOS, precio, globalId: globalId || null, talla, color, stock });
      detalle.push({
        codigo,
        nombre: nombrePOS,
        talla,
        color,
        accion: 'creado',
      });
      continue;
    }

    let corregidoPorPOS = false;
    const estabaInactivo = Number(producto.activo || 0) !== 1;
    const nombreNube = String(producto.nombre || '').trim();
    if (nombrePOS && nombrePOS !== nombreNube) {
      corregidoPorPOS = true;
    }
    const precioValido = Number.isFinite(precio) && precio >= 0;
    const nombreFinal = corregidoPorPOS ? nombrePOS : producto.nombre;
    const precioFinal = precioValido ? precio : producto.precio;
    sentenciasUpdate.push(
      env.DB.prepare('UPDATE products SET nombre = ?, precio = ?, activo = 1 WHERE id = ?').bind(nombreFinal, precioFinal, producto.id)
    );
    const reactivado = estabaInactivo;
    producto.nombre = nombreFinal;
    producto.precio = precioFinal;
    producto.activo = 1;

    const variantes = variantesDe.get(producto.id) || [];
    let variante = null;
    if (!talla && !color && variantes.length === 1) variante = variantes[0];
    else variante = variantes.find((v) => v.talla === talla && v.color === color);

    if (!variante) {
      variantesNuevas.push({ productId: producto.id, talla, color, stock });
      variantes.push({ id: null, product_id: producto.id, talla, color, stock });
      variantesDe.set(producto.id, variantes);
      creadas++;
      creadasVariantes++;
      detalle.push({
        codigo,
        nombre: producto.nombre,
        talla,
        color,
        cruce: corregidoPorPOS ? true : undefined,
        aviso: corregidoPorPOS
          ? 'Cruce de código corregido: sobrescrito por autoridad POS'
          : reactivado
            ? 'Producto reactivado por autoridad POS'
            : null,
        accion: corregidoPorPOS ? 'cruce_corregido' : reactivado ? 'reactivado' : 'creado',
        reactivado,
      });
    } else if (corregidoPorPOS) {
      detalle.push({
        codigo,
        nombre: producto.nombre,
        talla: variante.talla,
        color: variante.color,
        cruce: true,
        accion: 'cruce_corregido',
        aviso: 'Cruce de código corregido: sobrescrito por autoridad POS',
        reactivado,
      });
    } else if (reactivado) {
      detalle.push({
        codigo,
        nombre: producto.nombre,
        talla: variante.talla,
        color: variante.color,
        accion: 'reactivado',
        aviso: 'Producto reactivado por autoridad POS',
        reactivado: true,
      });
    } else {
      detalle.push({
        codigo,
        nombre: producto.nombre,
        talla: variante.talla,
        color: variante.color,
        accion: 'sobrescrito',
        aviso: null,
        reactivado: false,
      });
    }
  }

  // ── Fase de escritura (batched): un INSERT por producto nuevo (en un solo
  // batch) + un batch con los UPDATEs y las variantes. Así un lote de 250 filas
  // genera 2 round-trips a D1 en vez de ~500 (evita el 1101/1102 por CPU).
  if (nuevosProductos.length > 0) {
    const resultados = await env.DB.batch(
      nuevosProductos.map((n) =>
        env.DB.prepare(
          `INSERT INTO products (nombre, descripcion, precio, categoria_id, activo, codigo, global_id)
           VALUES (?, '', ?, NULL, 1, ?, ?)`
        ).bind(n.nombre, n.precio, n.codigo, n.globalId)
      )
    );
    for (let i = 0; i < nuevosProductos.length; i++) {
      const n = nuevosProductos[i];
      const productId = resultados[i].meta.last_row_id;
      variantesNuevas.push({ productId, talla: n.talla, color: n.color, stock: n.stock });
      creadas++;
      creadasProductos++;
    }
  }

  const sentencias = [
    ...sentenciasUpdate,
    ...variantesNuevas.map((v) =>
      env.DB.prepare(
        'INSERT INTO product_variants (product_id, talla, color, stock) VALUES (?, ?, ?, ?)'
      ).bind(v.productId, v.talla, v.color, v.stock)
    ),
  ];
  if (sentencias.length > 0) await env.DB.batch(sentencias);

  return { creadas, creadasProductos, creadasVariantes, detalle };
}

export async function reconciliarSyncPOS(env, { cutoff, filas }) {
  const filaAhora = await env.DB.prepare(`SELECT datetime('now') AS ahora`).first();
  const ahora = filaAhora?.ahora || cutoff;

  const upsert = await upsertCatalogoParaSync(env, filas);
  const { resultado } = await calcularSincronizacionDesde(env, filas, cutoff, ahora);
  const ventasPostCutoffRaw = await ventasEnLineaEntre(env, cutoff, ahora);
  return {
    ahora,
    upsert,
    resultado,
    ventasPostCutoff: ventasParaPOS(ventasPostCutoffRaw),
  };
}

// Valida el token machine-to-machine del POS (settings.sync_token, header
// "Authorization: Bearer <token>"). La sync directa vive fuera de /api/admin,
// así que no pasa por la sesión del admin: se autentica solo con este token.
// Devuelve null si es válido, o la Response de error ya armada (con CORS: el
// POS es una app local en otro origen y sin estos headers el navegador oculta
// hasta el mensaje de error).
export async function validarTokenSync(env, request) {
  const fila = await env.DB.prepare(`SELECT valor FROM settings WHERE clave = 'sync_token'`).first();
  const token = (fila?.valor || '').trim();
  if (!token)
    return jsonSync({ error: 'Sincronización directa no configurada' }, { status: 503 });

  const autorizacion = request.headers.get('authorization') || '';
  const recibido = autorizacion.replace(/^Bearer\s+/i, '').trim();
  if (recibido !== token) return jsonSync({ error: 'Token inválido' }, { status: 401 });

  return null;
}

// Cruza las filas del Excel contra la BD y calcula el stock nuevo de cada una.
// filas: [{ codigo, talla, color, stock }] — una por variante del sistema local.
export async function calcularSincronizacion(env, filas) {
  const desde = await obtenerUltimaSincronizacion(env);
  const filaAhora = await env.DB.prepare(`SELECT datetime('now') AS ahora`).first();
  const hasta = filaAhora?.ahora || desde;
  const { resultado } = await calcularSincronizacionDesde(env, filas, desde, hasta);
  return { desde, resultado };
}

export async function calcularSincronizacionDesde(env, filas, desde, hasta) {
  const ventas = await ventasPorVarianteEntre(env, desde, hasta);

  // Carga masiva: una consulta por fila revienta el límite de subrequests del
  // Worker (error 1101) con catálogos de 1700+ prendas. Se trae el catálogo
  // completo en 2 consultas y el cruce se hace en memoria (mismo patrón que la
  // búsqueda difusa de functions/api/productos.js).
  const [{ results: productos }, { results: todasLasVariantes }] = await Promise.all([
    env.DB.prepare(
      `SELECT id, nombre, codigo FROM products WHERE codigo IS NOT NULL AND codigo != ''`
    ).all(),
    env.DB.prepare('SELECT id, product_id, talla, color, stock FROM product_variants').all(),
  ]);
  const porCodigo = new Map(productos.map((p) => [p.codigo, p]));
  const variantesDe = new Map();
  for (const v of todasLasVariantes) {
    const lista = variantesDe.get(v.product_id);
    if (lista) lista.push(v);
    else variantesDe.set(v.product_id, [v]);
  }

  const resultado = [];

  // Códigos repetidos DENTRO del lote: el POS tiene dos prendas distintas con
  // el mismo shortCode. Solo se procesa la primera fila; las demás se marcan
  // como duplicadas para que el POS las repare (si no, la segunda fila pisa el
  // stock de la primera sobre la misma prenda web).
  const vistos = new Map(); // codigo → nombre de la primera fila

  // El POS manda el nombre real de la prenda: si difiere del que la tienda
  // tiene para ese código, el código está cruzado (p.ej. tras un borrado +
  // reimportación). NO se toca el stock y se reporta para revisión manual.
  for (const f of filas) {
    const codigo = normalizarCodigo(f.codigo);
    const talla = String(f.talla ?? '').trim();
    const color = String(f.color ?? '').trim();
    const stockExcel = Number(f.stock);
    const nombrePOS = String(f.nombre ?? '').trim();

    if (!codigo) {
      resultado.push({ codigo, talla, color, aviso: 'Fila sin código: ignorada' });
      continue;
    }
    if (!Number.isInteger(stockExcel) || stockExcel < 0) {
      resultado.push({ codigo, talla, color, aviso: 'Stock inválido en el Excel' });
      continue;
    }
    if (vistos.has(codigo)) {
      resultado.push({
        codigo,
        nombre: nombrePOS,
        talla,
        color,
        duplicado: true,
        aviso: `Código duplicado en el POS: ya vino con "${vistos.get(codigo)}" — reparar códigos en el POS`,
      });
      continue;
    }
    vistos.set(codigo, nombrePOS);

    const producto = porCodigo.get(codigo);
    if (!producto) {
      resultado.push({
        codigo,
        talla,
        color,
        aviso: 'Código no existe en la tienda virtual: sin cambios',
      });
      continue;
    }

    if (nubeDifiere(producto.nombre, nombrePOS)) {
      resultado.push({
        codigo,
        nombre: nombrePOS,
        talla,
        color,
        cruce: true,
        aviso: `Posible cruce de código: la tienda tiene "${producto.nombre}" pero el POS envía "${nombrePOS}" — revisar y borrar la prenda equivocada`,
      });
      continue;
    }

    const variantes = variantesDe.get(producto.id) || [];

    // Si el Excel no trae talla/color y la prenda tiene una sola variante, se usa esa.
    let variante = null;
    if (!talla && !color && variantes.length === 1) variante = variantes[0];
    else variante = variantes.find((v) => v.talla === talla && v.color === color);

    if (!variante) {
      resultado.push({
        codigo,
        nombre: producto.nombre,
        talla,
        color,
        aviso: 'Variante no encontrada (talla/color no coinciden): sin cambios',
      });
      continue;
    }

    const vendidas = ventas.get(variante.id) || 0;
    const stockNuevo = stockFinalConVentasPostCutoff(stockExcel, vendidas);
    resultado.push({
      codigo,
      nombre: producto.nombre,
      talla: variante.talla,
      color: variante.color,
      varianteId: variante.id,
      stockActual: variante.stock,
      stockExcel,
      vendidas,
      stockNuevo,
      aviso: stockExcel - vendidas < 0 ? 'Sobreventa: el stock quedó en 0, revisar a mano' : null,
    });
  }

  return { desde, hasta, resultado };
}
