import { Fragment } from 'react';
import {
  Body1,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Subtitle2,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { CopyRegular } from '@fluentui/react-icons';
import type { LegalDoc } from '../lib/legal';
import { ScrollArea } from './ScrollArea';

const useStyles = makeStyles({
  surface: { maxWidth: '760px', width: 'calc(100vw - 48px)' },
  // DialogContent no longer scrolls itself; the ScrollArea inside it does.
  content: { overflow: 'visible', display: 'flex', flexDirection: 'column', minHeight: 0 },
  scrollArea: { maxHeight: '62vh' },
  scroll: {
    paddingRight: tokens.spacingHorizontalXL,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    userSelect: 'text',
    cursor: 'text',
  },
  heading: { margin: `${tokens.spacingVerticalM} 0 0` },
  para: { margin: 0, color: tokens.colorNeutralForeground2, whiteSpace: 'pre-wrap', lineHeight: tokens.lineHeightBase400 },
  item: { margin: 0, color: tokens.colorNeutralForeground2, paddingLeft: tokens.spacingHorizontalL },
});

/** An ALL-CAPS line (optionally numbered) is a heading. */
const isHeading = (line: string) =>
  line.length <= 60 && /^(\d+\.\s+)?[A-Z0-9][A-Z0-9 ,.'&()\-/]+$/.test(line) && /[A-Z]{3}/.test(line);

/** Renders our plain-text legal documents with headings and indented items. */
function LegalText({ text }: { text: string }) {
  const styles = useStyles();
  // The first block (title lines) is already in the dialog title.
  const blocks = text.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/).slice(1);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        if (lines.length === 1 && isHeading(lines[0])) {
          return (
            <Subtitle2 key={i} className={styles.heading} as="h3">
              {lines[0]}
            </Subtitle2>
          );
        }
        if (lines.every((l) => /^\s+(-|\([a-z]\))\s/.test(l))) {
          return (
            <Fragment key={i}>
              {lines.map((l, j) => (
                <Body1 key={j} className={styles.item}>
                  {l.trim()}
                </Body1>
              ))}
            </Fragment>
          );
        }
        return (
          <Body1 key={i} className={styles.para} as="p">
            {block}
          </Body1>
        );
      })}
    </>
  );
}

interface Props {
  doc: LegalDoc | null;
  onClose: () => void;
}

export function LegalDialog({ doc, onClose }: Props) {
  const styles = useStyles();
  return (
    <Dialog open={!!doc} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={styles.surface}>
        {doc && (
          <DialogBody>
            <DialogTitle>{doc.title}</DialogTitle>
            <DialogContent className={styles.content}>
              <ScrollArea className={styles.scrollArea} viewportClassName={styles.scroll} data-allow-context-menu>
                <LegalText text={doc.text} />
              </ScrollArea>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="subtle"
                icon={<CopyRegular />}
                onClick={() => void navigator.clipboard.writeText(doc.text).catch(() => {})}
              >
                Copy text
              </Button>
              <Button appearance="primary" onClick={onClose}>
                Close
              </Button>
            </DialogActions>
          </DialogBody>
        )}
      </DialogSurface>
    </Dialog>
  );
}
