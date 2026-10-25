// UI-thread side of the fetch worker.
import { Worker } from 'node:worker_threads';
import chalk from 'chalk';
import { newCookieJarPath } from './lib/curl.js';
import { trackTempFile } from './lib/temp-files.js';

export const cookieJarPath = newCookieJarPath();

export class OfflineError extends Error {}

/* global __WORKER_SOURCE__ */
// In the compiled exe, build.js bundles worker.js into one CommonJS string and
// injects it here as __WORKER_SOURCE__, so the worker starts from memory with
// `eval: true`. Loading it as a file from inside the exe instead depends on how
// each Bun version lays out its embedded file system, which broke on Windows
// ("ENOENT reading B:\~BUN\root\worker.js").
// Running from source (`bun src/cli.jsx`) there's no injected string, so the
// sibling file is used directly.
function createWorker(options) {
  if (typeof __WORKER_SOURCE__ === 'string') {
    return new Worker(__WORKER_SOURCE__, { ...options, eval: true });
  }
  return new Worker(new URL('./worker.js', import.meta.url), options);
}

/**
 * Start the fetch in a worker thread.
 * Returns { done, stop }: `done` resolves with the result or rejects
 * (OfflineError when there's no connection); `stop()` kills the worker.
 */
export function startFetch({ onLog, onStatus }) {
  const worker = createWorker({
    workerData: { cookieJarPath, colorLevel: chalk.level },
  });

  let settled = false;
  const done = new Promise((resolve, reject) => {
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
      worker.terminate();
    };

    worker.on('message', (msg) => {
      switch (msg.type) {
        case 'log':
          onLog(msg);
          break;
        case 'status':
          onStatus(msg.text);
          break;
        case 'temp-file':
          trackTempFile(msg.path);
          break;
        case 'done':
          finish(resolve, msg.result);
          break;
        case 'error':
          finish(reject, msg.offline ? new OfflineError(msg.message) : new Error(msg.message));
          break;
      }
    });
    worker.on('error', (error) => finish(reject, error));
    worker.on('exit', (code) => finish(reject, new Error(`Fetch worker stopped unexpectedly (exit code ${code})`)));
  });

  return { done, stop: () => worker.terminate() };
}
