/**
 * Short, human-readable reason for a failure. Handles thrown Errors, plain
 * strings, and the `{ message }` objects Rust commands reject with.
 */
export function describeError(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : String(error);
  const text = raw.trim().split('\n')[0];
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
