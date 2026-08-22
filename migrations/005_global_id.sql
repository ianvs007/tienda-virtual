-- Migración 005 — Identificador global (UUID) para sincronización con el POS.
-- Cada producto recibe un UUID único que se mantiene igual en ambos sistemas
-- (tienda offline y tienda virtual). Se usa como identificador principal en la
-- sincronización directa (functions/api/sync.js) y en la importación de catálogo.

ALTER TABLE products ADD COLUMN global_id TEXT;

-- Asignar un UUID a los productos existentes que no lo tengan.
-- SQLite no tiene función UUID nativa, así que se genera un valor aleatorio
-- con hex(randomblob(16)) y se formatea como UUID v4.
UPDATE products
SET global_id = (
    lower(
        hex(randomblob(4)) || '-' ||
        hex(randomblob(2)) || '-' ||
        '4' || substr(hex(randomblob(2)), 2) || '-' ||
        substr('89ab', abs(random()) % 4 + 1, 1) ||
        substr(hex(randomblob(2)), 2) || '-' ||
        hex(randomblob(6))
    )
)
WHERE global_id IS NULL OR global_id = '';

-- Índice único para búsqueda rápida por global_id.
CREATE UNIQUE INDEX idx_products_global_id
    ON products(global_id) WHERE global_id IS NOT NULL AND global_id != '';
