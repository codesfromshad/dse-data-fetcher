/// <reference lib="webworker" />
import { parseCompanyPage } from '../lib/parse';

export interface ParseRequest {
  id: number;
  html: string;
  symbol: string;
}

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, html, symbol } = event.data;
  try {
    self.postMessage({ id, ok: true, result: parseCompanyPage(html, symbol) });
  } catch (error) {
    self.postMessage({ id, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
