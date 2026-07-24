-- Migración 002 — Mejoras del procedimiento de pago
-- 1) Clave de idempotencia: evita pedidos duplicados cuando el cliente reintenta
--    el checkout tras un error de red (el navegador reenvía la misma clave y el
--    servidor devuelve el pedido ya creado en vez de crear otro).
-- 2) rate_log: registro simple para limitar pedidos/comprobantes basura por IP.

ALTER TABLE orders ADD COLUMN idempotencia TEXT;
CREATE UNIQUE INDEX idx_orders_idempotencia
    ON orders(idempotencia) WHERE idempotencia IS NOT NULL;

CREATE TABLE rate_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    accion TEXT NOT NULL,           -- 'pedido' | 'comprobante'
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_rate_log ON rate_log(ip, accion, creado_en);
