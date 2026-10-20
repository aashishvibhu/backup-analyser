import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Production builds get a strict Content-Security-Policy: no connections to other origins,
 * so a parsed backup cannot leave the browser. (Dev is left alone: Vite's HMR needs inline scripts.)
 */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  build: {
    // The chart library is one ~620 kB chunk (~210 kB gzipped), cached separately.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Separate long-lived vendor chunks so app updates do not re-download the chart library.
        manualChunks: { charts: ['echarts', 'zrender'], react: ['react', 'react-dom'] },
      },
    },
  },
});
