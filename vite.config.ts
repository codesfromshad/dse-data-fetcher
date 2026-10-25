import { existsSync, readFileSync } from 'node:fs';
import { transform as transformCss } from 'lightningcss';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { griffel } from '@griffel/vite-plugin';
// The single source of the version (`bun run release` bumps it).
import pkg from './package.json' with { type: 'json' };

// Set by `tauri dev` when running on a phone/remote device; unused on desktop.
const host = process.env.TAURI_DEV_HOST;

/**
 * Fluent ships each component's styles twice: precompiled (`*.styles.js`,
 * CSS as strings inserted at runtime) and as plain `makeStyles` source
 * (`*.styles.raw.js`). Feeding the raw ones to Griffel's plugin moves all of
 * Fluent's CSS into a static stylesheet: less JS, and nothing to insert when
 * a component first mounts. Build only; dev keeps the runtime path.
 */
const FLUENT_STYLES = /[\\/]@fluentui[\\/].+\.styles\.js$/;

function fluentRawStyles(): Plugin[] {
  return [
    {
      name: 'fluent-raw-styles',
      apply: 'build',
      enforce: 'pre',
      load(id) {
        const file = id.split('?')[0];
        if (!FLUENT_STYLES.test(file)) return null;
        const raw = file.replace(/\.styles\.js$/, '.styles.raw.js');
        return existsSync(raw) ? readFileSync(raw, 'utf8') : null;
      },
    },
    {
      // Constants like `const pad = tokens.spacingHorizontalXXS;` only fed the
      // (now extracted) styles. Mark them pure so the 29 KB token map can go.
      name: 'fluent-raw-styles:pure-consts',
      apply: 'build',
      transform(code, id) {
        if (!FLUENT_STYLES.test(id.split('?')[0])) return null;
        return {
          code: code.replace(
            /(^|\*\/\s*)const (\w+) = ([^;\n]*\btokens\.[^;\n]*);$/gm,
            '$1const $2 = /* @__PURE__ */ (() => $3)();',
          ),
          map: null,
        };
      },
    },
  ];
}

/**
 * Griffel's plugin finds its rules by marker comments and sorts them in
 * `generateBundle`, so Vite's own CSS minify (which strips comments earlier)
 * is off and the stylesheet is minified here, after the sort.
 */
function minifyCssAfterGriffel(): Plugin {
  return {
    name: 'minify-css-after-griffel',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'asset' || !fileName.endsWith('.css')) continue;
        const source = typeof output.source === 'string' ? output.source : new TextDecoder().decode(output.source);
        const { code } = transformCss({
          filename: fileName,
          code: new TextEncoder().encode(source),
          minify: true,
          targets: { chrome: 120 << 16 },
        });
        output.source = new TextDecoder().decode(code);
      }
    },
  };
}

export default defineConfig({
  // Order matters: the CSS minifier must run after Griffel's extract step.
  plugins: [react(), ...fluentRawStyles(), griffel(), minifyCssAfterGriffel()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },

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
    // Everything loads from disk; no need for the preload polyfill.
    modulePreload: { polyfill: false },
    // One stylesheet: Griffel's atomic rules rely on their order, which
    // per-chunk CSS loaded later (lazy pages) could break.
    cssCodeSplit: false,
    cssMinify: false,
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      // Build-time styles leave bare reads like `tokens.spacingHorizontalXXS;`
      // behind; treating unused property reads as pure lets the token map go.
      treeshake: { propertyReadSideEffects: false },
    },
  },
});
