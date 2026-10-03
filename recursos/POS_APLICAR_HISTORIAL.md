# Aplicar historial "Venta en línea" en el POS (`ropa-cbba`)

## Qué es este parche (en simple)

La tienda **web** ya avisa al POS cuando confirmas o entregas un pedido.
Este parche enseña al POS a **mostrar esa venta en el historial** como:

- **Venta en línea · Pendiente de entrega** (al confirmar en el admin web)
- **Entregado** (cuando marcas entregado en el admin web)

No toca la caja. Solo historial + estado de la prenda.

## Estado

| Paso | Quién | Estado |
|------|--------|--------|
| 1. Migración D1 `008` | agente | Hecho |
| 2. Merge PR tienda-virtual #5 | agente | Hecho |
| 3. Push parche a `ropa-cbba` | **tú** (el bot no tiene write) | Pendiente |
| 4. `git pull` en máquina de producción | tú | Después del paso 3 |

## Paso a paso en tu PC (repo `ropa-cbba`)

Abre una terminal donde tengas clonado `ropa-cbba` y puedas hacer `git push`:

```bash
cd /ruta/a/ropa-cbba

# 1) Actualizar main
git checkout main
git pull origin main

# 2) Rama nueva
git checkout -b cursor/historial-venta-en-linea-52b0

# 3) Aplicar el parche (elige UNA opción)

# Opción A — si también tienes tienda-virtual al lado:
git am ../tienda-virtual/recursos/pos-historial-venta-en-linea.patch

# Opción B — bajar el parche desde GitHub (ya está en main de tienda-virtual):
curl -L -o /tmp/pos-historial.patch \
  https://raw.githubusercontent.com/ianvs007/tienda-virtual/main/recursos/pos-historial-venta-en-linea.patch
git am /tmp/pos-historial.patch

# 4) Subir a GitHub
git push -u origin cursor/historial-venta-en-linea-52b0
```

Luego en GitHub (`ianvs007/ropa-cbba`):

1. Abre el PR de esa rama → **Merge** a `main`.

## Paso a paso en producción (máquina de la tienda)

Cuando `main` ya tenga el merge:

```bash
cd /ruta/a/ropa-cbba
git pull origin main
npm install          # solo si hace falta
npm run build        # si en producción usan la carpeta dist
# reinicia el POS / recarga la app (Ctrl+F5 o reinicio del servicio)
```

## Prueba rápida

1. En el admin web: confirma un pedido con comprobante → sync POS → debe aparecer **Venta en línea · Pendiente de entrega**.
2. Marca el pedido **entregado** en el admin → sync otra vez → estado **Entregado**.
3. La caja del POS no debe cambiar por esa venta.

## Si quieres que el agente lo suba solo

En GitHub → `ropa-cbba` → Settings → Collaborators → invita / da **write** a la GitHub App de Cursor (`cursor[bot]`), y avísame. Hoy solo tiene lectura (403 al pushear).
