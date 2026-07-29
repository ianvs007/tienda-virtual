// Auditoría de stock (migración 004): cada cambio de stock deja una fila en
// stock_log. `sentenciaLogStock` devuelve la sentencia preparada SIN ejecutar,
// para meterla en el mismo batch del cambio: así el log y el cambio se aplican
// juntos o no se aplican (no queda stock movido sin registro).
//
// origen: creacion | edicion | venta | cancelacion | expiracion |
//         sincronizacion | importacion
// anterior: null cuando es el stock inicial (alta de prenda/variante).
export function sentenciaLogStock(
  env,
  {
    productId = null,
    variantId = null,
    codigo = '',
    nombre = '',
    talla = '',
    color = '',
    anterior = null,
    nuevo,
    origen,
    detalle = '',
  }
) {
  return env.DB.prepare(
    `INSERT INTO stock_log
       (product_id, variant_id, codigo, nombre, variante, stock_anterior, stock_nuevo, origen, detalle)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    productId,
    variantId,
    codigo,
    nombre,
    [talla, color].filter(Boolean).join(' · '),
    anterior,
    nuevo,
    origen,
    detalle
  );
}
