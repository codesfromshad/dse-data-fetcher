import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { deleteTempFiles, type LockedFile } from '../lib/native';

/**
 * On window close, delete the temp spreadsheets. If one is still open in
 * Excel (locked), keep the window open and let the user retry or leave it.
 */
export function useCloseGuard() {
  const [locked, setLocked] = useState<LockedFile[]>([]);
  const force = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (force.current) return;
        try {
          const stillOpen = await deleteTempFiles();
          if (stillOpen.length) {
            event.preventDefault();
            setLocked(stillOpen);
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
