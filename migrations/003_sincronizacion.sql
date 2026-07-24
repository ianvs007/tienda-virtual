-- Migración 003 — Sincronización de stock con el sistema local (offline).
-- products.codigo guarda el código corto del sistema local: es la llave de cruce
-- para el importador de Excel de /admin/sincronizar (ver PROPUESTA_SINCRONIZACION.md).

ALTER TABLE products ADD COLUMN codigo TEXT;
CREATE UNIQUE INDEX idx_products_codigo
    ON products(codigo) WHERE codigo IS NOT NULL AND codigo != '';

INSERT INTO settings (clave, valor) VALUES ('ultima_sincronizacion', '1970-01-01 00:00:00');
