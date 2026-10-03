-- Migración 008 — Eventos de historial para el POS (confirmacion / entrega).
-- Amplía stock_eventos.tipo: además de venta/cancelacion/expiracion (mueven stock),
-- confirmacion y entrega tienen delta = 0 y solo informan al historial de ventas
-- del POS (Venta en línea · Pendiente de entrega → Entregado), sin tocar caja.
-- SQLite no permite ALTER del CHECK: se recrea la tabla conservando filas e ids.

CREATE TABLE stock_eventos_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo            TEXT NOT NULL CHECK (tipo IN (
                        'venta', 'cancelacion', 'expiracion', 'confirmacion', 'entrega'
                    )),
    order_id        INTEGER NOT NULL,
    order_item_id   INTEGER NOT NULL,
    product_id      INTEGER,
    variant_id      INTEGER,
    global_id       TEXT NOT NULL DEFAULT '',
    codigo          TEXT NOT NULL DEFAULT '',
    nombre          TEXT NOT NULL DEFAULT '',
    talla           TEXT NOT NULL DEFAULT '',
    color           TEXT NOT NULL DEFAULT '',
    delta           INTEGER NOT NULL,
    precio_unit     REAL NOT NULL DEFAULT 0,
    pedido_ref      TEXT NOT NULL DEFAULT '',
    creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
    aplicado_pos_en TEXT
);

INSERT INTO stock_eventos_new (
    id, tipo, order_id, order_item_id, product_id, variant_id, global_id, codigo,
    nombre, talla, color, delta, precio_unit, pedido_ref, creado_en, aplicado_pos_en
)
SELECT
    id, tipo, order_id, order_item_id, product_id, variant_id, global_id, codigo,
    nombre, talla, color, delta, precio_unit, pedido_ref, creado_en, aplicado_pos_en
  FROM stock_eventos;

DROP TABLE stock_eventos;
ALTER TABLE stock_eventos_new RENAME TO stock_eventos;

CREATE INDEX idx_stock_eventos_variant ON stock_eventos(variant_id, id);
CREATE UNIQUE INDEX idx_stock_eventos_unico ON stock_eventos(order_item_id, tipo);
