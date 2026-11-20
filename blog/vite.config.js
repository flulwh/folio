import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = Number(process.env.BLOG_API_PORT) || 8787;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
      '/uploads': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
