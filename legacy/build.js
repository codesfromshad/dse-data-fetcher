// Compiles the app into a standalone executable with Bun.
//
//   bun build.js                 -> Windows x64 .exe (default)
//   bun build.js linux|mac|all   -> other targets
//
// Ink has an optional `react-devtools-core` import that only runs when
// DEV=true. Bun inlines that dynamic import into the single-file bundle, which
// turns it into a hard dependency, so we resolve it to an empty stub instead.

import { stampWindowsResources } from './scripts/windows-resources.js';

const TARGETS = {
  windows: { target: 'bun-windows-x64', outfile: 'dist/dse-data-fetcher.exe' },
  linux: { target: 'bun-linux-x64', outfile: 'dist/dse-data-fetcher' },
  mac: { target: 'bun-darwin-arm64', outfile: 'dist/dse-data-fetcher-mac' },
};

const stubDevtools = {
  name: 'stub-react-devtools-core',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'react-devtools-core',
      namespace: 'stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export default { initialize() {}, connectToDevTools() {} };',
      loader: 'js',
    }));
  },
};

// Windows icon + file properties (Explorer → Properties → Details).
const pkg = await Bun.file('./package.json').json();
const WINDOWS_META = {
  icon: './assets/icon.ico',
  productName: 'DSE Data Fetcher',
  description: 'DSE Data Fetcher',
  company: 'Shadman Rafid Chowdhury (codesfromshad)',
  copyright: `Copyright © ${new Date().getFullYear()} Shadman Rafid Chowdhury (codesfromshad). All rights reserved.`,
  // Windows wants four numbers: "0.1.0-beta" -> [0, 1, 0, 0]
  productVersion: pkg.version,
  version: [...pkg.version.split('-')[0].split('.').map(Number), 0, 0, 0, 0].slice(0, 4),
};

/**
 * Explorer caches icons by file path, so an exe rebuilt at the same path keeps
 * showing the old (Bun) icon. When building on Windows, ask the shell to
 * refresh its icon cache. Best effort; does nothing on other OSes.
 */
function refreshExplorerIconCache() {
  if (process.platform !== 'win32') return;
  try {
    Bun.spawnSync(['ie4uinit.exe', '-show'], { stdout: 'ignore', stderr: 'ignore' });
  } catch {
    // not fatal: renaming or moving the exe also forces a fresh icon
  }
}

/**
 * Bundle the fetch worker into a single CommonJS string. The app starts the
 * worker from this string (`new Worker(code, { eval: true })`), so nothing has
 * to be looked up in the exe's embedded file system at runtime.
 * target 'node' matters: Bun's own CJS output wraps the code in a function that
 * only Bun's module loader calls, which would silently do nothing under eval.
 */
async function bundleWorker() {
  const result = await Bun.build({
    entrypoints: ['./src/worker.js'],
    target: 'node',
    format: 'cjs',
    minify: true,
    define: { 'process.env.DEV': '"false"' },
    plugins: [stubDevtools],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  return result.outputs[0].text();
}

const workerSource = await bundleWorker();

const arg = process.argv[2] ?? 'windows';
const names = arg === 'all' ? Object.keys(TARGETS) : [arg];

for (const name of names) {
  const config = TARGETS[name];
  if (!config) {
    console.error(`Unknown target "${name}". Use one of: ${Object.keys(TARGETS).join(', ')}, all`);
    process.exit(1);
  }

  const result = await Bun.build({
    entrypoints: ['./src/cli.jsx'],
    minify: true,
    define: { 'process.env.DEV': '"false"', __WORKER_SOURCE__: JSON.stringify(workerSource) },
    plugins: [stubDevtools],
    compile: { target: config.target, outfile: config.outfile },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }

  if (name === 'windows') {
    await stampWindowsResources(config.outfile, WINDOWS_META);
    refreshExplorerIconCache();
  }

  console.log(`✔ ${name.padEnd(7)} -> ${config.outfile}`);
}
