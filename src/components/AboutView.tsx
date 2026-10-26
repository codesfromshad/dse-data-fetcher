import { Fragment, useEffect, useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Caption1,
  Link,
  Subtitle2,
  Title2,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  BugRegular,
  CheckmarkRegular,
  ChevronRightRegular,
  CodeRegular,
  CopyRegular,
  GlobeRegular,
  LockClosedRegular,
  MailRegular,
  ScalesRegular,
  ShieldRegular,
  WarningRegular,
  type FluentIcon,
} from '@fluentui/react-icons';
import { openUrl } from '@tauri-apps/plugin-opener';
import icon from '../assets/icon.png';
import { useSettings } from '../hooks/useSettings';
import { RELEASES } from '../lib/content';
import { LEGAL_DOCS, type LegalDoc, type LegalDocId } from '../lib/legal';
import { hasContent, isUnreleased } from '../lib/changelog';
import {
  APP_NAME,
  APP_VERSION,
  AUTHOR,
  COPYRIGHT_LINE,
  DATA_POINTS,
  displayVersion,
  IS_PRERELEASE,
  LINKS,
  SUMMARY,
} from '../lib/description';
import { DSE_URL } from '../lib/fetch';
import { getBuildInfo, type BuildInfo } from '../lib/settings';
import { LegalDialog } from './LegalDialog';
import { ScrollArea } from './ScrollArea';
import { ChangelogDialog, formatDate, ReleaseBlock } from './ReleaseNotes';
import { UpdatePanel } from './UpdateControls';

const useStyles = makeStyles({
  // Runs to the window's right and bottom edges, like Windows Settings: the
  // scrollbar sits at the edge and the shell's gutter moves inside as padding.
  scrollArea: {
    flex: 1,
    marginRight: `calc(-1 * ${tokens.spacingHorizontalXL})`,
    marginBottom: `calc(-1 * ${tokens.spacingVerticalXL})`,
  },
  page: {
    display: 'flex',
    justifyContent: 'center',
    // The column sizes to its content, so the scrollbar sees it grow.
    alignItems: 'flex-start',
    paddingRight: tokens.spacingHorizontalXL,
    paddingBottom: tokens.spacingVerticalXL,
  },
  column: {
    width: '100%',
    maxWidth: '960px',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalXXL,
  },
  card: {
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXL}`,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow2,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    minWidth: 0,
  },
  hero: { gap: tokens.spacingVerticalL },
  heroTop: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXL, flexWrap: 'wrap' },
  logo: { width: '72px', height: '72px', flexShrink: 0 },
  heroText: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS, flex: 1, minWidth: '240px' },
  versionLine: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  muted: { color: tokens.colorNeutralForeground3 },
  secondary: { color: tokens.colorNeutralForeground2 },
  divider: { height: '1px', backgroundColor: tokens.colorNeutralStroke2, border: 'none', margin: 0 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: tokens.spacingVerticalM },
  cardHead: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  grow: { flex: 1 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalXS },
  info: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    columnGap: tokens.spacingHorizontalXL,
    rowGap: tokens.spacingVerticalS,
    margin: 0,
    userSelect: 'text',
    cursor: 'text',
  },
  infoKey: { color: tokens.colorNeutralForeground3 },
  infoValue: { margin: 0, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' },
  links: { display: 'flex', flexDirection: 'column' },
  linkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    margin: `0 calc(-1 * ${tokens.spacingHorizontalS})`,
    borderRadius: tokens.borderRadiusMedium,
    border: 'none',
    background: 'none',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left',
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover },
    ':active': { backgroundColor: tokens.colorSubtleBackgroundPressed },
    ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}` },
  },
  linkIcon: { fontSize: '20px', color: tokens.colorBrandForeground1, flexShrink: 0 },
  linkText: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  chevron: { color: tokens.colorNeutralForeground3 },
  // Links in the footer: the footer's own (caption) size, not Link's default.
  footerLink: { fontSize: 'inherit', lineHeight: 'inherit' },
  footer: { textAlign: 'center', color: tokens.colorNeutralForeground3, padding: `${tokens.spacingVerticalS} 0` },
});

const open = (url: string) => () => void openUrl(url).catch(() => {});

const LEGAL_ICONS: Record<LegalDocId, FluentIcon> = {
  eula: ScalesRegular,
  disclaimer: WarningRegular,
  privacy: LockClosedRegular,
  'third-party': CodeRegular,
};

/** The legal documents, as short links in the footer (same icons as the Legal card). */
const FOOTER_LINKS: { id: LegalDocId; label: string }[] = [
  { id: 'eula', label: 'License' },
  { id: 'disclaimer', label: 'Disclaimer' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'third-party', label: 'Open-source' },
];

function LinkRow({ icon: Icon, title, description, onClick }: { icon: FluentIcon; title: string; description?: string; onClick: () => void }) {
  const styles = useStyles();
  return (
    <button type="button" className={styles.linkRow} onClick={onClick}>
      <Icon className={styles.linkIcon} />
      <span className={styles.linkText}>
        <Body1>{title}</Body1>
        {description && <Caption1 className={styles.muted}>{description}</Caption1>}
      </span>
      <ChevronRightRegular className={styles.chevron} />
    </button>
  );
}

function systemInfoText(build: BuildInfo | null, channel: string) {
  return [
    `${APP_NAME} ${APP_VERSION}${build?.debug ? ' (debug build)' : ''}`,
    `Update channel: ${channel}`,
    `Tauri: ${build?.tauriVersion ?? 'unknown'}`,
    `WebView2: ${build?.webviewVersion ?? 'unknown'}`,
    `Platform: ${build ? `${build.os} ${build.arch}` : 'unknown'}`,
    `User agent: ${navigator.userAgent}`,
  ].join('\n');
}

export function AboutView() {
  const styles = useStyles();
  const { channel } = useSettings();
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const [legal, setLegal] = useState<LegalDoc | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void getBuildInfo().then(setBuild).catch(() => {});
  }, []);

  const latest =
    RELEASES.find((r) => r.version === APP_VERSION && hasContent(r)) ?? RELEASES.find((r) => !isUnreleased(r) && hasContent(r));

  const copyInfo = async () => {
    await navigator.clipboard.writeText(systemInfoText(build, channel)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const info: [string, string][] = [
    ['Version', `${displayVersion(APP_VERSION)}${build?.debug ? ' (debug)' : ''}`],
    ['Update channel', channel === 'beta' ? 'Beta' : 'Stable'],
    ['Tauri', build?.tauriVersion ?? '…'],
    ['WebView2', build?.webviewVersion ?? '…'],
    ['Platform', build ? `${build.os === 'windows' ? 'Windows' : build.os} · ${build.arch}` : '…'],
  ];

  return (
    <ScrollArea className={styles.scrollArea} viewportClassName={styles.page}>
      <div className={styles.column}>
        {/* Identity + update status, like the About page of a browser. */}
        <section className={mergeClasses(styles.card, styles.hero)} aria-label="About">
          <div className={styles.heroTop}>
            <img src={icon} alt="" className={styles.logo} />
            <div className={styles.heroText}>
              <Title2>{APP_NAME}</Title2>
              <div className={styles.versionLine}>
                <Body1 className={styles.secondary}>Version {displayVersion(APP_VERSION)}</Body1>
                {IS_PRERELEASE && (
                  <Badge appearance="tint" color="informative" size="small">
                    Beta
                  </Badge>
                )}
              </div>
              <Caption1 className={styles.muted}>{SUMMARY}</Caption1>
            </div>
          </div>
          <hr className={styles.divider} />
          <UpdatePanel compact />
        </section>

        <div className={styles.grid}>
          {latest && (
            <section className={styles.card} aria-label="What's new">
              <div className={styles.cardHead}>
                <Subtitle2 className={styles.grow}>What’s new in {displayVersion(latest.version)}</Subtitle2>
                {latest.date && <Caption1 className={styles.muted}>{formatDate(latest.date)}</Caption1>}
              </div>
              <ReleaseBlock release={latest} headless limit={5} />
              <ChangelogDialog
                trigger={
                  <Link as="button" inline>
                    See all release notes
                  </Link>
                }
              />
            </section>
          )}

          <section className={styles.card} aria-label="System information">
            <div className={styles.cardHead}>
              <Subtitle2 className={styles.grow}>System information</Subtitle2>
              <Tooltip content="Copy for a bug report" relationship="description">
                <Button
                  size="small"
                  appearance="subtle"
                  icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
                  onClick={() => void copyInfo()}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </Tooltip>
            </div>
            <dl className={styles.info}>
              {info.map(([key, value]) => (
                <div key={key} style={{ display: 'contents' }}>
                  <dt className={styles.infoKey}>
                    <Body1>{key}</Body1>
                  </dt>
                  <dd className={styles.infoValue}>
                    <Body1>{value}</Body1>
                  </dd>
                </div>
              ))}
            </dl>
            <Caption1 className={styles.muted}>
              Data source:{' '}
              <Link inline onClick={open(DSE_URL)}>
                {DSE_URL.replace(/^https:\/\/|\/$/g, '')}
              </Link>
            </Caption1>
            <div className={styles.chips}>
              {DATA_POINTS.map((point) => (
                <Badge key={point} appearance="tint" color="informative" shape="rounded">
                  {point}
                </Badge>
              ))}
            </div>
          </section>
        </div>

        <div className={styles.grid}>
          <section className={styles.card} aria-label="Help and feedback">
            <Subtitle2>Help & feedback</Subtitle2>
            <div className={styles.links}>
              <LinkRow icon={BugRegular} title="Report a problem" description="Open an issue on GitHub" onClick={open(LINKS.issues)} />
              <LinkRow icon={CodeRegular} title="Releases & source" description="Download installers and past versions" onClick={open(LINKS.releases)} />
              <LinkRow icon={MailRegular} title="Contact the developer" description={AUTHOR.email} onClick={open(LINKS.email)} />
              <LinkRow icon={GlobeRegular} title="Website" description={LINKS.website.replace('https://', '')} onClick={open(LINKS.website)} />
            </div>
          </section>

          <section className={styles.card} aria-label="Legal">
            <Subtitle2>Legal</Subtitle2>
            <div className={styles.links}>
              {LEGAL_DOCS.map((doc) => (
                <LinkRow key={doc.id} icon={LEGAL_ICONS[doc.id]} title={doc.title} description={doc.description} onClick={() => setLegal(doc)} />
              ))}
            </div>
          </section>
        </div>

        <footer className={styles.footer}>
          <Caption1 block>
            <ShieldRegular style={{ verticalAlign: 'middle' }} /> No telemetry. Your data stays on this PC.
          </Caption1>
          <Caption1 block>{COPYRIGHT_LINE}</Caption1>
          <Caption1 block>Made with ❤️ in Dhaka, Bangladesh for EDGE Asset Management by {AUTHOR.name}</Caption1>
          <Caption1 block>
            {FOOTER_LINKS.map(({ id, label }, i) => {
              const doc = LEGAL_DOCS.find((d) => d.id === id);
              const Icon = LEGAL_ICONS[id];
              return (
                <Fragment key={id}>
                  {i > 0 && ' · '}
                  <Icon style={{ verticalAlign: 'middle' }} />{' '}
                  <Link inline className={styles.footerLink} onClick={() => setLegal(doc ?? null)}>
                    {label}
                  </Link>
                </Fragment>
              );
            })}
          </Caption1>
        </footer>
      </div>

      <LegalDialog doc={legal} onClose={() => setLegal(null)} />
    </ScrollArea>
  );
}
