// Lógica de la sincronización de stock con el sistema local (offline).
// Diseño aprobado en PROPUESTA_SINCRONIZACION.md:
//   stock nuevo en nube = stock del Excel (tras ventas locales)
//                       − ventas en línea desde la última sincronización
// "Ventas en línea" = ítems de pedidos NO cancelados creados después de la
// última sync. pendiente_pago cuenta: su stock está reservado (si expira,
// vuelve solo por functions/lib/expirar.js).
import { normalizarCodigo } from './codigo.js';

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

// Valida el token machine-to-machine del POS (settings.sync_token, header
// "Authorization: Bearer <token>"). La sync directa vive fuera de /api/admin,
// así que no pasa por la sesión del admin: se autentica solo con este token.
// Devuelve null si es válido, o la Response de error ya armada.
export async function validarTokenSync(env, request) {
  const fila = await env.DB.prepare(`SELECT valor FROM settings WHERE clave = 'sync_token'`).first();
  const token = (fila?.valor || '').trim();
  if (!token)
    return Response.json({ error: 'Sincronización directa no configurada' }, { status: 503 });

  const autorizacion = request.headers.get('authorization') || '';
  const recibido = autorizacion.replace(/^Bearer\s+/i, '').trim();
  if (recibido !== token) return Response.json({ error: 'Token inválido' }, { status: 401 });

  return null;
}

// Cruza las filas del Excel contra la BD y calcula el stock nuevo de cada una.
// filas: [{ codigo, talla, color, stock }] — una por variante del sistema local.
export async function calcularSincronizacion(env, filas) {
  const desde = await obtenerUltimaSincronizacion(env);
  const ventas = await ventasPorVariante(env, desde);

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

  for (const f of filas) {
    const codigo = normalizarCodigo(f.codigo);
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
