import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Windows 10 1803+ ships curl.exe in System32. Naming the .exe explicitly
// avoids any PATHEXT resolution quirks inside a compiled binary.
const CURL_BIN = process.platform === 'win32' ? 'curl.exe' : 'curl';

// curl persists cookies itself via -b/-c, replacing tough-cookie.
// The UI thread picks the path and hands it to the worker, so it can still
// delete the jar if the app is killed mid-fetch.
export const newCookieJarPath = () => path.join(os.tmpdir(), `dse_cookie_jar_${process.pid}_${Date.now()}.txt`);

let cookieJarPath = newCookieJarPath();
export const setCookieJarPath = (jarPath) => {
  cookieJarPath = jarPath;
};

// Browser-like headers sent with every request.
const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Not.A/Brand";v="8", "Chromium";v="114", "Google Chrome";v="114"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET a URL with curl and return the body as text.
 * Retries with exponential backoff (capped at 30s), mirroring the old
 * axios-retry setup. `--fail` makes HTTP 4xx/5xx count as failures so they
 * get retried instead of being parsed as if they were real pages.
 */
export async function curlGet(url, headers = {}, { retries = 99, timeoutMs = 10_000 } = {}) {
  const headerArgs = Object.entries({ ...DEFAULT_HEADERS, ...headers }).flatMap(([key, value]) => [
    '-H',
    `${key}: ${value}`,
  ]);

  const args = [
    '-s', // silent
    '-S', // ...but still report errors
    '-L', // follow redirects
    '--fail', // non-2xx => non-zero exit
    '--max-time', String(Math.ceil(timeoutMs / 1000)),
    '-b', cookieJarPath, // read cookies
    '-c', cookieJarPath, // write cookies
    ...headerArgs,
    url,
  ];

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { stdout } = await execFileAsync(CURL_BIN, args, {
        maxBuffer: 50 * 1024 * 1024,
        windowsHide: true,
      });
      return stdout;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`'${CURL_BIN}' was not found on PATH. curl is required to talk to the DSE website.`);
      }
      lastError = error;
      if (attempt < retries) await sleep(Math.min(1000 * 2 ** attempt, 30_000));
    }
  }
  throw lastError;
}

/** Short, human-readable reason for a failed curl call (the raw error embeds the whole command line). */
export function describeError(error) {
  const text = (error?.stderr || error?.message || String(error)).trim().split('\n')[0];
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export function cleanupCookieJar(jarPath = cookieJarPath) {
  try {
    fs.rmSync(jarPath, { force: true });
  } catch {
    // best effort
  }
}
