// Temp files live on the UI thread's books, so they can be cleaned up even if
// the worker that created them is gone (Ctrl+C mid-run, crash, etc.).
import fs from 'node:fs';

const tempFiles = new Set();

export const trackTempFile = (filePath) => tempFiles.add(filePath);

/** Delete a temp file. Returns 'deleted' | 'locked' (open in another app) | 'gone'. */
export function deleteTempFile(filePath) {
  try {
    fs.unlinkSync(filePath);
    tempFiles.delete(filePath);
    return 'deleted';
  } catch (error) {
    if (error.code === 'ENOENT') {
      tempFiles.delete(filePath);
      return 'gone';
    }
    if (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES') return 'locked';
    throw error;
  }
}

/** Best effort on exit; silently skips files a spreadsheet app still has open. */
export function cleanupTempFiles() {
  for (const filePath of tempFiles) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }
}
