import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function cspPlugin(): Plugin {
  let isBuild = false;
  return {
    name: 'ghostwire-csp',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    transformIndexHtml(html) {
      const csp = isBuild
        ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; media-src 'self' mediastream: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self';"
        : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; media-src 'self' mediastream: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self';";
      return html.replace(
        '<!-- GHOSTWIRE_CSP -->',
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
      );
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
