import { HttpError, httpGet } from './native';

// Browser-like headers sent with every request.
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Not.A/Brand";v="8", "Chromium";v="114", "Google Chrome";v="114"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new CancelledError();
}

/** setTimeout as a promise that rejects early with CancelledError on abort. */
export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface GetOptions {
  retries?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called before each retry wait. */
  onRetry?: (error: unknown, attempt: number, waitMs: number) => void;
}

/**
 * GET a URL and return the body as text, retrying with exponential backoff
 * (capped at 30s) like the curl version did. HTTP 4xx/5xx counts as a failure.
 */
export async function get(url: string, headers: Record<string, string> = {}, options: GetOptions = {}) {
  const { retries = 99, timeoutMs = 10_000, signal, onRetry } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    throwIfAborted(signal);
    try {
      return await httpGet(url, { ...DEFAULT_HEADERS, ...headers }, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const wait = Math.min(1000 * 2 ** attempt, 30_000);
        onRetry?.(error, attempt + 1, wait);
        await sleep(wait, signal);
      }
    }
  }
  throw lastError;
}

/** Short, human-readable reason for a failure. */
export function describeError(error: unknown) {
  const text = (error instanceof Error ? error.message : String(error)).trim().split('\n')[0];
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export const isConnectionError = (error: unknown) => error instanceof HttpError && error.kind === 'connect';
