import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { deleteTempFiles, type LockedFile } from '../lib/native';

/** How long the window stays up after deleting, so the log lines can be read. */
const LINGER_MS = 1200;

/**
 * On window close, delete the temp spreadsheets, logging each one. If one is
 * still open in Excel (locked), keep the window open and let the user retry
 * or leave it. If any were deleted, `onCleanup` runs (App shows the activity
 * log) and the window stays a moment so the lines can be read, then closes.
 */
export function useCloseGuard({ onCleanup }: { onCleanup?: () => void } = {}) {
  const [locked, setLocked] = useState<LockedFile[]>([]);
  const force = useRef(false);
  const cleanup = useRef(onCleanup);
  cleanup.current = onCleanup;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (force.current) return;
        try {
          const report = await deleteTempFiles();
          if (report.locked.length) {
            event.preventDefault();
            setLocked(report.locked);
          } else if (report.deleted > 0) {
            event.preventDefault();
            cleanup.current?.();
            await new Promise((resolve) => setTimeout(resolve, LINGER_MS));
            force.current = true;
            void getCurrentWindow().destroy();
          }
        } catch {
          // Never trap the user in the app because cleanup failed; Rust tries
          // once more on exit anyway.
        }
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)))
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const retry = useCallback(() => {
    setLocked([]);
    void getCurrentWindow().close();
  }, []);

  const closeAnyway = useCallback(() => {
    force.current = true;
    void getCurrentWindow().destroy();
  }, []);

  const stay = useCallback(() => setLocked([]), []);

  return { locked, retry, closeAnyway, stay };
}
