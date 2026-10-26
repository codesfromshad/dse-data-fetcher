// Turns raw system-check failures into messages a person can act on: what
// went wrong, in plain words, and what to try. The raw reason is kept as
// `technical` for the curious (and for bug reports).

import { describeError } from './errors';

export type Fix = 'retry' | 'chooseApp';

export interface Problem {
  severity: 'error' | 'warning';
  title: string;
  message: string;
  /** The underlying error text, shown small. */
  technical?: string;
  fix: Fix;
}

const SITE = 'old.dsebd.org';

/** The `{ kind, message }` that Rust's `HttpError` serializes to. */
interface HttpError {
  kind: 'connect' | 'timeout' | 'status' | 'body' | 'other';
  message: string;
}

const isHttpError = (e: unknown): e is HttpError =>
  typeof e === 'object' && e !== null && 'kind' in e && 'message' in e && typeof (e as HttpError).message === 'string';

/** "…: Access is denied. (os error 5)" → "Access is denied" */
const tidy = (text: string) => text.replace(/\s*\(os error \d+\)\s*$/i, '').replace(/\.$/, '');

export const offlineProblem = (): Problem => ({
  severity: 'error',
  title: 'You’re offline',
  message: 'This PC isn’t connected to the internet. Check your Wi-Fi or network cable. This goes away by itself once you’re back online.',
  fix: 'retry',
});

export function dseProblem(error: unknown): Problem {
  const technical = describeError(error);
  const base: Pick<Problem, 'severity' | 'technical' | 'fix'> = { severity: 'error', technical, fix: 'retry' };
  const kind = isHttpError(error) ? error.kind : 'other';

  // For timeouts and HTTP errors the message already says it all.
  if (kind === 'timeout') {
    return {
      ...base,
      technical: undefined,
      title: 'The DSE website isn’t responding',
      message: `${SITE} didn’t answer within 10 seconds. It may be busy or down for maintenance. Try again in a few minutes.`,
    };
  }

  if (kind === 'status') {
    const match = /(\d{3})\s*(.*)$/.exec(technical);
    const code = match ? Number(match[1]) : 0;
    const status = match ? `HTTP ${match[1]}${match[2] ? ` ${match[2]}` : ''}` : 'an error';
    base.technical = undefined;
    if (code >= 500) {
      return {
        ...base,
        title: 'The DSE website is having problems',
        message: `${SITE} replied with ${status}. The problem is on DSE’s side and usually clears up on its own. Try again in a few minutes.`,
      };
    }
    if (code === 403 || code === 429) {
      return {
        ...base,
        title: 'The DSE website turned the app away',
        message: `${SITE} replied with ${status}. It may be limiting requests from your network for now. Wait a while, then try again.`,
      };
    }
    return {
      ...base,
      title: 'The DSE website returned an error',
      message: `${SITE} replied with ${status}. If this keeps happening, the site may have changed. Check for an app update.`,
    };
  }

  if (/certificate|tls|ssl|handshake|schannel/i.test(technical)) {
    return {
      ...base,
      title: 'Couldn’t make a secure connection to DSE',
      message: `Windows couldn’t verify ${SITE}’s security certificate. Check that this PC’s date and time are correct, and that antivirus or a proxy isn’t inspecting HTTPS traffic.`,
    };
  }

  if (/dns|lookup|resolve|no such host|name or service/i.test(technical)) {
    return {
      ...base,
      title: 'Couldn’t find the DSE website',
      message: `Your network couldn’t look up ${SITE}. Your internet may be partly down, or a DNS or firewall setting may be blocking the site.`,
    };
  }

  if (kind === 'connect') {
    return {
      ...base,
      title: 'Couldn’t connect to the DSE website',
      message: `The connection to ${SITE} was refused or dropped. The site may be down, or a firewall or VPN may be blocking it.`,
    };
  }

  return {
    ...base,
    title: 'Couldn’t reach the DSE website',
    message: `Something went wrong while contacting ${SITE}. Try again in a moment.`,
  };
}

export function tempProblem(error: unknown): Problem {
  const technical = tidy(describeError(error));
  const reason = /denied|permission/i.test(technical)
    ? 'Windows didn’t allow it. Check the folder’s permissions, or whether antivirus is blocking the app.'
    : /space|disk full|quota/i.test(technical)
      ? 'The drive is full. Free up some disk space.'
      : 'Check that the drive is available and not full.';
  return {
    severity: 'error',
    title: 'Can’t save the workbook',
    message: `The workbook is written to your temporary folder first, but the app couldn’t write there. ${reason}`,
    technical,
    fix: 'retry',
  };
}

export const noAppProblem = (): Problem => ({
  severity: 'warning',
  title: 'No spreadsheet app found',
  message: 'Nothing on this PC is set to open .xlsx files, so the workbook won’t open by itself. You can still fetch and use “Save a copy”, or choose Excel, LibreOffice Calc or another app.',
  fix: 'chooseApp',
});

export const missingAppProblem = (path: string): Problem => ({
  severity: 'warning',
  title: 'Your chosen spreadsheet app is missing',
  message: 'The app picked in Settings isn’t there anymore (it may have been uninstalled or moved). Choose it again, or go back to the system default.',
  technical: path,
  fix: 'chooseApp',
});

export const appCheckProblem = (error: unknown): Problem => ({
  severity: 'warning',
  title: 'Couldn’t check for a spreadsheet app',
  message: 'The workbook may not open by itself. You can still fetch and use “Save a copy”.',
  technical: describeError(error),
  fix: 'chooseApp',
});
