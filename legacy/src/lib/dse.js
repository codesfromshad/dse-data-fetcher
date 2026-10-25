import { load } from 'cheerio';
import { curlGet } from './curl.js';
import { isoDate, isoSeconds } from './time.js';

// DSE_BASE_URL lets you point the app at a mirror or a local mock for testing.
export const DSE_URL = process.env.DSE_BASE_URL || 'https://old.dsebd.org/';

const XHR_HEADERS = {
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Connection: 'keep-alive',
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
  Connection: 'keep-alive',
  Referer: DSE_URL,
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

export const COLUMNS = [
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
export const isTreasuryBond = (symbol) => TREASURY_BOND.test(symbol);

/** Hit the home page so curl stores the session cookie in the jar. */
export async function fetchCookie() {
  await curlGet(DSE_URL);
}

export async function fetchSymbols() {
  const body = await curlGet(`${DSE_URL}ajax/suggestList.php?suggestType=tc`, XHR_HEADERS);
  const data = JSON.parse(body);
  if (!Array.isArray(data)) throw new Error('Unexpected ticker symbol response (not an array)');
  return data.map((s) => String(s).trim()).filter(Boolean);
}

/** Fetch and parse one company page. Resolves to a row, or `{ skip: reason }`. */
export async function fetchCompany(symbol) {
  // The outer pipeline retries parse failures too, so keep curl's own retries short.
  const html = await curlGet(
    `${DSE_URL}displayCompany.php?name=${encodeURIComponent(symbol)}`,
    PAGE_HEADERS,
    { retries: 3 },
  );
  return parseCompanyPage(html, symbol);
}

function parseSharePercentage(text) {
  const dateMatch = text.match(/\[(.*?)\]/);
  const numbers = text.match(
    /Sponsor\/Director: (\d+\.\d{2}) Govt: (\d+\.\d{2}) Institute: (\d+\.\d{2}) Foreign: (\d+\.\d{2}) Public: (\d+\.\d{2})/,
  );
  if (!dateMatch || !numbers) throw new Error('share holding percentage not found on page');

  const [, sponsor, govt, institute, foreign, pub] = numbers.map(Number);
  return {
    asOfDate: isoDate(new Date(dateMatch[1].replace('as on ', ''))),
    sponsor_director: sponsor,
    government: govt,
    institute,
    foreign,
    public: pub,
  };
}

export function parseCompanyPage(html, symbol) {
  const $ = load(html);

  // Check the sector first: debentures have no share-holding table, so parsing
  // that before this check used to throw and retry forever.
  const sector = $('h2:contains("Basic Information")').next().find('th:contains("Sector")').next().text().trim();
  if (sector === 'Debenture') return { skip: 'debenture' };

  const companyName = $('h2:contains("Company"):contains("Name:") > i').text().trim();
  if (!companyName) throw new Error('company name not found on page');

  const scripText = $('h2:contains("Company"):contains("Name")')
    .next()
    .find('th:contains("Scrip"):contains("Code:")')
    .text();
  const scripMatch = scripText.match(/\d+/);
  if (!scripMatch) throw new Error('scrip code not found on page');

  const outstanding = $('th:contains("Total"):contains("No."):contains("of"):contains("Outstanding"):contains("Securities")')
    .next()
    .text()
    .replace(/,/g, '');
  const marketCap = $('th:contains("Market"):contains("Capitalization"):contains("(mn)")')
    .next()
    .text()
    .trim()
    .replace(/,/g, '');

  const marketInfo = $('h2:contains("Market"):contains("Information")');
  const lastUpdatedDate = marketInfo.children('i').text();
  const lastUpdatedTime = marketInfo.next().find('th:contains("Last"):contains("Update")').next().text();
  const ycp = marketInfo.next().find(`th:contains("Yesterday's Closing Price")`).next().text();

  const shareRow = $('td:contains("Share"):contains("Holding"):contains("Percentage")');
  const shareText = [shareRow, shareRow.next()]
    .map((row) => row.map((_, el) => $(el).text()).get().pop())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const share = parseSharePercentage(shareText);

  return {
    symbol,
    scrip_code: Number(scripMatch[0]),
    company_name: companyName,
    sector,
    last_updated_timestamp: isoSeconds(new Date(`${lastUpdatedDate} ${lastUpdatedTime}`.trim())),
    yesterdays_closing_price: parseFloat(ycp),
    total_no_of_outstanding_securities: parseInt(outstanding, 10),
    market_capitalization: parseFloat(marketCap),
    share_percentage_as_of_date: share.asOfDate,
    share_percentage_sponsor_director: share.sponsor_director,
    share_percentage_government: share.government,
    share_percentage_institute: share.institute,
    share_percentage_foreign: share.foreign,
    share_percentage_public: share.public,
  };
}
