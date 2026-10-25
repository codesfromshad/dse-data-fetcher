// One-time setup for signed auto-updates.
//
//   bun run updater:setup                 create the key pair, write the public key into tauri.conf.json
//   bun run updater:setup --set-secrets   ...and store the private key as GitHub Actions secrets (needs `gh`)
//   bun run updater:setup --password X    protect the private key with a password
//
// The private key stays in %USERPROFILE%\.tauri\ — never commit it. If you
// lose it, installed copies can't verify future updates and must be
// reinstalled by hand, so back it up somewhere safe (a password manager).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

const root = join(import.meta.dir, '..');
const args = process.argv.slice(2);
const passwordIndex = args.indexOf('--password');
const password = passwordIndex >= 0 ? (args[passwordIndex + 1] ?? '') : (process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '');

const keyDir = join(homedir(), '.tauri');
const keyPath = join(keyDir, 'dse-data-fetcher.key');
const pubPath = `${keyPath}.pub`;

if (existsSync(keyPath)) {
  console.log(`Using the existing key ${keyPath}`);
} else {
  mkdirSync(keyDir, { recursive: true });
  console.log(`Creating a signing key at ${keyPath}…`);
  const passwordArgs = password ? ['-p', password] : [];
  await $`bun tauri signer generate --ci -w ${keyPath} ${passwordArgs}`.cwd(root);
}

const pubkey = readFileSync(pubPath, 'utf8').trim();
const confPath = join(root, 'src-tauri', 'tauri.conf.json');
const conf = readFileSync(confPath, 'utf8');
const updated = conf.replace(/("pubkey"\s*:\s*")[^"]*(")/, `$1${pubkey}$2`);
if (updated === conf && !conf.includes(pubkey)) throw new Error('Couldn’t find "pubkey" in src-tauri/tauri.conf.json');
writeFileSync(confPath, updated);
console.log('Public key written to src-tauri/tauri.conf.json');

if (args.includes('--set-secrets')) {
  // package.json "repository": "github:owner/name" — so this works before the folder is a git clone.
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { repository?: string };
  const repo = pkg.repository?.replace(/^github:/, '');
  if (!repo) throw new Error('Set "repository": "github:owner/name" in package.json first.');
  // Piped through stdin so the key never shows up in the process list.
  const setSecret = async (name: string, value: string) => {
    const proc = Bun.spawn(['gh', 'secret', 'set', name, '--repo', repo], {
      cwd: root,
      stdin: new TextEncoder().encode(value),
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if ((await proc.exited) !== 0) throw new Error(`gh secret set ${name} failed. Does github.com/${repo} exist, and is gh logged in with access to it?`);
  };
  await setSecret('TAURI_SIGNING_PRIVATE_KEY', readFileSync(keyPath, 'utf8').trim());
  // An unset secret reads as an empty string in Actions, which is what a key without a password needs.
  if (password) await setSecret('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', password);
  console.log(`GitHub secret TAURI_SIGNING_PRIVATE_KEY${password ? ' and TAURI_SIGNING_PRIVATE_KEY_PASSWORD' : ''} set.`);
} else {
  console.log(`
Now add two secrets to the GitHub repo (Settings → Secrets and variables → Actions):
  TAURI_SIGNING_PRIVATE_KEY           the contents of ${keyPath}
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD  ${password ? 'the password you chose' : '(not needed: the key has no password)'}
or run this again with --set-secrets if the GitHub CLI (gh) is installed and logged in.`);
}

console.log(`
Back up ${keyPath}. Without it you can't ship updates to existing installs.`);
