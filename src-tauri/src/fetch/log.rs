//! Structured log messages sent to the UI. A message is a list of parts; the
//! UI decides how each tone looks (mirrors `src/lib/log.ts`).

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Success,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tone {
    Accent,
    Success,
    Info,
    Danger,
    Subtle,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Part {
    Text(String),
    Styled {
        text: String,
        tone: Tone,
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        badge: bool,
        /// Opens in the browser when clicked.
        #[serde(skip_serializing_if = "Option::is_none")]
        href: Option<String>,
    },
}

impl Part {
    #[cfg(test)]
    pub fn text(&self) -> &str {
        match self {
            Part::Text(text) | Part::Styled { text, .. } => text,
        }
    }
}

impl From<&str> for Part {
    fn from(text: &str) -> Self {
        Part::Text(text.to_string())
    }
}

impl From<String> for Part {
    fn from(text: String) -> Self {
        Part::Text(text)
    }
}

/// Highlight a value inside a message.
pub fn hl(value: impl ToString) -> Part {
    hl_as(value, Tone::Accent)
}

pub fn hl_as(value: impl ToString, tone: Tone) -> Part {
    Part::Styled { text: value.to_string(), tone, badge: false, href: None }
}

/// Inline pill, e.g. COMPLETE or the elapsed time.
pub fn pill(value: impl ToString, tone: Tone) -> Part {
    Part::Styled { text: value.to_string(), tone, badge: true, href: None }
}

/// The company's page on the DSE website.
pub fn company_url(symbol: &str) -> String {
    // Symbols are letters, digits and the odd dash; anything else is escaped.
    let mut path = String::with_capacity(symbol.len());
    for byte in symbol.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => path.push(byte as char),
            _ => path.push_str(&format!("%{byte:02X}")),
        }
    }
    format!("https://www.dse.com.bd/company/{path}")
}

/// A symbol, highlighted and linked to its company page.
pub fn symbol(symbol: &str) -> Part {
    Part::Styled { text: symbol.to_string(), tone: Tone::Accent, badge: false, href: Some(company_url(symbol)) }
}

/// "A, B, C" with each symbol linked.
pub fn symbol_list(symbols: &[String]) -> Vec<Part> {
    let mut parts = Vec::with_capacity(symbols.len() * 2);
    for (i, s) in symbols.iter().enumerate() {
        if i > 0 {
            parts.push(", ".into());
        }
        parts.push(symbol(s));
    }
    parts
}

/// `parts!["Fetched ", hl(symbol), "!"]` → `Vec<Part>`.
macro_rules! parts {
    ($($part:expr),* $(,)?) => { vec![$($crate::fetch::log::Part::from($part)),*] };
}
pub(crate) use parts;

/// Plain text of a message (used in tests).
#[cfg(test)]
pub fn plain(parts: &[Part]) -> String {
    parts.iter().map(Part::text).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_like_the_ts_log_part() {
        let parts = parts!["a ", hl("b"), pill("C", Tone::Success), symbol("GP")];
        assert_eq!(
            serde_json::to_string(&parts).unwrap(),
            r#"["a ",{"text":"b","tone":"accent"},{"text":"C","tone":"success","badge":true},{"text":"GP","tone":"accent","href":"https://www.dse.com.bd/company/GP"}]"#
        );
    }

    #[test]
    fn company_links() {
        assert_eq!(company_url("1STPRIMFMF"), "https://www.dse.com.bd/company/1STPRIMFMF");
        assert_eq!(company_url("AL-HAJTEX"), "https://www.dse.com.bd/company/AL-HAJTEX");
        assert_eq!(company_url("A B&C"), "https://www.dse.com.bd/company/A%20B%26C");
        let list = symbol_list(&["A".into(), "B".into()]);
        assert_eq!(plain(&list), "A, B");
    }
}
