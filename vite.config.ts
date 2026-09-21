import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    // The game also ships inside an Android WebView, which may lag behind Chrome:
    // optional chaining and friends are compiled away instead of being left to a
    // parser that would refuse the whole bundle.
    target: 'es2017',
    outDir: 'dist',
  },
});
