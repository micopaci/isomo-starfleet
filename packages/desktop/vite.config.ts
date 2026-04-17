import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(args) { args.startup(); },
        vite: {
          build: { outDir: 'dist-electron', sourcemap: true },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) { args.reload(); },
        vite: {
          build: { outDir: 'dist-electron', sourcemap: true },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@starfleet/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
