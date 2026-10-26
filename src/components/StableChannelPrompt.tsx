import { useState } from 'react';
import {
  Body1,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { ShieldCheckmarkRegular } from '@fluentui/react-icons';
import { useSettings } from '../hooks/useSettings';
import { APP_VERSION, IS_PRERELEASE, displayVersion } from '../lib/description';
import { describeError } from '../lib/errors';
import { setHideStablePrompt } from '../lib/settings';

// Same layout as CloseDialog: a Windows 11 content dialog.
const useStyles = makeStyles({
  surface: { width: '480px', maxWidth: 'calc(100vw - 32px)', padding: 0, overflow: 'hidden' },
  body: { display: 'flex', flexDirection: 'column', gap: 0 },
  main: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXXL} ${tokens.spacingVerticalL}`,
  },
  title: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM },
  titleIcon: { fontSize: '24px', color: tokens.colorPaletteGreenForeground1, flexShrink: 0 },
  content: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, color: tokens.colorNeutralForeground2 },
  error: { color: tokens.colorPaletteRedForeground1 },
  footer: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXXL}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  button: { minWidth: 0, whiteSpace: 'nowrap' },
});

/**
 * On a stable build, people who chose the Beta channel in Settings are asked
 * once per launch whether to move to Stable, until they switch or tick
 * "Don't show this again". (Anyone who never picked a channel follows the
 * installed build, so they're on Stable already.)
 */
export function StableChannelPrompt({ ready }: { ready: boolean }) {
  const styles = useStyles();
  const { settings, update, replace } = useSettings();
  // Decided once, at launch: changing channel in Settings later doesn't pop this up.
  const [eligible] = useState(() => !IS_PRERELEASE && settings.updateChannel === 'beta' && !settings.hideStablePrompt);
  const [dismissed, setDismissed] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async (switchToStable: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (dontShow && !switchToStable) replace(await setHideStablePrompt(true));
      if (switchToStable) await update({ updateChannel: 'stable' });
      setDismissed(true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={eligible && ready && !dismissed} modalType="alert">
      <DialogSurface className={styles.surface}>
        <DialogBody className={styles.body}>
          <div className={styles.main}>
            <DialogTitle className={styles.title}>
              <ShieldCheckmarkRegular className={styles.titleIcon} />
              Switch to the Stable channel?
            </DialogTitle>
            <DialogContent className={styles.content}>
              <Body1>
                Version {displayVersion(APP_VERSION)} is a stable release. You’re on the Beta channel, which gets new
                features first but may have rough edges.
              </Body1>
              <Body1>
                On Stable you only get tested releases. You can change this any time in Settings → Updates.
              </Body1>
              <Checkbox
                label="Don’t show this again"
                checked={dontShow}
                disabled={busy}
                onChange={(_, d) => setDontShow(d.checked === true)}
              />
              {error && <Body1 className={styles.error}>{error}</Body1>}
            </DialogContent>
          </div>
          <div className={styles.footer}>
            <Button className={styles.button} appearance="primary" disabled={busy} onClick={() => void finish(true)}>
              Switch to Stable
            </Button>
            <Button className={styles.button} disabled={busy} onClick={() => void finish(false)}>
              Stay on Beta
            </Button>
          </div>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
