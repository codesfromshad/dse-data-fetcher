import {
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { DocumentTableRegular, LockClosedRegular } from '@fluentui/react-icons';
import type { LockedFile } from '../lib/native';

// Laid out like a Windows 11 content dialog: title and text on the surface,
// equal-width buttons on a darker footer band.
const useStyles = makeStyles({
  surface: {
    width: '480px',
    maxWidth: 'calc(100vw - 32px)',
    padding: 0,
    overflow: 'hidden',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXXL} ${tokens.spacingVerticalXL}`,
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
  },
  titleIcon: { fontSize: '24px', color: tokens.colorPaletteMarigoldForeground1, flexShrink: 0 },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    color: tokens.colorNeutralForeground2,
  },
  files: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    margin: 0,
    padding: 0,
    listStyle: 'none',
    maxHeight: '160px',
    overflowY: 'auto',
  },
  file: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
  },
  fileIcon: { fontSize: '20px', color: tokens.colorPaletteGreenForeground1, flexShrink: 0 },
  fileName: {
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  footer: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXXL}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  button: { minWidth: 0, whiteSpace: 'nowrap' },
});

interface Props {
  locked: LockedFile[];
  onRetry: () => void;
  onCloseAnyway: () => void;
  onStay: () => void;
}

/** Shown on close when a temporary workbook is still open in another app. */
export function CloseDialog({ locked, onRetry, onCloseAnyway, onStay }: Props) {
  const styles = useStyles();
  const one = locked.length === 1;
  return (
    <Dialog open={locked.length > 0} modalType="alert" onOpenChange={(_, d) => !d.open && onStay()}>
      <DialogSurface className={styles.surface}>
        <DialogBody className={styles.body}>
          <div className={styles.main}>
            <DialogTitle className={styles.title}>
              <LockClosedRegular className={styles.titleIcon} />
              {one ? 'Spreadsheet still open' : 'Spreadsheets still open'}
            </DialogTitle>
            <DialogContent className={styles.content}>
              <Body1>
                {one ? 'This temporary file is' : 'These temporary files are'} open in your spreadsheet application, so{' '}
                {one ? 'it' : 'they'} can’t be deleted yet.
              </Body1>
              <ul className={styles.files}>
                {locked.map((f) => (
                  <li key={f.path} className={styles.file} title={f.path}>
                    <DocumentTableRegular className={styles.fileIcon} />
                    <Caption1 className={styles.fileName}>{f.fileName}</Caption1>
                  </li>
                ))}
              </ul>
              <Body1>
                Close {one ? 'it' : 'them'} there, then choose <strong>Try again</strong>. Or close anyway and{' '}
                {one ? 'it stays' : 'they stay'} in your temp folder.
              </Body1>
            </DialogContent>
          </div>
          <div className={styles.footer}>
            <Button className={styles.button} appearance="primary" onClick={onRetry}>
              Try again
            </Button>
            <Button className={styles.button} onClick={onCloseAnyway}>
              Close anyway
            </Button>
            <Button className={styles.button} onClick={onStay}>
              Cancel
            </Button>
          </div>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
