// Importación inicial de catálogo desde el Excel del sistema local (offline).
// Crea UNA prenda por fila con UNA variante (talla/color). Fotos, descripción
// y categoría quedan vacías para editarlas después a mano desde Prendas.
// Los códigos que ya existen en la tienda se OMITEN sin tocar nada: el dueño
// los ajusta a mano después (diseño aprobado).
import { normalizarCodigo } from './codigo.js';
import { sentenciaLogStock } from './stockLog.js';

// Cruza las filas del Excel contra la BD y decide qué hacer con cada una.
// filas: [{ globalId, codigo, nombre, talla, color, stock, precio }]
// Devuelve detalle por fila: { accion: 'crear' | 'omitir', codigo, nombre,
// talla, color, stock, precio, aviso }.
export async function calcularImportacionCatalogo(env, filas) {
  const { results: existentes } = await env.DB.prepare(
    `SELECT codigo, global_id FROM products
      WHERE (codigo IS NOT NULL AND codigo != '')
         OR (global_id IS NOT NULL AND global_id != '')`
  ).all();
  const enTienda = new Set(existentes.map((r) => r.codigo).filter(Boolean));
  const enTiendaGlobalId = new Set(existentes.map((r) => r.global_id).filter(Boolean));
  const enArchivo = new Set(); // códigos ya aceptados de ESTE archivo
  const detalle = [];

  for (const f of filas) {
    const codigo = normalizarCodigo(f.codigo);
    const globalId = String(f.globalId ?? '').trim();
    const nombre = String(f.nombre ?? '').trim();
    const talla = String(f.talla ?? '').trim();
    const color = String(f.color ?? '').trim();
    const stock = Number(f.stock);
    const precio = Number(f.precio);

    const omitir = (aviso) =>
      detalle.push({ accion: 'omitir', codigo, globalId, nombre, talla, color, stock, precio, aviso });

    if (!codigo) {
      omitir('Fila sin código: ignorada');
      continue;
    }
    if (nombre.length < 2) {
      omitir('Nombre inválido: ignorada');
      continue;
    }
    if (!Number.isFinite(precio) || precio < 0) {
      omitir('Precio inválido: ignorada');
      continue;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      omitir('Stock inválido: ignorada');
      continue;
    }
    // globalId ya vinculado en la nube: es la MISMA prenda aunque el POS le
    // haya reasignado el código (reparación de duplicados). No se recrea.
    if (globalId && enTiendaGlobalId.has(globalId)) {
      omitir('Código ya existe en la tienda: sin cambios');
      continue;
    }
    if (enTienda.has(codigo)) {
      omitir('Código ya existe en la tienda: sin cambios');
      continue;
    }
    if (enArchivo.has(codigo)) {
      omitir('Código repetido en el archivo');
      continue;
    }

    enArchivo.add(codigo);
    detalle.push({ accion: 'crear', codigo, globalId, nombre, talla, color, stock, precio, aviso: null });
  }

  return detalle;
}

// Aplica la importación: RECALCULA en este instante (no confía en la vista
// previa) y crea las prendas. Las altas van en UN batch de INSERT OR IGNORE
// (una consulta por fila revienta el límite de subrequests del Worker con
// catálogos grandes, error 1101). meta.changes de cada sentencia dice si
// insertó de verdad: 0 = el código apareció por una carrera entre la vista
// previa y ahora → se omite sin tocar nada (mismo criterio que antes, cuando
// se insertaba una a una para leer meta.last_row_id; ahora los ids se
// recuperan con un SELECT posterior).
export async function aplicarImportacionCatalogo(env, filas) {
  const detalle = await calcularImportacionCatalogo(env, filas);
  const crear = detalle.filter((r) => r.accion === 'crear');
  if (crear.length === 0) return { creadas: 0, omitidas: detalle.length, detalle };

  const resultados = await env.DB.batch(
    crear.map((r) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO products (nombre, descripcion, precio, categoria_id, activo, codigo, global_id)
         VALUES (?, '', ?, NULL, 1, ?, ?)`
      ).bind(r.nombre, r.precio, r.codigo, r.globalId || null)
    )
  );

  const insertadas = [];
  for (let i = 0; i < crear.length; i++) {
    if (resultados[i].meta.changes > 0) {
      insertadas.push(crear[i]);
    } else {
      // Carrera: el código se creó entre la vista previa y ahora → se omite
      crear[i].accion = 'omitir';
      crear[i].aviso = 'Código ya existe en la tienda: sin cambios';
    }
  }

  if (insertadas.length > 0) {
    // Ids de las prendas recién creadas (D1 limita los parámetros por
    // consulta: se consulta en trozos de 90).
    const idPorCodigo = new Map();
    for (let i = 0; i < insertadas.length; i += 90) {
      const trozo = insertadas.slice(i, i + 90);
      const { results } = await env.DB.prepare(
        `SELECT id, codigo FROM products WHERE codigo IN (${trozo.map(() => '?').join(', ')})`
      )
        .bind(...trozo.map((r) => r.codigo))
        .all();
      for (const r of results) idPorCodigo.set(r.codigo, r.id);
    }

    const sentencias = [];
    for (const r of insertadas) {
      const productId = idPorCodigo.get(r.codigo);
      sentencias.push(
        env.DB.prepare(
          'INSERT INTO product_variants (product_id, talla, color, stock) VALUES (?, ?, ?, ?)'
        ).bind(productId, r.talla, r.color, r.stock)
      );
      // Auditoría: stock inicial traído del Excel del POS.
      sentencias.push(
        sentenciaLogStock(env, {
          productId,
          codigo: r.codigo,
          nombre: r.nombre,
          talla: r.talla,
          color: r.color,
          nuevo: r.stock,
          origen: 'importacion',
        })
      );
    }
    await env.DB.batch(sentencias);
  }

  return { creadas: insertadas.length, omitidas: detalle.length - insertadas.length, detalle };
}
