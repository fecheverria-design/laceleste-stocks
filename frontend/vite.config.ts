import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true, // escucha en todas las interfaces → accesible desde otras PCs de la red (LAN)
    // Permite servir el dev server detrás de un host externo (túnel cloudflared/ngrok o
    // por hostname en la LAN). Solo afecta al dev server, no al build de producción.
    allowedHosts: true,
    proxy: {
      // En dev, /api pega al backend Express. Evita CORS y replica el deploy.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
