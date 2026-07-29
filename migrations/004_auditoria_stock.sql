-- Migración 004 — Auditoría de cambios de stock.
-- Cada alta, edición, venta, cancelación, expiración, sincronización o
-- importación que altere el stock deja una fila aquí (qué cambió, cuánto
-- había antes, cuánto quedó y desde dónde se hizo el cambio).

CREATE TABLE stock_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,               -- sin FK: la fila sobrevive si la prenda se borra
    variant_id INTEGER,
    codigo TEXT NOT NULL DEFAULT '',  -- código del sistema local (POS)
    nombre TEXT NOT NULL DEFAULT '',  -- copia del nombre por si la prenda se borra
    variante TEXT NOT NULL DEFAULT '',-- "M · NEGRO"
    stock_anterior INTEGER,           -- NULL = stock inicial (alta de prenda/variante)
    stock_nuevo INTEGER NOT NULL,
    origen TEXT NOT NULL,             -- creacion | edicion | venta | cancelacion | expiracion | sincronizacion | importacion
    detalle TEXT NOT NULL DEFAULT '', -- p.ej. código del pedido
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_stock_log_fecha ON stock_log(creado_en);
CREATE INDEX idx_stock_log_producto ON stock_log(product_id);
