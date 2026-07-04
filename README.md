# Tienda Virtual — Compra de Ropa

Catálogo de ropa en línea con carrito y pago por código QR. Arquitectura y decisiones: ver `ARQUITECTURA.md`.

## Stack

React + Vite + Tailwind CSS · Cloudflare Pages (hosting) · D1 (base de datos) · R2 (fotos) · Pages Functions (API).

## Desarrollo local

```bash
npm install
npm run dev          # solo la web (sin BD)
npx wrangler pages dev dist   # web + API + BD local (tras npm run build)
```

## Puesta en marcha en Cloudflare (una sola vez)

```bash
npx wrangler login
npx wrangler d1 create tienda-virtual-db        # copiar el database_id a wrangler.toml
npx wrangler r2 bucket create tienda-virtual-fotos
npx wrangler d1 migrations apply tienda-virtual-db --remote
npm run deploy
```

## Estructura

```
src/           React: páginas y componentes
functions/api/ API (Pages Functions sobre D1/R2)
migrations/    SQL de la base de datos, numeradas
wrangler.toml  Conexión del proyecto con D1 y R2
```
