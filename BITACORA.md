# Bitácora del proyecto — Tienda Virtual

Registro del estado, decisiones y procedimientos de trabajo. Última actualización: 2026-09-04.

## Estado actual

**Fases 1–4 completadas y en producción.** La tienda funciona de punta a punta: catálogo → carrito → checkout → pago QR → comprobante → confirmación en panel admin.

## Mejoras del procedimiento de pago (2026-07-24)

Tras analizar el flujo de pago se implementaron estas mejoras (migración `002_mejoras_pago.sql` — **aplicar con `--remote` al desplegar**):

1. **Expiración de pedidos**: `pendiente_pago` con más de 24 h se cancela solo y repone el stock (barrido perezoso en `functions/lib/expirar.js`, se ejecuta al listar pedidos en admin, al consultar un pedido y al crear uno).
2. **Referencia de pago**: la pantalla del pedido muestra una referencia de 8 caracteres para que el cliente la escriba en la glosa de la transferencia; el admin la ve como `#REF` en la bandeja y así concilia el pago en su banco.
3. **Badge "por verificar"**: el menú del admin muestra cuántos pedidos tienen comprobante pendiente de verificación (se refresca cada minuto).
4. **Envío "a coordinar"**: si el costo de envío es 0, el checkout aclara que el envío se coordina y se paga aparte del QR.
5. **WhatsApp prefijado**: el enlace al cliente en el detalle del pedido abre con un mensaje listo según el estado (pago confirmado, entregado, etc.).
6. **Idempotencia en checkout**: clave única por compra en `sessionStorage`; un reintento tras error de red devuelve el pedido ya creado (columna `orders.idempotencia`).
7. **Rate limiting**: máx. 10 pedidos/hora y 30 comprobantes/hora por IP (tabla `rate_log`, `functions/lib/limite.js`).
8. **Detalles**: al re-subir comprobante se borra la foto anterior de R2; la página del pedido refresca su estado sola cada 20 s; el pedido cancelado muestra aviso al cliente con su referencia.

## Datos clave del proyecto

| Recurso | Valor |
|---|---|
| Web pública | https://tienda-virtual-26n.pages.dev |
| Panel admin | https://tienda-virtual-26n.pages.dev/admin |
| Repo GitHub | ianvs007/tienda-virtual (privado, rama `main`) |
| Cloudflare Pages | proyecto `tienda-virtual` |
| Base de datos D1 | `tienda-virtual-db` (id `cec65991-901c-4a32-898d-18e620a424ef`) |
| Fotos R2 | bucket `tienda-virtual-fotos` |
| Stack | React 19 + Vite + Tailwind 4 + Pages Functions |

## Procedimiento de trabajo (ciclo normal)

1. Se edita el código en esta carpeta.
2. Verificación local opcional: `npm run dev` (solo web) o `npm run build`.
3. Publicar:
   ```powershell
   git add .
   git commit -m "descripción del cambio"
   git push
   ```
4. Cada `git push` a `main` construye y publica automáticamente en Cloudflare (1–3 min). Verificar en el panel de Cloudflare → tienda-virtual → Deployments que el build más reciente esté en verde.
5. Cambios en la BD: crear archivo nuevo en `migrations/` (numerado: `002_...sql`) y aplicar con:
   ```powershell
   npx wrangler d1 migrations apply tienda-virtual-db --remote
   ```
   **Nota (al 04/09/2026)**: la migración 005 se había aplicado a mano sin
   registrar; el registro se insertó el 04/09/2026 y `migrations apply` volvió
   a ser seguro (ver "Verificación integral (2026-09-04)" al final).

## Lecciones aprendidas (problemas ya resueltos)

- **"Invalid database UUID (PENDIENTE)"**: el `wrangler.toml` del repo tenía el marcador; se corrigió con el ID real y push.
- **`npm ci` fallando en Cloudflare**: el `package-lock.json` subido estaba corrupto; se regeneró con `Remove-Item package-lock.json; npm install` y push. Si vuelve a pasar: regenerar el lockfile localmente.
- **"Retry deployment" reconstruye el commit viejo**, no la última versión. Para forzar un build del código actual sin cambios: `git commit --allow-empty -m "Redeploy"; git push`.
- El deploy tiene dos etapas: assets (web) y Functions (API). Si "Assets published" pero la Function falla, la web se ve nueva pero la API sigue vieja.

## Operación diaria de la tienda (sin programar)

- **Pedidos**: `/admin` → Pedidos → filtro "Por verificar" → ver comprobante → verificar el pago en el banco → **Confirmar** → coordinar entrega por WhatsApp → **Marcar entregado**. Cancelar repone stock automáticamente.
- **Prendas**: `/admin` → Prendas → crear/editar; primero se guarda la prenda, luego se suben fotos. La primera foto es la portada. Poner el **código del sistema local** a cada prenda que se venda en ambos canales.
- **Sincronizar stock (cierre de caja)**: `/admin` → Sincronizar → subir el Excel recién exportado del sistema local → revisar vista previa → confirmar → descargar el Excel de ventas en línea y registrarlo en el sistema local.
- **Ajustes**: QR de cobro (imprescindible para vender), WhatsApp con código de país (591...), costos de envío.

## Sincronización de stock con el sistema local (implementada el 2026-07-24)

Pestaña nueva `/admin/sincronizar` (migración `003_sincronizacion.sql` — **aplicar con `--remote` al desplegar**):

- Cada prenda tiene campo **Código del sistema local** (formulario de prendas, columna `products.codigo`, único). Es la llave de cruce con el sistema offline. **Formato canónico: 5 dígitos con ceros a la izquierda** (`00042`), igual que el `shortCode` del POS. Desde el 2026-07-27 la nube normaliza sola (`functions/lib/codigo.js`): un código numérico escrito sin ceros (`42`) o leído del Excel como número se rellena a 5 dígitos al guardar la prenda y al importar el Excel; códigos con letras se respetan tal cual.
- **Subir Excel de cierre de caja** (columnas `codigo, talla, color, stock`; acepta acentos y alias como "cantidad") → vista previa → confirmar. El servidor aplica: `stock nuevo = stock Excel − ventas en línea desde la última sync` (pedidos no cancelados). Advertencias por código no encontrado, variante sin coincidencia y sobreventa (queda en 0).
- **Descargar Excel de ventas en línea** desde la última sync, para registrar en el sistema local.
- El Excel se procesa en el navegador con SheetJS (`xlsx`, import dinámico); la API solo ve JSON. Endpoints: `POST /api/admin/sincronizar(/previsualizar)`, `GET /api/admin/sincronizar/ventas`. Lógica en `functions/lib/sincronizar.js`.
- Marca de tiempo: `settings.ultima_sincronizacion`.
- **Importante**: subir siempre un Excel recién exportado del sistema local; uno viejo descuadra el stock.
- Diseño completo: `PROPUESTA_SINCRONIZACION.md`.
- **Lado del POS implementado el 2026-07-27** (proyecto `tienda de ropas`, pantalla `/sync`): exporta el Excel de stock con el formato exacto (`codigo|nombre|talla|color|stock|precio`, codigo = shortCode del POS) e importa el Excel de ventas en línea descontando stock con registro en kárdex (sin tocar ventas ni caja; guard contra doble importación). Ya no hace falta ajustar mapeo de columnas ni registrar ventas a mano. Pendiente operativo: poner el código del POS (`products.codigo` = shortCode) a cada prenda de la nube. El ritual se hace SOLO en la máquina central del POS (decidido el 2026-07-27; las demás máquinas no sincronizan).
- **Importación inicial de catálogo (2026-07-27)**: tarjeta ④ en `/admin/sincronizar` — sube el mismo Excel del POS y CREA las prendas que no existen (una prenda por fila con una variante talla/color; sin foto, descripción ni categoría: se editan después en Prendas). Códigos existentes o repetidos en el archivo se omiten sin tocar nada. Endpoints `POST /api/admin/catalogo(/previsualizar)`, lógica en `functions/lib/catalogo.js`.

## Datos de la tienda física (2026-07-24, en el sitio público)

- Marca: **Casa Rick** — "Marca & Estilo · Outfits", Cochabamba. Paleta blanco/negro (cabecera y pie oscuros, acento verde WhatsApp).
- Pie de página (Layout.jsx) y portada del catálogo (hero en Catalogo.jsx) muestran: casa matriz calle Jordán #631 entre Antezana y Lanza; sucursal calle San Martín #563 entre Ladislao Cabrera; horarios (Lun–Sáb 9:30–19:30, Dom 9:00–15:00, feriados cerrado); envíos al interior; WhatsApp 77525264 y 61611290 (wa.me/591...).
- Navegación tipo tienda profesional (2026-07-24): membrete superior (marca, horario, WhatsApp), buscador de prendas en la cabecera (`GET /api/productos?q=`), pestañas de categorías en la cabecera (URL `/?categoria=N` y `/?q=`), y banda de anuncios/promociones editable en admin → Ajustes (setting `anuncio`; vacío = oculta).
- Desarrollo local: `npm run dev` (Vite) hace proxy de `/api` a producción (vite.config.js) para ver prendas y fotos reales; para probar con BD local: `npm run build && npx wrangler pages dev dist`.
- Foto de la fachada: `public/fachada.jpg` (original en `recursos/fachada-original.jpeg`, optimizar con `optimizar_fachada.py`).
- `index.html` y `public/og.jpg` usan el nombre "Casa Rick" (regenerar og con `generar_og.py`).
- Logo en el sitio: el 2026-07-24 el dueño pidió NO usar imagen de logo, pero el **2026-07-27 confirmó que SÍ la quiere** (se implementó y desplegó ese día; ver "Cambios desplegados 2026-07-27").

## Cambios desplegados (2026-07-27)

- **Logo de empresa** (aprobado por el dueño el 2026-07-27, dejando sin efecto la decisión del 2026-07-24): endpoint nuevo `POST /api/admin/logo` (`functions/api/admin/logo.js`), clave `logo_r2_key` expuesta en `/api/ajustes` y `/api/admin/ajustes`, subida desde admin → Ajustes (`src/pages/admin/Ajustes.jsx`) y muestra en el membrete (`src/components/Layout.jsx`).
- **Búsqueda difusa**: el buscador (`functions/api/productos.js`) ya no usa solo LIKE; ahora tolera tildes y errores de tipeo (distancia Levenshtein). Nota: trae todo el catálogo a memoria para rankear — aceptable hoy, revisar si el catálogo crece mucho.
- **Ajuste visual**: tarjetas y paneles cambian de `bg-white` a `bg-gray-100` en catálogo, producto, carrito, checkout, pedido y las pantallas del admin.

## Cruce de códigos POS↔nube (diagnosticado y corregido el 2026-08-18)

Síntoma: prendas web que "no coinciden con su código". Prueba en stock_log: el código `00075` creó "CONJT DEPORT 2PZ" y luego "BODY"; `02253` creó "CHAMARRA" y luego "BLAISER VESTIDO" (el borrado libera el código UNIQUE y la reimportación lo reasigna).

**Causa raíz (POS)**: `generateShortCode` asigna max+1 al abrir el formulario, sin transacción; dos pestañas → mismo código en dos prendas. `products` del POS nunca se deduplicaba (solo `barcodes`).

**Correcciones**:
- POS (`tienda de ropas`): `src/utils/duplicateShortCodes.js` + `findDuplicateProductShortCodes`/`fixDuplicateProductShortCodes` en helpers (conserva el código en la prenda más antigua, reasigna a las demás, una transacción); la sync directa y la exportación Excel se BLOQUEAN si hay códigos duplicados (panel rojo + botón de reparación); ProductForm re-verifica unicidad al guardar (regenera si hay carrera); 18 tests nuevos (209 en verde).
- Nube: `calcularSincronizacion` salta filas con código duplicado dentro del lote (`duplicado: true`) y filas cuyo nombre del POS difiere del de la tienda (`cruce: true`, no toca stock). `/api/sync` devuelve `duplicados` y `cruces` destacados; el POS los muestra en rojo.
- Datos: borradas las prendas cruzadas conocidas (BODY id 3781, BLAISER VESTIDO id 5507; sin fotos ni pedidos) con registro en stock_log. Tras reparar duplicados en el POS y re-sincronizar, se recrean correctamente.

## Pendiente (Fase 5 — pulido)

- [ ] Estreno: crear usuario admin, subir QR de cobro, WhatsApp, prendas reales, compra de prueba completa
- [x] SEO básico + vista previa al compartir enlace (Open Graph) — desplegado el 2026-07-24:
  - `index.html`: meta description, OG y Twitter Card estáticos (con URLs absolutas), `theme-color`, favicon SVG (`public/favicon.svg`), imagen por defecto `public/og.jpg` 1200×630 (regenerar con `generar_og.py`).
  - `functions/_middleware.js`: a los rastreadores (WhatsApp, Facebook, Twitter, etc.) que piden `/producto/:id` les devuelve HTML mínimo con OG del producto (nombre, precio, descripción, primera foto); los humanos reciben la SPA normal.
  - `src/lib/useTitulo.js`: título de la pestaña por página (producto, carrito, checkout).
- [ ] PWA (instalable en el celular)
- [x] Nombre real de la tienda en la cabecera (leído de ajustes vía `/api/ajustes`, con fallback "Tienda Virtual"; desplegado el 2026-07-24 en commit `0d75323`)
- [x] Página 404 (`src/pages/NoEncontrado.jsx` + ruta catch-all `path="*"` dentro del Layout en `src/App.jsx`; desplegado el 2026-07-24 en commit `0d75323`)
- [ ] Dominio propio (opcional)

## Documentos

- `ARQUITECTURA.md` — decisiones, modelo de datos, flujos y seguridad
- `README.md` — comandos de desarrollo y puesta en marcha
- `PROPUESTA_SINCRONIZACION.md` — diseño aprobado de la sincronización de stock con
  el sistema local (**ya implementada** el 2026-07-24; queda como registro de diseño)
- `CONTINUAR_SESION.txt` — resumen de contexto para retomar el trabajo en otra sesión

## Admin: eliminar prenda, buscador y auditoría de stock (2026-07-29)

Migración `004_auditoria_stock.sql` (**ya aplicada con `--remote` y `--local`** el 2026-07-29). Desplegado a mano con `wrangler pages deploy` (el deploy automático de GitHub venía fallando desde el 2026-07-27; ver nota abajo).

1. **Eliminar prenda**: botón "🗑 Eliminar prenda" en el formulario de edición (admin → Prendas → abrir una prenda). `DELETE /api/admin/productos/:id` intenta el borrado real (variantes y fotos caen en cascada); si algún pedido la referencia, no se puede borrar y solo se **desactiva** (se avisa en pantalla).
2. **Buscador en admin → Prendas**: filtra al escribir, por nombre (contiene, tolera tildes: "pant" encuentra "Pantalón") o por código del sistema local (por iniciales: "0004"). El listado ahora muestra el `codigo` de cada prenda (se agregó a `GET /api/admin/productos`).
3. **Auditoría de stock**: tabla `stock_log` + pestaña nueva **📊 Auditoría** (`/admin/auditoria`, endpoint `GET /api/admin/stock-log?q=&limite=`). Cada cambio de stock deja una fila (prenda, variante, antes/después, origen, detalle, fecha) con el helper `functions/lib/stockLog.js` (`sentenciaLogStock`, se mete en el mismo batch del cambio). Orígenes: `creacion`, `edicion` (formulario de prenda), `venta` (checkout), `cancelacion` (admin cancela pedido), `expiracion` (pedido vencido 24 h), `sincronizacion` (Excel de cierre) e `importacion` (catálogo inicial). La vista tiene buscador por nombre/código/pedido y muestra los últimos 300 movimientos.

**Nota deploy**: el 2026-07-27 el build automático del push `ae68f51` falló en Cloudflare (deployment `ff2da9e9`, status Failure) y la web quedó vieja sin que nadie lo notara. El 2026-07-29 se desplegó a mano (`npx wrangler pages deploy dist --project-name=tienda-virtual`) y se revisó la integración: el push `1545e9c` de ese mismo día gatilló el build automático y salió **Active** (deployment `ca3f3198`), así que la falla del 2026-07-27 fue puntual/transitoria (wrangler no da acceso al log del build de GitHub; habría que verla en el dashboard si se repite). De todos modos, tras cada push conviene verificar que el deployment salga en verde (`npx wrangler pages deployment list --project-name=tienda-virtual`) o desplegar a mano.


## Sincronización directa POS ↔ web, sin Excel (2026-07-29)

Reemplaza el ritual diario de 4 pasos con archivos por **un botón de 1 clic en el POS**. El flujo Excel (tarjetas ①②③ de `/admin/sincronizar`) queda intacto como respaldo.

- **Endpoint machine-to-machine** `functions/api/sync.js` (`POST /api/sync`): no pasa por el middleware de /admin; se autentica con `Authorization: Bearer <token>` contra `settings.sync_token` (`validarTokenSync` en `functions/lib/sincronizar.js`; 503 si no hay token, 401 si no coincide). Body `{ filas: [{codigo, talla, color, stock}] }` (1..5000). Ejecuta la MISMA lógica que el flujo Excel (`calcularSincronizacion` + batch con `sentenciaLogStock` + update de `ultima_sincronizacion`), pero captura las ventas en línea ANTES de aplicar (misma ventana `[desde, ahora)`) y las devuelve en la respuesta (`ventas`, con `pedido_ref`→`pedido` y `creado_en`→`fecha` vía `ventasParaPOS`) para que el POS las descuente localmente en el mismo clic.
- **`GET /api/sync/ventas`** (`functions/api/sync/ventas.js`): mismas ventas en formato POS, para recuperación si una sync falla a mitad.
- **Token**: `POST/DELETE /api/admin/sync-token.js` (protegido por sesión admin) genera/revoca (`crypto.randomUUID` sin guiones, texto plano en settings). UI en admin → Ajustes, tarjeta "Sincronización directa con el POS": muestra el token enmascarado (`sync_token_mascara` en GET ajustes, nunca el completo), "Generar token nuevo" (lo muestra una sola vez con botón copiar) y "Revocar". Generar uno nuevo invalida el anterior.
- **Lado POS** (proyecto `tienda de ropas`, pantalla `/sync`): tarjeta nueva "SINCRONIZACIÓN DIRECTA (1 CLIC)" arriba de todo. Config una sola vez (URL + token en settings Dexie `syncUrl`/`syncToken`); botón "🔄 Sincronizar ahora" que envía el stock, aplica los cambios en la web y descuenta las ventas devueltas con la MISMA transacción Dexie del flujo Excel (extraída a `src/utils/syncAplicar.js` → `aplicarVentas`; normalización en `ventasDesdeApi` de `src/utils/syncExcel.js`). El guard `ultimaImportacionVentas` hace idempotente el reintento: no hay doble descuento si falla a mitad.
- Verificado en producción: 503 sin token → 401 token malo → 200 con código inexistente (0 cambios, aviso correcto). Las pruebas se limpiaron (token temporal borrado y `ultima_sincronizacion` restaurada a `1970-01-01 00:00:00`).

## Barras de avance en procesos largos (2026-07-29)

Con 1700+ prendas, el borrado masivo y la importación de catálogo dejaban la pantalla minutos sin señal de vida. Ahora ambos procesan **por lotes** y muestran barra con porcentaje ("X de Y — no cierres esta página"):

- **Borrado en lote**: endpoint nuevo `POST /api/admin/productos/eliminar-lote` (máx 200 ids por llamada, misma regla: con pedidos → solo desactiva). `Productos.jsx` trocea la selección en lotes de 200 y actualiza el avance entre llamadas.
- **Importación de catálogo (tarjeta ④)**: `aplicarCatalogo` en `Sincronizar.jsx` trocea en lotes de 250 contra el mismo endpoint `/api/admin/catalogo` (es idempotente: omite códigos existentes, así que reintentar tras un corte no duplica) y acumula el reporte.

## Sync directa también CREA prendas (2026-07-29)

`POST /api/sync` ahora ejecuta primero `aplicarImportacionCatalogo` (crea las prendas cuyo código no existe, si la fila trae nombre y precio válidos) y después la sincronización de stock: el botón de 1 clic del POS sirve tanto para la **carga inicial del inventario** como para el ritual diario y para subir prendas nuevas. La respuesta añade `creadas` y `avisosImportacion`. El POS envía nombre+precio en las filas y muestra "Prendas nuevas creadas en la web" en el resumen. Verificado en vivo: 1ra llamada crea (creadas:1), 2da no duplica (creadas:0). Pruebas limpiadas (producto/log de prueba borrados, `ultima_sincronizacion` restaurada, token temporal eliminado).

## Sync directa por lotes + corrección del error 1101 (2026-07-29, commit `1545e9c`)

Con el catálogo completo (1700+ prendas) la sync directa en una sola llamada dejaba al POS minutos esperando y reventaba los límites del Worker. Ahora el POS trocea el inventario en **lotes de 250 filas** con barra de avance (`Sync.jsx`): solo el último lote va con `finalizar: true`, y `/api/sync` recién ahí captura las ventas en línea y actualiza `ultima_sincronizacion` (así todos los lotes calculan con la misma ventana `[desde, ahora)` y las ventas se descuentan una sola vez).

La primera prueba en vivo falló con **error 1101** ("Worker threw exception") en el lote 1. Tenía DOS causas, ambas corregidas:

1. **Consultas por fila**: `calcularSincronizacion` hacía 2 consultas D1 por fila (500+ subrequests por lote) y `aplicarImportacionCatalogo` un INSERT por prenda. Ahora `calcularSincronizacion` trae el catálogo completo en 2 consultas y cruza en memoria (mismo patrón que la búsqueda difusa), y `aplicarImportacionCatalogo` inserta en UN batch de `INSERT OR IGNORE` (el `meta.changes` de cada sentencia detecta carreras; los ids se recuperan con un SELECT posterior en trozos de 90 por el límite de parámetros de D1). Un lote de 250 pasó de ~500 subrequests a ~8.
2. **Batch vacío**: un lote intermedio (`finalizar: false`) sin cambios de stock llamaba `env.DB.batch([])` y D1 lanza excepción. Ahora se salta el batch si no hay sentencias (`functions/api/sync.js`).

Verificado en vivo (desplegado a mano con `wrangler pages deploy`, el build automático de GitHub sigue roto): 2 lotes de 250 filas en <1 s cada uno (HTTP 200), creación idempotente (reintento `creadas: 0`), ajuste de stock con auditoría (`actualizadas: 1`), y 503 "no configurada" al borrar el token. Limpieza posterior: prendas de prueba 99997/99998/99999 y sus logs borrados (la 99997 "LOTE UNO" era residuo de la prueba interrumpida), `ultima_sincronizacion` restaurada a `1970-01-01 00:00:00` y token temporal `tokentemporal789` eliminado (también era residuo).

**Zip del POS regenerado**: `D:\software\MisProyectos\actualizacion-tienda-ropas-2026-07-29.zip` (el que había estaba truncado por la sesión interrumpida). Incluye el `dist` reconstruido con el envío por lotes; los 191 tests del POS pasan.

## CORS en /api/sync: el clic real del POS no llegaba (2026-07-29)

Al probar el botón de 1 clic desde el POS real, la nube no registraba nada (0 prendas, 0 movimientos, `ultima_sincronizacion` en 1970) y el POS mostraba "Sin internet o la tienda está caída". Causa: **todas las pruebas anteriores se hicieron con scripts de terminal (node), que no aplican CORS**. El POS corre en el navegador desde otro origen (localhost/IP local), así que el POST con header `Authorization` exige preflight `OPTIONS`; como la función no lo manejaba, el navegador bloqueaba el envío y el POST nunca salía del POS.

Fix (`functions/lib/cors.js`): `onRequestOptions` (204 con `Access-Control-Allow-Origin: *`, métodos y headers) y `jsonSync` (Response.json con los headers CORS) en `/api/sync`, `/api/sync/ventas` y en los errores de `validarTokenSync` (para que el POS pueda LEER el 401/503 en vez de un error de red genérico). Origen `*` es seguro acá: la autenticación es por Bearer token, no por cookies. Verificado con preflight real (204 + headers) y POST con `Origin` (401 con `Access-Control-Allow-Origin`). **No requirió cambios en el POS** (el zip sigue vigente).

## Sync autoritativa del POS por identidad estable (2026-08-19 al 22)

Decisión de fondo (Alain, 22/08/2026): la nube es DESCARTABLE; el POS offline es la fuente canónica y la nube siempre se re-sincroniza desde él.

- `4da218c` + `92de418` (PR #2 y #3): la sync del POS reactiva prendas tocadas y establece el protocolo robusto start/commit (sync autoritativa).
- `65e4cee` — **migración `005_global_id.sql`**: `products.global_id` (UUID) + índice único parcial `idx_products_global_id`; el cruce pasa del `codigo` (mutable: se libera al borrar y se reasigna al reimportar) al `global_id` (estable). Legado: la nube adopta el globalId del POS y backfillea UUIDs aleatorios a productos sin él.
- `d5f335f`: escrituras del upsert batcheadas para no exceder la CPU del Worker.
- `1f058ff`: los conflictos (nombre/código distintos) ya no se saltean: la nube REEMPLAZA su registro por el canónico del POS.
- `f049d84`: el admin puede vaciar TODO el catálogo cloud de una vez (`POST /api/admin/productos/eliminar-todas`), para re-sincronizados completos desde el POS.
- Todos desplegados en producción (último deployment = `f049d84`); el build automático de Pages al push funciona.

## Verificación integral (2026-09-04)

Hecha desde Qwen Code local (sin tocar datos):

- 8/8 tests (`node --test "functions/**/*.test.js"`) + `npm run build` OK.
- BD viva: columna `products.global_id` presente, backfill completo (2410/2410 productos) e índice único presente.
- ✅ DRIFT resuelto (04/09/2026): el ledger `d1_migrations` remoto registraba solo 001–004 (la 005 se había aplicado manualmente, sin registrar). Con aprobación de Alain se insertó el registro (`INSERT INTO d1_migrations (name) VALUES ('005_global_id.sql')`); `wrangler d1 migrations list --remote` vuelve a dar "No migrations to apply" y `migrations apply` es seguro de nuevo.
- ⚠️ Lado POS: el zip con globalId (schema v23) está ARMADO (`ropa-cbba-v5-globalid-20260904.zip` en `D:\software\MisProyectos`) pero aún NO se copia a las 3 máquinas; la sync nueva lo requiere (ver CLAUDE.md del POS, item 17).

## Fixes de stock y admin (2026-09-10)

- `990a6ed`: expiración y cancelación reponen stock SOLO si ganan la carrera del `UPDATE` de estado (antes: doble reposición posible); el checkout descuenta con `CASE … RAISE(ABORT)` (un `UPDATE` de 0 filas no revertía el batch de D1).
- `2fe04dd`: "Vaciar nube" del admin ahora borra por lotes de 200 (el POST único agotaba el Worker y devolvía HTML → `Unexpected token '<'` en el admin).
- Hallazgo: tras el vaciado + re-sync desde la central (20:00), D1 tenía **2592 productos y 0 con `global_id`**: la central sincroniza con una BD Dexie v22 (se copió solo `Sync.jsx` en la carpeta vieja o el acceso directo apunta a ella). Ver `tienda de ropas/docs/DISENO_SYNC_EVENTOS.md` §0.

## Sincronización v2 por eventos (2026-09-10) — código listo, SIN desplegar

Diseño completo en `tienda de ropas/docs/DISENO_SYNC_EVENTOS.md`. Resumen: la nube registra cada venta/cancelación/expiración como un evento con id creciente (`stock_eventos`); el POS los baja, los aplica con idempotencia por id y confirma (`ack`). El snapshot de stock cruza SOLO por `global_id` y publica `stock_pos + Σ eventos sin ack`. Sin cutoff por fecha; cualquier corte se resuelve repitiendo.

- `932f961` — migración **`006_sync_eventos.sql`**: `stock_eventos` (índice único `(order_item_id, tipo)`), `sync_dispositivos` (ack por dispositivo), `products.sesion_snapshot`.
- `453cb04` — `functions/lib/eventos.js`: el checkout, `expirar.js` y la cancelación del admin insertan el evento en el MISMO batch que el stock (`INSERT OR IGNORE`).
- Endpoints `functions/api/sync/v2/`: `GET eventos` (paginado, `hayMas`), `POST snapshot` (≤250 filas; identidad por `global_id`; **bootstrap**: adopta por `codigo` solo si el producto de la nube no tiene `global_id`; libera códigos que tenga otra identidad), `POST ack` (nunca retrocede), `POST finalizar` (desactiva ausentes solo si vio ≥ `productosEsperados`; reemplaza "Vaciar nube"). Lógica de decisión en `functions/lib/syncV2.js::planificarSnapshot` (pura, 15 tests) + 3 tests de integración con D1 simulada. 34/34 tests + build OK.
- Los endpoints viejos (`/api/sync`, `/api/sync/start|commit|ventas`) siguen vivos hasta que la central corra el POS v8.
- ⚠️ **ORDEN DE DESPLIEGUE OBLIGATORIO**: aplicar la migración 006 en D1 remoto ANTES de pushear a `main`. Si el código nuevo llega sin la tabla `stock_eventos`, el `INSERT` del checkout falla y **ningún cliente puede comprar**. `wrangler d1 migrations apply tienda-virtual-db --remote` (o ejecutar el SQL + registrar `006_sync_eventos.sql` en `d1_migrations`, como se hizo con la 005).
- ✅ **Migración 006 APLICADA en D1 remoto (2026-09-10 17:35, por MCP de Cloudflare, con instrucción de Alain de sincronizar a GitHub)**: `wrangler` seguía con el error de auth 10000, así que se ejecutó el SQL de `006_sync_eventos.sql` tal cual y se registró en el ledger (`INSERT INTO d1_migrations (name) VALUES ('006_sync_eventos.sql')`). Verificado: tablas `stock_eventos` y `sync_dispositivos`, 3 índices, columna `products.sesion_snapshot`, ledger 001–006. Recién entonces se hizo el push a `main` (Pages despliega solo).
- Repositorio del POS en GitHub: `ianvs007/ropa-cbba` (rama `main`); la sync de código entre ambos proyectos se hace a sus `main` respectivos.
