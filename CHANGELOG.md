# Changelog

All notable changes to DSE Data Fetcher are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the app uses
[Semantic Versioning](https://semver.org/).

Add entries under **Unreleased** as you work. `bun run release <version>`
turns that section into the new version, and the release workflow publishes
it as the GitHub release notes and the in-app "What's new".

## [Unreleased]

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
