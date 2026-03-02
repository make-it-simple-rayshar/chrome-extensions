import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/background/index.ts'),
      formats: ['iife'],
      name: 'background',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'background.js',
        extend: true,
      },
    },
  },
});
