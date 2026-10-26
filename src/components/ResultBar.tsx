import { useState } from 'react';
import {
  Button,
  Link,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { AppsAddInRegular, DocumentTableRegular, FolderOpenRegular, OpenRegular, SaveRegular } from '@fluentui/react-icons';
import { save } from '@tauri-apps/plugin-dialog';
import { describeError } from '../lib/errors';
import { openFile, revealFile, saveCopy } from '../lib/native';
import type { FetchResult } from '../lib/fetch';
import { useSettings } from '../hooks/useSettings';

const useStyles = makeStyles({
  name: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  // On its own line, so the title doesn't run into the file name.
  title: { display: 'block', marginBottom: tokens.spacingVerticalXXS },
});

/** Suggested name for "Save a copy": drop the temp_ prefix. */
const suggestedName = (fileName: string) => fileName.replace(/^temp_/, '');

interface Props {
  result: FetchResult;
  /** False when no spreadsheet app is available. */
  canOpen: boolean;
  onChooseApp: () => void;
}

export function ResultBar({ result, canOpen, onChooseApp }: Props) {
  const styles = useStyles();
  const { settings } = useSettings();
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<void>) => async () => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const saveAs = run(async () => {
    const destination = await save({
      title: 'Save a copy of the spreadsheet',
      defaultPath: suggestedName(result.fileName),
      filters: [{ name: 'Spreadsheet (.xlsx)', extensions: ['xlsx'] }],
    });
    if (!destination) return;
    await saveCopy(result.filePath, destination);
    setSavedTo(destination);
  });

  return (
    <>
      <MessageBar intent="success" layout="multiline" icon={<DocumentTableRegular />}>
        <MessageBarBody>
          <MessageBarTitle className={styles.title}>Spreadsheet ready</MessageBarTitle>
          {settings.deleteTempOnClose ? (
            <>
              <span className={styles.name}>{result.fileName}</span> is temporary and will be deleted when you close the
              app. Use “Save a copy” to keep it.
            </>
          ) : (
            <>
              <span className={styles.name}>{result.fileName}</span> is in your temp folder and is kept when you close the
              app. Use “Save a copy” to put it somewhere else.
            </>
          )}
          {savedTo && (
            <>
              {' '}
              Copy saved to{' '}
              <Link as="button" inline onClick={run(() => revealFile(savedTo))}>
                {savedTo}
              </Link>
              .
            </>
          )}
        </MessageBarBody>
        <MessageBarActions>
          {canOpen ? (
            <Button appearance="primary" icon={<OpenRegular />} onClick={run(() => openFile(result.filePath))}>
              Open
            </Button>
          ) : (
            <Button appearance="primary" icon={<AppsAddInRegular />} onClick={onChooseApp}>
              Choose app to open…
            </Button>
          )}
          <Button icon={<SaveRegular />} onClick={saveAs}>
            Save a copy…
          </Button>
          <Button appearance="subtle" icon={<FolderOpenRegular />} onClick={run(() => revealFile(result.filePath))}>
            Show in folder
          </Button>
        </MessageBarActions>
      </MessageBar>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
    </>
  );
}
