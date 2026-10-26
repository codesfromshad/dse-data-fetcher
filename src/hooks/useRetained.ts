import { useRef } from 'react';

/**
 * What a dialog shows, kept while it animates closed.
 *
 * Dialogs whose content comes from the value that opens them (a document, a
 * list of locked files) lose that content the moment they're told to close,
 * but the surface still fades and shrinks for a moment: an empty box flashed
 * across the window. This returns the value as it was while `open`, so the
 * dialog closes showing what it showed.
 */
export function useRetained<T>(value: T, open: boolean): T {
  const kept = useRef(value);
  if (open) kept.current = value;
  return open ? value : kept.current;
}
