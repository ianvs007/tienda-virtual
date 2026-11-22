# Seguridad: endurecimiento de la API (noviembre 2026)

Cambios a partir del informe de estado del 22/11/2026 (sección 7). Resumen de
contratos, migración y pasos manuales. El POS (`ropa-cbba`) **no necesita
cambios** para seguir funcionando.

## Resumen por riesgo

| # | Riesgo | Cambio |
|---|--------|--------|
| 1 | `/api/admin/login` sin freno | 429 + `Retry-After: 900` tras 5 fallos por IP+correo, 20 por IP o 30 por correo en 15 min (`lib/intentos.js`, tabla `rate_log` existente: sin migración). Bloqueado = no se verifica la clave. Correo inexistente gasta el mismo CPU (sin enumeración por tiempos). |
| 2 | `/api/admin/setup` abierto con `admins` vacío | Requiere `ADMIN_SETUP_SECRET` (variable de entorno). Sin ella, el setup está **deshabilitado** (403 `setup_deshabilitado`). Secreto comparado en tiempo constante, 5 fallos por IP → 429. Alta atómica (`INSERT … WHERE NOT EXISTS`). |
| 3 | Token compartido `!==`, sin alcance ni sucursal | Comparación en tiempo constante (`lib/seguridad.js`); tokens nuevos con alcance y sucursal (migración **010**); el servidor impone la sucursal en traslados. |
| 4 | `err.message` al cliente | `lib/errores.js`: 500 genérico `{error, codigo:'interno'}`, detalle solo a `console.error`. Quitados `detalle` del middleware raíz y de `pedido_no_creado`. D1 sin cuota sigue siendo 503 `d1_sin_cuota`. |
| 5 | PBKDF2 con 50 000 iteraciones | 100 000 (máximo de Workers). Migración transparente: el hash guardado ya lleva sus iteraciones (`pbkdf2$N$sal$hash`); se verifica con las suyas y se re-guarda en el siguiente login correcto. |
| 6 | Sin cabeceras de seguridad | `public/_headers` (estáticos) + `functions/lib/cabeceras.js` (API y HTML Open Graph): CSP, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS. |
| 7 | 3 tests fallidos | `limite.test.js` carga TODAS las migraciones reales; `expirar.test.js` alineado con la columna `cantidad`. |
| 8 | `npm audit` | `npm audit fix` + wrangler 4.166 / vite 7.3.8: de 13 vulnerabilidades a 1 (`xlsx`, sin parche en npm). |
| 9 | Sin CI | `.github/workflows/ci.yml` (`npm ci`, `npm test`, `npm run build`) y script `npm test`. |

## Contrato de la API (cambios)

### Autenticación del POS (`/api/sync*`, `/api/sync/v2/*`, `/api/traslados/*`)

`Authorization: Bearer <token>` igual que antes. Tokens aceptados:

1. `settings.sync_token` (heredado). Sigue sirviendo para sync y, **mientras no se
   desactive**, también para traslados **sin validación de sucursal**
   (comportamiento actual del POS).
2. Tokens de la tabla `api_tokens` (migración 010), con `alcance` (`sync`,
   `traslados` o ambos) y `sucursal`.

Respuestas nuevas:

- `403 {codigo:'token_sin_alcance'}`: token válido pero sin permiso para ese grupo
  de endpoints (o token heredado en traslados con el modo heredado desactivado).
- `403 {codigo:'sucursal_no_autorizada'}`: el token de sucursal X intenta enviar con
  `originBranch` ≠ X, o pedir `?destino=` ≠ X.
- `401 Token inválido` / `503 Sincronización directa no configurada`: sin cambio
  (el 503 ahora solo si no hay token heredado **y** la petición no trae token).
- `429 {codigo:'demasiados_intentos', reintentarEnSegundos}` en login/setup.
- Errores 500: cuerpo `{error:'Error interno del servidor…', codigo:'interno'}` en
  lugar del mensaje de la excepción. Los endpoints de sync que antes devolvían la
  excepción tal cual en 500 ahora pasan por el mismo clasificador: cuota de D1 →
  **503** `d1_sin_cuota` (el cliente POS ya reintenta todo `>= 500`).

### `/api/traslados/*` con token de sucursal

- `enviar`: `originBranch` debe ser la sucursal del token.
- `pendientes`: se fuerza `destino` = sucursal del token (si se omite, se usa la
  suya; si se pide otra, 403). Con el token heredado, sin cambios.
- `confirmar`: solo si el traslado tiene como destino la sucursal del token;
  si no, responde 404 (no revela traslados ajenos). `receivedBranch` queda fijado
  a la sucursal del token.

### Setup y login del panel

- `GET /api/admin/setup` → `{ necesitaSetup, setupHabilitado }` (campo nuevo).
- `POST /api/admin/setup` → exige `X-Setup-Secret` (o `setupSecret` en el JSON).
  El login del panel ya envía el campo cuando el setup está pendiente.

### Endpoints nuevos (admin, con sesión)

- `GET /api/admin/api-tokens` — lista (sin hashes) + `legacySyncEnTraslados`.
- `POST /api/admin/api-tokens` `{nombre, alcance:[…], sucursal}` — devuelve el token
  **una sola vez** (`tv_…`; en BD solo su SHA-256). `sucursal` obligatoria con alcance `traslados`.
- `DELETE /api/admin/api-tokens?id=` — revoca.
- `PUT /api/admin/api-tokens` `{legacySyncEnTraslados:boolean}` — acepta o no el token
  heredado en traslados.
- UI: tarjeta "Tokens por tienda" en Admin → Ajustes.

## Migración y compatibilidad de despliegue

`migrations/010_api_tokens.sql`: tabla nueva `api_tokens` (aditiva, no toca nada
existente). **No se aplicó.** El código es compatible con la migración sin
aplicar: el token heredado sigue funcionando y los endpoints de gestión avisan
(`migracionPendiente` / 503 `migracion_pendiente`). No hay otro cambio de esquema
(el bloqueo del login reutiliza `rate_log`).

## Pasos manuales (en orden)

1. **Antes o justo después de mergear**: definir en Cloudflare Pages
   (Settings → Variables and Secrets, como *Secret*, producción) `ADMIN_SETUP_SECRET`
   con un valor largo aleatorio. Solo hace falta si algún día hay que recrear el admin;
   sin ella el alta inicial queda deshabilitada (lo seguro por defecto). Hoy ya hay admin.
2. Aplicar la migración: `npx wrangler d1 migrations apply tienda-virtual-db --remote`
   (si el ledger `d1_migrations` tuviera drift, registrar la fila a mano como se
   hizo con la 005; verificar con `wrangler d1 migrations list --remote`).
3. Entrar al panel una vez: el hash del admin pasa solo a 100 000 iteraciones.
   Vigilar que el login responda sin error de CPU. Si Cloudflare reportara `exceeded CPU`
   con 100 000 iteraciones, bajar `ITERACIONES` en `functions/lib/auth.js` (p. ej. a 50 000):
   los hashes ya migrados a 100 000 siguen verificando (el tope aceptado es el máximo de
   Workers, no `ITERACIONES`), solo que no se re-guardan con menos.
4. Emitir un token por tienda en Ajustes → "Tokens por tienda" (alcance `traslados`
   + sucursal con el MISMO nombre que usa el POS, p. ej. `SUCURSAL 1`; la central,
   `traslados` + `sync` con su sucursal). Pegarlo en el campo de token de `/sync`
   del POS correspondiente (el POS usa un único campo de token para sync y traslados).
5. Cuando todos los POS usen su token: desmarcar "Aceptar también el token general en
   traslados" y, si se desea, rotar/revocar el token heredado (Ajustes → Revocar).
6. Verificar en producción: login (error 401 y luego bloqueo 429 tras 5 intentos
   desde una IP de prueba), cabeceras (`curl -I https://…/` y `/api/categorias`),
   y que la tienda pública y el panel cargan sin violaciones de CSP en la consola
   del navegador (si apareciera alguna, ajustar `public/_headers` **y**
   `functions/lib/cabeceras.js`).

## Pendiente / fuera de alcance

- `xlsx@0.18.5` sin parche en npm (prototype pollution, ReDoS; solo admin sube Excel).
  Opciones: SheetJS oficial por CDN (`xlsx-0.20.x`) o `exceljs`.
- CORS `*` en `/api/sync*` y `/api/traslados/*` se mantiene (Bearer, sin cookies; el
  POS corre desde otro origen).
- `vite.config.js` sigue haciendo proxy a producción en desarrollo.
- Los tokens heredados siguen en texto plano en `settings` hasta que se revoque; los
  nuevos se guardan hasheados.
