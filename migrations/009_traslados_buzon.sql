-- Migración 009: Buzón seguro de traslados entre sucursales y tienda central.
-- Permite que sucursales remotas envíen paquetes de mercadería (`en_transito`)
-- y la tienda destino los consulte y confirme su recepción física (`recibido`)
-- sin exponer puertos locales ni depender de que la PC central esté encendida.

CREATE TABLE IF NOT EXISTS traslados_buzon (
  transfer_uid TEXT PRIMARY KEY,
  origin_branch TEXT NOT NULL,
  destination_branch TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'en_transito',
  notes TEXT NOT NULL DEFAULT '',
  sent_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_by TEXT,
  received_at TEXT,
  received_branch TEXT
);

CREATE INDEX IF NOT EXISTS idx_traslados_buzon_destino_estado
  ON traslados_buzon (destination_branch, status, created_at DESC);
