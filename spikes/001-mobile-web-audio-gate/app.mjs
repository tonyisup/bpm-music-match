import { AUDIO_ENGINE_BUILD_COMMIT, createAudioEngine, createPercussionBuffer } from './audio-engine.mjs';
import { AUDIO_MATH_BUILD_COMMIT, createEqualPowerCurves } from './audio-math.mjs';

export const APP_BUILD_COMMIT = '__BUILD_COMMIT__';

const TERMINAL_STATES = new Set(['load-error', 'stopped', 'interrupted', 'complete', 'runtime-error']);
const RUN_STATES = new Set(['starting', 'running', 'stopping']);

function immutable(model) {
  return Object.freeze({ ...model });
}

export function createInitialUiModel() {
  return immutable({
    state: 'loading',
    freshLoadEligible: true,
    generation: 0,
    terminalCause: null,
    errorCode: null,
  });
}

export function reduceUi(model, event) {
  const current = { ...model };
  const unchanged = () => immutable(current);

  if (event.type === 'load-succeeded' && model.state === 'loading') {
    return immutable({ ...current, state: 'ready' });
  }
  if (event.type === 'load-failed' && model.state === 'loading') {
    return immutable({
      ...current,
      state: 'load-error',
      freshLoadEligible: false,
      terminalCause: event.errorCode,
      errorCode: event.errorCode,
    });
  }
  if (event.type === 'run-activated' && model.state === 'ready' && model.freshLoadEligible) {
    return immutable({
      ...current,
      state: 'starting',
      freshLoadEligible: false,
      generation: model.generation + 1,
    });
  }

  if (TERMINAL_STATES.has(model.state)) {
    return unchanged();
  }
  if (event.generation !== undefined && event.generation !== model.generation) {
    return unchanged();
  }
  if (event.type === 'resume-succeeded' && model.state === 'starting') {
    return immutable({ ...current, state: 'running' });
  }
  if (event.type === 'stop-requested' && (model.state === 'starting' || model.state === 'running')) {
    return immutable({ ...current, state: 'stopping' });
  }
  if (event.type === 'runtime-failed' && RUN_STATES.has(model.state)) {
    return immutable({
      ...current,
      state: 'runtime-error',
      terminalCause: event.errorCode,
      errorCode: event.errorCode,
    });
  }
  if (event.type === 'terminal-settled' && RUN_STATES.has(model.state)) {
    if (!TERMINAL_STATES.has(event.state) || event.state === 'load-error' || event.state === 'runtime-error') {
      return unchanged();
    }
    return immutable({
      ...current,
      state: event.state,
      terminalCause: event.cause,
    });
  }
  return unchanged();
}

const BUTTON_MODELS = Object.freeze({
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
});

export function buttonModel(state) {
  const values = BUTTON_MODELS[state];
  if (!values) {
    throw new RangeError(`unknown UI state: ${state}`);
  }
  const [primaryLabel, primaryDisabled, stopDisabled, stopHidden] = values;
  return { primaryLabel, primaryDisabled, stopDisabled, stopHidden };
}

const VIEW_COPY = Object.freeze({
  loading: ['Loading test audio…', 'Wait for the controlled test track to load.', null, null],
  ready: ['Ready', 'Set media volume before Run. Keep this page foregrounded. Listen without watching; record what you heard before opening diagnostics.', null, null],
  starting: ['Starting audio…', 'Keep this page visible while audio starts.', null, null],
  running: ['Running', 'Listen for one continuous percussion-to-track handoff.', null, null],
  stopping: ['Stopping…', 'Audio ownership is being released.', null, null],
  stopped: ['Stopped', 'The test is terminal for this load.', 'Test stopped.', 'Reload this page for another attempt.'],
  interrupted: ['Test interrupted', 'Playback stopped when the page or audio context lost the foreground.', 'Test interrupted.', 'Reload this page for another attempt.'],
  complete: ['Complete', 'The controlled playback reached its natural end.', 'Playback finished.', 'Reload this page for another attempt.'],
  'load-error': ['Audio unavailable', 'The controlled asset could not be prepared.', null, 'Check the connection, then reload this page.'],
  'runtime-error': ["Couldn't continue audio", 'The browser could not retain the controlled audio run.', null, 'Reload this page for another attempt.'],
});

export function viewModelForState(model) {
  const [status, instruction, fixedResult, recovery] = VIEW_COPY[model.state] ?? VIEW_COPY['runtime-error'];
  const isError = model.state === 'load-error' || model.state === 'runtime-error';
  const buttons = buttonModel(model.state);
  return {
    status,
    instruction,
    result: isError ? model.errorCode ?? 'unknown-error' : fixedResult,
    recovery,
    isError,
    statusLive: RUN_STATES.has(model.state) ? 'off' : 'polite',
    ...buttons,
  };
}

export class GateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GateError';
    this.code = code;
  }
}

function isUnitGain(value) {
  return Number.isFinite(value) && value > 0 && value <= 1;
}

function validateMetadata(metadata, calibration) {
  const metadataValid = metadata
    && metadata.id === 'gate-track-v1'
    && metadata.bpm === 120
    && metadata.sampleRate === 44100
    && metadata.channels === 2
    && metadata.durationSeconds === 16
    && metadata.targetEntryDownbeatSeconds === 2
    && metadata.postCrossfadeTailSeconds >= 2
    && metadata.generator === 'scripts/generate_gate_track.py'
    && typeof metadata.sha256 === 'string'
    && /^[0-9a-f]{64}$/.test(metadata.sha256);
  const calibrationValid = calibration
    && isUnitGain(calibration.trackTrim)
    && isUnitGain(calibration.percussionTrim)
    && isUnitGain(calibration.masterGain);
  if (!metadataValid || !calibrationValid) {
    throw new GateError('metadata-invalid', 'Canonical asset metadata or calibration is invalid.');
  }
}

async function checkedFetch(fetchFn, url, signal, bodyType) {
  let response;
  try {
    response = await fetchFn(url, { signal, cache: 'no-store' });
  } catch (error) {
    if (error instanceof GateError) throw error;
    throw new GateError('asset-fetch-failed', `Failed to fetch ${url}.`);
  }
  if (!response?.ok) {
    throw new GateError('asset-fetch-failed', `Failed to fetch ${url}; HTTP ${response?.status ?? 'unknown'}.`);
  }
  try {
    return await response[bodyType]();
  } catch {
    throw new GateError(bodyType === 'json' ? 'metadata-invalid' : 'asset-fetch-failed', `Invalid response body for ${url}.`);
  }
}

function defaultTimeout(milliseconds) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new GateError('load-timeout', `Loading exceeded ${milliseconds}ms.`)), milliseconds);
  });
}

export async function loadGateAsset({
  fetchFn,
  decodeFn,
  digestFn,
  contextSampleRate,
  nowFn = () => performance.now(),
  timeoutFn = defaultTimeout,
  timeoutMs = 15_000,
}) {
  const startedAt = nowFn();
  const controller = new AbortController();
  const load = async () => {
    const metadata = await checkedFetch(fetchFn, './asset-metadata.json', controller.signal, 'json');
    const calibration = await checkedFetch(fetchFn, './calibration.json', controller.signal, 'json');
    validateMetadata(metadata, calibration);
    const bytes = await checkedFetch(fetchFn, './assets/gate-track.wav', controller.signal, 'arrayBuffer');
    const digest = await digestFn(bytes);
    if (digest !== metadata.sha256) {
      throw new GateError('asset-integrity-failed', 'Runtime WAV SHA-256 does not match immutable metadata.');
    }

    let audioBuffer;
    try {
      audioBuffer = await decodeFn(bytes);
    } catch {
      throw new GateError('decode-failed', 'Chrome could not decode the canonical WAV.');
    }
    const durationTolerance = 1 / metadata.sampleRate;
    if (audioBuffer.sampleRate !== contextSampleRate
      || audioBuffer.numberOfChannels !== metadata.channels
      || Math.abs(audioBuffer.duration - metadata.durationSeconds) > durationTolerance
      || metadata.durationSeconds < metadata.targetEntryDownbeatSeconds + 2 + metadata.postCrossfadeTailSeconds) {
      throw new GateError('decode-failed', 'Decoded audio invariants do not match immutable metadata.');
    }

    return {
      metadata,
      calibration,
      audioBuffer,
      identity: {
        assetId: metadata.id,
        assetSha256: digest,
        calibration: { ...calibration },
        loadToReadyMs: nowFn() - startedAt,
      },
    };
  };

  try {
    return await Promise.race([load(), timeoutFn(timeoutMs)]);
  } catch (error) {
    controller.abort();
    if (error instanceof GateError) throw error;
    throw new GateError('asset-fetch-failed', 'Unexpected asset-loading failure.');
  }
}

export function createRunController({
  context,
  engine,
  getModel,
  setModel,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let activeGeneration = null;
  let startupTimer = null;

  const apply = (event) => {
    const next = reduceUi(getModel(), event);
    setModel(next);
    return next;
  };

  const clearStartupTimer = () => {
    if (startupTimer !== null) {
      clearTimeoutFn(startupTimer);
      startupTimer = null;
    }
  };

  const failGeneration = async (generation, errorCode) => {
    if (activeGeneration !== generation) return false;
    activeGeneration = null;
    clearStartupTimer();
    await engine.settle({ generation, cause: errorCode, state: 'runtime-error', immediate: true });
    apply({ type: 'runtime-failed', generation, errorCode });
    return false;
  };

  const run = () => {
    const before = getModel();
    if (before.state !== 'ready' || !before.freshLoadEligible) return Promise.resolve(false);
    const starting = reduceUi(before, { type: 'run-activated' });
    setModel(starting);
    const generation = starting.generation;
    activeGeneration = generation;

    let resumePromise;
    try {
      resumePromise = Promise.resolve(context.resume());
    } catch {
      return failGeneration(generation, 'resume-failed');
    }

    let rejectStartup;
    const startupDeadline = new Promise((_, reject) => {
      rejectStartup = reject;
    });
    startupTimer = setTimeoutFn(() => {
      rejectStartup(new GateError('startup-timeout', 'AudioContext resume exceeded five seconds.'));
    }, 5_000);

    try {
      engine.start(generation);
    } catch (error) {
      const code = error?.code === 'schedule-failed' ? 'schedule-failed' : 'schedule-failed';
      return failGeneration(generation, code);
    }

    return (async () => {
      try {
        await Promise.race([resumePromise, startupDeadline]);
        if (activeGeneration !== generation || getModel().state !== 'starting') return false;
        clearStartupTimer();
        if (context.state !== 'running') return failGeneration(generation, 'resume-failed');
        apply({ type: 'resume-succeeded', generation });
        return true;
      } catch (error) {
        if (activeGeneration !== generation) return false;
        const code = error instanceof GateError && error.code === 'startup-timeout'
          ? 'startup-timeout'
          : 'resume-failed';
        return failGeneration(generation, code);
      }
    })();
  };

  const settleFromUser = async ({ cause, state, forceImmediate = false }) => {
    const before = getModel();
    if (activeGeneration === null || (before.state !== 'starting' && before.state !== 'running')) return false;
    const generation = activeGeneration;
    const immediate = forceImmediate || before.state !== 'running';
    activeGeneration = null;
    clearStartupTimer();
    apply({ type: 'stop-requested', generation });
    const snapshot = await engine.settle({ generation, cause, state, immediate });
    apply({ type: 'terminal-settled', generation, state: snapshot.terminalState, cause: snapshot.acceptedCause });
    return true;
  };

  const handleEngineTerminal = (snapshot) => {
    if (activeGeneration === null) return false;
    const generation = activeGeneration;
    activeGeneration = null;
    clearStartupTimer();
    apply({
      type: 'terminal-settled',
      generation,
      state: snapshot.terminalState,
      cause: snapshot.acceptedCause,
    });
    return true;
  };

  return {
    run,
    stop: () => settleFromUser({ cause: 'manual-stop', state: 'stopped' }),
    interrupt: (cause) => settleFromUser({ cause, state: 'interrupted', forceImmediate: true }),
    handleEngineTerminal,
  };
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function closeContextQuietly(context) {
  try {
    await context.close();
  } catch {
    // The original typed setup/load failure remains the user-visible first cause.
  }
}

function diagnosticPairs({ model, identity, terminal, context, buildCommit, browserIdentity, sessionStartedAt }) {
  if (model.state === 'loading') return [];
  if (model.state === 'ready') {
    return [
      ['build commit', buildCommit],
      ['asset id', identity.assetId],
      ['asset SHA-256', identity.assetSha256],
      ['track trim', identity.calibration.trackTrim],
      ['percussion trim', identity.calibration.percussionTrim],
      ['master gain', identity.calibration.masterGain],
    ];
  }
  if (model.state === 'starting' || model.state === 'running' || model.state === 'stopping') {
    return [['status', 'withheld while listening']];
  }
  const plan = terminal?.plan ?? {};
  return [
    ['build commit', buildCommit],
    ['asset id', identity?.assetId ?? 'unavailable'],
    ['asset SHA-256', identity?.assetSha256 ?? 'unavailable'],
    ['browser identity', browserIdentity],
    ['context sample rate', context?.sampleRate ?? 'unavailable'],
    ['session started', sessionStartedAt],
    ['load-to-ready ms', identity?.loadToReadyMs ?? 'unavailable'],
    ['terminal state', terminal?.terminalState ?? model.state],
    ['accepted cause', terminal?.acceptedCause ?? model.errorCode ?? 'unavailable'],
    ['beat one audio time', plan.beatOneTime ?? 'unavailable'],
    ['crossfade start audio time', plan.crossfadeStartTime ?? 'unavailable'],
    ['crossfade end audio time', plan.crossfadeEndTime ?? 'unavailable'],
    ['natural end audio time', plan.naturalEndTime ?? 'unavailable'],
    ['scheduled percussion', terminal?.scheduledPercussion ?? 'unavailable'],
    ['ended percussion', terminal?.endedPercussion ?? 'unavailable'],
    ['track ended', terminal?.trackEnded ?? 'unavailable'],
    ['active source count', terminal?.activeSourceCount ?? 'unavailable'],
    ['teardown settled', terminal?.teardownSettled ?? false],
    ['final context state', terminal?.finalContextState ?? context?.state ?? 'unavailable'],
    ['error code', terminal?.errorCode ?? model.errorCode ?? 'none'],
  ];
}

function renderBrowser(documentRef, model, diagnostics, focusState) {
  const view = viewModelForState(model);
  const status = documentRef.getElementById('status');
  const instruction = documentRef.getElementById('instruction');
  const result = documentRef.getElementById('result');
  const recovery = documentRef.getElementById('recovery');
  const primary = documentRef.getElementById('primary-action');
  const stop = documentRef.getElementById('stop-action');
  const list = documentRef.getElementById('diagnostics-list');
  const focusedBefore = documentRef.activeElement;

  status.textContent = view.status;
  status.setAttribute('aria-live', view.statusLive);
  instruction.textContent = view.instruction;
  result.textContent = view.result ?? '';
  result.hidden = view.result === null;
  recovery.textContent = view.recovery ?? '';
  recovery.hidden = view.recovery === null;
  primary.textContent = view.primaryLabel;
  primary.disabled = view.primaryDisabled;
  stop.disabled = view.stopDisabled;
  stop.hidden = view.stopHidden;
  if (model.state === 'starting' && focusedBefore === primary) {
    stop.focus();
  } else if (model.state === 'stopping' && focusedBefore === stop) {
    focusState.pendingTerminalFocus = true;
  } else if (TERMINAL_STATES.has(model.state)) {
    if (focusedBefore === stop || focusState.pendingTerminalFocus) primary.focus();
    focusState.pendingTerminalFocus = false;
  }
  if (view.isError) result.setAttribute('role', 'alert');
  else result.removeAttribute('role');

  const children = [];
  for (const [label, value] of diagnostics) {
    const term = documentRef.createElement('dt');
    term.textContent = label;
    const description = documentRef.createElement('dd');
    description.textContent = String(value);
    children.push(term, description);
  }
  list.replaceChildren(...children);
}

export async function initializeBrowserGate({
  documentRef,
  AudioContextCtor,
  fetchFn,
  cryptoSubtle,
  loadAssetFn = loadGateAsset,
  engineFactory = createAudioEngine,
  percussionFactory = createPercussionBuffer,
  reloadFn,
  browserIdentity = globalThis.navigator?.userAgent ?? 'unknown',
}) {
  let model = createInitialUiModel();
  let identity = null;
  let terminal = null;
  let controller = null;
  const focusState = { pendingTerminalFocus: false };
  const htmlBuildCommit = documentRef.querySelector('meta[name="build-commit"]')?.content ?? 'missing';
  const buildCommit = APP_BUILD_COMMIT;
  const sessionStartedAt = new Date().toISOString();
  let context = null;
  const render = () => renderBrowser(documentRef, model, diagnosticPairs({
    model, identity, terminal, context, buildCommit, browserIdentity, sessionStartedAt,
  }), focusState);
  const setModel = (next) => {
    model = next;
    render();
  };
  const bindReloadRecovery = () => {
    documentRef.getElementById('primary-action').addEventListener('click', () => {
      reloadFn();
      return Promise.resolve(true);
    });
  };

  const moduleCommits = [APP_BUILD_COMMIT, AUDIO_ENGINE_BUILD_COMMIT, AUDIO_MATH_BUILD_COMMIT];
  if (moduleCommits.some((commit) => commit !== APP_BUILD_COMMIT) || htmlBuildCommit !== APP_BUILD_COMMIT) {
    model = reduceUi(model, { type: 'load-failed', errorCode: 'module-identity-failed' });
    render();
    bindReloadRecovery();
    return { getModel: () => model, context: null, controller: null };
  }

  try {
    context = new AudioContextCtor();
  } catch {
    model = reduceUi(model, { type: 'load-failed', errorCode: 'decode-failed' });
    renderBrowser(documentRef, model, diagnosticPairs({
      model, identity, terminal, context: null, buildCommit, browserIdentity, sessionStartedAt,
    }), focusState);
    bindReloadRecovery();
    return { getModel: () => model, context: null, controller: null };
  }
  render();

  let loaded;
  try {
    loaded = await loadAssetFn({
      fetchFn,
      contextSampleRate: context.sampleRate,
      decodeFn: (bytes) => context.decodeAudioData(bytes.slice(0)),
      digestFn: async (bytes) => bytesToHex(await cryptoSubtle.digest('SHA-256', bytes)),
    });
  } catch (error) {
    await closeContextQuietly(context);
    model = reduceUi(model, { type: 'load-failed', errorCode: error?.code ?? 'asset-fetch-failed' });
    render();
    bindReloadRecovery();
    return { getModel: () => model, context, controller: null };
  }

  identity = { ...loaded.identity, calibration: { ...loaded.calibration } };
  let engine;
  try {
    const percussionBuffer = percussionFactory(context);
    engine = engineFactory({
      context,
      trackBuffer: loaded.audioBuffer,
      percussionBuffer,
      calibration: loaded.calibration,
      curveFactory: createEqualPowerCurves,
      onTerminal: (snapshot) => {
        terminal = snapshot;
        controller?.handleEngineTerminal(snapshot);
        render();
      },
    });
    controller = createRunController({
      context,
      engine,
      getModel: () => model,
      setModel,
    });
  } catch {
    await closeContextQuietly(context);
    model = reduceUi(model, { type: 'load-failed', errorCode: 'schedule-failed' });
    render();
    bindReloadRecovery();
    return { getModel: () => model, context, controller: null };
  }
  model = reduceUi(model, { type: 'load-succeeded' });
  render();

  const primary = documentRef.getElementById('primary-action');
  const stop = documentRef.getElementById('stop-action');
  primary.addEventListener('click', () => {
    if (TERMINAL_STATES.has(model.state)) {
      reloadFn();
      return Promise.resolve(true);
    }
    return controller.run();
  });
  stop.addEventListener('click', () => controller.stop());
  documentRef.addEventListener('visibilitychange', () => {
    if (documentRef.hidden) return controller.interrupt('hidden');
    return Promise.resolve(false);
  });
  context.onstatechange = () => {
    if (context.state === 'suspended' || context.state === 'interrupted') {
      void controller.interrupt(`context-${context.state}`);
    }
  };

  return {
    getModel: () => model,
    getTerminalDiagnostics: () => terminal,
    context,
    controller,
  };
}

export async function main(environment = globalThis) {
  if (!environment.document) return false;
  const AudioContextCtor = environment.AudioContext ?? environment.webkitAudioContext;
  return initializeBrowserGate({
    documentRef: environment.document,
    AudioContextCtor,
    fetchFn: environment.fetch.bind(environment),
    cryptoSubtle: environment.crypto.subtle,
    reloadFn: () => environment.location.reload(),
    browserIdentity: environment.navigator?.userAgent ?? 'unknown',
  });
}
