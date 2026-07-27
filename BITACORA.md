# Bitácora del proyecto — Tienda Virtual

Registro del estado, decisiones y procedimientos de trabajo. Última actualización: 2026-07-27.

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
- **Lado del POS implementado el 2026-07-27** (proyecto `tienda de ropas`, pantalla `/sync`, aún sin commitear allá): exporta el Excel de stock con el formato exacto (`codigo|nombre|talla|color|stock`, codigo = shortCode del POS) e importa el Excel de ventas en línea descontando stock con registro en kárdex (sin tocar ventas ni caja; guard contra doble importación). Ya no hace falta ajustar mapeo de columnas ni registrar ventas a mano. Pendiente operativo: poner el código del POS (`products.codigo` = shortCode) a cada prenda de la nube. El ritual se hace SOLO en la máquina central del POS (decidido el 2026-07-27; las demás máquinas no sincronizan).

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
