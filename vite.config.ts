import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

import { injectCspMeta } from './src/config/csp';

function cspPlugin(): Plugin {
  let isBuild = false;
  return {
    name: 'ghostwire-csp',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    transformIndexHtml(html) {
      return injectCspMeta(html, isBuild);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), cspPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  worker: {
    format: 'es',
  },
});
