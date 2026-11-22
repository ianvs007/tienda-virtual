-- Migración 010 — Índice por fecha en rate_log para el DELETE de mantenimiento.
-- Hoy la tabla suele estar vacía; es prevención. NO aplicar desde el PR:
-- aplicar a mano en D1 después de revisar.
CREATE INDEX IF NOT EXISTS idx_rate_log_creado_en ON rate_log(creado_en);
