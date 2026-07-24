# Propuesta aprobada — Sincronización de stock con el sistema local (offline)

**Fecha:** 2026-07-24 · **Estado:** APROBADA por el cliente — implementación pendiente (se hará después).

Sincronizar el stock entre el sistema de gestión local (offline) y la tienda virtual,
una vez al día, al cierre de caja del sistema local. Formato de intercambio: **Excel**.
Los productos del sistema local tienen **código corto**, que será la llave de cruce.

## 1. Idea central

Al cierre de caja, el sistema local exporta un **Excel de stock** y el dueño lo sube en
una nueva sección `/admin/sincronizar` de la tienda virtual. El importador **no pisa el
stock a ciegas**: a cada producto le descuenta las ventas en línea hechas desde la última
sincronización, porque esas prendas ya no están físicamente en la tienda. Luego la nube
devuelve un **Excel de ventas en línea** para registrar en el sistema local. Así ambos
sistemas quedan igualados al final del ritual.

```
stock nuevo en nube = stock del Excel (tras ventas locales)
                    − ventas en línea desde la última sincronización
```

- Pedidos `cancelado` NO cuentan como venta en línea (su stock ya fue repuesto).
- Pedidos `pendiente_pago` SÍ cuentan (su stock está reservado; si expiran, vuelve solo).

## 2. Llave de cruce: código corto

- Migración `003_sincronizacion.sql`: agregar `products.codigo TEXT` (único, opcional)
  para guardar el código corto del sistema local; exponer el campo en el formulario de
  prendas del admin (`src/pages/admin/ProductoForm.jsx`).
- El Excel trae **una fila por variante**: `codigo | nombre | talla | color | stock`.
  La variante se cruza por `codigo + talla + color`. (Si el sistema local no maneja
  tallas, se cruza solo por código — ajustar al implementar con el archivo real.)
- Filas que no cruzan con nada → reporte de advertencias, NO se crean solas
  (evita duplicar catálogo por un typo).

## 3. Decisión técnica: el Excel se procesa en el navegador

Leer y generar el Excel en el React del admin (librería **SheetJS / `xlsx`**), no en el
servidor. La API sigue hablando solo JSON. Ventajas: vista previa antes de aplicar, sin
parser pesado en el Worker, y el formato de columnas se ajusta sin tocar el backend.

## 4. Flujo en el panel admin (`/admin/sincronizar`, pestaña nueva)

1. **Subir Excel de cierre** → vista previa por fila:
   *stock actual nube | stock Excel | ventas en línea descontadas | stock nuevo*,
   con advertencias (códigos no encontrados, resultados negativos que quedan en 0).
2. **Confirmar** → `POST /api/admin/sincronizar` recalcula todo en ese instante
   (fresco, no lo de la vista previa), aplica los cambios en batch y guarda
   `settings.ultima_sincronizacion`.
3. **Descargar Excel de ventas en línea** (desde la última sync):
   `codigo | nombre | talla | color | cantidad | precio | referencia pedido | fecha`
   → se importa/registra en el sistema local para que su stock también baje.

## 5. Endpoints nuevos (admin, protegidos por `_middleware.js`)

- `POST /api/admin/sincronizar/previsualizar` — recibe filas parseadas, devuelve el
  cálculo sin aplicar.
- `POST /api/admin/sincronizar` — aplica y devuelve el reporte final.
- `GET /api/admin/sincronizar/ventas` — JSON de ventas en línea desde la última sync
  (el navegador lo convierte a Excel).

Ventas en línea = `order_items` de pedidos con `estado != 'cancelado'` y
`creado_en > settings.ultima_sincronizacion`, agrupados por variante.

## 6. Casos borde contemplados

- **Sobreventa** (Excel < ventas en línea): el stock queda en 0 y se marca en el
  reporte para revisión manual.
- **Producto en la nube pero no en el Excel**: se deja intacto y se reporta
  (p. ej. prenda solo web).
- **Olvidar sincronizar un día**: no pasa nada; la próxima sync descuenta las ventas
  acumuladas de todos los días pendientes.
- **Pedido pendiente de pago al sincronizar**: queda reservado; si después expira,
  su stock vuelve solo (mejora ya implementada el 2026-07-24).

## 7. Ritual diario del dueño (documentar en BITACORA al implementar)

1. Cierre de caja en el sistema local → exportar Excel de stock.
2. `/admin/sincronizar` → subir Excel → revisar vista previa → confirmar.
3. Descargar Excel de ventas en línea → registrarlo en el sistema local.

## 8. Preguntas abiertas (responder antes de implementar)

1. **Columnas exactas del Excel del sistema local** (¿encabezados? ¿fila por variante
   o por producto?). Ideal: un archivo de ejemplo real.
2. **¿El sistema local puede importar un Excel de ventas**, o el archivo de ventas en
   línea es solo para registro manual? (Cambia el formato de salida, no el diseño.)
3. Dependencia nueva: **`xlsx` (SheetJS)** en el frontend del admin — confirmada en
   principio por el cliente al aceptar esta propuesta.

## 9. Relación con ARQUITECTURA.md

Al implementar, actualizar la sección 9 ("Relación con el sistema offline"): pasa de
"ninguna dependencia" a "sincronización diaria manual vía Excel (opción A, dos sentidos)".
