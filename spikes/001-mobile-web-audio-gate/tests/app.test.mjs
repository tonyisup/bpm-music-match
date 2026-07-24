import test from 'node:test';
import assert from 'node:assert/strict';

const MODULE_URL = new URL('../app.mjs', import.meta.url);

async function loadApp() {
  return import(MODULE_URL);
}

test('UI follows loading ready starting running and natural completion once', async () => {
  const { createInitialUiModel, reduceUi } = await loadApp();
  const loading = createInitialUiModel();
  const ready = reduceUi(loading, { type: 'load-succeeded' });
  const starting = reduceUi(ready, { type: 'run-activated' });
  const running = reduceUi(starting, { type: 'resume-succeeded', generation: 1 });
  const complete = reduceUi(running, { type: 'terminal-settled', generation: 1, state: 'complete', cause: 'natural-end' });

  assert.deepEqual(loading, { state: 'loading', freshLoadEligible: true, generation: 0, terminalCause: null, errorCode: null });
  assert.equal(ready.state, 'ready');
  assert.equal(starting.state, 'starting');
  assert.equal(starting.freshLoadEligible, false);
  assert.equal(starting.generation, 1);
  assert.equal(running.state, 'running');
  assert.equal(complete.state, 'complete');
  assert.equal(complete.terminalCause, 'natural-end');
});

test('rapid activation consumes fresh-load eligibility atomically', async () => {
  const { createInitialUiModel, reduceUi } = await loadApp();
  const ready = reduceUi(createInitialUiModel(), { type: 'load-succeeded' });
  const first = reduceUi(ready, { type: 'run-activated' });
  const second = reduceUi(first, { type: 'run-activated' });

  assert.equal(first.generation, 1);
  assert.equal(second.generation, 1);
  assert.equal(second.state, 'starting');
  assert.notStrictEqual(second, first);
});

test('first terminal cause wins and stale async events are no-ops', async () => {
  const { createInitialUiModel, reduceUi } = await loadApp();
  const ready = reduceUi(createInitialUiModel(), { type: 'load-succeeded' });
  const starting = reduceUi(ready, { type: 'run-activated' });
  const stopping = reduceUi(starting, { type: 'stop-requested', generation: 1 });
  const stopped = reduceUi(stopping, { type: 'terminal-settled', generation: 1, state: 'stopped', cause: 'manual-stop' });

  const lateResume = reduceUi(stopped, { type: 'resume-succeeded', generation: 1 });
  const lateInterrupt = reduceUi(lateResume, { type: 'terminal-settled', generation: 1, state: 'interrupted', cause: 'hidden' });
  const wrongGeneration = reduceUi(stopped, { type: 'runtime-failed', generation: 2, errorCode: 'resume-failed' });

  assert.deepEqual(lateResume, stopped);
  assert.deepEqual(lateInterrupt, stopped);
  assert.deepEqual(wrongGeneration, stopped);
  assert.notStrictEqual(lateResume, stopped);
});

test('typed load and runtime failures are terminal reload states', async () => {
  const { createInitialUiModel, reduceUi } = await loadApp();
  const loadError = reduceUi(createInitialUiModel(), { type: 'load-failed', errorCode: 'asset-integrity-failed' });
  assert.equal(loadError.state, 'load-error');
  assert.equal(loadError.errorCode, 'asset-integrity-failed');
  assert.equal(loadError.freshLoadEligible, false);

  const ready = reduceUi(createInitialUiModel(), { type: 'load-succeeded' });
  const starting = reduceUi(ready, { type: 'run-activated' });
  const runtimeError = reduceUi(starting, { type: 'runtime-failed', generation: 1, errorCode: 'startup-timeout' });
  assert.equal(runtimeError.state, 'runtime-error');
  assert.equal(runtimeError.errorCode, 'startup-timeout');
  assert.equal(runtimeError.terminalCause, 'startup-timeout');
});

test('button model preserves one primary slot and one permanent Stop slot', async () => {
  const { buttonModel } = await loadApp();
  const expected = {
    loading: ['Loading…', true, true, true],
    'load-error': ['Reload', false, true, true],
    ready: ['Run', false, true, true],
    starting: ['Starting…', true, false, false],
    running: ['Running', true, false, false],
    stopping: ['Stopping…', true, true, false],
    stopped: ['Reload', false, true, true],
    interrupted: ['Reload', false, true, true],
    complete: ['Reload', false, true, true],
    'runtime-error': ['Reload', false, true, true],
  };

  for (const [state, [primaryLabel, primaryDisabled, stopDisabled, stopHidden]] of Object.entries(expected)) {
    assert.deepEqual(buttonModel(state), { primaryLabel, primaryDisabled, stopDisabled, stopHidden });
  }
});

test('unknown events and illegal transitions return isolated unchanged values', async () => {
  const { createInitialUiModel, reduceUi } = await loadApp();
  const loading = createInitialUiModel();
  const illegal = reduceUi(loading, { type: 'run-activated' });
  const unknown = reduceUi(loading, { type: 'not-real' });
  assert.deepEqual(illegal, loading);
  assert.deepEqual(unknown, loading);
  assert.notStrictEqual(illegal, loading);
  assert.notStrictEqual(unknown, loading);
});

function jsonResponse(value, ok = true) {
  return { ok, status: ok ? 200 : 404, json: async () => value };
}

function bytesResponse(bytes, ok = true) {
  return { ok, status: ok ? 200 : 404, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

function validMetadata() {
  return {
    id: 'gate-track-v1', bpm: 120, sampleRate: 44100, channels: 2,
    durationSeconds: 16, targetEntryDownbeatSeconds: 2,
    postCrossfadeTailSeconds: 2, generator: 'scripts/generate_gate_track.py',
    sha256: 'a'.repeat(64),
  };
}

function loaderDependencies(overrides = {}) {
  const bytes = new Uint8Array([1, 2, 3]);
  const fetchFn = async (url) => {
    if (url.endsWith('asset-metadata.json')) return jsonResponse(validMetadata());
    if (url.endsWith('calibration.json')) return jsonResponse({ trackTrim: 0.7, percussionTrim: 0.35, masterGain: 0.8 });
    return bytesResponse(bytes);
  };
  return {
    fetchFn,
    decodeFn: async () => ({ sampleRate: 44100, numberOfChannels: 2, duration: 16 }),
    digestFn: async () => 'a'.repeat(64),
    contextSampleRate: 44100,
    nowFn: (() => { let value = 100; return () => (value += 25); })(),
    timeoutFn: () => new Promise(() => {}),
    ...overrides,
  };
}

test('asset loader validates exact bytes and returns identity at ready', async () => {
  const { loadGateAsset } = await loadApp();
  const seen = [];
  const dependencies = loaderDependencies();
  const fetchFn = async (url, options) => {
    seen.push([url, options.signal, options.cache]);
    return dependencies.fetchFn(url, options);
  };
  const result = await loadGateAsset({ ...dependencies, fetchFn });

  assert.deepEqual(seen.map(([url]) => url), ['./asset-metadata.json', './calibration.json', './assets/gate-track.wav']);
  assert.ok(seen.every(([, signal]) => signal instanceof AbortSignal));
  assert.ok(seen.every(([, , cache]) => cache === 'no-store'));
  assert.equal(result.metadata.id, 'gate-track-v1');
  assert.equal(result.calibration.masterGain, 0.8);
  assert.equal(result.audioBuffer.duration, 16);
  assert.equal(result.identity.assetSha256, 'a'.repeat(64));
  assert.equal(result.identity.loadToReadyMs, 25);
});

test('asset loader maps fetch metadata hash decode and timeout failures', async () => {
  const { loadGateAsset, GateError } = await loadApp();
  const cases = [
    [loaderDependencies({ fetchFn: async () => jsonResponse({}, false) }), 'asset-fetch-failed'],
    [loaderDependencies({ fetchFn: async (url) => url.endsWith('asset-metadata.json') ? jsonResponse({}) : url.endsWith('calibration.json') ? jsonResponse({ trackTrim: 0.7, percussionTrim: 0.35, masterGain: 0.8 }) : bytesResponse(new Uint8Array([1])) }), 'metadata-invalid'],
    [loaderDependencies({ digestFn: async () => 'wrong-hash' }), 'asset-integrity-failed'],
    [loaderDependencies({ decodeFn: async () => { throw new Error('codec detail'); } }), 'decode-failed'],
    [loaderDependencies({ timeoutFn: async () => { throw new GateError('load-timeout', 'deadline'); } }), 'load-timeout'],
  ];

  for (const [dependencies, code] of cases) {
    await assert.rejects(loadGateAsset(dependencies), (error) => error instanceof GateError && error.code === code);
  }
});

test('asset loader rejects invalid calibration and decoded audio invariants', async () => {
  const { loadGateAsset } = await loadApp();
  const invalidCalibration = loaderDependencies({
    fetchFn: async (url) => url.endsWith('asset-metadata.json') ? jsonResponse(validMetadata()) : url.endsWith('calibration.json') ? jsonResponse({ trackTrim: 2 }) : bytesResponse(new Uint8Array([1])),
  });
  await assert.rejects(loadGateAsset(invalidCalibration), (error) => error.code === 'metadata-invalid');

  const invalidAudio = loaderDependencies({ decodeFn: async () => ({ sampleRate: 44100, numberOfChannels: 1, duration: 2 }) });
  await assert.rejects(loadGateAsset(invalidAudio), (error) => error.code === 'decode-failed');
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function readyModel(app) {
  return app.reduceUi(app.createInitialUiModel(), { type: 'load-succeeded' });
}

function controllerFixture(app, overrides = {}) {
  let model = readyModel(app);
  const log = [];
  const resume = overrides.resume ?? (() => { log.push('resume'); context.state = 'running'; return Promise.resolve(); });
  const context = { state: 'suspended', resume };
  const engine = overrides.engine ?? {
    start(generation) { log.push(`start:${generation}`); },
    async settle({ cause, state }) { log.push(`settle:${cause}`); return { terminalState: state, acceptedCause: cause }; },
  };
  const timers = overrides.timers ?? {
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
  };
  const controller = app.createRunController({
    context,
    engine,
    getModel: () => model,
    setModel: (next) => { model = next; },
    ...timers,
  });
  return { controller, context, engine, log, get model() { return model; } };
}

test('run controller resumes then synchronously schedules exactly once before awaiting', async () => {
  const app = await loadApp();
  const f = controllerFixture(app);
  const first = f.controller.run();
  const second = f.controller.run();
  assert.deepEqual(f.log, ['resume', 'start:1']);
  assert.equal(f.model.state, 'starting');
  assert.equal(await second, false);
  assert.equal(await first, true);
  assert.equal(f.model.state, 'running');
});

test('Stop during pending resume settles once and late resolution is stale', async () => {
  const app = await loadApp();
  const pending = deferred();
  const f = controllerFixture(app, {
    resume: () => { f.log.push('resume'); return pending.promise; },
  });
  const run = f.controller.run();
  const stop = f.controller.stop();
  assert.equal(f.model.state, 'stopping');
  await stop;
  assert.equal(f.model.state, 'stopped');
  pending.resolve();
  await run;
  assert.equal(f.model.state, 'stopped');
  assert.deepEqual(f.log, ['resume', 'start:1', 'settle:manual-stop']);
});

test('resume rejection and synchronous resume throw map to one typed terminal error', async () => {
  const app = await loadApp();
  const rejected = controllerFixture(app, {
    resume: () => Promise.reject(new Error('private browser detail')),
  });
  await rejected.controller.run();
  assert.equal(rejected.model.state, 'runtime-error');
  assert.equal(rejected.model.errorCode, 'resume-failed');
  assert.equal(rejected.log.filter((entry) => entry.startsWith('start')).length, 1);

  const thrown = controllerFixture(app, {
    resume: () => { throw new Error('sync'); },
  });
  await thrown.controller.run();
  assert.equal(thrown.model.errorCode, 'resume-failed');
  assert.equal(thrown.log.filter((entry) => entry.startsWith('start')).length, 0);
});

test('startup watchdog invalidates a pending resume generation', async () => {
  const app = await loadApp();
  const pending = deferred();
  const callbacks = new Map();
  const timers = {
    setTimeoutFn(callback) { callbacks.set(1, callback); return 1; },
    clearTimeoutFn(id) { callbacks.delete(id); },
  };
  const f = controllerFixture(app, { resume: () => pending.promise, timers });
  const run = f.controller.run();
  callbacks.get(1)();
  await run;
  assert.equal(f.model.state, 'runtime-error');
  assert.equal(f.model.errorCode, 'startup-timeout');
  pending.resolve();
  await Promise.resolve();
  assert.equal(f.model.state, 'runtime-error');
});

test('synchronous scheduling failure rolls back without waiting for resume', async () => {
  const app = await loadApp();
  const pending = deferred();
  const engine = {
    start() { const error = new Error('schedule'); error.code = 'schedule-failed'; throw error; },
    async settle({ cause, state }) { return { terminalState: state, acceptedCause: cause }; },
  };
  const f = controllerFixture(app, { resume: () => pending.promise, engine });
  await f.controller.run();
  assert.equal(f.model.state, 'runtime-error');
  assert.equal(f.model.errorCode, 'schedule-failed');
  pending.resolve();
});

test('engine natural terminal snapshot transitions only the active generation', async () => {
  const app = await loadApp();
  const f = controllerFixture(app);
  await f.controller.run();
  f.controller.handleEngineTerminal({ terminalState: 'complete', acceptedCause: 'natural-end' });
  assert.equal(f.model.state, 'complete');
  f.controller.handleEngineTerminal({ terminalState: 'interrupted', acceptedCause: 'hidden' });
  assert.equal(f.model.state, 'complete');
});

test('foreground interruption is immediate while manual running Stop ramps', async () => {
  const app = await loadApp();
  const calls = [];
  const engine = {
    start() {},
    async settle(options) {
      calls.push(options);
      return { terminalState: options.state, acceptedCause: options.cause };
    },
  };
  const hidden = controllerFixture(app, { engine });
  await hidden.controller.run();
  await hidden.controller.interrupt('hidden');
  assert.equal(calls.at(-1).immediate, true);

  const manual = controllerFixture(app, { engine });
  await manual.controller.run();
  await manual.controller.stop();
  assert.equal(calls.at(-1).immediate, false);
});

test('view model gives every state truthful phase-neutral copy and recovery', async () => {
  const { viewModelForState } = await loadApp();
  const expectations = {
    loading: ['Loading test audio…', 'Loading…', null, 'polite'],
    ready: ['Ready', 'Run', null, 'polite'],
    starting: ['Starting audio…', 'Starting…', null, 'off'],
    running: ['Running', 'Running', null, 'off'],
    stopping: ['Stopping…', 'Stopping…', null, 'off'],
    stopped: ['Stopped', 'Reload', 'Reload this page for another attempt.', 'polite'],
    interrupted: ['Test interrupted', 'Reload', 'Reload this page for another attempt.', 'polite'],
    complete: ['Complete', 'Reload', 'Reload this page for another attempt.', 'polite'],
    'load-error': ['Audio unavailable', 'Reload', 'Check the connection, then reload this page.', 'polite'],
    'runtime-error': ["Couldn't continue audio", 'Reload', 'Reload this page for another attempt.', 'polite'],
  };

  for (const [state, [status, primaryLabel, recovery, statusLive]] of Object.entries(expectations)) {
    const view = viewModelForState({ state, errorCode: state.includes('error') ? 'typed-error' : null });
    assert.equal(view.status, status, state);
    assert.equal(view.primaryLabel, primaryLabel, state);
    assert.equal(view.recovery, recovery, state);
    assert.equal(view.statusLive, statusLive, state);
    assert.equal(view.isError, state.includes('error'), state);
    assert.ok(!/beat|crossfade|second|countdown/i.test(JSON.stringify(view)), state);
  }
  assert.equal(
    viewModelForState({ state: 'ready', errorCode: null }).instruction,
    'Set media volume before Run. Keep this page foregrounded. Listen without watching; record what you heard before opening diagnostics.',
  );
});

class FakeElement {
  constructor({ content = null } = {}) {
    this.content = content;
    this.textContent = '';
    this.disabled = false;
    this.hidden = false;
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
    this.ownerDocument = null;
    this.focusCalls = 0;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type) { return this.listeners.get(type)?.(); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  replaceChildren(...children) { this.children = children; }
  focus() { this.focusCalls += 1; this.ownerDocument.activeElement = this; }
}

class FakeDocument {
  constructor() {
    this.hidden = false;
    this.activeElement = null;
    this.listeners = new Map();
    this.elements = new Map([
      ['status', new FakeElement()], ['instruction', new FakeElement()],
      ['result', new FakeElement()], ['recovery', new FakeElement()],
      ['primary-action', new FakeElement()], ['stop-action', new FakeElement()],
      ['diagnostics-list', new FakeElement()],
    ]);
    for (const element of this.elements.values()) element.ownerDocument = this;
    this.commitMeta = new FakeElement({ content: '__BUILD_COMMIT__' });
  }
  getElementById(id) { return this.elements.get(id); }
  querySelector(selector) { return selector === 'meta[name="build-commit"]' ? this.commitMeta : null; }
  createElement() { return new FakeElement(); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type) { return this.listeners.get(type)?.(); }
}

test('browser initialization owns one context and reaches reload-only interruption', async () => {
  const app = await loadApp();
  const documentRef = new FakeDocument();
  let contextCount = 0;
  let reloadCount = 0;
  class Context {
    constructor() { contextCount += 1; this.state = 'suspended'; this.sampleRate = 48000; this.onstatechange = null; }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  const engine = {
    start() {},
    async settle({ cause, state }) {
      return { terminalState: state, acceptedCause: cause, activeSourceCount: 0, teardownSettled: true, finalContextState: 'closed' };
    },
  };
  const loaded = {
    metadata: { id: 'gate-track-v1' },
    calibration: { trackTrim: 0.7, percussionTrim: 0.35, masterGain: 0.8 },
    audioBuffer: { duration: 16 },
    identity: { assetId: 'gate-track-v1', assetSha256: 'b'.repeat(64), loadToReadyMs: 25 },
  };
  const gate = await app.initializeBrowserGate({
    documentRef,
    AudioContextCtor: Context,
    fetchFn: async () => { throw new Error('injected loader should own fetch'); },
    cryptoSubtle: {},
    loadAssetFn: async (options) => { assert.equal(options.contextSampleRate, 48000); return loaded; },
    engineFactory: () => engine,
    percussionFactory: () => ({ name: 'click' }),
    reloadFn: () => { reloadCount += 1; },
  });

  assert.equal(contextCount, 1);
  assert.equal(gate.getModel().state, 'ready');
  assert.equal(documentRef.getElementById('status').textContent, 'Ready');
  assert.equal(documentRef.getElementById('status').attributes.get('aria-live'), 'polite');
  assert.equal(
    documentRef.getElementById('instruction').textContent,
    'Set media volume before Run. Keep this page foregrounded. Listen without watching; record what you heard before opening diagnostics.',
  );
  assert.ok(documentRef.getElementById('diagnostics-list').children.some((child) => child.textContent === 'build commit'));

  const primary = documentRef.getElementById('primary-action');
  const stop = documentRef.getElementById('stop-action');
  primary.focus();
  const runPromise = primary.dispatch('click');
  assert.equal(gate.getModel().state, 'starting');
  assert.equal(documentRef.activeElement, stop);
  assert.equal(documentRef.getElementById('status').attributes.get('aria-live'), 'off');
  await runPromise;
  assert.equal(gate.getModel().state, 'running');
  assert.equal(documentRef.getElementById('status').textContent, 'Running');
  assert.equal(documentRef.activeElement, stop);
  assert.equal(documentRef.getElementById('status').attributes.get('aria-live'), 'off');

  documentRef.hidden = true;
  const interruptPromise = documentRef.dispatch('visibilitychange');
  assert.equal(gate.getModel().state, 'stopping');
  assert.equal(documentRef.activeElement, stop);
  assert.equal(documentRef.getElementById('status').attributes.get('aria-live'), 'off');
  await interruptPromise;
  assert.equal(gate.getModel().state, 'interrupted');
  assert.equal(primary.textContent, 'Reload');
  assert.equal(documentRef.activeElement, primary);
  assert.equal(documentRef.getElementById('status').attributes.get('aria-live'), 'polite');
  primary.dispatch('click');
  assert.equal(reloadCount, 1);
});

test('main is inert when imported outside a browser', async () => {
  const { main } = await loadApp();
  assert.equal(await main({}), false);
});

test('HTML and executed module identity mismatch fails before context construction', async () => {
  const app = await loadApp();
  const documentRef = new FakeDocument();
  documentRef.commitMeta.content = 'a'.repeat(40);
  let contextCount = 0;
  class Context { constructor() { contextCount += 1; } }
  let reloadCalls = 0;
  const gate = await app.initializeBrowserGate({
    documentRef,
    AudioContextCtor: Context,
    fetchFn: async () => {},
    cryptoSubtle: {},
    reloadFn: () => { reloadCalls += 1; },
  });
  assert.equal(gate.getModel().state, 'load-error');
  assert.equal(gate.getModel().errorCode, 'module-identity-failed');
  assert.equal(contextCount, 0);
  await documentRef.getElementById('primary-action').dispatch('click');
  assert.equal(reloadCalls, 1);
});

test('load failure closes the owned context and binds reload recovery', async () => {
  const app = await loadApp();
  const documentRef = new FakeDocument();
  let closeCalls = 0;
  let reloadCalls = 0;
  class Context {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; }
    async close() { closeCalls += 1; this.state = 'closed'; }
  }
  const gate = await app.initializeBrowserGate({
    documentRef,
    AudioContextCtor: Context,
    fetchFn: async () => {},
    cryptoSubtle: {},
    loadAssetFn: async () => { throw new app.GateError('metadata-invalid', 'private detail'); },
    reloadFn: () => { reloadCalls += 1; },
  });
  assert.equal(gate.getModel().state, 'load-error');
  assert.equal(closeCalls, 1);
  assert.equal(documentRef.getElementById('result').textContent, 'metadata-invalid');
  assert.equal(documentRef.getElementById('result').attributes.get('role'), 'alert');
  await documentRef.getElementById('primary-action').dispatch('click');
  assert.equal(reloadCalls, 1);
});

test('post-load graph setup failure closes context and exposes schedule-failed recovery', async () => {
  const app = await loadApp();
  const documentRef = new FakeDocument();
  let closeCalls = 0;
  class Context {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; }
    async close() { closeCalls += 1; this.state = 'closed'; }
  }
  const gate = await app.initializeBrowserGate({
    documentRef,
    AudioContextCtor: Context,
    fetchFn: async () => {},
    cryptoSubtle: {},
    loadAssetFn: async () => ({
      metadata: { id: 'gate-track-v1' },
      calibration: { trackTrim: 0.7, percussionTrim: 0.35, masterGain: 0.8 },
      audioBuffer: { duration: 16 },
      identity: { assetId: 'gate-track-v1', assetSha256: 'b'.repeat(64), loadToReadyMs: 25 },
    }),
    percussionFactory: () => { throw new Error('device buffer failure'); },
    reloadFn: () => {},
  });
  assert.equal(gate.getModel().state, 'load-error');
  assert.equal(gate.getModel().errorCode, 'schedule-failed');
  assert.equal(closeCalls, 1);
});
