#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EXPECTED_FIXTURE_SHA256 = '9f63dad57226cb5e4a8bd615f0d86e09ab474c9a235cd9230b0f97fe40d26db9';
const COMMAND_TIMEOUT_MS = 5_000;
const PAGE_TIMEOUT_MS = 20_000;
const CHROME_START_TIMEOUT_MS = 12_000;
const NETWORK_QUIET_MS = 150;
const PRIVATE_BYTE_SENTINEL = 'PRIVATE_BYTE_SENTINEL_DO_NOT_EXPOSE';
const FIXTURE_PLAINTEXT_SENTINEL = 'PRIVATE_BYTE_SENTINEL_M2_ENROLLMENT_7F3A9C';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..');
const fixturePath = path.join(
  repoRoot,
  'tools',
  'm2-enrollment',
  'tests',
  'fixtures',
  'synthetic-enrollment.mp3',
);

const ASSET_KEYS = Object.freeze([
  'schemaVersion',
  'assetVersion',
  'displayLabel',
  'allowedExtension',
  'allowedMimeType',
  'sha256',
  'compressedBytes',
  'decodedDurationSeconds',
  'decodedDurationToleranceSeconds',
  'decodedChannelCount',
  'decodedSampleRate',
  'calculatedDecodedPcmBytes',
  'applicationMemoryContractPassed',
  'ownedReferencesCleared',
  'contextsCloseSettled',
  'browserHeapObserved',
]);
const CONFIG_KEYS = Object.freeze([
  'configVersion',
  'trackBpm',
  'beatsPerBar',
  'targetEntryDownbeatSeconds',
  'leadInBeats',
  'minimumPostCrossfadeTailSeconds',
  'percussionRecipeId',
  'percussionTrimGain',
  'trackTrimGain',
  'masterGain',
  'bpmMatchWindow',
  'intervalOutlierFraction',
  'stabilityCvLimit',
  'reconciliationToleranceMs',
  'silenceTimeoutFormula',
  'crossfadeStartBeat',
  'targetDownbeatBeat',
  'crossfadeEndBeat',
  'crossfadeSampleCount',
  'crossfadeCurveId',
]);
const REQUIRED_BOOT_PATHS = Object.freeze([
  '/tools/m2-enrollment/',
  '/tools/m2-enrollment/styles.css',
  '/tools/m2-enrollment/app.mjs',
  '/tools/m2-enrollment/enrollment-config.mjs',
  '/tools/m2-enrollment/enrollment-browser.mjs',
  '/tools/m2-enrollment/enrollment-browser-load.mjs',
  '/tools/m2-enrollment/enrollment-browser-preview.mjs',
  '/tools/m2-enrollment/enrollment-browser-resources.mjs',
  '/tools/m2-enrollment/enrollment-browser-shared.mjs',
  '/tools/m2-enrollment/enrollment-lifecycle.mjs',
  '/tools/m2-enrollment/enrollment-measurements.mjs',
  '/tools/m2-enrollment/enrollment-report.mjs',
]);

let privateNeedles = [];

function sanitize(value) {
  let text = String(value ?? 'unknown failure');
  for (const needle of privateNeedles) {
    if (needle.length > 0) text = text.split(needle).join('[redacted-private]');
  }
  return text;
}

function fail(message) {
  throw new Error(message);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function bounded(promise, label, milliseconds = COMMAND_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds} ms`)), milliseconds);
    }),
  ]);
}

function mimeTypeFor(filePath) {
  switch (path.extname(filePath)) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.mjs': return 'text/javascript; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.mp3': return 'audio/mpeg';
    default: return 'application/octet-stream';
  }
}

async function startStaticServer() {
  const canonicalRoot = await realpath(repoRoot);
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      requests.push(requestUrl.pathname);
      const decodedPath = decodeURIComponent(requestUrl.pathname);
      const relativePath = decodedPath.endsWith('/')
        ? `${decodedPath.slice(1)}index.html`
        : decodedPath.slice(1);
      const candidate = path.resolve(canonicalRoot, relativePath);
      if (candidate !== canonicalRoot && !candidate.startsWith(`${canonicalRoot}${path.sep}`)) {
        response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Forbidden');
        return;
      }
      const candidateStat = await stat(candidate);
      if (!candidateStat.isFile()) throw new Error('not a file');
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': candidateStat.size,
        'content-type': mimeTypeFor(candidate),
        'x-content-type-options': 'nosniff',
      });
      createReadStream(candidate).pipe(response);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
  const closeServer = async () => {
    if (!server.listening) return;
    await bounded(new Promise((resolve, reject) => server.close((error) => (
      error === undefined ? resolve() : reject(error)
    ))), 'static server shutdown');
  };
  try {
    await bounded(new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    }), 'static server startup');
    const address = server.address();
    requireCondition(address !== null && typeof address === 'object', 'static server has no loopback address');
    return {
      origin: `http://127.0.0.1:${address.port}`,
      requests,
      close: closeServer,
    };
  } catch (error) {
    try {
      await closeServer();
    } catch {
      // Preserve the startup failure; no request diagnostics are emitted here.
    }
    throw error;
  }
}

async function terminateChild(child) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    throw new Error('Chrome child termination failed');
  }
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(2_000).then(() => false),
  ]);
  if (exited || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill('SIGKILL');
  } catch {
    throw new Error('Chrome child forced termination failed');
  }
  const forcedExit = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(2_000).then(() => false),
  ]);
  if (!forcedExit && child.exitCode === null && child.signalCode === null) {
    throw new Error('Chrome child did not exit after forced termination');
  }
}

async function launchChrome(profileDirectory) {
  const child = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--remote-allow-origins=*',
    'about:blank',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  try {
    const endpoint = await bounded(new Promise((resolve, reject) => {
      const inspect = (chunk) => {
        stderr += chunk.toString('utf8');
        if (stderr.length > 32_768) stderr = stderr.slice(-32_768);
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match !== null) resolve(match[1]);
      };
      child.stderr.on('data', inspect);
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        reject(new Error(`Chrome exited before DevTools startup (code ${code ?? 'none'}, signal ${signal ?? 'none'})`));
      });
    }), 'Chrome DevTools startup', CHROME_START_TIMEOUT_MS);
    return { child, endpoint, stderr: () => stderr };
  } catch (error) {
    await terminateChild(child);
    throw error;
  }
}

class CdpConnection {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async connect() {
    this.socket = new WebSocket(this.endpoint);
    this.socket.addEventListener('message', (event) => this.#handleMessage(event.data));
    this.socket.addEventListener('close', () => this.#rejectPending('DevTools connection closed'));
    this.socket.addEventListener('error', () => this.#rejectPending('DevTools connection failed'));
    await bounded(new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('DevTools WebSocket open failed')), { once: true });
    }), 'DevTools WebSocket open');
  }

  #rejectPending(message) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error(message));
    }
    this.pending.clear();
  }

  #handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'));
    } catch {
      this.#rejectPending('DevTools returned malformed JSON');
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) {
        pending.reject(new Error(`CDP ${pending.method} failed: ${message.error.message}`));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(method, params = {}, sessionId = undefined, timeoutMilliseconds = COMMAND_TIMEOUT_MS) {
    requireCondition(this.socket?.readyState === WebSocket.OPEN, 'DevTools connection is not open');
    const id = this.nextId;
    this.nextId += 1;
    const message = { id, method, params };
    if (sessionId !== undefined) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMilliseconds} ms`));
      }, timeoutMilliseconds);
      this.pending.set(id, { method, reject, resolve, timer });
      this.socket.send(JSON.stringify(message));
    });
  }

  close() {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close();
  }
}

async function evaluate(cdp, sessionId, expression, {
  awaitPromise = true,
  userGesture = false,
  timeoutMilliseconds = COMMAND_TIMEOUT_MS,
} = {}) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture,
  }, sessionId, timeoutMilliseconds);
  if (result.exceptionDetails !== undefined) {
    throw new Error('page evaluation produced an exception');
  }
  return result.result?.value;
}

async function waitForValue(cdp, sessionId, expression, predicate, label, timeoutMilliseconds = PAGE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await evaluate(cdp, sessionId, expression);
    if (predicate(lastValue)) return lastValue;
    await delay(50);
  }
  throw new Error(`${label} timed out; last public state: ${sanitize(JSON.stringify(lastValue))}`);
}

async function waitForNetworkQuiet(state, label) {
  const deadline = Date.now() + PAGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.inflight.size === 0) {
      const observedVersion = state.networkVersion;
      await delay(NETWORK_QUIET_MS);
      if (state.inflight.size === 0 && state.networkVersion === observedVersion) return;
    } else {
      await delay(25);
    }
  }
  throw new Error(`${label} did not finish all startup requests`);
}

function consoleValue(arg) {
  if (Object.hasOwn(arg, 'value')) return arg.value;
  return arg.description ?? arg.type ?? 'unknown console value';
}

async function openScenario(cdp, pageUrl, {
  captureClipboard = false,
  rejectContextClose = false,
  stallClipboard = false,
  stallDecode = false,
  stallFileRead = false,
  stallSecondContextClose = false,
} = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const state = {
    armed: false,
    bootRequests: new Map(),
    consoleRecords: [],
    exceptionRecords: [],
    failedRequests: [],
    inflight: new Set(),
    logRecords: [],
    networkVersion: 0,
    postRequests: [],
  };
  const removeListener = cdp.onEvent((message) => {
    if (message.sessionId !== sessionId) return;
    const params = message.params ?? {};
    if (message.method === 'Network.requestWillBeSent') {
      state.networkVersion += 1;
      state.inflight.add(params.requestId);
      const record = {
        requestId: params.requestId,
        type: params.type,
        url: params.request?.url ?? '',
      };
      state.bootRequests.set(params.requestId, record);
      if (state.armed) state.postRequests.push(record);
    } else if (message.method === 'Network.loadingFinished') {
      state.inflight.delete(params.requestId);
      const record = state.bootRequests.get(params.requestId);
      if (record !== undefined) record.finished = true;
    } else if (message.method === 'Network.loadingFailed') {
      state.inflight.delete(params.requestId);
      const record = state.bootRequests.get(params.requestId);
      if (record !== undefined) record.failed = true;
      state.failedRequests.push({ requestId: params.requestId, errorText: params.errorText ?? 'request failed' });
    } else if (message.method === 'Runtime.consoleAPICalled' && state.armed) {
      state.consoleRecords.push({
        type: params.type,
        values: (params.args ?? []).map(consoleValue),
      });
    } else if (message.method === 'Runtime.exceptionThrown' && state.armed) {
      state.exceptionRecords.push(params.exceptionDetails ?? { text: 'runtime exception' });
    } else if (message.method === 'Log.entryAdded' && state.armed) {
      state.logRecords.push(params.entry ?? { text: 'page log entry' });
    }
  });

  await Promise.all([
    cdp.send('DOM.enable', {}, sessionId),
    cdp.send('Log.enable', {}, sessionId),
    cdp.send('Network.enable', {}, sessionId),
    cdp.send('Page.enable', {}, sessionId),
    cdp.send('Runtime.enable', {}, sessionId),
  ]);
  await cdp.send('Page.navigate', { url: pageUrl }, sessionId);
  await waitForValue(
    cdp,
    sessionId,
    `document.readyState === 'complete' && document.querySelector('#status')?.textContent`,
    (value) => value === 'Ready for the first selection.',
    'enrollment page boot',
  );
  await waitForNetworkQuiet(state, 'enrollment page boot');
  requireCondition(state.failedRequests.length === 0, 'a startup resource request failed');
  const bootPaths = [...state.bootRequests.values()].map(({ url }) => new URL(url).pathname);
  for (const requiredPath of REQUIRED_BOOT_PATHS) {
    requireCondition(bootPaths.includes(requiredPath), `startup resource was not requested: ${requiredPath}`);
  }
  for (const request of state.bootRequests.values()) {
    requireCondition(request.finished === true, 'a startup module or style request did not finish');
  }

  const tripwireSetup = await evaluate(cdp, sessionId, `(() => {
    const evidence = {
      clipboardWrites: [],
      clipboardReject: null,
      clipboardResolve: null,
      clipboardStarted: false,
      closeCalls: 0,
      closeResolve: null,
      decodeStarted: false,
      pageErrors: [],
      statusChanges: [document.querySelector('#status')?.textContent ?? ''],
      unhandledRejections: [],
    };
    Object.defineProperty(window, '__enrollmentPrivacySmoke', {
      configurable: false,
      enumerable: false,
      value: evidence,
      writable: false,
    });
    window.addEventListener('error', (event) => {
      evidence.pageErrors.push(String(event.error?.message ?? event.message ?? 'page error'));
    });
    window.addEventListener('unhandledrejection', (event) => {
      evidence.unhandledRejections.push(String(event.reason?.message ?? event.reason ?? 'unhandled rejection'));
    });
    const statusElement = document.querySelector('#status');
    if (statusElement !== null) {
      new MutationObserver(() => {
        evidence.statusChanges.push(statusElement.textContent ?? '');
      }).observe(statusElement, { childList: true, subtree: true });
    }
    let clipboardCaptureInstalled = false;
    if (${captureClipboard ? 'true' : 'false'}) {
      const clipboard = navigator.clipboard;
      if (clipboard && typeof clipboard.writeText === 'function') {
        Object.defineProperty(clipboard, 'writeText', {
          configurable: true,
          value: (text) => {
            evidence.clipboardWrites.push(String(text));
            evidence.clipboardStarted = true;
            if (${stallClipboard ? 'true' : 'false'}) {
              return new Promise((resolve, reject) => {
                evidence.clipboardReject = reject;
                evidence.clipboardResolve = resolve;
              });
            }
            return Promise.resolve();
          },
        });
        clipboardCaptureInstalled = true;
      }
    }
    if (${stallFileRead ? 'true' : 'false'}) {
      Object.defineProperty(File.prototype, 'arrayBuffer', {
        configurable: true,
        value: function privacySmokePendingRead() {
          return new Promise(() => {});
        },
      });
    }
    const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    let closeFailureInstalled = false;
    let secondCloseStallInstalled = false;
    let decodeStallInstalled = false;
    if (${rejectContextClose ? 'true' : 'false'} && typeof AudioContextConstructor === 'function') {
      Object.defineProperty(AudioContextConstructor.prototype, 'close', {
        configurable: true,
        value: function privacySmokeRejectClose() {
          return Promise.reject(new Error('synthetic context close rejection'));
        },
      });
      closeFailureInstalled = true;
    }
    if (${stallSecondContextClose ? 'true' : 'false'} && typeof AudioContextConstructor === 'function') {
      Object.defineProperty(AudioContextConstructor.prototype, 'close', {
        configurable: true,
        value: function privacySmokeStallSecondClose() {
          evidence.closeCalls += 1;
          if (evidence.closeCalls === 1) return Promise.resolve();
          return new Promise((resolve) => {
            evidence.closeResolve = resolve;
          });
        },
      });
      secondCloseStallInstalled = true;
    }
    if (${stallDecode ? 'true' : 'false'} && typeof AudioContextConstructor === 'function') {
      Object.defineProperty(AudioContextConstructor.prototype, 'decodeAudioData', {
        configurable: true,
        value: function privacySmokePendingDecode() {
          evidence.decodeStarted = true;
          return new Promise(() => {});
        },
      });
      decodeStallInstalled = true;
    }
    return {
      clipboardCaptureInstalled,
      closeFailureInstalled,
      decodeStallInstalled,
      secondCloseStallInstalled,
    };
  })()`);
  if (captureClipboard) {
    requireCondition(tripwireSetup?.clipboardCaptureInstalled === true, 'DevTools clipboard capture could not be installed');
  }
  if (rejectContextClose) {
    requireCondition(tripwireSetup?.closeFailureInstalled === true, 'context close failure injection could not be installed');
  }
  if (stallDecode) {
    requireCondition(tripwireSetup?.decodeStallInstalled === true, 'decode stall injection could not be installed');
  }
  if (stallSecondContextClose) {
    requireCondition(tripwireSetup?.secondCloseStallInstalled === true, 'second close stall injection could not be installed');
  }
  await waitForNetworkQuiet(state, 'tripwire setup');
  state.consoleRecords.length = 0;
  state.exceptionRecords.length = 0;
  state.failedRequests.length = 0;
  state.logRecords.length = 0;
  state.postRequests.length = 0;
  state.armed = true;

  return {
    sessionId,
    state,
    targetId,
    async close() {
      state.armed = false;
      removeListener();
      try {
        await cdp.send('Target.closeTarget', { targetId });
      } catch {
        // Browser-wide cleanup is the final fallback.
      }
    },
  };
}

async function setFileInput(cdp, scenario, selectedPath) {
  const { root } = await cdp.send('DOM.getDocument', { depth: 2, pierce: true }, scenario.sessionId);
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '#track-file',
  }, scenario.sessionId);
  requireCondition(Number.isSafeInteger(nodeId) && nodeId > 0, 'actual file input was not found');
  await cdp.send('DOM.setFileInputFiles', { files: [selectedPath], nodeId }, scenario.sessionId);
}

async function click(cdp, scenario, selector) {
  const encodedSelector = JSON.stringify(selector);
  const clicked = await evaluate(cdp, scenario.sessionId, `(() => {
    const control = document.querySelector(${encodedSelector});
    if (!(control instanceof HTMLElement) || control.disabled) return false;
    control.click();
    return true;
  })()`, { userGesture: true });
  requireCondition(clicked === true, `DOM control was unavailable: ${selector}`);
}

async function waitForStatus(cdp, scenario, expectedText, timeoutMilliseconds = PAGE_TIMEOUT_MS) {
  return waitForValue(
    cdp,
    scenario.sessionId,
    `document.querySelector('#status')?.textContent ?? ''`,
    (value) => typeof value === 'string' && value.includes(expectedText),
    `status containing ${expectedText}`,
    timeoutMilliseconds,
  );
}

async function collectSurface(cdp, scenario) {
  return evaluate(cdp, scenario.sessionId, `(() => ({
    clipboardWrites: [...window.__enrollmentPrivacySmoke.clipboardWrites],
    cycleCount: document.querySelector('#cycle-count')?.textContent ?? '',
    decodeStarted: window.__enrollmentPrivacySmoke.decodeStarted,
    html: document.documentElement.outerHTML,
    inputValue: document.querySelector('#track-file')?.value ?? '',
    pageErrors: [...window.__enrollmentPrivacySmoke.pageErrors],
    report: document.querySelector('#report-output')?.textContent ?? '',
    status: document.querySelector('#status')?.textContent ?? '',
    statusChanges: [...window.__enrollmentPrivacySmoke.statusChanges],
    text: document.documentElement.innerText,
    unhandledRejections: [...window.__enrollmentPrivacySmoke.unhandledRejections],
  }))()`);
}

function assertNoPrivateMaterial(label, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const needle of privateNeedles) {
    assert.equal(text.includes(needle), false, `${label} exposed forbidden private material`);
  }
  assert.doesNotMatch(text, /file:\/\//i, `${label} exposed a local file URI`);
  assert.doesNotMatch(text, /blob:/i, `${label} exposed an object URI`);
}

function assertArmedPrivacy(scenario, surface, label) {
  assert.equal(scenario.state.postRequests.length, 0, `${label} made a post-selection request`);
  assert.equal(scenario.state.consoleRecords.length, 0, `${label} emitted a post-selection console message`);
  assert.equal(scenario.state.exceptionRecords.length, 0, `${label} emitted a runtime exception`);
  assert.equal(scenario.state.logRecords.length, 0, `${label} emitted a page log entry`);
  assert.deepEqual(surface.pageErrors, [], `${label} emitted a page error`);
  assert.deepEqual(surface.unhandledRejections, [], `${label} emitted an unhandled rejection`);
  assert.equal(surface.inputValue, '', `${label} retained a picker value`);
  assertNoPrivateMaterial(`${label} DOM`, surface);
  assertNoPrivateMaterial(`${label} console`, scenario.state.consoleRecords);
  assertNoPrivateMaterial(`${label} exceptions`, scenario.state.exceptionRecords);
  assertNoPrivateMaterial(`${label} page logs`, scenario.state.logRecords);
  assertNoPrivateMaterial(`${label} requests`, scenario.state.postRequests);
}

function parseAndValidateReport(json, fixtureBytes) {
  assertNoPrivateMaterial('report JSON', json);
  const report = JSON.parse(json);
  assert.deepEqual(Object.keys(report), ['assetIdentity', 'experimentConfigIdentity']);
  assert.deepEqual(Object.keys(report.assetIdentity), ASSET_KEYS);
  assert.deepEqual(Object.keys(report.experimentConfigIdentity), CONFIG_KEYS);
  assert.equal(report.assetIdentity.sha256, EXPECTED_FIXTURE_SHA256);
  assert.equal(report.assetIdentity.compressedBytes, fixtureBytes.byteLength);
  assert.equal(Math.abs(report.assetIdentity.decodedDurationSeconds - 6) <= 0.050, true);
  assert.equal(report.assetIdentity.decodedChannelCount, 2);
  assert.equal(Number.isSafeInteger(report.assetIdentity.decodedSampleRate), true);
  assert.equal(report.assetIdentity.decodedSampleRate >= 8_000, true);
  assert.equal(report.assetIdentity.decodedSampleRate <= 96_000, true);
  assert.equal(
    report.assetIdentity.calculatedDecodedPcmBytes,
    Math.round(
      report.assetIdentity.decodedDurationSeconds * report.assetIdentity.decodedSampleRate,
    ) * report.assetIdentity.decodedChannelCount * 4,
  );
  assert.equal(report.assetIdentity.applicationMemoryContractPassed, true);
  assert.equal(report.assetIdentity.ownedReferencesCleared, true);
  assert.equal(report.assetIdentity.contextsCloseSettled, true);
  assert.equal(report.assetIdentity.browserHeapObserved, false);
  assert.equal(report.experimentConfigIdentity.trackBpm, 110);
  assert.equal(Number.isFinite(report.experimentConfigIdentity.targetEntryDownbeatSeconds), true);
  assert.equal(report.experimentConfigIdentity.targetEntryDownbeatSeconds >= 0, true);
  return report;
}

async function runFailureScenario(cdp, pageUrl, oversizedPath) {
  const scenario = await openScenario(cdp, pageUrl);
  try {
    await setFileInput(cdp, scenario, oversizedPath);
    await waitForStatus(cdp, scenario, 'metadata could not be checked');
    const surface = await collectSurface(cdp, scenario);
    assert.equal(surface.report, 'Report locked.');
    assert.equal(surface.cycleCount, 'Completed unload cycles: 0 of 2');
    assertArmedPrivacy(scenario, surface, 'size failure scenario');
    return scenario.state.bootRequests.size;
  } finally {
    await scenario.close();
  }
}

async function runCancellationScenario(cdp, pageUrl, sensitiveFixturePath) {
  const scenario = await openScenario(cdp, pageUrl, { stallFileRead: true });
  try {
    await setFileInput(cdp, scenario, sensitiveFixturePath);
    await waitForStatus(cdp, scenario, 'Loading, hashing, and decoding locally.');
    await waitForValue(
      cdp,
      scenario.sessionId,
      `document.querySelector('#cancel-load')?.disabled === false`,
      (value) => value === true,
      'Cancel load enablement',
    );
    await click(cdp, scenario, '#cancel-load');
    await waitForValue(
      cdp,
      scenario.sessionId,
      `(() => ({
        cancelDisabled: document.querySelector('#cancel-load')?.disabled,
        fileDisabled: document.querySelector('#track-file')?.disabled,
        status: document.querySelector('#status')?.textContent ?? '',
      }))()`,
      (value) => value?.cancelDisabled === true && value?.fileDisabled === false,
      'cancellation settlement',
    );
    const surface = await collectSurface(cdp, scenario);
    assert.equal(surface.statusChanges.includes('Cancelling the local load.'), true);
    assert.equal(surface.status, 'Load cancelled. Application-owned references were cleared.');
    assert.equal(
      surface.statusChanges.includes('Load cancelled. Application-owned references were cleared.'),
      true,
    );
    assert.equal(
      surface.statusChanges.includes('The local load did not complete. No report data was accepted.'),
      false,
    );
    assert.equal(surface.report, 'Report locked.');
    assert.equal(surface.cycleCount, 'Completed unload cycles: 0 of 2');
    assertArmedPrivacy(scenario, surface, 'cancellation scenario');
    return scenario.state.bootRequests.size;
  } finally {
    await scenario.close();
  }
}

async function assertInteractionLocked(cdp, scenario, label) {
  const controls = await evaluate(cdp, scenario.sessionId, `(() =>
    [...document.querySelectorAll('input, button')].map((control) => ({
      disabled: control.disabled,
      id: control.id,
    })))()`);
  requireCondition(Array.isArray(controls) && controls.length > 0, `${label} found no controls`);
  requireCondition(controls.every((control) => control.disabled === true), `${label} left an interaction enabled`);
}

async function runCancellationTeardownFailureScenario(cdp, pageUrl, sensitiveFixturePath) {
  const scenario = await openScenario(cdp, pageUrl, {
    rejectContextClose: true,
    stallDecode: true,
  });
  try {
    await setFileInput(cdp, scenario, sensitiveFixturePath);
    await waitForStatus(cdp, scenario, 'Loading, hashing, and decoding locally.');
    await waitForValue(
      cdp,
      scenario.sessionId,
      `window.__enrollmentPrivacySmoke.decodeStarted`,
      (value) => value === true,
      'stalled decode start',
    );
    await click(cdp, scenario, '#cancel-load');
    await waitForStatus(cdp, scenario, 'Cancellation did not prove clean application teardown.');
    const surface = await collectSurface(cdp, scenario);
    assert.equal(
      surface.status,
      'Cancellation did not prove clean application teardown. Reload before continuing.',
    );
    assert.equal(surface.report, 'Report locked.');
    assert.equal(surface.cycleCount, 'Completed unload cycles: 0 of 2');
    await assertInteractionLocked(cdp, scenario, 'failed cancellation teardown');
    assertArmedPrivacy(scenario, surface, 'failed cancellation teardown scenario');
    return scenario.state.bootRequests.size;
  } finally {
    await scenario.close();
  }
}

async function runUnloadTeardownFailureScenario(cdp, pageUrl, sensitiveFixturePath) {
  const scenario = await openScenario(cdp, pageUrl, { rejectContextClose: true });
  try {
    await setFileInput(cdp, scenario, sensitiveFixturePath);
    await waitForStatus(cdp, scenario, 'Track ready.');
    await click(cdp, scenario, '#analyze-cue');
    await waitForStatus(cdp, scenario, 'Cue window passed');
    await click(cdp, scenario, '#unload-track');
    await waitForStatus(cdp, scenario, 'Unload did not prove clean application teardown.');
    const surface = await collectSurface(cdp, scenario);
    assert.equal(
      surface.status,
      'Unload did not prove clean application teardown. Reload before continuing.',
    );
    assert.equal(surface.report, 'Report locked.');
    assert.equal(surface.cycleCount, 'Completed unload cycles: 0 of 2');
    await assertInteractionLocked(cdp, scenario, 'failed unload teardown');
    assertArmedPrivacy(scenario, surface, 'failed unload teardown scenario');
    return scenario.state.bootRequests.size;
  } finally {
    await scenario.close();
  }
}

async function preparePendingMismatchTeardown(cdp, scenario, firstPath, mismatchPath) {
  await setFileInput(cdp, scenario, firstPath);
  await waitForStatus(cdp, scenario, 'Track ready.');
  await click(cdp, scenario, '#analyze-cue');
  await waitForStatus(cdp, scenario, 'Cue window passed');
  await click(cdp, scenario, '#unload-track');
  await waitForStatus(cdp, scenario, 'First clean cycle completed.');

  await setFileInput(cdp, scenario, mismatchPath);
  await waitForStatus(cdp, scenario, 'Resetting and unloading locally.');
  await waitForValue(
    cdp,
    scenario.sessionId,
    `(() => ({
      closeCalls: window.__enrollmentPrivacySmoke.closeCalls,
      resolverReady: typeof window.__enrollmentPrivacySmoke.closeResolve === 'function',
    }))()`,
    (value) => value?.closeCalls === 2 && value?.resolverReady === true,
    'mismatch teardown close stall',
  );
}

async function settleInjectedClose(cdp, scenario) {
  return evaluate(cdp, scenario.sessionId, `(async () => {
    const evidence = window.__enrollmentPrivacySmoke;
    const resolve = evidence.closeResolve;
    if (typeof resolve !== 'function') return false;
    evidence.closeResolve = null;
    resolve();
    await new Promise((settle) => setTimeout(settle, 0));
    return true;
  })()`);
}

async function runMismatchLifecycleScenario(cdp, pageUrl, firstPath, mismatchPath, lifecycleKind) {
  const scenario = await openScenario(cdp, pageUrl, { stallSecondContextClose: true });
  try {
    await preparePendingMismatchTeardown(cdp, scenario, firstPath, mismatchPath);
    const expectedStatus = lifecycleKind === 'foreground'
      ? 'Foreground access ended. Reload before continuing enrollment.'
      : 'Page exit started. Reload before continuing enrollment.';
    if (lifecycleKind === 'foreground') {
      await evaluate(cdp, scenario.sessionId, `(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
        document.dispatchEvent(new Event('visibilitychange'));
        return true;
      })()`);
    } else {
      await evaluate(cdp, scenario.sessionId, `(() => {
        window.dispatchEvent(new PageTransitionEvent('pagehide'));
        return true;
      })()`);
    }
    await waitForStatus(cdp, scenario, expectedStatus);
    await assertInteractionLocked(cdp, scenario, `${lifecycleKind} mismatch teardown`);
    requireCondition(await settleInjectedClose(cdp, scenario), 'stalled context close did not resolve');
    await waitForStatus(cdp, scenario, expectedStatus);
    const surface = await collectSurface(cdp, scenario);
    assert.equal(surface.status, expectedStatus);
    assert.equal(surface.report, 'Report locked.');
    assert.equal(surface.cycleCount, 'Completed unload cycles: 0 of 2');
    assertArmedPrivacy(scenario, surface, `${lifecycleKind} mismatch teardown scenario`);
    return scenario.state.bootRequests.size;
  } finally {
    await scenario.close();
  }
}

async function waitForDownload(cdp, action) {
  let downloadGuid = null;
  let suggestedFilename = null;
  const completion = new Promise((resolve, reject) => {
    const remove = cdp.onEvent((message) => {
      if (message.method === 'Browser.downloadWillBegin') {
        downloadGuid = message.params?.guid ?? null;
        suggestedFilename = message.params?.suggestedFilename ?? null;
      } else if (message.method === 'Browser.downloadProgress'
          && downloadGuid !== null
          && message.params?.guid === downloadGuid) {
        if (message.params.state === 'completed') {
          remove();
          resolve();
        } else if (message.params.state === 'canceled') {
          remove();
          reject(new Error('report download was canceled'));
        }
      }
    });
  });
  await action();
  await bounded(completion, 'report download', PAGE_TIMEOUT_MS);
  assert.equal(suggestedFilename, 'm2-enrollment-report.json');
  return suggestedFilename;
}

async function completeTwoCycleReport(cdp, scenario, sensitiveFixturePath, { exercisePreview = false } = {}) {
  await setFileInput(cdp, scenario, sensitiveFixturePath);
  await waitForStatus(cdp, scenario, 'Track ready.');
  if (exercisePreview) {
    await click(cdp, scenario, '#play-preview');
    await waitForStatus(cdp, scenario, 'preview is playing');
    await click(cdp, scenario, '#use-preview-time');
    await waitForStatus(cdp, scenario, 'Preview time copied');
    await click(cdp, scenario, '#stop-preview');
    await waitForStatus(cdp, scenario, 'Preview stopped');
  }
  await click(cdp, scenario, '#analyze-cue');
  await waitForStatus(cdp, scenario, 'Cue window passed');
  await click(cdp, scenario, '#unload-track');
  await waitForStatus(cdp, scenario, 'First clean cycle completed');

  await setFileInput(cdp, scenario, sensitiveFixturePath);
  await waitForStatus(cdp, scenario, 'Track ready.');
  await click(cdp, scenario, '#unload-track');
  await waitForStatus(cdp, scenario, 'Two matching clean cycles completed');
  await click(cdp, scenario, '#confirm-bpm');
  await waitForStatus(cdp, scenario, 'Configured BPM explicitly confirmed');
  return evaluate(
    cdp,
    scenario.sessionId,
    `document.querySelector('#report-output')?.textContent ?? ''`,
  );
}

async function runCopyPagehideScenario(
  cdp,
  pageUrl,
  sensitiveFixturePath,
  fixtureBytes,
  clipboardSettlement,
) {
  requireCondition(
    clipboardSettlement === 'resolve' || clipboardSettlement === 'reject',
    'copy pagehide scenario requires a known clipboard settlement',
  );
  const scenario = await openScenario(cdp, pageUrl, {
    captureClipboard: true,
    stallClipboard: true,
  });
  try {
    const reportJson = await completeTwoCycleReport(cdp, scenario, sensitiveFixturePath);
    parseAndValidateReport(reportJson, fixtureBytes);
    await click(cdp, scenario, '#copy-report');
    await waitForStatus(cdp, scenario, 'Copying the sanitized report.');
    await waitForValue(
      cdp,
      scenario.sessionId,
      `(() => ({
        started: window.__enrollmentPrivacySmoke.clipboardStarted,
        rejectReady: typeof window.__enrollmentPrivacySmoke.clipboardReject === 'function',
        resolverReady: typeof window.__enrollmentPrivacySmoke.clipboardResolve === 'function',
      }))()`,
      (value) => value?.started === true
        && value?.rejectReady === true
        && value?.resolverReady === true,
      'stalled clipboard write',
    );
    await evaluate(cdp, scenario.sessionId, `(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      return true;
    })()`);
    const terminalStatus = 'Page exit started. Reload before continuing enrollment.';
    await waitForStatus(cdp, scenario, terminalStatus);
    await assertInteractionLocked(cdp, scenario, 'pagehide during report copy');
    requireCondition(await evaluate(cdp, scenario.sessionId, `(async () => {
      const evidence = window.__enrollmentPrivacySmoke;
      const reject = evidence.clipboardReject;
      const resolve = evidence.clipboardResolve;
      if (typeof reject !== 'function' || typeof resolve !== 'function') return false;
      evidence.clipboardReject = null;
      evidence.clipboardResolve = null;
      if (${clipboardSettlement === 'resolve' ? 'true' : 'false'}) {
        resolve();
      } else {
        reject(new Error('synthetic clipboard rejection'));
      }
      await new Promise((settle) => setTimeout(settle, 0));
      return true;
    })()`), 'stalled clipboard write did not resolve');
    await waitForStatus(cdp, scenario, terminalStatus);
    const surface = await collectSurface(cdp, scenario);
    assert.equal(surface.status, terminalStatus);
    assert.equal(surface.report, reportJson);
    assert.equal(surface.clipboardWrites.length, 1);
    assert.equal(surface.clipboardWrites[0], reportJson);
    assertArmedPrivacy(scenario, surface, `pagehide during report copy ${clipboardSettlement} scenario`);
    assertNoPrivateMaterial('stalled clipboard capture', surface.clipboardWrites);
    return scenario.state.bootRequests.size;
  } finally {
    await scenario.close();
  }
}

async function runSuccessScenario(cdp, pageUrl, sensitiveFixturePath, fixtureBytes, downloadDirectory) {
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDirectory,
    eventsEnabled: true,
  });
  const scenario = await openScenario(cdp, pageUrl, { captureClipboard: true });
  try {
    const reportJson = await completeTwoCycleReport(
      cdp,
      scenario,
      sensitiveFixturePath,
      { exercisePreview: true },
    );
    const domReport = parseAndValidateReport(reportJson, fixtureBytes);

    await click(cdp, scenario, '#copy-report');
    await waitForStatus(cdp, scenario, 'Sanitized report copied');
    const clipboardWrites = await evaluate(
      cdp,
      scenario.sessionId,
      `[...window.__enrollmentPrivacySmoke.clipboardWrites]`,
    );
    assert.equal(clipboardWrites.length, 1);
    const copiedReport = parseAndValidateReport(clipboardWrites[0], fixtureBytes);
    assert.deepEqual(copiedReport, domReport);

    const suggestedFilename = await waitForDownload(
      cdp,
      () => click(cdp, scenario, '#download-report'),
    );
    await waitForStatus(cdp, scenario, 'Sanitized report download started');
    const downloadPath = path.join(downloadDirectory, suggestedFilename);
    const downloadedJson = await readFile(downloadPath, 'utf8');
    const downloadedReport = parseAndValidateReport(downloadedJson, fixtureBytes);
    assert.deepEqual(downloadedReport, domReport);
    assert.equal(downloadedJson, reportJson);
    assert.equal(clipboardWrites[0], reportJson);

    const surface = await collectSurface(cdp, scenario);
    assert.equal(surface.cycleCount, 'Completed unload cycles: 2 of 2');
    assert.equal(surface.report, reportJson);
    assertArmedPrivacy(scenario, surface, 'success scenario');
    assertNoPrivateMaterial('clipboard capture', clipboardWrites);
    assertNoPrivateMaterial('downloaded report', downloadedJson);
    return {
      bootRequestCount: scenario.state.bootRequests.size,
      reportByteCount: Buffer.byteLength(reportJson),
    };
  } finally {
    await scenario.close();
  }
}

async function terminateChrome(chrome, cdp = undefined) {
  if (cdp !== undefined) {
    try {
      await cdp.send('Browser.close', {}, undefined, 2_000);
    } catch {
      // Process termination below is the bounded fallback.
    }
    cdp.close();
  }
  await terminateChild(chrome.child);
}

async function main() {
  const fixtureBytes = await readFile(fixturePath);
  const actualDigest = createHash('sha256').update(fixtureBytes).digest('hex');
  assert.equal(actualDigest, EXPECTED_FIXTURE_SHA256, 'synthetic fixture digest changed');
  assert.equal(fixtureBytes.byteLength, 97_071, 'synthetic fixture byte count changed');

  const fixturePlaintextSentinelBytes = Buffer.from(FIXTURE_PLAINTEXT_SENTINEL, 'utf8');
  assert.equal(
    fixtureBytes.includes(fixturePlaintextSentinelBytes),
    true,
    'synthetic fixture plaintext sentinel changed',
  );
  const fixtureHexSentinel = fixtureBytes.subarray(0, 32).toString('hex');
  const fixtureBase64Sentinel = fixtureBytes.subarray(0, 32).toString('base64');

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'm2-enrollment-privacy-smoke-'));
  let staticServer;
  let chrome;
  let cdp;
  let mainFailure = null;
  let successOutput = null;
  try {
    const privateDirectory = path.join(temporaryRoot, 'private-inputs');
    const profileDirectory = path.join(temporaryRoot, 'chrome-profile');
    const downloadDirectory = path.join(temporaryRoot, 'downloads');
    const privateToken = randomUUID();
    const sensitiveFilename = `medical-session-${privateToken}-${PRIVATE_BYTE_SENTINEL}.mp3`;
    const mismatchFilename = `medical-session-${privateToken}-mismatch.mp3`;
    const oversizedFilename = `medical-session-${privateToken}-oversized.mp3`;
    const sensitiveFixturePath = path.join(privateDirectory, sensitiveFilename);
    const mismatchPath = path.join(privateDirectory, mismatchFilename);
    const oversizedPath = path.join(privateDirectory, oversizedFilename);
    privateNeedles = [
      temporaryRoot,
      sensitiveFixturePath,
      mismatchPath,
      oversizedPath,
      sensitiveFilename,
      mismatchFilename,
      oversizedFilename,
      privateToken,
      PRIVATE_BYTE_SENTINEL,
      FIXTURE_PLAINTEXT_SENTINEL,
      fixtureHexSentinel,
      fixtureBase64Sentinel,
      fixturePath,
      path.basename(fixturePath),
    ];

    await Promise.all([
      mkdir(privateDirectory, { recursive: true }),
      mkdir(profileDirectory, { recursive: true }),
      mkdir(downloadDirectory, { recursive: true }),
    ]);
    await copyFile(fixturePath, sensitiveFixturePath);
    await writeFile(mismatchPath, Buffer.concat([fixtureBytes, Buffer.from([0])]));
    const oversizedFile = await open(oversizedPath, 'w');
    try {
      await oversizedFile.truncate((20 * 1024 * 1024) + 1);
    } finally {
      await oversizedFile.close();
    }

    staticServer = await startStaticServer();
    chrome = await launchChrome(profileDirectory);
    cdp = new CdpConnection(chrome.endpoint);
    await cdp.connect();
    const pageUrl = `${staticServer.origin}/tools/m2-enrollment/`;

    const failureBootRequests = await runFailureScenario(cdp, pageUrl, oversizedPath);
    const cancellationBootRequests = await runCancellationScenario(cdp, pageUrl, sensitiveFixturePath);
    const failedCancellationBootRequests = await runCancellationTeardownFailureScenario(
      cdp,
      pageUrl,
      sensitiveFixturePath,
    );
    const failedUnloadBootRequests = await runUnloadTeardownFailureScenario(
      cdp,
      pageUrl,
      sensitiveFixturePath,
    );
    const foregroundMismatchBootRequests = await runMismatchLifecycleScenario(
      cdp,
      pageUrl,
      sensitiveFixturePath,
      mismatchPath,
      'foreground',
    );
    const pagehideMismatchBootRequests = await runMismatchLifecycleScenario(
      cdp,
      pageUrl,
      sensitiveFixturePath,
      mismatchPath,
      'pagehide',
    );
    const copyPagehideResolveBootRequests = await runCopyPagehideScenario(
      cdp,
      pageUrl,
      sensitiveFixturePath,
      fixtureBytes,
      'resolve',
    );
    const copyPagehideRejectBootRequests = await runCopyPagehideScenario(
      cdp,
      pageUrl,
      sensitiveFixturePath,
      fixtureBytes,
      'reject',
    );
    const success = await runSuccessScenario(
      cdp,
      pageUrl,
      sensitiveFixturePath,
      fixtureBytes,
      downloadDirectory,
    );

    const downloadFiles = await readdir(downloadDirectory);
    assert.deepEqual(downloadFiles, ['m2-enrollment-report.json']);
    requireCondition(staticServer.requests.length > 0, 'loopback server observed no startup requests');

    successOutput = [
      'PASS enrollment browser privacy smoke',
      'scenarios=success,size-failure,cancellation,cancellation-close-failure,unload-close-failure,mismatch-foreground,mismatch-pagehide,copy-pagehide-resolve,copy-pagehide-reject',
      'postSelectionRequests=0',
      `startupRequestsFinished=${failureBootRequests + cancellationBootRequests
        + failedCancellationBootRequests + failedUnloadBootRequests
        + foregroundMismatchBootRequests + pagehideMismatchBootRequests
        + copyPagehideResolveBootRequests + copyPagehideRejectBootRequests
        + success.bootRequestCount}`,
      `fixtureSha256=${EXPECTED_FIXTURE_SHA256}`,
      `reportBytes=${success.reportByteCount}`,
      'reportSchema=closed;twoCycleCleanup=true;browserHeapObserved=false',
      'clipboardEvidence=DevTools-injected writeText capture; system clipboard not asserted',
      'downloadEvidence=Chrome completed and parsed m2-enrollment-report.json',
      '',
    ].join('\n');
  } catch (error) {
    mainFailure = error;
    throw error;
  } finally {
    const cleanupFailures = [];
    if (chrome !== undefined) {
      try {
        await terminateChrome(chrome, cdp);
      } catch {
        cleanupFailures.push('Chrome');
      }
    }
    if (staticServer !== undefined) {
      try {
        await staticServer.close();
      } catch {
        cleanupFailures.push('static server');
      }
    }
    try {
      await rm(temporaryRoot, { force: true, recursive: true });
    } catch {
      cleanupFailures.push('temporary files');
    }
    if (mainFailure === null && cleanupFailures.length > 0) {
      throw new Error(`Smoke cleanup failed for: ${cleanupFailures.join(', ')}`);
    }
  }
  requireCondition(successOutput !== null, 'smoke completed without a success result');
  process.stdout.write(successOutput);
}

main().catch((error) => {
  const diagnostic = sanitize(error?.stack ?? error?.message ?? error);
  process.stderr.write(`FAIL enrollment browser privacy smoke\n${diagnostic}\n`);
  process.exitCode = 1;
});
