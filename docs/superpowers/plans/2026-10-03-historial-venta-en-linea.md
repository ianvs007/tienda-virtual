# Historial venta en línea — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al confirmar un pedido web, el POS recibe eventos `confirmacion`/`entrega` (delta 0) para mostrar en historial “Venta en línea” con estado Pendiente de entrega → Entregado, sin tocar caja.

**Architecture:** Extender `stock_eventos.tipo` con `confirmacion` y `entrega` (delta 0). Emitirlos desde `PUT /api/admin/pedidos/:codigo`. `listarEventos` expone `estadoEntrega`/`origen`/`nota`. El POS (repo aparte) aplica esos tipos al historial.

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite), node:test, React admin (sin UI nueva obligatoria).

## Global Constraints

- Historial solo tras `confirmado` (no en `comprobante_subido`).
- Estados: `pendiente_entrega` → `entregado` (texto UI: Pendiente de entrega / Entregado).
- Caja del POS: nunca.
- Stock: sin cambio en confirmación/entrega (delta 0).
- Migración 008 en D1 remoto antes/junto al deploy que inserta los nuevos tipos.
- POS (`ropa-cbba`): fuera de alcance si no hay acceso al repo; documentar contrato en BITACORA/PROPUESTA.

---

### Task 1: Migración 008 + deltaDeEvento / TIPOS

**Files:**
- Create: `migrations/008_eventos_historial.sql`
- Modify: `functions/lib/eventos.js`
- Test: `functions/lib/eventos.test.js`

**Interfaces:**
- Produces: `TIPOS_EVENTO` incluye `confirmacion`,`entrega`; `deltaDeEvento(tipo, cantidad)` → 0 para esos tipos; `sentenciaEventoStock` los acepta.

- [ ] **Step 1:** Tests fallando para delta 0 y tipos nuevos
- [ ] **Step 2:** Implementar `deltaDeEvento` + `TIPOS_EVENTO`
- [ ] **Step 3:** Migración recreate `stock_eventos` con nuevo CHECK
- [ ] **Step 4:** `node --test functions/lib/eventos.test.js` PASS
- [ ] **Step 5:** Commit

### Task 2: Emitir eventos al confirmar / entregar

**Files:**
- Modify: `functions/api/admin/pedidos/[codigo].js`
- Test: ampliar `functions/lib/eventos.test.js` o test de helper de batch

**Interfaces:**
- Consumes: `itemsParaReponer`, `sentenciaEventoStock`
- Produces: tras UPDATE a `confirmado`/`entregado`, batch de eventos por ítem

- [ ] **Step 1:** Tras ganar carrera de estado, si `confirmado` o `entregado`, batch eventos
- [ ] **Step 2:** Tests / verificación manual de SQL generado
- [ ] **Step 3:** Commit

### Task 3: listarEventos + docs

**Files:**
- Modify: `functions/lib/syncV2.js` (`listarEventos`)
- Modify: `PROPUESTA_SINCRONIZACION.md`, `BITACORA.md` (entrada corta)
- Test: `functions/lib/syncV2.test.js` si hace falta assert de campos nuevos

- [ ] **Step 1:** Mapear `estadoEntrega` en listarEventos
- [ ] **Step 2:** Docs contrato POS
- [ ] **Step 3:** Suite completa + build
- [ ] **Step 4:** Commit + push + actualizar PR
