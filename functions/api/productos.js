// GET /api/productos           — lista prendas activas con su primera foto.
// GET /api/productos?categoria=3 — filtradas por categoría.
// GET /api/productos?q=vestido   — búsqueda: etiqueta física exacta → código de
//                                  modelo exacto → texto tolerante a tildes y
//                                  errores de escritura (lib/busqueda.js).
//                                  Cada resultado puede traer `coincidencia`
//                                  ({ tipo: 'etiqueta'|'etiqueta_conflicto'|'codigo', ... }).
//
// Caché de borde (Cache API): cada respuesta del catálogo lee ~8.000 filas de
// D1 (todas las prendas activas + subconsultas de foto y stock). Con la cuota
// gratuita de D1 (5 M filas leídas/día) eso alcanza para ~600 vistas diarias,
// así que la respuesta se guarda `SEGUNDOS_CACHE` en el centro de datos de
// Cloudflare: las visitas repetidas en ese lapso no tocan D1. El stock mostrado
// puede atrasarse hasta ese tiempo; el checkout siempre valida contra D1.
import { adminDesdeRequest } from '../lib/auth.js';
import { normalizarCodigo } from '../lib/codigo.js';
import { sentenciaLogStock } from '../lib/stockLog.js';
import { buscarEnCatalogo } from '../lib/busqueda.js';
import { buscarPorEtiqueta } from '../lib/etiquetas.js';

export const SEGUNDOS_CACHE = 60;

/** Clave de caché: solo método + URL (sin cookies ni cabeceras del visitante). */
export function claveCacheCatalogo(request) {
  return new Request(new URL(request.url).toString(), { method: 'GET' });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const categoria = url.searchParams.get('categoria');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const claveCache = cache ? claveCacheCatalogo(request) : null;
  if (cache) {
    const guardada = await cache.match(claveCache);
    if (guardada) return guardada;
  }

  let sql = `SELECT p.id, p.nombre, p.descripcion, p.precio, p.categoria_id, p.codigo,
                    (SELECT r2_key FROM product_images i
                      WHERE i.product_id = p.id ORDER BY i.orden LIMIT 1) AS imagen,
                    (SELECT COALESCE(SUM(v.stock), 0) FROM product_variants v
                      WHERE v.product_id = p.id) AS stock_total
               FROM products p
              WHERE p.activo = 1`;
  const params = [];

  if (categoria) {
    sql += ' AND p.categoria_id = ?';
    params.push(categoria);
  }
  sql += ' ORDER BY p.creado_en DESC';

  let { results } = await env.DB.prepare(sql)
    .bind(...params)
    .all();

  if (q) {
    // Etiqueta física primero. Se consulta con inactivos incluidos para que una
    // etiqueta cuya prenda ya no está en venta NO caiga al código de modelo (que
    // sería otra prenda); `buscarEnCatalogo` solo devuelve los que están en la
    // lista de activos. Luego código de modelo y texto, filtrando en memoria
    // (el catálogo de la tienda es pequeño).
    const etiqueta = await buscarPorEtiqueta(env, q, { soloActivos: false });
    results = buscarEnCatalogo({ q, productos: results, etiqueta }).resultados;
  }
  const respuesta = Response.json(results, {
    headers: { 'Cache-Control': `public, max-age=0, s-maxage=${SEGUNDOS_CACHE}` },
  });
  if (cache) {
    const guardar = cache.put(claveCache, respuesta.clone());
    if (typeof context.waitUntil === 'function') context.waitUntil(guardar);
    else await guardar;
  }
  return respuesta;
}

// POST /api/productos — alta de prenda (requiere admin por cookie o Bearer).
export async function onRequestPost({ env, request }) {
  const adminEmail = await adminDesdeRequest(request, env);
  if (!adminEmail) return Response.json({ error: 'No autorizado' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400 });
  }

  const nombre = String(body.nombre || '').trim();
  const precio = Number(body.precio);
  const descripcion = String(body.descripcion || '').trim();
  const categoriaId = body.categoria_id ? Number(body.categoria_id) : null;
  const codigo = normalizarCodigo(body.codigo);

  if (!nombre || !Number.isFinite(precio) || precio < 0) {
    return Response.json({ error: 'nombre y precio son obligatorios' }, { status: 400 });
  }
  if (codigo.length > 50) {
    return Response.json({ error: 'código demasiado largo' }, { status: 400 });
  }
  if (categoriaId !== null && (!Number.isInteger(categoriaId) || categoriaId <= 0)) {
    return Response.json({ error: 'categoria_id inválida' }, { status: 400 });
  }

  const variantesEntrada = Array.isArray(body.variantes) ? body.variantes : [];
  let variantes = variantesEntrada
    .map((v) => ({
      talla: String(v.talla || '').trim(),
      color: String(v.color || '').trim(),
      stock: Number(v.stock),
    }))
    .filter((v) => Number.isInteger(v.stock) && v.stock >= 0);

  if (variantes.length === 0) {
    const stock = Number(body.stock ?? 0);
    if (!Number.isInteger(stock) || stock < 0) {
      return Response.json({ error: 'stock inválido' }, { status: 400 });
    }
    variantes = [{ talla: '', color: '', stock }];
  }

  let r;
  try {
    r = await env.DB.prepare(
      'INSERT INTO products (nombre, descripcion, precio, categoria_id, codigo) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(nombre, descripcion, precio, categoriaId, codigo || null)
      .run();
  } catch {
    return Response.json({ error: 'Ese código ya está en uso en otra prenda' }, { status: 409 });
  }

  const id = r.meta.last_row_id;
  await env.DB.batch(
    variantes.map((v) =>
      env.DB.prepare(
        'INSERT INTO product_variants (product_id, talla, color, stock) VALUES (?, ?, ?, ?)'
      ).bind(id, v.talla, v.color, v.stock)
    )
  );

  // Auditoría: stock inicial de cada variante.
  await env.DB.batch(
    variantes.map((v) =>
      sentenciaLogStock(env, {
        productId: id,
        codigo,
        nombre,
        talla: v.talla,
        color: v.color,
        nuevo: v.stock,
        origen: 'creacion',
      })
    )
  );

  return Response.json({ ok: true, id }, { status: 201 });
}
