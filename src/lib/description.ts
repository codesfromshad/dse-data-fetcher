// Everything the About page, installer and updater say about the app.
// The version comes from package.json at build time (see vite.config.ts), so
// `bun run release` is the only place it ever changes.

export const APP_NAME = 'DSE Data Fetcher';

/** Raw semver, e.g. "2.0.0-beta.1". */
export const APP_VERSION: string = __APP_VERSION__;
/** Short commit hash this build is from ("-dirty" with local changes). */
export const BUILD_COMMIT: string = __BUILD_COMMIT__;
/** When this build was made. */
export const BUILD_TIME = new Date(__BUILD_TIME__);
/** The build's commit on GitHub (none for a dirty or unknown build). */
export const buildCommitUrl = () =>
  /^[0-9a-f]{7}$/.test(BUILD_COMMIT) ? `https://github.com/${GITHUB_REPO}/commit/${BUILD_COMMIT}` : null;
/** e.g. "27 October 2026, 02:15", in the user's locale. */
export const formatBuildTime = () =>
  BUILD_TIME.toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

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
  /** The author's GitHub profile. */
  github: `https://github.com/${AUTHOR.handle}`,
  repository: `https://github.com/${GITHUB_REPO}`,
  releases: `https://github.com/${GITHUB_REPO}/releases`,
  issues: `https://github.com/${GITHUB_REPO}/issues/new`,
  email: `mailto:${AUTHOR.email}`,
};
