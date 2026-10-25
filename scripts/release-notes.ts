// Prints the CHANGELOG.md section for a version (used by the release workflow
// as the GitHub release body, which also becomes the in-app update notes).
//
//   bun scripts/release-notes.ts 2.0.0-beta.1

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseNotesMarkdown } from '../src/lib/changelog';

const version = process.argv[2]?.replace(/^v/, '');
if (!version) {
  console.error('Usage: bun scripts/release-notes.ts <version>');
  process.exit(1);
}

const changelog = readFileSync(join(import.meta.dir, '..', 'CHANGELOG.md'), 'utf8');
const notes = releaseNotesMarkdown(changelog, version);
if (!notes) {
  console.error(`CHANGELOG.md has no "## [${version}]" section.`);
  process.exit(1);
}
console.log(notes);
