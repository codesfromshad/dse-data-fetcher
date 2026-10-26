// Display formats for the UI. (Dates from DSE pages are handled in Rust.)

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function offset(date: Date, separator = ':') {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}${separator}${pad(abs % 60)}`;
}

const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hms = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** YYYY-MM-DDTHH:mm:ss.SSSZ — used for log lines. */
export const logTimestamp = (d = new Date()) => `${ymd(d)}T${hms(d)}.${pad(d.getMilliseconds(), 3)}${offset(d)}`;

/** HH:mm:ss.SSS — the short form shown in the log view. */
export const shortTime = (d = new Date()) => `${hms(d)}.${pad(d.getMilliseconds(), 3)}`;

/** Stopwatch format, to the millisecond: M:SS.fff, or H:MM:SS.fff past an hour. */
export function formatElapsed(ms: number) {
  const t = Math.max(0, ms);
  const total = Math.floor(t / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h ? `${h}:${pad(m)}` : m}:${pad(total % 60)}.${pad(Math.floor(t % 1000), 3)}`;
}
