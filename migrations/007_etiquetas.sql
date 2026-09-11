-- Migración 007 — Etiquetas físicas como códigos adicionales de búsqueda.
--
-- Problema: el POS imprime en cada prenda el shortCode de la UNIDAD
-- (barcodes.shortCode), distinto del shortCode del producto (products.codigo en
-- la nube). El cliente busca en la web el número de su etiqueta y la nube solo
-- conocía el código de modelo → encontraba otra prenda (02797) o ninguna.
--
-- Solución: el POS publica, dentro de la misma sesión de snapshot v2, la lista
-- (etiqueta → globalId, disponible). La nube la persiste SEPARADA de
-- products.codigo y los buscadores resuelven primero la etiqueta exacta.
-- La identidad sigue siendo global_id; la etiqueta es solo un alias de búsqueda.
-- `disponible` es informativo (estado de la unidad en el POS al último
-- snapshot): NO participa del stock, que sigue siendo snapshot + eventos.

-- Asociaciones PUBLICADAS. La PK admite la misma etiqueta en varios productos
-- a propósito: si el POS tiene una etiqueta duplicada, la nube la guarda tal
-- cual y los buscadores muestran el conflicto en vez de elegir una en silencio.
CREATE TABLE product_etiquetas (
    etiqueta       TEXT    NOT NULL,                 -- 5 dígitos con ceros (normalizarEtiqueta)
    product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    global_id      TEXT    NOT NULL,                 -- identidad del POS (diagnóstico)
    disponible     INTEGER NOT NULL DEFAULT 1,       -- 1 = unidad sin vender según el POS
    actualizado_en TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (etiqueta, product_id)
);
CREATE INDEX idx_product_etiquetas_product ON product_etiquetas(product_id);

-- Zona de aterrizaje por sesión. Los lotes de /api/sync/v2/etiquetas escriben
-- aquí (idempotentes por PK); /api/sync/v2/finalizar valida que llegó la lista
-- completa y publica en UN batch (borra ausentes, inserta/actualiza presentes).
-- Un corte a mitad deja filas huérfanas aquí y NO toca lo publicado.
CREATE TABLE sync_etiquetas_pendientes (
    sesion     TEXT    NOT NULL,
    etiqueta   TEXT    NOT NULL,
    global_id  TEXT    NOT NULL,
    disponible INTEGER NOT NULL DEFAULT 1,
    creado_en  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (sesion, etiqueta, global_id)
);
CREATE INDEX idx_sync_etiquetas_pendientes_creado ON sync_etiquetas_pendientes(creado_en);
