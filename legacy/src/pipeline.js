import { spawn } from 'node:child_process';
import dns from 'node:dns';
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import ExcelJS from 'exceljs';
import { describeError, sleep } from './lib/curl.js';
import { COLUMNS, DSE_URL, fetchCompany, fetchCookie, fetchSymbols, isTreasuryBond } from './lib/dse.js';
import { fileTimestamp, formatDuration } from './lib/time.js';

// Company pages fetched at once. The old version fired every symbol in
// parallel (hundreds of curl processes); a small pool is gentler on DSE and
// on the machine, and barely slower.
const CONCURRENCY = 10;
const MAX_ATTEMPTS = 6;

export class OfflineError extends Error {
  constructor() {
    super('No internet connection. Please connect to the internet and then re-run the app.');
    this.name = 'OfflineError';
  }
}

// Padded "badge" for log lines. Uses non-breaking spaces so wrapping can
// neither split the badge nor trim its padding.
const badge = (text, style) => style(`\u00A0${text}\u00A0`);

async function connectedToInternet() {
  try {
    await dns.promises.resolve('www.google.com');
    return true;
  } catch {
    return false;
  }
}

async function runPool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function writeWorkbook(rows, onTempFile) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('stock_data');
  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.addRows(rows);

  const fileName = `temp_stock_data_${fileTimestamp()}.xlsx`;
  const filePath = path.join(os.tmpdir(), fileName);
  onTempFile(filePath); // report before writing, so a half-written file still gets cleaned up
  await workbook.xlsx.writeFile(filePath);
  return { fileName, filePath };
}

/** Open a file with the OS default app, without waiting for it. */
export function openWithDefaultApp(filePath) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['explorer.exe', [filePath]] // safe with spaces in the path, unlike `cmd /c start`
      : process.platform === 'darwin'
        ? ['open', [filePath]]
        : ['xdg-open', [filePath]];

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * The whole fetch run. UI-agnostic: it only talks to the outside world through
 * callbacks, so it can run in a worker thread (see worker.js).
 *   log(level, message) · status(text) · onTempFile(path)
 */
export async function runFetch({ log, status, onTempFile = () => {} }) {
  const startedAt = performance.now();

  status('Checking internet connection...');
  if (!(await connectedToInternet())) throw new OfflineError();

  status(`Fetching cookie from ${DSE_URL}...`);
  await fetchCookie();
  log('success', `Cookie fetched from ${DSE_URL} successfully!`);

  status(`Fetching ticker symbols from ${DSE_URL}...`);
  const symbols = await fetchSymbols();
  log('success', `Ticker symbols retrieved from ${DSE_URL} successfully! (${chalk.yellow(symbols.length)} symbols)`);

  const counts = { total: symbols.length, fetched: 0, skipped: 0, failed: 0 };
  const failedSymbols = [];
  const rows = [];

  const progress = () => {
    const done = counts.fetched + counts.skipped + counts.failed;
    status(
      `${done}/${counts.total} processed · ${counts.fetched} fetched · ${counts.skipped} skipped` +
        (counts.failed ? ` · ${counts.failed} failed` : '') +
        ' — please wait...',
    );
  };
  progress();

  await runPool(symbols, CONCURRENCY, async (symbol) => {
    if (isTreasuryBond(symbol)) {
      counts.skipped++;
      log('info', `Skipping treasury bond ${symbol}...`);
      progress();
      return;
    }

    for (let attempt = 1; ; attempt++) {
      try {
        const result = await fetchCompany(symbol);
        if (result.skip) {
          counts.skipped++;
          log('info', `Skipping ${result.skip} ${symbol}...`);
        } else {
          rows.push(result);
          counts.fetched++;
          log('success', `Fetched stock data for ${symbol}`);
        }
        break;
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS) {
          counts.failed++;
          failedSymbols.push(symbol);
          log('error', `Failed to fetch stock data for ${symbol} after ${chalk.yellow(attempt)} attempts: ${chalk.dim(describeError(error))}`);
          break;
        }
        log('warn', `Failed to fetch stock data for ${symbol} ${chalk.dim(`(${describeError(error)})`)}. Retrying (${attempt}/${MAX_ATTEMPTS - 1})...`);
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 15_000));
      }
    }
    progress();
  });

  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const plural = counts.total === 1 ? 'symbol' : 'symbols';
  log(
    'success',
    `Fetching ${badge('COMPLETE', chalk.bgGreen.whiteBright)} for all ${chalk.yellow(counts.total)} ${chalk.yellow(plural)} ` +
      `(${chalk.green(`${counts.fetched} fetched`)}, ${chalk.cyan(`${counts.skipped} skipped`)}, ` +
      `${counts.failed ? chalk.red(`${counts.failed} failed`) : '0 failed'}). ` +
      `Elapsed time: ${badge(formatDuration(performance.now() - startedAt), chalk.bgWhite.black)}`,
  );
  if (failedSymbols.length) log('warn', `Failed symbols: ${chalk.yellow(failedSymbols.join(', '))}`);

  status('Creating spreadsheet...');
  const { fileName, filePath } = await writeWorkbook(rows, onTempFile);
  log('success', `Created ${chalk.yellow(fileName)} with the fetched stock data.`);
  log('info', `${chalk.yellow(fileName)} is a temporary file and WILL BE DELETED when you exit this application. Please save the file if you want to keep it.`);

  status(`Opening ${fileName}...`);
  try {
    await openWithDefaultApp(filePath);
    log('success', `Opened ${chalk.yellow(fileName)} using the default spreadsheet application.`);
  } catch (error) {
    log('error', `Couldn't open the file automatically ${chalk.dim(`(${describeError(error)})`)}. It's at: ${chalk.yellow(filePath)}`);
  }

  return { fileName, filePath, counts, failedSymbols };
}
