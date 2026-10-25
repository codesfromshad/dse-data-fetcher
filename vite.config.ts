import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The single source of the version (`bun run release` bumps it).
import { version } from './package.json';

// Set by `tauri dev` when running on a phone/remote device; unused on desktop.
const host = process.env.TAURI_DEV_HOST;


export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },

  // Tauri expects a fixed port and shows its own (Rust) errors in the terminal.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**', '**/legacy/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],

  build: {
    // WebView2 on Windows is evergreen Chromium.
    target: 'chrome120',
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 2000,
  },
  worker: { format: 'es' },
});
