# Tienda Virtual — "Tienda de Ropas" — Arquitectura y Cimientos

**Fecha:** 2026-07-04 · **Estado:** Aprobado para desarrollo

## 1. Qué es

Catálogo público en línea donde el cliente navega prendas con precios, arma su carrito y paga escaneando un código QR de cobro. Es un proyecto **completamente nuevo, separado e independiente**, con su propio repositorio, base de datos y despliegue. Pertenece al mismo cliente y negocio que el sistema local "tienda de ropas" (POS offline), pero **no depende de él ni se conecta con él**: el sistema offline gestiona el negocio dentro de la tienda; esta plataforma vende en línea al público.

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Frontend | React + Vite + Tailwind CSS (mismo stack que el sistema offline) |
| Base de datos | **Cloudflare D1** (SQLite, 5 GB gratis) |
| Fotos de prendas | **Cloudflare R2** (10 GB gratis, sin costo por descargas) |
| Backend/API | Cloudflare Pages Functions (Workers) |
| Hosting | Cloudflare Pages + repo GitHub propio |
| Pago | QR simple (banco/billetera) + cliente sube comprobante + **verificación manual** |
| Cuentas de cliente | **Sin registro** — compra como invitado (nombre + WhatsApp) |
| Administración | Panel `/admin` propio con login solo para el dueño |
| Entrega | Envío local, envío nacional y recojo en tienda |

## 3. Diagrama general

```
Cliente (navegador/celular)
        │
        ▼
Cloudflare Pages ──── React + Vite + Tailwind (catálogo, carrito, checkout, /admin)
        │
        ▼
Pages Functions (API) ──┬── D1: productos, categorías, pedidos, ajustes
                        └── R2: fotos de prendas y comprobantes de pago
```

## 4. Modelo de datos (D1)

```
categories        id, nombre, orden, activa
products          id, categoria_id, nombre, descripcion, precio, activo, codigo, creado_en
product_variants  id, product_id, talla, color, stock
product_images    id, product_id, r2_key, orden
orders            id, codigo, cliente_nombre, cliente_whatsapp, tipo_entrega
                  (local|nacional|recojo), direccion/ciudad, total,
                  estado (pendiente_pago → comprobante_subido → confirmado →
                  entregado | cancelado), comprobante_r2_key, idempotencia,
                  creado_en
order_items       id, order_id, product_id, variant_id, cantidad, precio_unit
admins            id, email, password_hash
settings          clave, valor  (ej. imagen del QR de cobro, WhatsApp de la tienda)
rate_log          id, ip, accion, creado_en  (rate limiting de pedidos/comprobantes)
```

## 5. Flujo de compra

1. Cliente navega el catálogo (filtros por categoría, talla, precio).
2. Agrega prendas al carrito (guardado en el navegador, sin cuenta).
3. Checkout: nombre, WhatsApp y tipo de entrega (local / nacional / recojo).
4. El sitio crea el pedido (estado `pendiente_pago`) y muestra **el QR de cobro** con el monto y la **referencia del pedido** (8 caracteres) para escribir en la glosa de la transferencia.
5. Cliente paga desde su app bancaria y **sube foto del comprobante** → estado `comprobante_subido`.
6. Dueño ve el pedido en `/admin` (badge con el contador de "por verificar"), verifica el pago en su banco y lo **confirma** → avisa al cliente por WhatsApp (mensaje prefijado) y coordina la entrega.

Reglas adicionales del proceso de pago:

- **Pedido vencido**: si un pedido pasa 24 h en `pendiente_pago` sin comprobante, se cancela solo y su stock vuelve al catálogo (barrido perezoso al listar pedidos o consultar uno).
- **Idempotencia**: el checkout envía una clave única por intento de compra; si la red falla y el cliente reintenta, el servidor devuelve el pedido ya creado en vez de duplicarlo.
- **Rate limiting**: máx. 10 pedidos y 30 comprobantes por IP por hora (tabla `rate_log`).

## 6. Panel admin (`/admin`)

- Login con email y contraseña (solo dueño).
- CRUD de prendas: fotos (a R2), precio, tallas/colores, stock, activar/desactivar.
- Bandeja de pedidos por estado, con vista del comprobante y botón confirmar/cancelar.
- Ajustes: imagen del QR de cobro, WhatsApp de contacto, costos de envío.

## 7. Estructura del repositorio

```
tienda-virtual/
├── src/                  # React: páginas y componentes
│   ├── pages/            # Catalogo, Producto, Carrito, Checkout, Admin...
│   ├── components/
│   └── lib/              # cliente API, helpers
├── functions/            # Pages Functions (API sobre D1/R2)
│   └── api/
├── migrations/           # SQL de D1, numeradas (001_init.sql...)
├── public/
└── wrangler.toml         # config D1 + R2
```

## 8. Fases de desarrollo

1. **Cimiento**: repo GitHub, proyecto Pages, D1 + migración inicial, bucket R2, esqueleto React.
2. **Catálogo**: listado, ficha de producto, filtros, carrito.
3. **Checkout + QR**: pedido, pantalla de pago QR, subida de comprobante.
4. **Panel admin**: login, CRUD de prendas, gestión de pedidos, ajustes.
5. **Pulido y lanzamiento**: PWA, SEO básico, carga de productos reales, dominio propio (opcional).

## 9. Relación con el sistema offline

Sincronización de stock **diaria y manual** al cierre de caja del sistema local, vía Excel, en dos sentidos (implementada el 2026-07-24, pestaña `/admin/sincronizar`):

1. El sistema local exporta su Excel de stock (`codigo | nombre | talla | color | stock`, una fila por variante) y el dueño lo sube en `/admin/sincronizar`.
2. El servidor recalcula y aplica: **stock nuevo = stock del Excel − ventas en línea desde la última sincronización** (pedidos no cancelados; `pendiente_pago` cuenta porque su stock está reservado). La llave de cruce es `products.codigo` (código corto del sistema local) + talla/color.
3. La plataforma devuelve un **Excel de ventas en línea** (desde la última sync) para registrar en el sistema local, de modo que su stock también baje.

El Excel se lee y genera en el navegador (SheetJS, import dinámico para no inflar el bundle público); la API solo maneja JSON. Vista previa antes de aplicar, con advertencias por códigos no encontrados, variantes sin coincidencia y sobreventas (quedan en 0). Detalles en `PROPUESTA_SINCRONIZACION.md`.

## 10. Seguridad y alcance de datos

### Pago en línea

El sistema **nunca toca dinero ni datos bancarios**: el pago ocurre entre la app bancaria del cliente y la cuenta de la tienda (banco a banco). El sitio solo muestra la imagen del QR de cobro y recibe la foto del comprobante. No existen tarjetas ni credenciales bancarias que robar.

Mitigación de riesgos:

- **Comprobante falso/editado** → la defensa central: el dueño verifica en su banco que el dinero llegó antes de confirmar el pedido.
- **Alteración del QR mostrado** → el QR vive en R2 y solo se cambia desde `/admin` con contraseña.
- **Manipulación de precios desde el navegador** → la API recalcula totales con los precios de la BD; el cliente no puede "pagar Bs 1".

### Datos del cliente

Alcance mínimo: nombre, WhatsApp, tipo de entrega y dirección/ciudad si hay envío. Único uso: coordinar la entrega. No se guardan correos, contraseñas de clientes ni datos financieros (sin cuentas = sin credenciales que robar).

### Protecciones técnicas

- **HTTPS en todo** (automático en Cloudflare).
- **Pedidos solo legibles desde `/admin`**: la API pública crea pedidos pero no permite listar los de otros; cada pedido usa un código aleatorio largo.
- **Login admin** con contraseña hasheada y sesión con expiración.
- **Comprobantes en R2 privado**, visibles solo desde el panel admin.
- **Rate limiting** contra pedidos basura masivos (en la app, tabla `rate_log`; complementa el WAF de Cloudflare).
- **Idempotencia en checkout**: un reintento tras error de red no duplica el pedido ni descuenta stock dos veces.
- **Expiración de pedidos sin pagar (24 h)**: el stock no queda congelado por compras abandonadas.

Punto de control crítico: la confirmación manual del pago por el dueño en su banco.

## 11. Costo

Bs 0/mes dentro de los límites gratuitos: Pages (ilimitado estático), D1 (5 GB, 5M lecturas/día), R2 (10 GB), Functions (100k peticiones/día).
