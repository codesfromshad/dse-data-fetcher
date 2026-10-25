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
    Part::Styled { text: value.to_string(), tone, badge: false }
}

/// Inline pill, e.g. COMPLETE or the elapsed time.
pub fn pill(value: impl ToString, tone: Tone) -> Part {
    Part::Styled { text: value.to_string(), tone, badge: true }
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
        let parts = parts!["a ", hl("b"), pill("C", Tone::Success)];
        assert_eq!(
            serde_json::to_string(&parts).unwrap(),
            r#"["a ",{"text":"b","tone":"accent"},{"text":"C","tone":"success","badge":true}]"#
        );
    }
}
