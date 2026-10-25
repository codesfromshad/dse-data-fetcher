import { Fragment, type ReactElement, type ReactNode } from 'react';
import {
  Badge,
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Link,
  Subtitle2,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { openUrl } from '@tauri-apps/plugin-opener';
import { hasContent, isUnreleased, parseChangelog, type Release } from '../lib/changelog';
import { RELEASES } from '../lib/content';
import { APP_VERSION, displayVersion, LINKS } from '../lib/description';

const useStyles = makeStyles({
  release: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
  releaseHead: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  muted: { color: tokens.colorNeutralForeground3 },
  sectionTitle: {
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    fontSize: tokens.fontSizeBase100,
    marginTop: tokens.spacingVerticalXS,
  },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalXL, display: 'grid', gap: tokens.spacingVerticalXS },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: '0.92em',
    padding: '0 4px',
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  all: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXL },
  surface: { maxWidth: '760px', width: 'calc(100vw - 48px)' },
  scroll: { maxHeight: '60vh', overflowY: 'auto', paddingRight: tokens.spacingHorizontalS },
});

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

/** **bold**, `code` and [links](https://…) — all a changelog line needs. */
export function InlineMarkdown({ text }: { text: string }) {
  const styles = useStyles();
  const parts: ReactNode[] = text.split(INLINE).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className={styles.code}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      return (
        <Link key={i} inline onClick={() => void openUrl(link[2]).catch(() => {})}>
          {link[1]}
        </Link>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
  return <>{parts}</>;
}

interface ReleaseProps {
  release: Release;
  /** Hide the version heading (e.g. when the surrounding card already says it). */
  headless?: boolean;
  /** Show at most this many bullets in total. */
  limit?: number;
}

export function ReleaseBlock({ release, headless, limit }: ReleaseProps) {
  const styles = useStyles();
  const current = release.version === APP_VERSION;
  let budget = limit ?? Infinity;

  return (
    <article className={styles.release}>
      {!headless && (
        <div className={styles.releaseHead}>
          <Subtitle2>{isUnreleased(release) ? 'Unreleased' : `Version ${displayVersion(release.version)}`}</Subtitle2>
          {current && (
            <Badge appearance="tint" color="brand" size="small">
              Installed
            </Badge>
          )}
          {release.version.includes('-') && (
            <Badge appearance="outline" color="informative" size="small">
              Pre-release
            </Badge>
          )}
          {release.date && <Caption1 className={styles.muted}>{formatDate(release.date)}</Caption1>}
        </div>
      )}
      {release.summary && (
        <Body1>
          <InlineMarkdown text={release.summary} />
        </Body1>
      )}
      {release.sections.map((section) => {
        if (budget <= 0) return null;
        const items = section.items.slice(0, budget);
        budget -= items.length;
        return (
          <Fragment key={section.title}>
            <span className={styles.sectionTitle}>{section.title}</span>
            <ul className={styles.list}>
              {items.map((item, i) => (
                <li key={i}>
                  <Body1>
                    <InlineMarkdown text={item} />
                  </Body1>
                </li>
              ))}
            </ul>
          </Fragment>
        );
      })}
    </article>
  );
}

/** Release notes markdown from the update server → a Release. */
export function notesToRelease(version: string, notes: string | null): Release | null {
  if (!notes) return null;
  const [release] = parseChangelog(`## [${version}]\n${notes}`);
  return release && hasContent(release) ? release : null;
}

export function formatDate(iso: string) {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Every release in CHANGELOG.md, newest first. */
export function ChangelogDialog({ trigger }: { trigger: ReactElement }) {
  const styles = useStyles();
  const releases = RELEASES.filter(hasContent);
  return (
    <Dialog>
      <DialogTrigger disableButtonEnhancement>{trigger}</DialogTrigger>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Release notes</DialogTitle>
          <DialogContent className={styles.scroll}>
            <div className={styles.all}>
              {releases.map((release) => (
                <ReleaseBlock key={release.version} release={release} />
              ))}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="subtle" onClick={() => void openUrl(LINKS.releases).catch(() => {})}>
              View on GitHub
            </Button>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="primary">Close</Button>
            </DialogTrigger>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
