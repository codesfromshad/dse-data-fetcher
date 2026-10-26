import { makeStyles, mergeClasses } from '@fluentui/react-components';
import { OpenRegular } from '@fluentui/react-icons';

// The "opens in your browser" mark after a link or item that leaves the app
// (a company page, GitHub, the website). Sized to the text it follows, so the
// same icon works in the log, the footer and release notes. Inline-block, so
// a link's hover underline doesn't run under it.
const useStyles = makeStyles({
  icon: {
    display: 'inline-block',
    marginLeft: '2px',
    fontSize: '0.9em',
    verticalAlign: '-0.1em',
  },
});

export function OpensInBrowser({ className }: { className?: string }) {
  const styles = useStyles();
  return <OpenRegular aria-hidden className={mergeClasses(styles.icon, className)} />;
}
