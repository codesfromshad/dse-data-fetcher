# DSE Data Fetcher

Desktop app (Tauri 2 + React + Fluent UI) that fetches company data from the
old Dhaka Stock Exchange website and saves it as a spreadsheet (.xlsx).
Updates itself from GitHub Releases.

## Prerequisites (Windows)

- [Bun](https://bun.sh)
- Rust via [rustup](https://rustup.rs) (stable, MSVC toolchain)
- Microsoft C++ Build Tools ("Desktop development with C++")
- WebView2: already installed on Windows 10/11

## Commands

```sh
bun install
bun run app              # run the desktop app with hot reload (tauri dev)
bun run app:build        # release exe + NSIS installer in src-tauri/target/release/bundle/nsis
bun run typecheck
bun run icons            # regenerate src-tauri/icons from assets/icon.png
bun run release beta     # cut a release (see below)
bun run updater:setup    # one-time: create the update signing key
```

The first `bun run app` compiles the Rust side and takes a few minutes; later runs are quick.

## Releases and automatic updates

The app checks GitHub for updates on launch and every 6 hours, downloads them in
the background and installs on restart (all switchable in **Settings → Updates**).
Installers are signed; the app refuses any update whose signature doesn't match
the public key in `src-tauri/tauri.conf.json`.

### One-time setup

1. Create the GitHub repo `codesfromshad/dse-data-fetcher` and push this project.
   **It must be public**: the updater downloads release files without logging in.
   For a different repo, change `GITHUB_REPO` in `src/lib/description.ts` and the
   endpoint in `src-tauri/tauri.conf.json` → `plugins.updater`.
2. `bun run updater:setup --set-secrets` creates the signing key in
   `%USERPROFILE%\.tauri\`, writes the public key into `tauri.conf.json`, and
   stores the private key as GitHub Actions secrets (needs the `gh` CLI; without
   `--set-secrets` it tells you what to add by hand).
   **Back up the key.** Without it, existing installs can't be updated.
3. Commit `tauri.conf.json`.

### Shipping a version

1. While you work, add changes to `## [Unreleased]` in `CHANGELOG.md`
   (sections: Added, Changed, Fixed, Removed).
2. `bun run release beta --push` (or `patch`, `minor`, `major`, or an exact
   version like `2.1.0`). This bumps `package.json`, `Cargo.toml` and
   `Cargo.lock`, dates the changelog section, commits, tags `v<version>` and pushes.
3. `.github/workflows/release.yml` builds and signs the installer, publishes a
   GitHub release with the changelog section as its notes, and updates the
   channel manifests on the `updater` release:
   - `beta.json`: every release
   - `stable.json`: releases without a `-beta`/`-rc` suffix

Installed apps pick it up on their next check. Release notes appear in the
update banner, Settings → Updates, and a "What's new" dialog after updating.

Local `bun run app:build` doesn't need the signing key; only CI builds the
updater artifacts (`src-tauri/tauri.updater.conf.json`).

## Legal

| File | Shown |
| --- | --- |
| `legal/EULA.txt` | Installer license page, About → Legal |
| `legal/DISCLAIMER.txt` | Installer license page, About → Legal |
| `legal/PRIVACY.txt` | Installer license page, About → Legal |
| `legal/THIRD-PARTY-NOTICES.txt` | About → Legal |

`bun run build` combines the first three into `legal/build/LICENSE.txt` for the
installer (plain ASCII only; the script checks). All four, plus `CHANGELOG.md`,
are installed next to the app in a `legal` folder.

## How it fits together

| Where | What |
| --- | --- |
| `src-tauri/src/fetch/pipeline.rs` | The fetch run: cookie → symbols → company pages (10 at a time, retries from Settings) → sorted rows |
| `src-tauri/src/fetch/mod.rs` | `start_fetch` / `cancel_fetch` / `check_dse` commands; streams log + progress events to the UI over a channel, writes and opens the xlsx |
| `src-tauri/src/fetch/parse.rs`, `time.rs` | Company-page parsing (`scraper`, same selectors as the old cheerio code) and DSE date handling |
| `src-tauri/src/fetch/dse.rs`, `http.rs`, `workbook.rs` | DSE URLs/headers, retry/backoff/cancel, the xlsx (`rust_xlsxwriter`) |
| `src/hooks/useFetchRun.ts`, `src/lib/fetch.ts` | Starts/cancels a run and renders its events. The frontend does no fetching or parsing |
| `src/lib/native.ts`, `settings.ts` | Typed wrappers for the other Rust commands |
| `src/hooks/useSettings.tsx`, `SettingsView.tsx`, `SettingRow.tsx` | Settings (theme, fetching, updates, system status, advanced) |
| `src/hooks/useUpdater.tsx`, `UpdateControls.tsx` | Update checks, download progress, banner, restart-to-install |
| `src/components/AboutView.tsx`, `ReleaseNotes.tsx`, `LegalDialog.tsx`, `WhatsNewDialog.tsx` | About page, changelog, legal documents |
| `src/lib/changelog.ts` | CHANGELOG.md parser (shared by the app and `scripts/`) |
| `src-tauri/src/updater.rs` | Check/download/install against the channel manifest |
| `src-tauri/src/spreadsheet.rs`, `settings.rs` | Finds the .xlsx app (Windows file association), launches a chosen .exe, saves settings |
| `src-tauri/src/lib.rs` | Online check, temp files, settings and build-info commands, theme |
| `scripts/` | `release.ts`, `release-notes.ts`, `build-legal.ts`, `setup-updater.ts` |

## Startup check

Every launch checks: internet (DNS), the DSE site, the temp folder, and which app opens `.xlsx` files.
Fetching starts on its own only if all of them pass (turn that off in **Settings → Fetching**).
If no spreadsheet app is found you can pick one (any `.exe`, e.g. LibreOffice's `scalc.exe`)
on the check card or in Settings, or fetch without opening. Settings are saved to
`%APPDATA%\com.codesfromshad.dse-data-fetcher\settings.json`.

The spreadsheet is written to the temp folder and deleted when the app closes.
If Excel still has it open, the app asks you to close it first (or leave it).
Use **Save a copy…** to keep one.

## Legacy CLI

The previous Ink/Bun terminal version is in `legacy/` (`cd legacy && bun src/cli.jsx`).
