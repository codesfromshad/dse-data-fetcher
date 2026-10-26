//! HTTP with retries, backoff and cancellation (replaces curl.exe, then the
//! TypeScript `http.ts`). Bodies are read chunk by chunk and decompressed
//! here (not by reqwest) so the run can count bytes on the wire and bytes
//! decoded separately.

use std::{fmt, io::Read, time::Duration};

use reqwest::header::{CONTENT_ENCODING, CONTENT_TYPE};
use serde::Serialize;
use tokio_util::sync::CancellationToken;

use super::metrics::Metrics;

/// Browser-like headers sent with every request.
const DEFAULT_HEADERS: [(&str, &str); 5] = [
    ("Accept-Encoding", "gzip, deflate, br"),
    (
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    ),
    ("sec-ch-ua", r#""Not.A/Brand";v="8", "Chromium";v="114", "Google Chrome";v="114""#),
    ("sec-ch-ua-mobile", "?0"),
    ("sec-ch-ua-platform", r#""Windows""#),
];

pub type Headers = [(&'static str, &'static str)];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpError {
    /// "connect" | "timeout" | "status" | "body" | "other"
    pub kind: &'static str,
    pub message: String,
}

impl fmt::Display for HttpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl From<reqwest::Error> for HttpError {
    fn from(error: reqwest::Error) -> Self {
        let kind = if error.is_timeout() {
            "timeout"
        } else if error.is_connect() {
            "connect"
        } else if error.is_body() || error.is_decode() {
            "body"
        } else {
            "other"
        };
        // reqwest's top-level message embeds the URL; the root cause is what
        // actually says what went wrong ("dns error", "connection refused"...).
        let mut root: &dyn std::error::Error = &error;
        while let Some(source) = root.source() {
            root = source;
        }
        let message = match kind {
            "timeout" => "Operation timed out".to_string(),
            _ => root.to_string(),
        };
        Self { kind, message }
    }
}

/// Every run gets a new client, so a fresh cookie jar.
pub fn new_client() -> reqwest::Client {
    reqwest::Client::builder()
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .expect("failed to build HTTP client")
}

/// The user pressed Cancel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cancelled;

#[derive(Debug)]
pub enum GetError {
    Cancelled,
    Http(HttpError),
}

impl From<Cancelled> for GetError {
    fn from(_: Cancelled) -> Self {
        GetError::Cancelled
    }
}

/// Sleep, returning early with `Cancelled` if the run is cancelled.
pub async fn sleep(duration: Duration, cancel: &CancellationToken) -> Result<(), Cancelled> {
    tokio::select! {
        _ = tokio::time::sleep(duration) => Ok(()),
        _ = cancel.cancelled() => Err(Cancelled),
    }
}

/// One GET. Non-2xx counts as an error, like `curl --fail`, so the caller
/// retries instead of parsing an error page.
pub async fn get_once(
    client: &reqwest::Client,
    url: &str,
    headers: &Headers,
    timeout: Duration,
    metrics: &Metrics,
) -> Result<String, HttpError> {
    let mut request = client.get(url).timeout(timeout);
    for (name, value) in DEFAULT_HEADERS.iter().chain(headers) {
        request = request.header(*name, *value);
    }
    let mut response = request.send().await?;
    metrics.add_request();
    let status = response.status();
    let header = |name| response.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let (encoding, content_type) = (header(CONTENT_ENCODING), header(CONTENT_TYPE));

    // Read even an error page, so its bytes count as transferred.
    let mut raw = Vec::with_capacity(response.content_length().unwrap_or(0).min(4 << 20) as usize);
    while let Some(chunk) = response.chunk().await? {
        metrics.add_transferred(chunk.len());
        raw.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        return Err(HttpError { kind: "status", message: format!("The requested URL returned error: {status}") });
    }
    let body = decompress(encoding.as_deref(), raw)?;
    metrics.add_processed(body.len());
    Ok(decode_text(content_type.as_deref(), &body))
}

/// Undo `Content-Encoding` (applied in order, so undone in reverse). We only
/// ask for gzip/deflate/br; any other label ("none", "utf-8"... from
/// misconfigured servers) is treated as a plain body.
fn decompress(encoding: Option<&str>, mut body: Vec<u8>) -> Result<Vec<u8>, HttpError> {
    let Some(encoding) = encoding else { return Ok(body) };
    for coding in encoding.rsplit(',').map(|c| c.trim().to_ascii_lowercase()) {
        let mut out = Vec::with_capacity(body.len() * 4);
        let result = match coding.as_str() {
            "gzip" | "x-gzip" => flate2::read::MultiGzDecoder::new(&body[..]).read_to_end(&mut out),
            // "deflate" is meant to be zlib-wrapped, but some servers send raw deflate.
            "deflate" => flate2::read::ZlibDecoder::new(&body[..]).read_to_end(&mut out).or_else(|_| {
                out.clear();
                flate2::read::DeflateDecoder::new(&body[..]).read_to_end(&mut out)
            }),
            "br" => brotli_decompressor::Decompressor::new(&body[..], 8192).read_to_end(&mut out),
            _ => continue,
        };
        result.map_err(|e| HttpError { kind: "body", message: format!("Couldn't decompress the response ({coding}): {e}") })?;
        body = out;
    }
    Ok(body)
}

/// Bytes → text using the `charset` from `Content-Type` (UTF-8 if missing or
/// unknown; a BOM wins), same as reqwest's `Response::text`.
fn decode_text(content_type: Option<&str>, bytes: &[u8]) -> String {
    let label = content_type.and_then(|ct| {
        ct.split(';').skip(1).find_map(|param| {
            let (key, value) = param.split_once('=')?;
            key.trim().eq_ignore_ascii_case("charset").then(|| value.trim().trim_matches('"'))
        })
    });
    let encoding = label.and_then(|l| encoding_rs::Encoding::for_label(l.as_bytes())).unwrap_or(encoding_rs::UTF_8);
    encoding.decode(bytes).0.into_owned()
}

pub struct Retry {
    pub retries: u32,
    pub timeout: Duration,
}

impl Default for Retry {
    fn default() -> Self {
        Self { retries: 99, timeout: Duration::from_secs(10) }
    }
}

/// Backoff before retry `attempt` (1-based): 1s, 2s, 4s... capped.
pub fn backoff(attempt: u32, cap: Duration) -> Duration {
    Duration::from_secs(1u64 << attempt.saturating_sub(1).min(16)).min(cap)
}

/// GET with exponential backoff (capped at 30s). `on_retry(error, attempt,
/// wait)` is called before each wait. Cancelling stops an in-flight request too.
pub async fn get(
    client: &reqwest::Client,
    url: &str,
    headers: &Headers,
    retry: Retry,
    cancel: &CancellationToken,
    metrics: &Metrics,
    on_retry: impl Fn(&HttpError, u32, Duration),
) -> Result<String, GetError> {
    let mut attempt = 0;
    loop {
        let result = tokio::select! {
            r = get_once(client, url, headers, retry.timeout, metrics) => r,
            _ = cancel.cancelled() => return Err(GetError::Cancelled),
        };
        match result {
            Ok(body) => return Ok(body),
            Err(error) if attempt >= retry.retries => return Err(GetError::Http(error)),
            Err(error) => {
                attempt += 1;
                let wait = backoff(attempt, Duration::from_secs(30));
                on_retry(&error, attempt, wait);
                sleep(wait, cancel).await?;
            }
        }
    }
}

/// Short, human-readable reason for a failure.
pub fn describe_error(error: &dyn fmt::Display) -> String {
    let text = error.to_string();
    let line = text.trim().lines().next().unwrap_or_default().to_string();
    if line.chars().count() > 120 {
        format!("{}...", line.chars().take(117).collect::<String>())
    } else {
        line
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_and_caps() {
        let cap = Duration::from_secs(15);
        let waits: Vec<_> = (1..=6).map(|a| backoff(a, cap).as_secs()).collect();
        assert_eq!(waits, [1, 2, 4, 8, 15, 15]);
        assert_eq!(backoff(500, cap), cap);
    }

    #[test]
    fn decompresses_every_encoding() {
        use std::io::Write;
        let text = "<html>পদ্মা ".repeat(200);
        let gzip = {
            let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            e.write_all(text.as_bytes()).unwrap();
            e.finish().unwrap()
        };
        let zlib = {
            let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            e.write_all(text.as_bytes()).unwrap();
            e.finish().unwrap()
        };
        let raw_deflate = {
            let mut e = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
            e.write_all(text.as_bytes()).unwrap();
            e.finish().unwrap()
        };
        assert!(gzip.len() < text.len() / 10);
        for (encoding, body) in [("gzip", &gzip), ("deflate", &zlib), ("deflate", &raw_deflate), ("identity", &text.as_bytes().to_vec())] {
            assert_eq!(decompress(Some(encoding), body.clone()).unwrap(), text.as_bytes(), "{encoding}");
        }
        assert_eq!(decompress(None, b"plain".to_vec()).unwrap(), b"plain");
        assert_eq!(decompress(Some("none"), b"plain".to_vec()).unwrap(), b"plain");
        assert_eq!(decompress(Some("gzip"), b"not gzip".to_vec()).unwrap_err().kind, "body");
    }

    #[test]
    fn brotli() {
        // "hello" compressed with `brotli -q 11`.
        let br = [0x0b, 0x02, 0x80, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x03];
        assert_eq!(decompress(Some("br"), br.to_vec()).unwrap(), b"hello");
    }

    #[test]
    fn charsets() {
        assert_eq!(decode_text(Some("text/html; charset=UTF-8"), "টাকা".as_bytes()), "টাকা");
        assert_eq!(decode_text(Some("text/html; charset=\"iso-8859-1\""), &[0xA3, 0x31]), "£1");
        assert_eq!(decode_text(Some("text/html"), "é".as_bytes()), "é");
        assert_eq!(decode_text(None, &[0xEF, 0xBB, 0xBF, b'x']), "x");
    }

    #[test]
    fn describe_error_keeps_the_first_line_short() {
        assert_eq!(describe_error(&"  boom\nmore  "), "boom");
        let long = "x".repeat(200);
        assert_eq!(describe_error(&long).chars().count(), 120);
    }
}
