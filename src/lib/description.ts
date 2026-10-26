// Everything the About page, installer and updater say about the app.
// The version comes from package.json at build time (see vite.config.ts), so
// `bun run release` is the only place it ever changes.

export const APP_NAME = 'DSE Data Fetcher';

/** Raw semver, e.g. "2.0.0-beta.1". */
export const APP_VERSION: string = __APP_VERSION__;

/** True for pre-release builds (anything with a "-beta", "-rc"... suffix). */
export const IS_PRERELEASE = APP_VERSION.includes('-');

/** "2.0.0-beta.1" → "2.0.0 Beta 1", "2.0.0" → "2.0.0". */
export function displayVersion(version: string) {
  const [core, pre] = version.split('-', 2);
  if (!pre) return core;
  const [tag, ...rest] = pre.split('.');
  const label = tag.charAt(0).toUpperCase() + tag.slice(1);
  return [core, label, ...rest].join(' ');
}

export const SUMMARY =
  'Fetches company data from the old Dhaka Stock Exchange website and saves it as a spreadsheet (.xlsx).';

export const DATA_POINTS = [
  'Scrip code and trading code',
  'Company name and sector',
  "Yesterday's closing price",
  'Market capitalization (BDT mn)',
  'Outstanding securities',
  'Shareholding breakdown',
];

export const AUTHOR = {
  name: 'Shadman Rafid Chowdhury',
  handle: 'codesfromshad',
  phone: '+880 1769-030206',
  email: 'contact@codesfromshad.com',
};

export const COPYRIGHT_LINE = `© 2026 ${AUTHOR.name} (${AUTHOR.handle}). All rights reserved.`;

// Keep in sync with src-tauri/tauri.conf.json → plugins.updater.endpoints.
export const GITHUB_REPO = 'codesfromshad/dse-data-fetcher';

export const LINKS = {
  website: 'https://codesfromshad.com',
  repository: `https://github.com/${GITHUB_REPO}`,
  releases: `https://github.com/${GITHUB_REPO}/releases`,
  issues: `https://github.com/${GITHUB_REPO}/issues/new`,
  email: `mailto:${AUTHOR.email}`,
};
