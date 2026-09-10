-- Migración 006 — Sincronización por eventos con el POS (protocolo v2).
-- Ver tienda de ropas/docs/DISENO_SYNC_EVENTOS.md.
--
-- Cada movimiento de stock originado en la web (venta, cancelación, expiración)
-- queda como un evento con id creciente. El POS los baja en orden, los aplica y
-- confirma (ack) hasta qué id llegó. El stock que publica la nube en un snapshot
-- es: stock_pos + suma de deltas de los eventos que el POS aún no confirmó.
-- No hay ventanas por fecha ni "cutoff": cualquier corte se resuelve repitiendo.

CREATE TABLE stock_eventos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo            TEXT NOT NULL CHECK (tipo IN ('venta', 'cancelacion', 'expiracion')),
    order_id        INTEGER NOT NULL,
    order_item_id   INTEGER NOT NULL,
    product_id      INTEGER,                    -- sin FK: el evento sobrevive si la prenda se borra
    variant_id      INTEGER,
    global_id       TEXT NOT NULL DEFAULT '',   -- identidad estable del POS
    codigo          TEXT NOT NULL DEFAULT '',
    nombre          TEXT NOT NULL DEFAULT '',
    talla           TEXT NOT NULL DEFAULT '',
    color           TEXT NOT NULL DEFAULT '',
    delta           INTEGER NOT NULL,           -- venta: -cantidad · cancelación/expiración: +cantidad
    precio_unit     REAL NOT NULL DEFAULT 0,
    pedido_ref      TEXT NOT NULL DEFAULT '',   -- substr(orders.codigo, 1, 8) en mayúsculas
    creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
    aplicado_pos_en TEXT                        -- NULL hasta que el POS confirme (ack)
);
CREATE INDEX idx_stock_eventos_variant ON stock_eventos(variant_id, id);
-- Un mismo ítem no puede generar dos eventos del mismo tipo (doble cancelación
-- imposible aunque falle la guarda de estado del pedido).
CREATE UNIQUE INDEX idx_stock_eventos_unico ON stock_eventos(order_item_id, tipo);

-- Un registro por dispositivo POS que sincroniza (hoy: la máquina central).
CREATE TABLE sync_dispositivos (
    id                 TEXT PRIMARY KEY,        -- uuid generado por el POS (settings.syncV2.dispositivoId)
    nombre             TEXT NOT NULL DEFAULT '',
    ultimo_evento_ack  INTEGER NOT NULL DEFAULT 0,
    sesion_snapshot    TEXT,                    -- sesión de snapshot en curso / última
    ultimo_snapshot_en TEXT,
    ultima_actividad   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Marca "visto en el snapshot X" para desactivar ausentes al finalizar la sesión
-- (reemplaza al botón "Vaciar nube" del admin).
ALTER TABLE products ADD COLUMN sesion_snapshot TEXT;
CREATE INDEX idx_products_sesion_snapshot ON products(sesion_snapshot);
