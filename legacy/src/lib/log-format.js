import chalk from 'chalk';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';

// Same label styling the blessed version used.
const LEVELS = {
  success: chalk.green('SUCCESS:'),
  info: chalk.cyan('INFO:'),
  warn: chalk.yellow('WARNING:'),
  error: chalk.red('ERROR:'),
};

// Below this many columns for the message itself, a hanging indent wastes
// more space than it saves, so lines wrap flush to the left edge instead.
const MIN_MESSAGE_WIDTH = 30;

/**
 * Turn a log entry into screen lines that fit `width` columns exactly.
 * Wrapped lines get a hanging indent so they line up under the message:
 *
 *   [2026-10-05T07:44:38.432+06:00] SUCCESS: Fetching  COMPLETE  for all 34
 *                                            symbols. Elapsed time: 00:00:11
 */
export function wrapLogEntry(entry, width) {
  const head = `[${entry.time}] ${LEVELS[entry.level] ?? LEVELS.info} `;
  const headWidth = stringWidth(head);
  const messageWidth = width - headWidth;

  if (messageWidth < MIN_MESSAGE_WIDTH) {
    return wrapAnsi(head + entry.message, width, { hard: true }).split('\n');
  }

  const indent = ' '.repeat(headWidth);
  return wrapAnsi(entry.message, messageWidth, { hard: true })
    .split('\n')
    .map((line, i) => (i === 0 ? head : indent) + line);
}

/** Wrap plain text (keeps leading spaces, so the ASCII art stays aligned). */
export const wrapText = (text, width) => wrapAnsi(text, width, { hard: true, trim: false }).split('\n');
