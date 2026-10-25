// DSE company-page parser. Runs inside a Web Worker (see parse.worker.ts):
// cheerio can block for hundreds of ms on a big page, and in there it only
// blocks the worker, never the window.
import { load } from 'cheerio';
import { isoDate, isoSeconds } from './time';

export interface CompanyRow {
  symbol: string;
  scrip_code: number;
  company_name: string;
  sector: string;
  last_updated_timestamp: string;
  yesterdays_closing_price: number;
  total_no_of_outstanding_securities: number;
  market_capitalization: number;
  share_percentage_as_of_date: string;
  share_percentage_sponsor_director: number;
  share_percentage_government: number;
  share_percentage_institute: number;
  share_percentage_foreign: number;
  share_percentage_public: number;
}

export type ParseResult = CompanyRow | { skip: string };

function parseSharePercentage(text: string) {
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

export function parseCompanyPage(html: string, symbol: string): ParseResult {
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
    .map((row) =>
      row
        .map((_, el) => $(el).text())
        .get()
        .pop(),
    )
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
