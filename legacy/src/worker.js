// Runs the whole fetch (curl spawns, cheerio parsing, ExcelJS) off the UI
// thread. Parsing a DSE company page with cheerio can block for hundreds of
// milliseconds; in here that only blocks this worker, never the Ink UI.
import { parentPort, workerData } from 'node:worker_threads';
import chalk from 'chalk';
import { describeError, setCookieJarPath } from './lib/curl.js';
import { logTimestamp } from './lib/time.js';
import { OfflineError, runFetch } from './pipeline.js';

// A worker's stdout isn't a TTY, so chalk would detect "no colour support" and
// strip all styling. Use whatever level the UI thread detected instead.
chalk.level = workerData.colorLevel;
setCookieJarPath(workerData.cookieJarPath);

const post = (message) => parentPort.postMessage(message);

// No top-level await: in the compiled exe this file is bundled as CommonJS
// (see build.js), where top-level await isn't allowed.
async function main() {
  try {
    const result = await runFetch({
      log: (level, message) => post({ type: 'log', level, message, time: logTimestamp() }),
      status: (text) => post({ type: 'status', text }),
      onTempFile: (path) => post({ type: 'temp-file', path }),
    });
    post({ type: 'done', result });
  } catch (error) {
    const offline = error instanceof OfflineError;
    post({ type: 'error', offline, message: offline ? error.message : describeError(error) });
  }
}

main();
