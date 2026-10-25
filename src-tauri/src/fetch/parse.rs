//! DSE company-page parser (was cheerio in a Web Worker).
//!
//! The selectors are a straight port of the cheerio ones, including jQuery's
//! `:contains()` (an element whose text contains a string), `.next()` (next
//! sibling element), `.find()` and `.text()` (concatenated text of every
//! matched element).

use std::sync::LazyLock;

use regex::Regex;
use scraper::{ElementRef, Html};

use super::time::{iso_date, iso_seconds};

/// One spreadsheet row. `None` = the page had no usable number there (NaN in
/// the old version); those cells are written blank.
#[derive(Debug, Clone, PartialEq)]
pub struct CompanyRow {
    pub symbol: String,
    pub scrip_code: u64,
    pub company_name: String,
    pub sector: String,
    pub last_updated_timestamp: String,
    pub yesterdays_closing_price: Option<f64>,
    pub total_no_of_outstanding_securities: Option<f64>,
    pub market_capitalization: Option<f64>,
    pub share_percentage_as_of_date: String,
    pub share_percentage_sponsor_director: f64,
    pub share_percentage_government: f64,
    pub share_percentage_institute: f64,
    pub share_percentage_foreign: f64,
    pub share_percentage_public: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ParseResult {
    Row(Box<CompanyRow>),
    /// Not a company we write out (e.g. a debenture); the reason is logged.
    Skip(&'static str),
}

// --- jQuery-ish helpers ------------------------------------------------------

type Set<'a> = Vec<ElementRef<'a>>;

fn text_of(element: ElementRef) -> String {
    element.text().collect()
}

fn matches(element: ElementRef, tag: &str, needles: &[&str]) -> bool {
    if element.value().name() != tag {
        return false;
    }
    if needles.is_empty() {
        return true;
    }
    let text = text_of(element);
    needles.iter().all(|needle| text.contains(needle))
}

/// `$('tag:contains(a):contains(b)')`
fn select<'a>(document: &'a Html, tag: &str, needles: &[&str]) -> Set<'a> {
    document
        .root_element()
        .descendants()
        .filter_map(ElementRef::wrap)
        .filter(|el| matches(*el, tag, needles))
        .collect()
}

fn dedupe(mut set: Set<'_>) -> Set<'_> {
    let mut seen = std::collections::HashSet::new();
    set.retain(|el| seen.insert(el.id()));
    set
}

/// `.next()`
fn next<'a>(set: &Set<'a>) -> Set<'a> {
    dedupe(set.iter().filter_map(|el| el.next_siblings().find_map(ElementRef::wrap)).collect())
}

/// `.find('tag:contains(...)')`
fn find<'a>(set: &Set<'a>, tag: &str, needles: &[&str]) -> Set<'a> {
    dedupe(
        set.iter()
            .flat_map(|el| el.descendants().skip(1).filter_map(ElementRef::wrap))
            .filter(|el| matches(*el, tag, needles))
            .collect(),
    )
}

/// `.children('tag')`
fn children<'a>(set: &Set<'a>, tag: &str) -> Set<'a> {
    set.iter()
        .flat_map(|el| el.children().filter_map(ElementRef::wrap))
        .filter(|el| el.value().name() == tag)
        .collect()
}

/// `.text()`
fn text(set: &Set) -> String {
    set.iter().map(|el| text_of(*el)).collect()
}

// --- JS number parsing -------------------------------------------------------

static FLOAT_PREFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?").unwrap());
static INT_PREFIX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[+-]?\d+").unwrap());

/// `parseFloat`: the longest numeric prefix after leading whitespace.
fn parse_float(text: &str) -> Option<f64> {
    let m = FLOAT_PREFIX.find(text.trim_start())?;
    m.as_str().parse().ok().filter(|v: &f64| v.is_finite())
}

/// `parseInt(text, 10)`
fn parse_int(text: &str) -> Option<f64> {
    let m = INT_PREFIX.find(text.trim_start())?;
    m.as_str().parse().ok().filter(|v: &f64| v.is_finite())
}

// --- the page ----------------------------------------------------------------

static SHARE_DATE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[(.*?)\]").unwrap());
static SHARE_NUMBERS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"Sponsor/Director: (\d+\.\d{2}) Govt: (\d+\.\d{2}) Institute: (\d+\.\d{2}) Foreign: (\d+\.\d{2}) Public: (\d+\.\d{2})",
    )
    .unwrap()
});
static DIGITS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d+").unwrap());
static WHITESPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

struct SharePercentage {
    as_of_date: String,
    values: [f64; 5],
}

fn parse_share_percentage(text: &str) -> Result<SharePercentage, String> {
    let not_found = || "share holding percentage not found on page".to_string();
    let date = SHARE_DATE.captures(text).ok_or_else(not_found)?;
    let numbers = SHARE_NUMBERS.captures(text).ok_or_else(not_found)?;
    let value = |i: usize| numbers[i].parse::<f64>().unwrap_or(f64::NAN);
    Ok(SharePercentage {
        // `replacen`: the JS `.replace('as on ', '')` only replaced the first one.
        as_of_date: iso_date(&date[1].replacen("as on ", "", 1)),
        values: [value(1), value(2), value(3), value(4), value(5)],
    })
}

/// Parse one company page. `Err` = the page is missing something essential
/// (the caller fetches it again).
pub fn parse_company_page(html: &str, symbol: &str) -> Result<ParseResult, String> {
    let document = Html::parse_document(html);

    // Check the sector first: debentures have no share-holding table.
    let basic_info = select(&document, "h2", &["Basic Information"]);
    let sector = text(&next(&find(&next(&basic_info), "th", &["Sector"]))).trim().to_string();
    if sector == "Debenture" {
        return Ok(ParseResult::Skip("debenture"));
    }

    let company_name = text(&children(&select(&document, "h2", &["Company", "Name:"]), "i")).trim().to_string();
    if company_name.is_empty() {
        return Err("company name not found on page".into());
    }

    let scrip_text = text(&find(&next(&select(&document, "h2", &["Company", "Name"])), "th", &["Scrip", "Code:"]));
    let scrip_code = DIGITS
        .find(&scrip_text)
        .and_then(|m| m.as_str().parse().ok())
        .ok_or("scrip code not found on page")?;

    let outstanding = text(&next(&select(&document, "th", &["Total", "No.", "of", "Outstanding", "Securities"])))
        .replace(',', "");
    let market_cap = text(&next(&select(&document, "th", &["Market", "Capitalization", "(mn)"])))
        .trim()
        .replace(',', "");

    let market_info = select(&document, "h2", &["Market", "Information"]);
    let last_updated_date = text(&children(&market_info, "i"));
    let market_table = next(&market_info);
    let last_updated_time = text(&next(&find(&market_table, "th", &["Last", "Update"])));
    let ycp = text(&next(&find(&market_table, "th", &["Yesterday's Closing Price"])));

    // Last matching cell, then the last cell after one: same as the cheerio
    // `.map(text).get().pop()` on each.
    let share_cells = select(&document, "td", &["Share", "Holding", "Percentage"]);
    let last_text = |set: &Set| set.last().map(|el| text_of(*el)).unwrap_or_default();
    let share_text = format!("{} {}", last_text(&share_cells), last_text(&next(&share_cells)));
    let share_text = WHITESPACE.replace_all(&share_text, " ");
    let share = parse_share_percentage(share_text.trim())?;
    let [sponsor, government, institute, foreign, public] = share.values;

    let timestamp = format!("{last_updated_date} {last_updated_time}");
    Ok(ParseResult::Row(Box::new(CompanyRow {
        symbol: symbol.to_string(),
        scrip_code,
        company_name,
        sector,
        last_updated_timestamp: iso_seconds(timestamp.trim()),
        yesterdays_closing_price: parse_float(&ycp),
        total_no_of_outstanding_securities: parse_int(&outstanding),
        market_capitalization: parse_float(&market_cap),
        share_percentage_as_of_date: share.as_of_date,
        share_percentage_sponsor_director: sponsor,
        share_percentage_government: government,
        share_percentage_institute: institute,
        share_percentage_foreign: foreign,
        share_percentage_public: public,
    })))
}

/// Trimmed-down copy of a DSE `displayCompany.php` page: same nesting and
/// labels the selectors rely on.
#[cfg(test)]
pub(crate) fn fixture_page(sector: &str, ycp: &str, share_table: bool) -> String {
        let share = if share_table {
            r#"<tr>
                 <td>Share Holding Percentage<br>[as on Sep 30, 2026]</td>
                 <td><table><tr>
                   <td>Sponsor/Director:<br>
                     34.12</td>
                   <td>Govt:<br>
                     0.00</td>
                   <td>Institute:<br>
                     22.45</td>
                   <td>Foreign:<br>
                     12.03</td>
                   <td>Public:<br>
                     31.40</td>
                 </tr></table></td>
               </tr>"#
        } else {
            ""
        };
        format!(
            r#"<html><body>
            <h2 class="BodyHead topBodyHead">Company Name: <i>Square Pharmaceuticals PLC.</i></h2>
            <div class="table-responsive"><table>
              <tr><th>Trading Code: SQURPHARMA</th><th>Scrip Code: 12345</th></tr>
            </table></div>
            <h2 class="BodyHead topBodyHead">Market Information <i>Oct 22, 2026</i></h2>
            <div class="table-responsive"><table>
              <tr><th>Last Trading Price</th><td>212.50</td><th>Last Update</th><td>2:30 PM</td></tr>
              <tr><th>Yesterday's Closing Price</th><td>{ycp}</td></tr>
              <tr><th>Market Capitalization (mn)</th><td> 188,375.12 </td></tr>
            </table></div>
            <h2 class="BodyHead topBodyHead">Basic Information</h2>
            <div class="table-responsive"><table>
              <tr><th>Total No. of Outstanding Securities</th><td>886,451,010</td></tr>
              <tr><th>Sector</th><td> {sector} </td></tr>
            </table></div>
            <h2 class="BodyHead topBodyHead">Other Information of the Company</h2>
            <div class="table-responsive"><table>{share}</table></div>
            </body></html>"#
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(sector: &str, ycp: &str, share_table: bool) -> String {
        fixture_page(sector, ycp, share_table)
    }

    fn row(html: &str) -> CompanyRow {
        match parse_company_page(html, "SQURPHARMA").unwrap() {
            ParseResult::Row(row) => *row,
            other => panic!("expected a row, got {other:?}"),
        }
    }

    #[test]
    fn parses_a_company_page() {
        let r = row(&page("Pharmaceuticals &amp; Chemicals", "211.90", true));
        assert_eq!(r.symbol, "SQURPHARMA");
        assert_eq!(r.scrip_code, 12345);
        assert_eq!(r.company_name, "Square Pharmaceuticals PLC.");
        assert_eq!(r.sector, "Pharmaceuticals & Chemicals");
        assert!(r.last_updated_timestamp.starts_with("2026-10-22T14:30:00"), "{}", r.last_updated_timestamp);
        assert_eq!(r.yesterdays_closing_price, Some(211.9));
        assert_eq!(r.total_no_of_outstanding_securities, Some(886_451_010.0));
        assert_eq!(r.market_capitalization, Some(188_375.12));
        assert_eq!(r.share_percentage_as_of_date, "2026-09-30");
        assert_eq!(r.share_percentage_sponsor_director, 34.12);
        assert_eq!(r.share_percentage_government, 0.0);
        assert_eq!(r.share_percentage_institute, 22.45);
        assert_eq!(r.share_percentage_foreign, 12.03);
        assert_eq!(r.share_percentage_public, 31.40);
    }

    #[test]
    fn blank_numbers_come_back_as_none() {
        let r = row(&page("Bank", "-", true));
        assert_eq!(r.yesterdays_closing_price, None);
        assert_eq!(r.market_capitalization, Some(188_375.12));
    }

    #[test]
    fn debentures_are_skipped_before_the_share_table() {
        let result = parse_company_page(&page("Debenture", "100", false), "X").unwrap();
        assert_eq!(result, ParseResult::Skip("debenture"));
    }

    #[test]
    fn missing_pieces_are_errors() {
        let err = parse_company_page(&page("Bank", "1", false), "X").unwrap_err();
        assert!(err.contains("share holding"), "{err}");
        let err = parse_company_page("<html><body>Maintenance</body></html>", "X").unwrap_err();
        assert!(err.contains("company name"), "{err}");
    }

    #[test]
    fn js_number_parsing() {
        assert_eq!(parse_float(" 12.5abc"), Some(12.5));
        assert_eq!(parse_float(".5"), Some(0.5));
        assert_eq!(parse_float("1e3"), Some(1000.0));
        assert_eq!(parse_float(""), None);
        assert_eq!(parse_float("-"), None);
        assert_eq!(parse_int("886451010\n"), Some(886_451_010.0));
        assert_eq!(parse_int("12.9"), Some(12.0));
        assert_eq!(parse_int("abc"), None);
    }
}
