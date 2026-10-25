// Builds the text the installer shows on its "License Agreement" page
// (tauri.conf.json → bundle.licenseFile) from the documents in legal/.
// Runs as part of `bun run build`, so it's always current for `tauri build`.
//
//   bun scripts/build-legal.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const parts = ['EULA.txt', 'DISCLAIMER.txt', 'PRIVACY.txt'];
const rule = '='.repeat(72);

const texts = parts.map((name) => {
  const text = readFileSync(join(root, 'legal', name), 'utf8').replace(/\r\n?/g, '\n').trim();
  // The NSIS license page is happiest with plain ASCII.
  const bad = [...text].findIndex((ch) => ch.charCodeAt(0) > 0x7e);
  if (bad >= 0) {
    const line = text.slice(0, bad).split('\n').length;
    throw new Error(`legal/${name}:${line} has a non-ASCII character (${JSON.stringify(text[bad])}). Use plain ASCII.`);
  }
  return text;
});

const out = join(root, 'legal', 'build');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'LICENSE.txt'), `${texts.join(`\n\n\n${rule}\n\n`)}\n`.replace(/\n/g, '\r\n'));
console.log('legal/build/LICENSE.txt written');
