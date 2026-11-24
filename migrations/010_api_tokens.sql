-- Migración 010 — Tokens de máquina con alcance y sucursal (hardening de seguridad).
--
-- Hasta ahora TODA integración máquina-a-máquina (sync de stock del POS y buzón
-- de traslados) usaba un único token compartido en settings.sync_token, comparado
-- tal cual y sin noción de sucursal. Esta tabla permite emitir tokens separados:
--   - alcance: lista separada por comas con 'sync' y/o 'traslados';
--   - sucursal: obligatoria si el alcance incluye 'traslados'. Con ese token solo
--     se puede ENVIAR desde esa sucursal, LISTAR lo dirigido a ella y CONFIRMAR lo
--     que tiene como destino a ella (el servidor ya no confía en lo que diga el cliente).
-- Solo se guarda el SHA-256 del token (se muestra completo una única vez al crearlo).
--
-- Es ADITIVA: no toca tablas existentes. El código nuevo funciona aunque esta
-- migración aún no esté aplicada (sigue aceptando settings.sync_token, el modo
-- heredado); los endpoints de gestión responden 503 'migracion_pendiente'.
-- Aplicar a mano: wrangler d1 migrations apply tienda-virtual-db --remote

CREATE TABLE IF NOT EXISTS api_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      TEXT NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,
    alcance     TEXT NOT NULL,
    sucursal    TEXT,
    activo      INTEGER NOT NULL DEFAULT 1,
    creado_en   TEXT NOT NULL DEFAULT (datetime('now')),
    ultimo_uso  TEXT,
    revocado_en TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_activo ON api_tokens(activo);
