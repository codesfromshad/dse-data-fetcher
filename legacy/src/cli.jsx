#!/usr/bin/env bun
import React from 'react';
import { render } from 'ink';
import App from './app.jsx';
import { cookieJarPath } from './fetch-client.js';
import { cleanupCookieJar } from './lib/curl.js';
import { cleanupTempFiles } from './lib/temp-files.js';

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('DSE Data Fetcher needs an interactive terminal. Run it from Command Prompt, PowerShell or Windows Terminal.');
  process.exit(1);
}

// Full-screen like blessed did: switch to the alternate screen buffer so the
// user's scrollback is restored untouched on exit.
const ENTER_ALT_SCREEN = '\x1b[?1049h\x1b[H';
const LEAVE_ALT_SCREEN = '\x1b[?25h\x1b[?1049l';

let restored = false;
function restoreTerminal() {
  if (restored) return;
  restored = true;
  process.stdout.write(LEAVE_ALT_SCREEN);
}

function cleanup() {
  restoreTerminal();
  cleanupCookieJar(cookieJarPath);
  cleanupTempFiles(); // e.g. an xlsx left behind by Ctrl+C
}

process.on('exit', cleanup);
process.on('uncaughtException', (error) => {
  cleanup();
  console.error(error);
  process.exit(1);
});

process.stdout.write(ENTER_ALT_SCREEN);

const app = render(<App />, { exitOnCtrlC: true, patchConsole: true });
await app.waitUntilExit().catch(() => {});
process.exit(0);
