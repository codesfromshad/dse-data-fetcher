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
import type { LockedFile } from '../lib/native';

const useStyles = makeStyles({
  files: { margin: `${tokens.spacingVerticalS} 0`, paddingLeft: tokens.spacingHorizontalXL },
  name: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
});

interface Props {
  locked: LockedFile[];
  onRetry: () => void;
  onCloseAnyway: () => void;
  onStay: () => void;
}

export function CloseDialog({ locked, onRetry, onCloseAnyway, onStay }: Props) {
  const styles = useStyles();
  const one = locked.length === 1;
  return (
    <Dialog open={locked.length > 0} modalType="alert" onOpenChange={(_, d) => !d.open && onStay()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{one ? 'Spreadsheet is still open' : 'Spreadsheets are still open'}</DialogTitle>
          <DialogContent>
            {one ? 'This temporary file is' : 'These temporary files are'} open in another app (probably Excel), so{' '}
            {one ? "it can't" : "they can't"} be deleted yet:
            <ul className={styles.files}>
              {locked.map((f) => (
                <li key={f.path} className={styles.name}>
                  {f.fileName}
                </li>
              ))}
            </ul>
            Close {one ? 'it' : 'them'} there and choose <b>Try again</b>, or close the app and leave{' '}
            {one ? 'it' : 'them'} in your temp folder.
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onRetry}>
              Try again
            </Button>
            <Button onClick={onCloseAnyway}>Close anyway</Button>
            <Button appearance="subtle" onClick={onStay}>
              Cancel
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
