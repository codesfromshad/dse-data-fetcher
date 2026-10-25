// Byte sizes and rates for the network metrics. Same rules as
// format_bytes in src-tauri/src/fetch/metrics.rs (binary units, like Explorer).

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1536 → "1.50 KB". */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${UNITS[unit]}`;
}

export const formatRate = (bytesPerSecond: number) => `${formatBytes(bytesPerSecond)}/s`;
