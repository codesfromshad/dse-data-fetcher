// Windows 11 Settings-style building blocks: a titled group of rows, each row
// a card with an icon, title, description and a control on the right.
import type { ReactNode } from 'react';
import { Body1, Caption1, Subtitle2, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  group: { display: 'flex', flexDirection: 'column', gap: '3px' },
  groupTitle: { padding: `${tokens.spacingVerticalM} 0 ${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXXS}` },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    minHeight: '68px',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    boxSizing: 'border-box',
  },
  block: { flexDirection: 'column', alignItems: 'stretch' },
  disabled: { opacity: 0.55 },
  icon: {
    fontSize: '20px',
    width: '20px',
    display: 'grid',
    placeItems: 'center',
    color: tokens.colorNeutralForeground2,
    flexShrink: 0,
  },
  text: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
  description: { color: tokens.colorNeutralForeground3 },
  control: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexShrink: 0 },
  head: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalL },
  extra: {
    marginTop: tokens.spacingVerticalM,
    paddingTop: tokens.spacingVerticalM,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <section className={styles.group} aria-label={title}>
      {title && <Subtitle2 className={styles.groupTitle}>{title}</Subtitle2>}
      {children}
    </section>
  );
}

interface RowProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** The control on the right (switch, dropdown, button). */
  children?: ReactNode;
  /** Extra content under the row, separated by a divider. */
  extra?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function SettingRow({ icon, title, description, children, extra, disabled, className }: RowProps) {
  const styles = useStyles();
  const head = (
    <>
      {icon && <span className={styles.icon}>{icon}</span>}
      <div className={styles.text}>
        <Body1>{title}</Body1>
        {description && <Caption1 className={styles.description}>{description}</Caption1>}
      </div>
      {children && <div className={styles.control}>{children}</div>}
    </>
  );
  return (
    <div className={mergeClasses(styles.row, extra !== undefined && styles.block, disabled && styles.disabled, className)}>
      {extra !== undefined ? (
        <>
          <div className={styles.head}>{head}</div>
          {extra && <div className={styles.extra}>{extra}</div>}
        </>
      ) : (
        head
      )}
    </div>
  );
}

/** A plain card the same shape as a row, for free-form content. */
export function SettingCard({ children, className }: { children: ReactNode; className?: string }) {
  const styles = useStyles();
  return <div className={mergeClasses(styles.row, styles.block, className)}>{children}</div>;
}
