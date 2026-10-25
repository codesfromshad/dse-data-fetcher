import type { Column } from 'exceljs';
import { get, type GetOptions } from './http';
import type { ParserPool } from './parser-pool';

export const DSE_URL = 'https://old.dsebd.org/';

const XHR_HEADERS = {
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: DSE_URL,
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'X-Requested-With': 'XMLHttpRequest',
};

const PAGE_HEADERS = {
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'max-age=0',
  Referer: DSE_URL,
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

export const COLUMNS: Partial<Column>[] = [
  { header: 'Scrip Code', key: 'scrip_code', width: 10 },
  { header: 'Symbol', key: 'symbol', width: 10 },
  { header: 'Company Name', key: 'company_name', width: 50 },
  { header: 'Sector', key: 'sector', width: 30 },
  { header: 'Last Updated Timestamp', key: 'last_updated_timestamp', width: 30 },
  { header: "Yesterday's Closing Price", key: 'yesterdays_closing_price', width: 20 },
  { header: 'Total No. of Outstanding Securities', key: 'total_no_of_outstanding_securities', width: 30 },
  { header: 'Market Capitalization', key: 'market_capitalization', width: 30 },
  { header: 'As Of Date', key: 'share_percentage_as_of_date', width: 20 },
  { header: 'Sponsor/Director', key: 'share_percentage_sponsor_director', width: 10 },
  { header: 'Government', key: 'share_percentage_government', width: 10 },
  { header: 'Institute', key: 'share_percentage_institute', width: 10 },
  { header: 'Foreign', key: 'share_percentage_foreign', width: 10 },
  { header: 'Public', key: 'share_percentage_public', width: 10 },
];

const TREASURY_BOND = /^TB(2Y|5Y|10Y|15Y|20Y)\d{4}$/;
export const isTreasuryBond = (symbol: string) => TREASURY_BOND.test(symbol);

/** Hit the home page so the session cookie lands in the jar. */
export async function fetchCookie(options?: GetOptions) {
  await get(DSE_URL, {}, options);
}

export async function fetchSymbols(options?: GetOptions) {
  const body = await get(`${DSE_URL}ajax/suggestList.php?suggestType=tc`, XHR_HEADERS, options);
  const data: unknown = JSON.parse(body);
  if (!Array.isArray(data)) throw new Error('Unexpected ticker symbol response (not an array)');
  return data.map((s) => String(s).trim()).filter(Boolean);
}

/** Fetch and parse one company page. Resolves to a row, or `{ skip: reason }`. */
export async function fetchCompany(symbol: string, parser: ParserPool, signal?: AbortSignal) {
  // The pipeline retries parse failures too, so keep the request's own retries short.
  const html = await get(`${DSE_URL}displayCompany.php?name=${encodeURIComponent(symbol)}`, PAGE_HEADERS, {
    retries: 3,
    signal,
  });
  return parser.parse(html, symbol);
}
