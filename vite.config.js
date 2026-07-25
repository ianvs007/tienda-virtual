import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // La API de producción (catálogo, fotos, pedidos) se usa en desarrollo local
      // para ver las prendas reales con sus imágenes. Para probar con BD local:
      // npm run build && npx wrangler pages dev dist
      '/api': {
        target: 'https://tienda-virtual-26n.pages.dev',
        changeOrigin: true,
      },
    },
  },
});
