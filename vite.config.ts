import { defineConfig } from 'vite';

export default defineConfig({
  base: '/road-realms/',
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
