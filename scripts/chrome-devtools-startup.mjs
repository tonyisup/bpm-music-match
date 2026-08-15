import assert from 'node:assert/strict';

const DEVTOOLS_BROWSER_PATH = /^\/devtools\/browser\/[A-Za-z0-9._~-]+$/;
const MAX_DIAGNOSTIC_CHARACTERS = 2_000;

function normalizeEndpoint(candidate) {
  if (typeof candidate !== 'string') return null;
  try {
    const endpoint = new URL(candidate);
    if (endpoint.protocol !== 'ws:'
        || endpoint.hostname !== '127.0.0.1'
        || endpoint.username !== ''
        || endpoint.password !== ''
        || endpoint.search !== ''
        || endpoint.hash !== ''
        || !DEVTOOLS_BROWSER_PATH.test(endpoint.pathname)) {
      return null;
    }
    const port = Number(endpoint.port);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return null;
    return endpoint.href;
  } catch {
    return null;
  }
}

export function devToolsEndpointFromStderr(stderr) {
  assert.equal(typeof stderr, 'string', 'Chrome stderr must be a string');
  const matches = [...stderr.matchAll(/DevTools listening on (ws:\/\/[^\s]+)/g)];
  return normalizeEndpoint(matches.at(-1)?.[1] ?? null);
}

export function devToolsEndpointFromActivePort(contents) {
  assert.equal(typeof contents, 'string', 'DevToolsActivePort contents must be a string');
  const [portText, browserPath] = contents.split(/\r?\n/);
  if (!/^[1-9][0-9]{0,4}$/.test(portText ?? '')
      || !DEVTOOLS_BROWSER_PATH.test(browserPath ?? '')) {
    return null;
  }
  return normalizeEndpoint(`ws://127.0.0.1:${portText}${browserPath}`);
}

function compactStderr(stderr) {
  const compact = stderr.trim().replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ');
  if (compact === '') return 'none';
  return compact.slice(-MAX_DIAGNOSTIC_CHARACTERS);
}

function processSummary(state) {
  if (state.spawnError !== null) return 'spawn-error';
  if (state.exitCode !== null) return `exit-${state.exitCode}`;
  if (state.signalCode !== null) return `signal-${state.signalCode}`;
  return 'running';
}

function startupFailure(message, state, stderr, activePortErrorCode) {
  return new Error(
    `${message}; process=${processSummary(state)}; `
    + `activePort=${activePortErrorCode ?? 'unavailable'}; stderr=${compactStderr(stderr)}`,
  );
}

export async function waitForChromeDevToolsEndpoint({
  readActivePort,
  readStderr,
  readProcessState,
  wait,
  now,
  timeoutMilliseconds,
  pollMilliseconds = 100,
}) {
  for (const dependency of [readActivePort, readStderr, readProcessState, wait, now]) {
    assert.equal(typeof dependency, 'function', 'Chrome startup dependency must be a function');
  }
  assert.equal(
    Number.isInteger(timeoutMilliseconds) && timeoutMilliseconds > 0,
    true,
    'Chrome startup timeout must be a positive integer',
  );
  assert.equal(
    Number.isInteger(pollMilliseconds) && pollMilliseconds > 0,
    true,
    'Chrome startup poll interval must be a positive integer',
  );

  const startedAt = now();
  let activePortErrorCode = null;
  while (true) {
    const stderr = readStderr();
    const stderrEndpoint = devToolsEndpointFromStderr(stderr);
    if (stderrEndpoint !== null) return stderrEndpoint;

    try {
      const activePortEndpoint = devToolsEndpointFromActivePort(await readActivePort());
      if (activePortEndpoint !== null) return activePortEndpoint;
      activePortErrorCode = 'invalid';
    } catch (error) {
      activePortErrorCode = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : 'read-failed';
    }

    const state = readProcessState();
    if (state.spawnError !== null || state.exitCode !== null || state.signalCode !== null) {
      throw startupFailure(
        'Chrome exited before DevTools startup',
        state,
        stderr,
        activePortErrorCode,
      );
    }
    const elapsed = now() - startedAt;
    if (!Number.isFinite(elapsed) || elapsed >= timeoutMilliseconds) {
      throw startupFailure(
        `Chrome DevTools startup timed out after ${timeoutMilliseconds} ms`,
        state,
        stderr,
        activePortErrorCode,
      );
    }
    await wait(Math.min(pollMilliseconds, timeoutMilliseconds - elapsed));
  }
}
