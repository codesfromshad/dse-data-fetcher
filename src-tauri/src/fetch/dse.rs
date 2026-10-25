//! The DSE website: URLs, request headers, and the three things we fetch.

use std::sync::LazyLock;

use regex::Regex;
use tokio_util::sync::CancellationToken;

use super::{
    http::{self, GetError, Headers, HttpError, Retry},
    metrics::Metrics,
};

pub const DSE_URL: &str = "https://old.dsebd.org/";

const XHR_HEADERS: &Headers = &[
    ("Accept", "*/*"),
    ("Accept-Language", "en-US,en;q=0.9"),
    ("Referer", DSE_URL),
    ("Sec-Fetch-Dest", "empty"),
    ("Sec-Fetch-Mode", "cors"),
    ("Sec-Fetch-Site", "same-origin"),
    ("X-Requested-With", "XMLHttpRequest"),
];

const PAGE_HEADERS: &Headers = &[
    (
        "Accept",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    ),
    ("Accept-Language", "en-US,en;q=0.9"),
    ("Cache-Control", "max-age=0"),
    ("Referer", DSE_URL),
    ("Sec-Fetch-Dest", "document"),
    ("Sec-Fetch-Mode", "navigate"),
    ("Sec-Fetch-Site", "none"),
    ("Sec-Fetch-User", "?1"),
    ("Upgrade-Insecure-Requests", "1"),
];

static TREASURY_BOND: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^TB(2Y|5Y|10Y|15Y|20Y)\d{4}$").unwrap());

pub fn is_treasury_bond(symbol: &str) -> bool {
    TREASURY_BOND.is_match(symbol)
}

/// A DSE session: one cookie jar, one base URL, one set of byte counters.
pub struct Dse<'a> {
    client: reqwest::Client,
    base: String,
    metrics: &'a Metrics,
}

impl<'a> Dse<'a> {
    pub fn new(base: impl Into<String>, metrics: &'a Metrics) -> Self {
        Self { client: http::new_client(), base: base.into(), metrics }
    }

    /// Hit the home page so the session cookie lands in the jar.
    pub async fn fetch_cookie(
        &self,
        cancel: &CancellationToken,
        on_retry: impl Fn(&HttpError, u32, std::time::Duration),
    ) -> Result<(), GetError> {
        http::get(&self.client, &self.base, &[], Retry::default(), cancel, self.metrics, on_retry).await.map(drop)
    }

    pub async fn fetch_symbols(
        &self,
        cancel: &CancellationToken,
        on_retry: impl Fn(&HttpError, u32, std::time::Duration),
    ) -> Result<Vec<String>, GetError> {
        let url = format!("{}ajax/suggestList.php?suggestType=tc", self.base);
        let body = http::get(&self.client, &url, XHR_HEADERS, Retry::default(), cancel, self.metrics, on_retry).await?;
        parse_symbols(&body).map_err(|message| GetError::Http(HttpError { kind: "body", message }))
    }

    /// The raw company page. Retries are kept short: the pipeline retries
    /// parse failures and incomplete pages on top of this.
    pub async fn fetch_company_html(&self, symbol: &str, cancel: &CancellationToken) -> Result<String, GetError> {
        let mut url = reqwest::Url::parse(&format!("{}displayCompany.php", self.base))
            .map_err(|e| GetError::Http(HttpError { kind: "other", message: e.to_string() }))?;
        url.query_pairs_mut().append_pair("name", symbol);
        let retry = Retry { retries: 3, ..Retry::default() };
        http::get(&self.client, url.as_str(), PAGE_HEADERS, retry, cancel, self.metrics, |_, _, _| {}).await
    }
}

fn parse_symbols(body: &str) -> Result<Vec<String>, String> {
    let data: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("Unexpected ticker symbol response ({e})"))?;
    let serde_json::Value::Array(items) = data else {
        return Err("Unexpected ticker symbol response (not an array)".into());
    };
    Ok(items
        .into_iter()
        .map(|item| match item {
            serde_json::Value::String(s) => s.trim().to_string(),
            other => other.to_string().trim().to_string(),
        })
        .filter(|s| !s.is_empty())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn treasury_bonds() {
        assert!(is_treasury_bond("TB10Y0131"));
        assert!(is_treasury_bond("TB2Y0527"));
        assert!(!is_treasury_bond("TB3Y0527"));
        assert!(!is_treasury_bond("SQURPHARMA"));
    }

    #[test]
    fn symbols() {
        assert_eq!(parse_symbols(r#"[" ACI ", "", "BATBC", 123]"#).unwrap(), ["ACI", "BATBC", "123"]);
        assert!(parse_symbols(r#"{"a":1}"#).unwrap_err().contains("not an array"));
        assert!(parse_symbols("<html>").is_err());
    }
}
