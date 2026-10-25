// Cut a release: bump the version everywhere, turn CHANGELOG.md's
// [Unreleased] section into the new version, commit and tag.
// Pushing the tag starts .github/workflows/release.yml, which builds, signs
// and publishes the installer and the update manifests.
//
//   bun run release beta            2.0.0-beta → 2.0.0-beta.1 → 2.0.0-beta.2
//   bun run release patch|minor|major
//   bun run release 2.1.0           an exact version
//   bun run release beta --push     ...and push the commit + tag
//   bun run release beta --dry-run  show what would happen, change nothing

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { $ } from 'bun';
import { hasContent, parseChangelog } from '../src/lib/changelog';

const root = join(import.meta.dir, '..');
const file = (p: string) => join(root, p);
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const target = args.find((a) => !a.startsWith('--'));
const dryRun = flags.has('--dry-run');

function fail(message: string): never {
  console.error(`\x1b[31m✖ ${message}\x1b[0m`);
  process.exit(1);
}

// --- semver ----------------------------------------------------------------

interface Version {
  major: number;
  minor: number;
  patch: number;
  pre: (string | number)[];
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function parse(v: string): Version {
  const m = v.match(SEMVER);
  if (!m) fail(`"${v}" isn't a valid version (expected e.g. 2.1.0 or 2.1.0-beta.1).`);
  return {
    major: +m[1],
    minor: +m[2],
    patch: +m[3],
    pre: m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? +p : p)) : [],
  };
}

const format = (v: Version) => `${v.major}.${v.minor}.${v.patch}${v.pre.length ? `-${v.pre.join('.')}` : ''}`;

function compare(a: Version, b: Version) {
  for (const k of ['major', 'minor', 'patch'] as const) if (a[k] !== b[k]) return a[k] - b[k];
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length; // release > pre-release
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function next(current: Version, how: string): Version {
  const v = { ...current, pre: [...current.pre] };
  switch (how) {
    case 'major':
      return { major: v.major + 1, minor: 0, patch: 0, pre: [] };
    case 'minor':
      return { major: v.major, minor: v.minor + 1, patch: 0, pre: [] };
    case 'patch':
      return v.pre.length ? { ...v, pre: [] } : { ...v, patch: v.patch + 1 };
    case 'beta': {
      if (v.pre[0] !== 'beta') return { major: v.major, minor: v.minor, patch: v.patch + 1, pre: ['beta', 1] };
      const n = typeof v.pre[1] === 'number' ? v.pre[1] : 0;
      return { ...v, pre: ['beta', n + 1] };
    }
    default:
      return parse(how.replace(/^v/, ''));
  }
}

// --- go --------------------------------------------------------------------

if (!target) fail('Usage: bun run release <beta|patch|minor|major|x.y.z[-beta.n]> [--push] [--dry-run]');

const pkgText = readFileSync(file('package.json'), 'utf8');
const currentText = JSON.parse(pkgText).version as string;
const current = parse(currentText);
const version = format(next(current, target));
if (compare(parse(version), current) <= 0) fail(`${version} must be newer than the current version ${currentText}.`);

const changelogText = readFileSync(file('CHANGELOG.md'), 'utf8');
const unreleased = parseChangelog(changelogText).find((r) => r.version.toLowerCase() === 'unreleased');
if (!unreleased || !hasContent(unreleased)) {
  fail('CHANGELOG.md has nothing under "## [Unreleased]". Describe the changes there first.');
}
if (parseChangelog(changelogText).some((r) => r.version === version)) fail(`CHANGELOG.md already has a ${version} section.`);

const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
const edits: [string, string, string][] = [
  [
    'CHANGELOG.md',
    changelogText,
    changelogText.replace(/^## \[Unreleased\][^\n]*$/m, `## [Unreleased]\n\n## [${version}] - ${today}`),
  ],
  ['package.json', pkgText, pkgText.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`)],
];

const cargoText = readFileSync(file('src-tauri/Cargo.toml'), 'utf8');
edits.push([
  'src-tauri/Cargo.toml',
  cargoText,
  cargoText.replace(/(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/, `$1${version}$2`),
]);

const lockPath = 'src-tauri/Cargo.lock';
const lockText = readFileSync(file(lockPath), 'utf8');
edits.push([lockPath, lockText, lockText.replace(/(name = "dse-data-fetcher"\r?\nversion = ")[^"]+(")/, `$1${version}$2`)]);

for (const [name, before, after] of edits) if (before === after) fail(`Couldn't update the version in ${name}.`);

console.log(`Releasing \x1b[1m${currentText} → ${version}\x1b[0m${dryRun ? ' (dry run)' : ''}`);
if (dryRun) {
  for (const [name] of edits) console.log(`  would update ${name}`);
  process.exit(0);
}
for (const [name, , after] of edits) {
  writeFileSync(file(name), after);
  console.log(`  updated ${name}`);
}

const inGit = (await $`git -C ${root} rev-parse --is-inside-work-tree`.quiet().nothrow()).exitCode === 0;
if (!inGit || flags.has('--no-git')) {
  console.log('\nNot a git repository: skipped commit and tag.');
  process.exit(0);
}

const tag = `v${version}`;
await $`git -C ${root} add ${edits.map(([name]) => name)}`;
await $`git -C ${root} commit -m ${`Release ${tag}`}`;
await $`git -C ${root} tag -a ${tag} -m ${`DSE Data Fetcher ${version}`}`;
console.log(`  committed and tagged ${tag}`);

if (flags.has('--push')) {
  await $`git -C ${root} push --follow-tags`;
  console.log(`\nPushed. GitHub Actions is building ${tag} now.`);
} else {
  console.log(`\nNext: git push --follow-tags   (starts the release build for ${tag})`);
}
