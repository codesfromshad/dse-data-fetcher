// Structured log messages. The CLI coloured parts of a message with chalk;
// here a message is a list of parts, and the UI decides how each tone looks.

export type LogLevel = 'success' | 'info' | 'warn' | 'error';
export type Tone = 'accent' | 'success' | 'info' | 'danger' | 'subtle';

/** `href`: opens in the browser when clicked (a symbol's company page). */
export type LogPart = string | { text: string; tone: Tone; badge?: boolean; href?: string };

export interface LogEntry {
  id: number;
  /** Full ISO timestamp (used for copy/export). */
  time: string;
  /** HH:mm:ss.SSS shown in the list. */
  shortTime: string;
  level: LogLevel;
  parts: LogPart[];
}

/** Highlight a value inside a message (the CLI's chalk.yellow). */
export const hl = (value: string | number, tone: Tone = 'accent'): LogPart => ({ text: String(value), tone });

/** Inline pill, e.g. COMPLETE or the elapsed time. */
export const pill = (value: string, tone: Tone): LogPart => ({ text: value, tone, badge: true });

export const partText = (part: LogPart) => (typeof part === 'string' ? part : part.text);

const LEVEL_LABEL: Record<LogLevel, string> = { success: 'SUCCESS', info: 'INFO', warn: 'WARNING', error: 'ERROR' };
export const levelLabel = (level: LogLevel) => LEVEL_LABEL[level];

/** Plain-text line, same shape as the CLI's log lines. */
export const entryToText = (entry: LogEntry) =>
  `[${entry.time}] ${LEVEL_LABEL[entry.level]}: ${entry.parts.map(partText).join('')}`;
