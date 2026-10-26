import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useSettings } from '../hooks/useSettings';
import { hasContent } from '../lib/changelog';
import { RELEASES } from '../lib/content';
import { APP_VERSION, displayVersion } from '../lib/description';
import { setLastSeenVersion } from '../lib/settings';
import { ChangelogDialog, ReleaseBlock } from './ReleaseNotes';

const useStyles = makeStyles({
  surface: { maxWidth: '640px', width: 'calc(100vw - 48px)' },
  scroll: { maxHeight: '55vh', overflowY: 'auto', paddingRight: tokens.spacingHorizontalS },
});

/**
 * Shown once after the app updates to a new version. A fresh install just
 * records the version silently. `onDone` fires once it's closed (or right
 * away when there's nothing to show), so other launch prompts can wait.
 */
export function WhatsNewDialog({ onDone }: { onDone?: () => void }) {
  const styles = useStyles();
  const { settings, replace } = useSettings();
  const [open, setOpen] = useState(false);
  const release = RELEASES.find((r) => r.version === APP_VERSION && hasContent(r));

  useEffect(() => {
    const seen = settings.lastSeenVersion;
    if (seen && seen !== APP_VERSION && release) setOpen(true);
    else onDone?.();
    if (seen === APP_VERSION) return;
    void setLastSeenVersion(APP_VERSION).then(replace).catch(() => {});
    // Only once, on launch.
  }, []);

  const close = () => {
    setOpen(false);
    onDone?.();
  };

  if (!release) return null;
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && close()}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>What’s new in {displayVersion(APP_VERSION)}</DialogTitle>
          <DialogContent className={styles.scroll}>
            <ReleaseBlock release={release} headless />
          </DialogContent>
          <DialogActions>
            <ChangelogDialog trigger={<Button appearance="subtle">All release notes</Button>} />
            <Button appearance="primary" onClick={close}>
              Got it
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
