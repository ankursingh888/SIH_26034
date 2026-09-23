import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/upload-photos': 'http://localhost:3001',
      '/submit-inspection': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
