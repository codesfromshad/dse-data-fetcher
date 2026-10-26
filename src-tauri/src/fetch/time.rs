//! Date handling for DSE pages and output names.
//!
//! The TypeScript version fed DSE's date strings to `new Date(...)`, which is
//! very forgiving. `parse_loose` accepts the same shapes ("Oct 22, 2026",
//! "22-Oct-2026", "10/22/2026", "2026-10-22", with an optional "2:30 PM" or
//! "14:30:00") and reads them as local time, like the webview did.

use std::time::Duration;

use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};

const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

fn month_of(word: &str) -> Option<u32> {
    if word.len() < 3 || !word.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let position = MONTHS.iter().position(|m| word.starts_with(m))?;
    Some(position as u32 + 1)
}

/// "2:30", "14:30:05", "2:30pm", "14:30:05.123".
fn time_of(token: &str) -> Option<(u32, u32, u32, Option<bool>)> {
    let (clock, meridiem) = if let Some(rest) = token.strip_suffix("am") {
        (rest, Some(false))
    } else if let Some(rest) = token.strip_suffix("pm") {
        (rest, Some(true))
    } else {
        (token, None)
    };
    let mut fields = clock.split(':');
    let hour = fields.next()?.parse().ok()?;
    let minute = fields.next()?.parse().ok()?;
    let second = match fields.next() {
        Some(s) => s.split('.').next()?.parse().ok()?,
        None => 0,
    };
    if fields.next().is_some() {
        return None;
    }
    Some((hour, minute, second, meridiem))
}

fn expand_year(text: &str, value: i32) -> i32 {
    match (text.len(), value) {
        (1 | 2, 0..=49) => 2000 + value,
        (1 | 2, 50..=99) => 1900 + value,
        _ => value,
    }
}

/// Parse a human date (and optional time) as local time. `None` = invalid.
pub fn parse_loose(input: &str) -> Option<NaiveDateTime> {
    let lowered = input.to_ascii_lowercase().replace(',', " ");
    let mut month = None;
    let mut numbers: Vec<&str> = Vec::new();
    let mut time = None;
    let mut meridiem = None;

    for word in lowered.split_whitespace() {
        if word.contains(':') {
            let (h, m, s, mer) = time_of(word)?;
            time = Some((h, m, s));
            meridiem = meridiem.or(mer);
            continue;
        }
        match word {
            "am" | "a.m." => meridiem = Some(false),
            "pm" | "p.m." => meridiem = Some(true),
            _ => {
                for piece in word.split(['-', '/', '.']).filter(|p| !p.is_empty()) {
                    if piece.chars().all(|c| c.is_ascii_digit()) {
                        numbers.push(piece);
                    } else if let Some(m) = month_of(piece) {
                        month = month.or(Some(m));
                    }
                    // Other words ("as", "on", weekday names) carry no date.
                }
            }
        }
    }

    let num = |s: &str| s.parse::<i32>().ok();
    let (year, month, day) = match (month, numbers.as_slice()) {
        // "Oct 22 2026" / "22 Oct 2026" / "2026 Oct 22"
        (Some(m), [a, b, ..]) => {
            if a.len() == 4 || num(a)? > 31 {
                (expand_year(a, num(a)?), m, num(b)?)
            } else {
                (expand_year(b, num(b)?), m, num(a)?)
            }
        }
        // "2026-10-22" or US-style "10/22/2026"
        (None, [a, b, c, ..]) => {
            if a.len() == 4 {
                (num(a)?, num(b)? as u32, num(c)?)
            } else {
                (expand_year(c, num(c)?), num(a)? as u32, num(b)?)
            }
        }
        _ => return None,
    };

    let date = NaiveDate::from_ymd_opt(year, month, u32::try_from(day).ok()?)?;
    let (mut hour, minute, second) = time.unwrap_or((0, 0, 0));
    match meridiem {
        Some(_) if !(1..=12).contains(&hour) => return None,
        Some(false) if hour == 12 => hour = 0,
        Some(true) if hour != 12 => hour += 12,
        _ => {}
    }
    Some(date.and_time(NaiveTime::from_hms_opt(hour, minute, second)?))
}

fn local(naive: NaiveDateTime) -> Option<DateTime<Local>> {
    Local.from_local_datetime(&naive).earliest()
}

/// YYYY-MM-DDTHH:mm:ss+06:00, or "" when the text isn't a date.
pub fn iso_seconds(text: &str) -> String {
    parse_loose(text)
        .and_then(local)
        .map(|d| d.format("%Y-%m-%dT%H:%M:%S%:z").to_string())
        .unwrap_or_default()
}

/// YYYY-MM-DD, or "" when the text isn't a date.
pub fn iso_date(text: &str) -> String {
    parse_loose(text).map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default()
}

/// Filesystem-safe timestamp for the output file name.
pub fn file_timestamp(now: DateTime<Local>) -> String {
    now.format("%Y-%m-%d_%H_%M_%S%.3f_%z").to_string()
}

/// Log line stamps: the full YYYY-MM-DDTHH:mm:ss.SSS±HH:MM (for copy/export)
/// and the HH:mm:ss.SSS shown in the activity log. Formatted here so the UI
/// doesn't build two strings per line on its hot path.
pub fn log_stamps(at: DateTime<Local>) -> (String, String) {
    (at.format("%Y-%m-%dT%H:%M:%S%.3f%:z").to_string(), at.format("%H:%M:%S%.3f").to_string())
}

/// HH:mm:ss.SSS for an elapsed duration.
pub fn format_duration(elapsed: Duration) -> String {
    let total = elapsed.as_millis();
    format!(
        "{:02}:{:02}:{:02}.{:03}",
        total / 3_600_000,
        total % 3_600_000 / 60_000,
        total % 60_000 / 1000,
        total % 1000
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(s: &str) -> String {
        parse_loose(s).map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string()).unwrap_or_default()
    }

    #[test]
    fn dse_shapes() {
        assert_eq!(dt("Oct 22, 2026 2:30 PM"), "2026-10-22 14:30:00");
        assert_eq!(dt("Oct 22, 2026 12:05 AM"), "2026-10-22 00:05:00");
        assert_eq!(dt("Oct 22, 2026 14:30:15"), "2026-10-22 14:30:15");
        assert_eq!(dt("September 30, 2026"), "2026-09-30 00:00:00");
        assert_eq!(dt("Sept 30, 2026"), "2026-09-30 00:00:00");
        assert_eq!(dt("30-Sep-2026"), "2026-09-30 00:00:00");
        assert_eq!(dt("30 Sep 26"), "2026-09-30 00:00:00");
        assert_eq!(dt("10/22/2026 2:30pm"), "2026-10-22 14:30:00");
        assert_eq!(dt("2026-10-22"), "2026-10-22 00:00:00");
        assert_eq!(dt("Thursday, Oct 22, 2026"), "2026-10-22 00:00:00");
    }

    #[test]
    fn invalid_is_empty() {
        assert_eq!(dt(""), "");
        assert_eq!(dt("2:30 PM"), "");
        assert_eq!(dt("Oct 32, 2026"), "");
        assert_eq!(dt("Feb 30, 2026"), "");
        assert_eq!(dt("n/a"), "");
        assert_eq!(iso_date("garbage"), "");
        assert_eq!(iso_seconds("-"), "");
    }

    #[test]
    fn durations() {
        assert_eq!(format_duration(Duration::from_millis(3_723_045)), "01:02:03.045");
    }

    #[test]
    fn log_stamp_shapes() {
        let t = Local.with_ymd_and_hms(2026, 10, 25, 9, 5, 7).unwrap() + chrono::Duration::milliseconds(45);
        let (full, short) = log_stamps(t);
        assert_eq!(short, "09:05:07.045");
        assert!(full.starts_with("2026-10-25T09:05:07.045"), "{full}");
        // ±HH:MM offset, like the TS logTimestamp it replaces.
        let offset = &full[full.len() - 6..];
        assert!(offset.starts_with(['+', '-']) && offset.as_bytes()[3] == b':', "{full}");
    }

    #[test]
    fn file_timestamp_shape() {
        let t = Local.with_ymd_and_hms(2026, 10, 25, 9, 5, 7).unwrap();
        assert!(file_timestamp(t).starts_with("2026-10-25_09_05_07.000_"));
    }
}
