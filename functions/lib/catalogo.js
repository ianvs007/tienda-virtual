// Importación inicial de catálogo desde el Excel del sistema local (offline).
// Crea UNA prenda por fila con UNA variante (talla/color). Fotos, descripción
// y categoría quedan vacías para editarlas después a mano desde Prendas.
// Los códigos que ya existen en la tienda se OMITEN sin tocar nada: el dueño
// los ajusta a mano después (diseño aprobado).
import { normalizarCodigo } from './codigo.js';

// Cruza las filas del Excel contra la BD y decide qué hacer con cada una.
// filas: [{ codigo, nombre, talla, color, stock, precio }]
// Devuelve detalle por fila: { accion: 'crear' | 'omitir', codigo, nombre,
// talla, color, stock, precio, aviso }.
export async function calcularImportacionCatalogo(env, filas) {
  const { results: existentes } = await env.DB.prepare(
    `SELECT codigo FROM products WHERE codigo IS NOT NULL AND codigo != ''`
  ).all();
  const enTienda = new Set(existentes.map((r) => r.codigo));
  const enArchivo = new Set(); // códigos ya aceptados de ESTE archivo
  const detalle = [];

  for (const f of filas) {
    const codigo = normalizarCodigo(f.codigo);
    const nombre = String(f.nombre ?? '').trim();
    const talla = String(f.talla ?? '').trim();
    const color = String(f.color ?? '').trim();
    const stock = Number(f.stock);
    const precio = Number(f.precio);

    const omitir = (aviso) =>
      detalle.push({ accion: 'omitir', codigo, nombre, talla, color, stock, precio, aviso });

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
    if (enTienda.has(codigo)) {
      omitir('Código ya existe en la tienda: sin cambios');
      continue;
    }
    if (enArchivo.has(codigo)) {
      omitir('Código repetido en el archivo');
      continue;
    }

    enArchivo.add(codigo);
    detalle.push({ accion: 'crear', codigo, nombre, talla, color, stock, precio, aviso: null });
  }

  return detalle;
}

// Aplica la importación: RECALCULA en este instante (no confía en la vista
// previa) y crea las prendas. Los productos se insertan uno a uno con .run()
// para conocer su id (meta.last_row_id) y enlazar la variante — dentro de un
// batch no se pueden leer los ids insertados (mismo patrón que
// functions/api/admin/productos.js POST).
export async function aplicarImportacionCatalogo(env, filas) {
  const detalle = await calcularImportacionCatalogo(env, filas);
  const variantes = [];
  let creadas = 0;

  for (const r of detalle) {
    if (r.accion !== 'crear') continue;
    let ins;
    try {
      ins = await env.DB.prepare(
        `INSERT INTO products (nombre, descripcion, precio, categoria_id, activo, codigo)
         VALUES (?, '', ?, NULL, 1, ?)`
      )
        .bind(r.nombre, r.precio, r.codigo)
        .run();
    } catch {
      // Carrera: el código se creó entre la vista previa y ahora → se omite
      r.accion = 'omitir';
      r.aviso = 'Código ya existe en la tienda: sin cambios';
      continue;
    }
    creadas++;
    variantes.push(
      env.DB.prepare(
        'INSERT INTO product_variants (product_id, talla, color, stock) VALUES (?, ?, ?, ?)'
      ).bind(ins.meta.last_row_id, r.talla, r.color, r.stock)
    );
  }

  if (variantes.length > 0) await env.DB.batch(variantes);

  return { creadas, omitidas: detalle.length - creadas, detalle };
}
