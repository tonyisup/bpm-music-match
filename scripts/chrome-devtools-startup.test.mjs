import test from 'node:test';
import assert from 'node:assert/strict';

import {
  devToolsEndpointFromActivePort,
  devToolsEndpointFromStderr,
  waitForChromeDevToolsEndpoint,
} from './chrome-devtools-startup.mjs';

const ENDPOINT = 'ws://127.0.0.1:9222/devtools/browser/browser-id';

function missingActivePort() {
  const error = new Error('not found');
  error.code = 'ENOENT';
  throw error;
}

test('Chrome startup parses only loopback browser endpoints', () => {
  assert.equal(
    devToolsEndpointFromStderr(`noise\nDevTools listening on ${ENDPOINT}\n`),
    ENDPOINT,
  );
  assert.equal(
    devToolsEndpointFromActivePort('9222\n/devtools/browser/browser-id\n'),
    ENDPOINT,
  );
  for (const invalid of [
    'DevTools listening on ws://example.com:9222/devtools/browser/browser-id',
    'DevTools listening on ws://127.0.0.1:9222/devtools/page/page-id',
    'DevTools listening on not-a-websocket',
  ]) {
    assert.equal(devToolsEndpointFromStderr(invalid), null);
  }
  for (const invalid of [
    '0\n/devtools/browser/browser-id\n',
    '70000\n/devtools/browser/browser-id\n',
    '9222\n/devtools/page/page-id\n',
  ]) {
    assert.equal(devToolsEndpointFromActivePort(invalid), null);
  }
});

test('Chrome startup falls back to DevToolsActivePort after the stderr banner is absent', async () => {
  let currentTime = 0;
  let reads = 0;
  const waits = [];
  const endpoint = await waitForChromeDevToolsEndpoint({
    readActivePort: async () => {
      reads += 1;
      if (reads === 1) return missingActivePort();
      return '9222\n/devtools/browser/browser-id\n';
    },
    readStderr: () => 'Chrome startup noise only',
    readProcessState: () => ({ spawnError: null, exitCode: null, signalCode: null }),
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      currentTime += milliseconds;
    },
    now: () => currentTime,
    timeoutMilliseconds: 1_000,
    pollMilliseconds: 25,
  });
  assert.equal(endpoint, ENDPOINT);
  assert.equal(reads, 2);
  assert.deepEqual(waits, [25]);
});

test('Chrome startup accepts the stderr banner without reading the fallback file', async () => {
  const endpoint = await waitForChromeDevToolsEndpoint({
    readActivePort: async () => assert.fail('stderr endpoint must win immediately'),
    readStderr: () => `DevTools listening on ${ENDPOINT}\n`,
    readProcessState: () => ({ spawnError: null, exitCode: null, signalCode: null }),
    wait: async () => assert.fail('ready Chrome must not wait'),
    now: () => 0,
    timeoutMilliseconds: 1_000,
  });
  assert.equal(endpoint, ENDPOINT);
});

test('Chrome startup reports bounded diagnostics when the process never becomes ready', async () => {
  let currentTime = 0;
  await assert.rejects(
    waitForChromeDevToolsEndpoint({
      readActivePort: async () => missingActivePort(),
      readStderr: () => `diagnostic-${'x'.repeat(3_000)}`,
      readProcessState: () => ({ spawnError: null, exitCode: null, signalCode: null }),
      wait: async (milliseconds) => { currentTime += milliseconds; },
      now: () => currentTime,
      timeoutMilliseconds: 30,
      pollMilliseconds: 10,
    }),
    (error) => {
      assert.match(error.message, /timed out after 30 ms/);
      assert.match(error.message, /process=running/);
      assert.match(error.message, /activePort=ENOENT/);
      assert.equal(error.message.length < 2_200, true);
      return true;
    },
  );
});

test('Chrome startup fails immediately when Chrome exits', async () => {
  await assert.rejects(
    waitForChromeDevToolsEndpoint({
      readActivePort: async () => missingActivePort(),
      readStderr: () => 'fatal startup detail',
      readProcessState: () => ({ spawnError: null, exitCode: 1, signalCode: null }),
      wait: async () => assert.fail('exited Chrome must not be polled again'),
      now: () => 0,
      timeoutMilliseconds: 1_000,
    }),
    /Chrome exited before DevTools startup; process=exit-1/,
  );
});
