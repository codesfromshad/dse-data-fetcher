// Parser for CHANGELOG.md (Keep a Changelog format). No Vite/DOM imports:
// scripts/release.ts and scripts/release-notes.ts use this file too.
//
//   ## [Unreleased]
//   ## [2.0.0-beta.1] - 2026-10-25
//   ### Added
//   - A thing, with **bold**, `code` and [links](https://…)

export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface Release {
  /** "Unreleased" or a semver string. */
  version: string;
  date: string | null;
  /** Free text between the version heading and its first ### section. */
  summary: string;
  sections: ChangelogSection[];
}

const RELEASE_HEADING = /^##\s+\[?([^\]\s]+)\]?(?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/;
const SECTION_HEADING = /^###\s+(.+?)\s*$/;
const BULLET = /^\s{0,3}[-*]\s+(.*)$/;

export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: ChangelogSection | null = null;

  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;

    if ((m = line.match(RELEASE_HEADING))) {
      release = { version: m[1], date: m[2] ?? null, summary: '', sections: [] };
      section = null;
      releases.push(release);
    } else if (!release || line.startsWith('[')) {
      // Preamble before the first release, or a link reference at the bottom.
      continue;
    } else if ((m = line.match(SECTION_HEADING))) {
      section = { title: m[1], items: [] };
      release.sections.push(section);
    } else if (section && (m = line.match(BULLET))) {
      section.items.push(m[1].trim());
    } else if (section && line.trim() && section.items.length) {
      // Wrapped continuation of the previous bullet.
      section.items[section.items.length - 1] += ` ${line.trim()}`;
    } else if (!section && line.trim()) {
      release.summary = release.summary ? `${release.summary} ${line.trim()}` : line.trim();
    }
  }

  // Drop empty sections (e.g. an [Unreleased] with only headings).
  for (const r of releases) r.sections = r.sections.filter((s) => s.items.length);
  return releases;
}

export const isUnreleased = (release: Release) => release.version.toLowerCase() === 'unreleased';

export const hasContent = (release: Release) => !!release.summary || release.sections.length > 0;

/** The markdown body under `## [version]`, for GitHub release notes. */
export function releaseNotesMarkdown(markdown: string, version: string): string | null {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => l.match(RELEASE_HEADING)?.[1] === version);
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && (RELEASE_HEADING.test(l) || /^\[[^\]]+\]:/.test(l)));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}
