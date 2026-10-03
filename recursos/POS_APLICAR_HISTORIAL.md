# Aplicar historial "Venta en línea" en el POS (`ropa-cbba`)

El agente cloud **no tiene permiso de escritura** en `ianvs007/ropa-cbba`.
El commit ya está preparado en este parche.

## Opción A — aplicar el parche (en tu PC)

```bash
cd ruta/a/ropa-cbba
git checkout main
git pull
git checkout -b cursor/historial-venta-en-linea-52b0
git am ../tienda-virtual/recursos/pos-historial-venta-en-linea.patch
# o: git apply recursos/pos-historial-venta-en-linea.patch && git add -A && git commit ...
git push -u origin cursor/historial-venta-en-linea-52b0
```

Luego en la máquina central: `git pull` (tras merge a main) y reiniciar el POS.

## Opción B — dar write al bot de Cursor

Añade la GitHub App / colaborador del agente a `ropa-cbba` con permiso de push y pide que vuelva a pushear la rama `cursor/historial-venta-en-linea-52b0`.

## Qué incluye

- Eventos `confirmacion` → historial **Venta en línea / Pendiente de entrega** (sin caja)
- Eventos `entrega` → **Entregado**
- Cancelación web → anula la venta en historial
- Dexie schema v25 (`pedidoRefWeb`, `deliveryStatus`)
- UI en SalesHistory

## Orden de despliegue

1. Aplicar migración `008_eventos_historial.sql` en D1 remoto (tienda-virtual)
2. Merge PR tienda-virtual → Pages
3. Merge + pull POS en la central
4. Confirmar un pedido de prueba → sync → ver historial
