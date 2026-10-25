import { COLUMNS, DSE_URL, fetchCompany, fetchCookie, fetchSymbols, isTreasuryBond } from './dse';
import { describeError, sleep, throwIfAborted } from './http';
import { hl, pill, type LogLevel, type LogPart } from './log';
import { checkOnline, openFile, resetHttpSession, writeTempFile } from './native';
import type { CompanyRow } from './parse';
import { ParserPool } from './parser-pool';
import { fileTimestamp, formatDuration } from './time';

// Company pages fetched at once. A small pool is gentler on DSE than firing
// every symbol in parallel, and barely slower.
const CONCURRENCY = 10;
const MAX_ATTEMPTS = 6;

export class OfflineError extends Error {
  constructor() {
    super('No internet connection. Please connect to the internet and try again.');
    this.name = 'OfflineError';
  }
}

export type Stage = 'connecting' | 'symbols' | 'companies' | 'writing' | 'opening';

export interface Counts {
  total: number;
  fetched: number;
  skipped: number;
  failed: number;
}

export interface Progress {
  stage: Stage;
  status: string;
  counts: Counts;
}

export interface FetchResult {
  fileName: string;
  filePath: string;
  counts: Counts;
  failedSymbols: string[];
  elapsedMs: number;
  opened: boolean;
}

export interface FetchCallbacks {
  log: (level: LogLevel, ...parts: LogPart[]) => void;
  progress: (progress: Progress) => void;
  signal: AbortSignal;
  /** Open the workbook when done. False when no spreadsheet app is available. */
  openAfter: boolean;
}

async function runPool<T>(items: T[], limit: number, signal: AbortSignal, worker: (item: T) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      throwIfAborted(signal);
      await worker(items[next++]);
    }
  });
  await Promise.all(runners);
}

async function buildWorkbook(rows: CompanyRow[]) {
  // ExcelJS is big; only load it once it's needed. Its browser build is UMD,
  // so the classes may sit on `default`.
  const mod = (await import('exceljs')) as unknown as typeof import('exceljs') & { default?: typeof import('exceljs') };
  const { Workbook } = mod.default ?? mod;

  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('stock_data');
  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.addRows(rows);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** The whole fetch run. UI-agnostic: talks to the outside world through callbacks. */
export async function runFetch({ log, progress, signal, openAfter }: FetchCallbacks): Promise<FetchResult> {
  const startedAt = performance.now();
  const counts: Counts = { total: 0, fetched: 0, skipped: 0, failed: 0 };
  const report = (stage: Stage, status: string) => progress({ stage, status, counts: { ...counts } });

  const retryLogger = (what: string) => (error: unknown, attempt: number, waitMs: number) =>
    log('warn', `${what} failed `, hl(`(${describeError(error)})`, 'subtle'), `. Retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt})...`);

  report('connecting', 'Checking internet connection...');
  if (!(await checkOnline())) throw new OfflineError();
  throwIfAborted(signal);

  await resetHttpSession(); // fresh cookie jar for this run
  report('connecting', `Fetching cookie from ${DSE_URL}...`);
  await fetchCookie({ signal, onRetry: retryLogger('Fetching the cookie') });
  log('success', `Cookie fetched from ${DSE_URL} successfully!`);

  report('symbols', 'Fetching ticker symbols...');
  const symbols = await fetchSymbols({ signal, onRetry: retryLogger('Fetching ticker symbols') });
  counts.total = symbols.length;
  log('success', `Ticker symbols retrieved from ${DSE_URL} successfully! (`, hl(symbols.length), ' symbols)');

  const failedSymbols: string[] = [];
  const rows: CompanyRow[] = [];
  const companyProgress = () => {
    const done = counts.fetched + counts.skipped + counts.failed;
    report('companies', `Fetching company pages · ${done} of ${counts.total} processed`);
  };
  companyProgress();

  const parser = new ParserPool();
  try {
    await runPool(symbols, CONCURRENCY, signal, async (symbol) => {
      if (isTreasuryBond(symbol)) {
        counts.skipped++;
        log('info', 'Skipping treasury bond ', hl(symbol), '...');
        companyProgress();
        return;
      }

      for (let attempt = 1; ; attempt++) {
        throwIfAborted(signal);
        try {
          const result = await fetchCompany(symbol, parser, signal);
          if ('skip' in result) {
            counts.skipped++;
            log('info', `Skipping ${result.skip} `, hl(symbol), '...');
          } else {
            rows.push(result);
            counts.fetched++;
            log('success', 'Fetched stock data for ', hl(symbol));
          }
          break;
        } catch (error) {
          throwIfAborted(signal);
          if (attempt >= MAX_ATTEMPTS) {
            counts.failed++;
            failedSymbols.push(symbol);
            log('error', 'Failed to fetch stock data for ', hl(symbol), ' after ', hl(attempt), ' attempts: ', hl(describeError(error), 'subtle'));
            break;
          }
          log('warn', 'Failed to fetch stock data for ', hl(symbol), ' ', hl(`(${describeError(error)})`, 'subtle'), `. Retrying (${attempt}/${MAX_ATTEMPTS - 1})...`);
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 15_000), signal);
        }
      }
      companyProgress();
    });
  } finally {
    parser.dispose();
  }

  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  const elapsedMs = performance.now() - startedAt;

  log(
    'success',
    'Fetching ', pill('COMPLETE', 'success'), ' for all ', hl(`${counts.total} ${counts.total === 1 ? 'symbol' : 'symbols'}`),
    ' (', hl(`${counts.fetched} fetched`, 'success'), ', ', hl(`${counts.skipped} skipped`, 'info'), ', ',
    counts.failed ? hl(`${counts.failed} failed`, 'danger') : '0 failed',
    '). Elapsed time: ', pill(formatDuration(elapsedMs), 'subtle'),
  );
  if (failedSymbols.length) log('warn', 'Failed symbols: ', hl(failedSymbols.join(', ')));

  report('writing', 'Creating spreadsheet...');
  const fileName = `temp_stock_data_${fileTimestamp()}.xlsx`;
  const filePath = await writeTempFile(fileName, await buildWorkbook(rows));
  log('success', 'Created ', hl(fileName), ' with the fetched stock data.');
  log('info', hl(fileName), ' is a temporary file and WILL BE DELETED when you close this app. Use “Save a copy” to keep it.');

  let opened = false;
  if (!openAfter) {
    log('warn', 'No spreadsheet application is set up, so ', hl(fileName), ' wasn’t opened. Choose one in Settings, or use “Save a copy”.');
    return { fileName, filePath, counts: { ...counts }, failedSymbols, elapsedMs, opened };
  }

  report('opening', `Opening ${fileName}...`);
  try {
    await openFile(filePath);
    opened = true;
    log('success', 'Opened ', hl(fileName), ' using the default spreadsheet application.');
  } catch (error) {
    log('error', "Couldn't open the file automatically ", hl(`(${describeError(error)})`, 'subtle'), ". It's at: ", hl(filePath));
  }

  return { fileName, filePath, counts: { ...counts }, failedSymbols, elapsedMs, opened };
}
