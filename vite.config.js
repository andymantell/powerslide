import { defineConfig } from 'vite';
import { serviceWorker } from './pwa/plugin.js';

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  // three.js alone is ~600 kB; one bundle is fine for a game.
  build: { chunkSizeWarningLimit: 1000 },
  plugins: [serviceWorker()],
});
