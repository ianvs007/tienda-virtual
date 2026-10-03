# Historial POS: venta en línea con estado de entrega

**Fecha:** 2026-10-03  
**Estado:** aprobado (enfoque A)  
**Repos:** `tienda-virtual` (nube) + `ropa-cbba` (POS offline)  
**Relacionado:** `PROPUESTA_SINCRONIZACION.md`, migración `006_sync_eventos.sql`, PR pago/comprobante

## 1. Problema

Hoy una compra web:

1. Descuenta stock en la nube al crear el pedido.
2. Emite `stock_eventos.tipo = 'venta'` para que el POS baje stock y deje kárdex `VENTA EN LÍNEA #ref`.
3. **No** crea fila en el historial de ventas del POS ni toca caja.

El dueño necesita ver en el **historial de ventas (rol administrador)** del POS las ventas web confirmadas, sin mezclarlas con la caja del día, y con un estado claro de si la prenda ya salió o sigue en la tienda.

## 2. Objetivo

| Momento en la web | Stock / kárdex POS | Historial de ventas POS | Caja |
|---|---|---|---|
| Checkout (pedido creado) | Descuento + kárdex `VENTA EN LÍNEA #ref` (como hoy) | — | No |
| Admin **Confirma pago** | Sin cambio de stock | Alta: canal **Venta en línea**, estado **Pendiente de entrega** | No |
| Admin **Marca entregado** | Sin cambio de stock | Actualiza estado → **Entregado** | No |
| Cancelación / expiración | Reposición (como hoy) | Si existía historial, marcar **Cancelado** | No |

Texto de estado **neutro** (sirve para recojo, envío local y nacional):

- Tras confirmar: **Pendiente de entrega**
- Tras entregar: **Entregado**

## 3. Decisiones

1. **Enfoque A:** eventos de historial en la sync v2 (append-only), no inventar el historial solo desde el kárdex.
2. El historial **solo aparece al confirmar** el pago en la web (`confirmado`), no en `comprobante_subido` ni en `pendiente_pago`.
3. Stock y caja quedan desacoplados del historial: stock en checkout; historial en confirmación/entrega; caja nunca.
4. Despliegue: push a GitHub en ambos repos → en la máquina central del POS `git pull` (preferible con tag de versión).

## 4. Contrato de eventos (nube → POS)

### 4.1 Extender `stock_eventos.tipo`

Hoy: `'venta' | 'cancelacion' | 'expiracion'`.

Añadir (migración `008_eventos_historial.sql`):

- `'confirmacion'` — alta en historial; **delta = 0** (no mueve stock).
- `'entrega'` — actualiza estado del historial a Entregado; **delta = 0**.

El índice único `(order_item_id, tipo)` se mantiene: un ítem tiene como máximo un evento de cada tipo.

### 4.2 Cuándo se emiten

| Transición web | Evento | `delta` | Notas |
|---|---|---|---|
| `POST /api/pedidos` (checkout) | `venta` | −cantidad | Sin cambio (hoy) |
| Admin `→ confirmado` | `confirmacion` | 0 | Uno por `order_item` del pedido |
| Admin `→ entregado` | `entrega` | 0 | Uno por `order_item` |
| Admin/expiry `→ cancelado` | `cancelacion` / `expiracion` | +cantidad | Sin cambio; si ya hubo `confirmacion`, el POS marca historial cancelado |

Si confirman un pedido que nunca tuvo `venta` (dato corrupto): igual se permite confirmar en la web (el dinero está en el banco), se emiten `confirmacion` igual, y se deja `console.error` de integridad; el POS crea historial aunque falte el kárdex previo.

### 4.3 Forma del evento hacia el POS (`listarEventos`)

Campos actuales más:

```json
{
  "id": 123,
  "tipo": "confirmacion",
  "globalId": "...",
  "codigo": "02786",
  "nombre": "...",
  "talla": "S",
  "color": "BEIS",
  "delta": 0,
  "precioUnit": 298,
  "pedidoRef": "4637C262",
  "creadoEn": "2026-10-03 20:00:00",
  "origen": "venta_en_linea",
  "nota": "VENTA EN LÍNEA #4637C262",
  "estadoEntrega": "pendiente_entrega"
}
```

Para `entrega`, `estadoEntrega`: `"entregado"`.  
Para `confirmacion`, `estadoEntrega`: `"pendiente_entrega"`.

`deltaDeEvento`: tipos con delta 0 → `0`; `venta` → negativo; `cancelacion`/`expiracion` → positivo.

### 4.4 Snapshot / stock publicado

Los eventos con `delta = 0` **no alteran** `stock_pos + Σ deltas pendientes`.  
`deltasPendientes` ya usa `SUM(delta)`: sumar ceros es inocuo.

## 5. Cambios en la nube (`tienda-virtual`)

1. Migración `008_eventos_historial.sql`: ampliar CHECK de `tipo`; documentar semántica delta 0.
2. `functions/lib/eventos.js`: `TIPOS_EVENTO` + `deltaDeEvento` + helper `sentenciaEventoHistorial` (confirmacion/entrega).
3. `functions/api/admin/pedidos/[codigo].js`:
   - Al pasar a `confirmado`: además del UPDATE de estado, batch de eventos `confirmacion` (por ítem).
   - Al pasar a `entregado`: batch de eventos `entrega`.
   - Transiciones atómicas existentes se conservan (ganar la carrera del UPDATE antes de emitir).
4. `functions/lib/syncV2.js` `listarEventos`: mapear `origen`, `nota`, `estadoEntrega` según `tipo`.
5. Tests: confirmación emite N eventos delta 0; entrega idempotente por UNIQUE; cancelación tras confirmación no duplica stock; snapshot ignora delta 0.
6. Actualizar `PROPUESTA_SINCRONIZACION.md` / BITACORA: el POS **sí** crea historial (sin caja) al recibir `confirmacion`.

## 6. Cambios en el POS (`ropa-cbba`) — fuera de este agente si no hay acceso al repo

1. Al aplicar evento `confirmacion`:
   - Crear (o upsert por `pedidoRef` + ítem) registro en **historial de ventas**.
   - Canal / tipo: **Venta en línea** (o equivalente UI).
   - Estado: **Pendiente de entrega**.
   - **No** sumar efectivo a caja / no abrir movimiento de caja.
   - Idempotencia por `stock_eventos.id` (como el resto de eventos).
2. Al aplicar evento `entrega`:
   - Buscar la venta en línea del `pedidoRef` (e ítem) y poner estado **Entregado**.
3. Al aplicar `cancelacion` / `expiracion` si ya existía historial por ese pedido:
   - Marcar historial **Cancelado**; no tocar caja.
4. UI historial (admin): mostrar canal “Venta en línea” + estado de entrega + ref `#XXXX`.
5. Tag de versión (ej. `v8.2.0`) y nota de pull en la central.

## 7. Flujo extremo a extremo

```
Cliente checkout → nube: stock− + evento venta
                 → POS sync: kárdex VENTA EN LÍNEA (sin historial)

Admin Confirmar  → nube: estado=confirmado + eventos confirmacion (delta 0)
                 → POS sync: historial "Venta en línea / Pendiente de entrega"

Admin Entregar   → nube: estado=entregado + eventos entrega (delta 0)
                 → POS sync: historial "Entregado"
```

## 8. Despliegue (ritual profesional)

1. Merge/PR nube → `main` → Pages deploy automático.  
2. Aplicar migración `008` en D1 remoto **antes** (o junto) al código que inserta los nuevos tipos.  
3. Merge/PR POS → `main` + tag.  
4. En la máquina central: `git pull` (o checkout del tag) y reiniciar el POS.  
5. Sync de prueba con un pedido confirmado; verificar historial y que la caja del día no cambió.

No editar código a mano solo en la tienda: todo cambio sale de GitHub.

## 9. Fuera de alcance

- WhatsApp / correo automático al cliente.
- Crear historial en `comprobante_subido` (solo tras confirmar).
- Textos distintos por tipo de entrega (“Listo para recojo” vs envío): se usa el neutro acordado.
- Cambiar el momento del descuento de stock (sigue en checkout).

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| POS viejo no conoce `confirmacion`/`entrega` | Ignorar tipos desconocidos (ya debería); documentar orden: migrar nube, luego POS |
| CHECK de SQLite no se altera con solo ALTER | Migración: recrear tabla o tabla nueva + copy (patrón D1); probar en local |
| Doble confirmación admin | UNIQUE `(order_item_id, tipo)` + `INSERT OR IGNORE` |
| Confirmar sin evento `venta` previo | Emitir `confirmacion` igual; log de integridad en nube |

## 11. Criterios de éxito

1. Pedido web confirmado aparece en historial POS como **Venta en línea** con **Pendiente de entrega**.  
2. Tras “Marcar entregado” en la web y sync, el mismo registro pasa a **Entregado**.  
3. La caja del POS no aumenta por esa venta.  
4. El kárdex de stock sigue mostrando `VENTA EN LÍNEA #ref` desde el checkout.  
5. Tests nube verdes; ritual GitHub → pull en central documentado.
