// Lógica de la sincronización de stock con el sistema local (offline).
// Diseño aprobado en PROPUESTA_SINCRONIZACION.md:
//   stock nuevo en nube = stock del Excel (tras ventas locales)
//                       − ventas en línea desde la última sincronización
// "Ventas en línea" = ítems de pedidos NO cancelados creados después de la
// última sync. pendiente_pago cuenta: su stock está reservado (si expira,
// vuelve solo por functions/lib/expirar.js).

export async function obtenerUltimaSincronizacion(env) {
  const fila = await env.DB.prepare(
    `SELECT valor FROM settings WHERE clave = 'ultima_sincronizacion'`
  ).first();
  return fila?.valor || '1970-01-01 00:00:00';
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

// Cruza las filas del Excel contra la BD y calcula el stock nuevo de cada una.
// filas: [{ codigo, talla, color, stock }] — una por variante del sistema local.
export async function calcularSincronizacion(env, filas) {
  const desde = await obtenerUltimaSincronizacion(env);
  const ventas = await ventasPorVariante(env, desde);
  const resultado = [];

  for (const f of filas) {
    const codigo = String(f.codigo ?? '').trim();
    const talla = String(f.talla ?? '').trim();
    const color = String(f.color ?? '').trim();
    const stockExcel = Number(f.stock);

    if (!codigo) {
      resultado.push({ codigo, talla, color, aviso: 'Fila sin código: ignorada' });
      continue;
    }
    if (!Number.isInteger(stockExcel) || stockExcel < 0) {
      resultado.push({ codigo, talla, color, aviso: 'Stock inválido en el Excel' });
      continue;
    }

    const producto = await env.DB.prepare('SELECT id, nombre FROM products WHERE codigo = ?')
      .bind(codigo)
      .first();
    if (!producto) {
      resultado.push({
        codigo,
        talla,
        color,
        aviso: 'Código no existe en la tienda virtual: sin cambios',
      });
      continue;
    }

    const { results: variantes } = await env.DB.prepare(
      'SELECT id, talla, color, stock FROM product_variants WHERE product_id = ?'
    )
      .bind(producto.id)
      .all();

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
    const stockNuevo = Math.max(0, stockExcel - vendidas);
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

  return { desde, resultado };
}
