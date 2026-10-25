// The changelog, bundled into the app at build time. The same file ships next
// to the .exe (tauri.conf.json → bundle.resources). Legal texts live in
// legal.ts so they load with the About page, not at startup.
import changelog from '../../CHANGELOG.md?raw';
import { parseChangelog } from './changelog';

export const RELEASES = parseChangelog(changelog);
