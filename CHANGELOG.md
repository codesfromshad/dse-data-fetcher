# Changelog

All notable changes to DSE Data Fetcher are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the app uses
[Semantic Versioning](https://semver.org/).

Add entries under **Unreleased** as you work. `bun run release <version>`
turns that section into the new version, and the release workflow publishes
it as the GitHub release notes and the in-app "What's new".

## [Unreleased]

### Changed

- The **Elapsed** timer now counts in milliseconds while fetching, not just when the run ends.
- Switching tabs is instant, even with thousands of lines in the activity log. Before, coming back to **Fetch** rebuilt the whole log (about a second with 2,000 lines on a typical laptop); now each page is kept in the background and the log only draws the lines on screen. Your place in the log is kept when you switch away and back.
- New log lines never hold up a click: they're drawn at a lower priority than tab switches, Cancel and the rest of the window.
- The native (Rust) core now sends log lines to the window in batches, already timestamped, instead of one message per line, so long runs put far less load on the window.

## [2.0.0-beta.4] - 2026-10-25

### Added

- **Network metrics** while fetching: data transferred (as downloaded, compressed), data processed (decompressed), live transfer speed, average and peak speed, and request count, on the progress card and in the activity log summary. Turn them on or off in Settings → Fetching → **Show network metrics**.

### Changed

- The system check is quieter: instead of listing every check, the Fetch page just says **System check passed**. When something is wrong it says what, in plain words, and what to try (offline, DSE down or not responding, a security certificate problem, the temp folder not writable, no spreadsheet app…). Every check is still listed in Settings → System status.
- The **Elapsed** timer now counts in hundredths of a second while fetching and shows the exact time to the millisecond when the run ends.
- Pills in the activity log (like **COMPLETE** and the elapsed time) are now the same size as the text around them, so they're easier to read.
- Faster and lighter: styles are compiled at build time instead of when the app starts, Settings and About load in the background after the window opens, and the activity log is cheaper to render. The code the window loads at startup is about 30% smaller.

## [2.0.0-beta.3] - 2026-10-25

### Changed

- Fetching, page parsing and creating the workbook now all run in the app's native (Rust) core instead of the window. The window stays responsive during a run, Cancel stops requests that are already in flight, and the app is smaller (ExcelJS and cheerio are gone).

## [2.0.0-beta.2] - 2026-10-25

### Added

- **Retries per company** setting in Settings → Fetching: choose how many times a company page is fetched again, or turn on **Unlimited** to keep trying until it works.

### Fixed

- Company pages that came back with NaN or missing values (prices, market cap, dates…) are now detected and fetched again, with a warning in the log. If retries run out, the row is kept with those cells blank instead of `NaN`, and the summary lists the affected symbols.

## [2.0.0-beta.1] - 2026-10-25

### Added

- **Automatic updates.** The app checks GitHub for new versions, downloads them in the background and installs them when you restart. Updates are signed and verified before they run.
- **Update channels.** Choose **Stable** or **Beta** (preview builds) in Settings → Updates.
- **What's new** dialog after an update, plus full release notes in About and Settings.
- **Redesigned Settings** with sections for General, Fetching, Updates, System and Advanced.
- **Theme setting:** follow Windows, or always light or dark.
- Options to turn off fetching on launch and opening the workbook when a fetch finishes.
- **Redesigned About page** with update status, system information you can copy for bug reports, links and legal documents.
- New End User License Agreement, Disclaimer, Privacy Notice and Third-Party Notices. The installer now shows the license agreement and installs these documents with the app.

### Fixed

- The window now appears as soon as it's drawn instead of after a 3-second delay.

## [2.0.0-beta] - 2026-10-21

### Changed

- Rebuilt as a Windows desktop app (Tauri 2, React and Fluent UI) with a progress view, live log and result actions. Replaces the terminal app.
- HTTP requests run natively with a per-run cookie jar instead of calling `curl.exe`.
- Company pages are parsed off the UI thread.

### Added

- Startup system check for the internet connection, the DSE website, the temp folder and the spreadsheet app. Fetching starts on its own when everything passes.
- Pick any spreadsheet app (Excel, LibreOffice Calc…) when Windows has none set for `.xlsx` files.
- **Save a copy…** and **Show in folder** for the finished workbook.
- The temporary workbook is deleted on close; if Excel still has it open, the app asks first.
- Follows the Windows light/dark theme.

## [1.0.2]

### Changed

- Terminal (Ink) version of the fetcher, built as a single `.exe`. Kept in `legacy/`.
