# Bitácora del proyecto — Tienda Virtual

Registro del estado, decisiones y procedimientos de trabajo. Última actualización: 2026-07-24.

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
- **Prendas**: `/admin` → Prendas → crear/editar; primero se guarda la prenda, luego se suben fotos. La primera foto es la portada.
- **Ajustes**: QR de cobro (imprescindible para vender), WhatsApp con código de país (591...), costos de envío.

## Próxima etapa APROBADA (sin implementar): sincronización de stock con el sistema local

El 2026-07-24 el cliente aprobó sincronizar el stock con su sistema de gestión local
(offline) al cierre de caja diario, vía Excel, en dos sentidos (opción A).
**Diseño completo en `PROPUESTA_SINCRONIZACION.md`** — leerlo antes de implementar.
Preguntas abiertas: columnas exactas del Excel del sistema local (pedir archivo de
ejemplo), si el sistema local puede importar un Excel de ventas, y OK final para la
dependencia `xlsx` (SheetJS). Requiere migración `003_sincronizacion.sql`
(campo `products.codigo` como llave de cruce).

## Pendiente (Fase 5 — pulido)

- [ ] Estreno: crear usuario admin, subir QR de cobro, WhatsApp, prendas reales, compra de prueba completa
- [ ] SEO básico + vista previa al compartir enlace (Open Graph)
- [ ] PWA (instalable en el celular)
- [ ] Nombre real de la tienda en la cabecera (leerlo de ajustes)
- [ ] Página 404
- [ ] Dominio propio (opcional)

## Documentos

- `ARQUITECTURA.md` — decisiones, modelo de datos, flujos y seguridad
- `README.md` — comandos de desarrollo y puesta en marcha
- `PROPUESTA_SINCRONIZACION.md` — diseño aprobado (pendiente de implementar) de la
  sincronización de stock con el sistema local
- `CONTINUAR_SESION.txt` — resumen de contexto para retomar el trabajo en otra sesión
