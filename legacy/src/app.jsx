import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useAnimation, useApp, useInput, useWindowSize } from 'ink';
import { APP_NAME, APP_VERSION, DESCRIPTION } from './description.js';
import { OfflineError, startFetch } from './fetch-client.js';
import { describeError } from './lib/curl.js';
import { deleteTempFile } from './lib/temp-files.js';
import { logTimestamp } from './lib/time.js';
import { wrapLogEntry, wrapText } from './lib/log-format.js';

const SPINNER = ['( ●    )', '(  ●   )', '(   ●  )', '(    ● )', '(     ●)', '(    ● )', '(   ●  )', '(  ●   )', '( ●    )', '(●     )'];

const MAX_LOG_LINES = 2000;
// Logs/status from the worker are queued and applied at most this often, so a
// burst of 50 log lines costs one React render instead of 50.
const FLUSH_INTERVAL_MS = 50;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function TitleBar({ width }) {
  const title = `${APP_NAME} | Version ${APP_VERSION}`;
  const left = Math.max(0, Math.floor((width - title.length) / 2));
  const line = (' '.repeat(left) + title).padEnd(width).slice(0, width);
  return (
    <Text color="white" backgroundColor="blue" wrap="truncate-end">
      {line}
    </Text>
  );
}

function Panel({ focused, height, label, scrollInfo, children }) {
  return (
    <Box
      flexDirection="column"
      height={height}
      borderStyle="single"
      borderColor={focused ? 'cyan' : 'gray'}
      paddingX={1}
      overflow="hidden"
    >
      <Box justifyContent="space-between" flexShrink={0}>
        <Text bold color={focused ? 'cyan' : 'gray'}>
          {label}
        </Text>
        <Text dimColor>{scrollInfo}</Text>
      </Box>
      {children}
    </Box>
  );
}

export default function App() {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();

  // 'running' -> 'done' | 'failed'; 'done' -> 'locked' if the xlsx can't be deleted yet
  const [phase, setPhase] = useState('running');
  const [status, setStatus] = useState('Starting...');
  const [logs, setLogs] = useState([]);
  const [focus, setFocus] = useState('description');
  const [descTop, setDescTop] = useState(0);
  const [logTop, setLogTop] = useState(null); // null = follow the tail
  const result = useRef(null);
  const nextLogId = useRef(0);

  const { frame } = useAnimation({ interval: 80, isActive: phase === 'running' });

  // Layout. Stay one row short of the terminal height: when Ink's output fills
  // the whole screen it clears and repaints every frame, which flickers.
  const usable = Math.max(rows - 1, 10);
  const descHeight = Math.floor((usable - 2) / 2);
  const logHeight = usable - 2 - descHeight;
  const descVisible = Math.max(descHeight - 3, 1); // 2 border rows + label row
  const logVisible = Math.max(logHeight - 3, 1);

  // Panel content width: 2 border columns + 2 padding columns.
  const innerWidth = Math.max(columns - 4, 20);

  const descLines = useMemo(() => wrapText(DESCRIPTION, innerWidth), [innerWidth]);

  // Wrap each entry once per width; only new entries get wrapped as logs stream in.
  const wrapCache = useRef(new WeakMap());
  const logLines = useMemo(() => {
    const lines = [];
    for (const entry of logs) {
      let cached = wrapCache.current.get(entry);
      if (!cached || cached.width !== innerWidth) {
        cached = { width: innerWidth, lines: wrapLogEntry(entry, innerWidth) };
        wrapCache.current.set(entry, cached);
      }
      cached.lines.forEach((text, i) => lines.push({ key: `${entry.id}:${i}`, text }));
    }
    return lines;
  }, [logs, innerWidth]);

  const descMax = Math.max(0, descLines.length - descVisible);
  const logMax = Math.max(0, logLines.length - logVisible);
  const descStart = clamp(descTop, 0, descMax);
  const logStart = logTop === null ? logMax : clamp(logTop, 0, logMax);

  useEffect(() => {
    let pendingLogs = [];
    let pendingStatus = null;

    const flush = () => {
      if (pendingLogs.length) {
        const batch = pendingLogs;
        pendingLogs = [];
        setLogs((prev) => {
          const next = prev.concat(batch);
          return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
        });
      }
      if (pendingStatus !== null) {
        setStatus(pendingStatus);
        pendingStatus = null;
      }
    };
    const timer = setInterval(flush, FLUSH_INTERVAL_MS);

    const queueLog = ({ level, message, time = logTimestamp() }) => {
      pendingLogs.push({ id: nextLogId.current++, time, level, message });
    };

    // The fetch runs in a worker thread; this thread only renders and reads keys.
    const fetch = startFetch({ onLog: queueLog, onStatus: (text) => (pendingStatus = text) });

    fetch.done
      .then((res) => {
        flush();
        result.current = res;
        setPhase('done');
        setStatus(`Press Enter or Esc to exit and delete ${res.fileName}`);
      })
      .catch((error) => {
        if (error instanceof OfflineError) {
          queueLog({ level: 'error', message: error.message });
          queueLog({ level: 'warn', message: 'Closing all the processes that ran...' });
        } else {
          queueLog({ level: 'error', message: `Fetch failed: ${describeError(error)}` });
        }
        flush();
        setPhase('failed');
        setStatus('Press Enter or Esc to exit');
      });

    return () => {
      clearInterval(timer);
      fetch.stop();
    };
  }, []);

  const tryExit = (keepFile) => {
    if (phase === 'failed' || !result.current) return exit();

    if (keepFile) {
      return exit();
    }

    const outcome = deleteTempFile(result.current.filePath);
    if (outcome === 'locked') {
      setPhase('locked');
      setStatus(`${result.current.fileName} is still open in another app. Close it and press Enter, or Esc to exit without deleting`);
      return;
    }
    exit();
  };

  useInput((input, key) => {
    if (key.tab) {
      setFocus((f) => (f === 'description' ? 'logs' : 'description'));
      return;
    }

    const page = focus === 'description' ? descVisible : logVisible;
    let delta = 0;
    if (key.upArrow || input === 'k') delta = -1;
    else if (key.downArrow || input === 'j') delta = 1;
    else if (key.pageUp) delta = -page;
    else if (key.pageDown) delta = page;
    else if (key.home || input === 'g') delta = -Infinity;
    else if (key.end || input === 'G') delta = Infinity;

    if (delta !== 0) {
      if (focus === 'description') {
        setDescTop(clamp(descStart + delta, 0, descMax));
      } else {
        const next = clamp(logStart + delta, 0, logMax);
        setLogTop(next >= logMax ? null : next); // reaching the bottom resumes following
      }
      return;
    }

    if (phase === 'running') return; // Ctrl+C still quits (Ink handles it)
    if (key.return) tryExit(false);
    else if (key.escape) tryExit(phase === 'locked');
  });

  const statusColor = phase === 'failed' || phase === 'locked' ? 'red' : 'yellow';
  const visibleDesc = descLines.slice(descStart, descStart + descVisible);
  const visibleLogs = logLines.slice(logStart, logStart + logVisible);

  return (
    <Box flexDirection="column" width={columns} height={usable}>
      <TitleBar width={columns} />

      <Panel
        label="About"
        focused={focus === 'description'}
        height={descHeight}
        scrollInfo={descMax ? `${descStart + 1}-${descStart + visibleDesc.length}/${descLines.length}` : ''}
      >
        {visibleDesc.map((line, i) => (
          <Text key={descStart + i} wrap="truncate-end">
            {line || ' '}
          </Text>
        ))}
      </Panel>

      <Panel
        label="Logs"
        focused={focus === 'logs'}
        height={logHeight}
        scrollInfo={logTop === null ? (logs.length ? `${logs.length} entries · following` : '') : `line ${logStart + 1}/${logLines.length} · paused`}
      >
        {visibleLogs.map((line) => (
          <Text key={line.key} wrap="truncate-end">
            {line.text}
          </Text>
        ))}
      </Panel>

      <Box justifyContent="space-between" height={1}>
        <Box flexShrink={1}>
          <Text color={statusColor} wrap="truncate-end">
            {phase === 'running' ? `${SPINNER[frame % SPINNER.length]} ` : ''}
            {status}
          </Text>
        </Box>
        {columns >= 100 && (
          <Box flexShrink={0} marginLeft={1}>
            <Text dimColor>Tab switch · ↑↓ PgUp/PgDn scroll</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
