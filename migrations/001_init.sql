-- Migración inicial — Tienda Virtual
-- Modelo según ARQUITECTURA.md, sección 4.

CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    orden INTEGER NOT NULL DEFAULT 0,
    activa INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    categoria_id INTEGER REFERENCES categories(id),
    nombre TEXT NOT NULL,
    descripcion TEXT NOT NULL DEFAULT '',
    precio REAL NOT NULL CHECK (precio >= 0),
    activo INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_products_categoria ON products(categoria_id);
CREATE INDEX idx_products_activo ON products(activo);

CREATE TABLE product_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    talla TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0)
);
CREATE INDEX idx_variants_product ON product_variants(product_id);

CREATE TABLE product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    r2_key TEXT NOT NULL,
    orden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_images_product ON product_images(product_id);

CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT NOT NULL UNIQUE,              -- código aleatorio largo; el cliente solo ve su pedido
    cliente_nombre TEXT NOT NULL,
    cliente_whatsapp TEXT NOT NULL,
    tipo_entrega TEXT NOT NULL CHECK (tipo_entrega IN ('local', 'nacional', 'recojo')),
    direccion TEXT NOT NULL DEFAULT '',
    ciudad TEXT NOT NULL DEFAULT '',
    total REAL NOT NULL CHECK (total >= 0),
    estado TEXT NOT NULL DEFAULT 'pendiente_pago'
        CHECK (estado IN ('pendiente_pago', 'comprobante_subido', 'confirmado', 'entregado', 'cancelado')),
    comprobante_r2_key TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_orders_estado ON orders(estado);

CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    variant_id INTEGER REFERENCES product_variants(id),
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    precio_unit REAL NOT NULL CHECK (precio_unit >= 0)   -- precio verificado en servidor
);
CREATE INDEX idx_items_order ON order_items(order_id);

CREATE TABLE admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
);

CREATE TABLE settings (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL DEFAULT ''
);

-- Valores iniciales de configuración
INSERT INTO settings (clave, valor) VALUES
    ('qr_cobro_r2_key', ''),        -- imagen del QR de cobro (se sube desde /admin)
    ('whatsapp_tienda', ''),
    ('costo_envio_local', '0'),
    ('costo_envio_nacional', '0'),
    ('nombre_tienda', 'Tienda Virtual');
