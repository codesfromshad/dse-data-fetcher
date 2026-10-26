# Changelog

All notable changes to DSE Data Fetcher are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the app uses
[Semantic Versioning](https://semver.org/).

Add entries under **Unreleased** as you work. `bun run release <version>`
turns that section into the new version, and the release workflow publishes
it as the GitHub release notes and the in-app "What's new".

## [Unreleased]

## [2.1.5] - 2026-10-27

### Added

- **Pause fetching.** Pause a running fetch and resume it later. Pages already downloading finish; no new ones start until you press **Resume fetching**. You can still stop the fetch while it's paused. Time spent paused doesn't count towards the elapsed time or the average speed.
- Company symbols in the activity log are now links: click one to open that company's page on the DSE website.
- The activity log now says when the temporary spreadsheet is deleted, or why it couldn't be (for example, because it's still open in another app). When you close the app, it shows the log for a moment while it deletes the spreadsheet, then closes.
- **Clean up temporary spreadsheets** in Settings → Advanced. Finds every spreadsheet this app has left in your temp folder, including ones from earlier sessions, with their sizes and dates, and deletes them all in one go.

### Changed

- The fetch buttons now read **Start fetching** and **Stop fetching** (was Start fetch and Cancel).
- The About page footer now links to all the legal documents on a line of their own: **License**, **Disclaimer**, **Privacy** and **Open-source**.
- The author's name in the About page footer now links to their GitHub profile.
- **About → System information** and the footer now show the build: the commit it was built from (linked on GitHub), whether it's a release or debug build, and when it was built. **Copy** includes them too.
- Links and buttons that open in your browser now show an "open" icon, so you can tell them apart from ones that stay in the app.

### Fixed

- Closing a dialog no longer flashes an empty box across the window. Dialogs now keep their content while they fade out.

## [2.1.4] - 2026-10-27

### Changed

- The scrollbar arrows now respond like Windows: they brighten when you point at them and shrink slightly while pressed.
- The arrows are a little bigger, slightly wider than the scrollbar, with a small gap between them and the scrollbar.

## [2.1.3] - 2026-10-26

### Fixed

- Scrolling the mouse wheel with the pointer on a scrollbar now scrolls exactly like scrolling over the page. Before, it barely moved the activity log.
- Scrolling the activity log while a fetch is running is smooth again instead of laggy and unresponsive.
- The scrollbar thumb no longer brightens while you drag it, matching Windows.

### Changed

- The activity log's scrollbar now runs the full height of the log, square-ended against its edges.
- The thin scrollbar is longer: in **Settings** and **About** its top now lines up with the first card, and the space for the arrows is smaller.

## [2.1.2] - 2026-10-26

### Changed

- Scrollbars now look and behave like Windows 11's. A thin line shows where you are in the page and stays visible whenever there's more to scroll. Point at it and it grows into a full scrollbar with arrows that you can drag, click or hold; it shrinks back shortly after the pointer moves away. This applies to Settings, About, the activity log and the dialogs.
- In **Settings** and **About**, the scrollbar now sits at the very edge of the window, as in Windows Settings, instead of floating inside the page.

## [2.1.1] - 2026-10-26

### Fixed

- Buttons, tabs, switches, checkboxes, dropdowns and list rows now show the normal arrow cursor, like the rest of Windows. The hand cursor is kept for links only.
- Labels, headings and buttons can no longer be highlighted or dragged, and show the arrow instead of the text cursor, just like a native Windows app. Text can still be selected in text fields, the About details and the legal documents, and Ctrl+A no longer selects the whole window.

## [2.1.0] - 2026-10-26

The first stable release of the DSE Data Fetcher desktop app. Everything from the 2.0 betas is now on the Stable channel: the Windows app, automatic updates, network metrics, the faster activity log and instant tab switching.

### Added

- **Connection monitoring.** The app now keeps an eye on your internet connection and the DSE website the whole time it's open, not just when you press Check again. The activity log says when the internet connection is lost and when it's restored, and when the DSE website can't be reached and when it's back. The system status updates on its own too.
- If you're on the **Beta** channel, the app asks once whether you'd like to switch to **Stable**. Tick **Don't show this again** to stay on Beta without being asked. You can change channel any time in Settings → Updates.

### Changed

- Checking whether you're online is more reliable. It now makes a real connection instead of a name lookup, which Windows can answer from memory for a while after the connection is gone.
- The app's description no longer mentions Excel: it saves company data as a spreadsheet (.xlsx) that opens in any spreadsheet application.

## [2.0.0-beta.7] - 2026-10-26

### Fixed

- Switching tabs is instant, with no more blank (black) moment the first time you open **Settings** or **About**. Both pages are now built quietly in the background shortly after the app starts, so a tab click only has to show them.

## [2.0.0-beta.6] - 2026-10-26

### Fixed

- The activity log no longer flickers when new lines come in. New lines were briefly drawn on top of each other before settling into place.
- The connection status now stays in sync. If a fetch finds you're offline, the system status says so too (and the other way round). Turning Wi-Fi off or on updates it right away, and the **You're offline** message goes away by itself once you're back online, including after **Fetch again**.
- Only one "You're offline" message is shown instead of two.

### Changed

- Redesigned the dialog that appears when you close the app while a spreadsheet is still open. It now refers to your spreadsheet application instead of guessing it's Excel.
- Clearer wording for **Retries per company** in Settings, and tidier text in the **Spreadsheet ready** message.

## [2.0.0-beta.5] - 2026-10-26

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
