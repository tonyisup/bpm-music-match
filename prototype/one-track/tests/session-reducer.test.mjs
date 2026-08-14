import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EFFECT_TYPES,
  assertDeclarativeEffect,
  createDeclarativeEffect,
} from '../src/core/effects.mjs';
import {
  CLEANUP_FAILURE_CAUSES,
  LOAD_FAILURE_CAUSES,
  createInitialSessionState,
  reduceSession,
} from '../src/core/session-reducer.mjs';
import { parseRunQuery } from '../src/core/run-context.mjs';
import {
  ASSET_IDENTITY,
  EXPERIMENT_CONFIG_IDENTITY,
} from '../src/config.mjs';

function assertRecursivelyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) {
      assertRecursivelyFrozen(descriptor.value, seen);
    }
  }
}

test('T4-SCHEMAS-EFFECTS creates a genuine immutable base lineage and ordered effects', () => {
  const state = createInitialSessionState(parseRunQuery('?run=session-1'));
  assert.deepEqual(state, {
    phase: 'awaiting-track',
    sessionId: 'session-1',
    runContext: {
      runValue: 'session-1',
      session: 'session-1',
      slot: 1,
      thermalState: 'cold',
      assignedClass: 'CENTER',
      recordKind: 'scored',
      cancellationPhase: null,
      scored: true,
      contextFrozenAtFirstAcceptedTap: false,
    },
    loadedSessionId: null,
    activeLoad: null,
    activeGenerationId: null,
    nextGenerationId: 1,
    nextEffectId: 1,
    nextLoadToken: 1,
    acceptedTap: false,
    estimatorSnapshot: null,
    lastMappedTapAudioTime: null,
    lastAudioNow: null,
    outputSampleRate: null,
    silenceDeadlineTimestampMs: null,
    predictions: [],
    nextSourceSequence: null,
    resumeEffectId: null,
    pendingResume: null,
    retiredResumes: [],
    matchDecision: null,
    handoffPlan: null,
    pendingHandoffCommit: null,
    trackSource: null,
    smokeProbe: null,
    pendingAttempt: null,
    attempts: [],
    generationTermination: null,
    terminalDraft: null,
    pairedWarmedAutoFailure: null,
    terminal: { cause: null, diagnostics: [] },
    evidence: {
      status: 'none',
      terminalRecordReceiptId: null,
      verdict: null,
      downloaded: false,
    },
    cleanup: { status: 'not-required', cause: null },
    resourceDisposition: 'none',
    pendingEffects: [],
    teardown: null,
    interruption: null,
    recoveryAction: null,
  });
  assertRecursivelyFrozen(state);

  const chosen = reduceSession(state, { type: 'choose-track' });
  assert.equal(chosen.state.phase, 'selecting-track');
  assert.notEqual(chosen.state, state);
  assert.equal(chosen.state.nextEffectId, 2);
  assert.deepEqual(chosen.effects, [{
    sessionId: 'session-1',
    generationId: 0,
    effectId: 1,
    effectType: 'open-track-picker',
    payload: {},
  }]);
  assert.deepEqual(chosen.state.pendingEffects, chosen.effects);
  assertRecursivelyFrozen(chosen);
  assert.equal(assertDeclarativeEffect(chosen.effects[0]), true);

  const noOp = reduceSession(state, { type: 'selection-cancelled' });
  assert.equal(noOp.state, state);
  assert.deepEqual(noOp.effects, []);
  assertRecursivelyFrozen(noOp);

  assert.throws(
    () => reduceSession(Object.freeze({ ...state }), { type: 'choose-track' }),
    /genuine session state/,
  );

  assert.deepEqual(EFFECT_TYPES, [
    'open-track-picker',
    'begin-track-load',
    'cancel-track-load',
    'application-teardown',
    'resume-context',
    'schedule-acknowledgment',
    'set-idle-deadline',
    'set-lock-deadline',
    'cancel-deadline',
    'schedule-predictions',
    'cancel-predictions',
    'capture-terminal-draft',
    'terminate-generation',
    'commit-handoff-plan',
    'reconcile-stale-resume',
    'run-smoke-probe',
  ]);
  const constructed = createDeclarativeEffect({
    sessionId: 'session-1',
    generationId: 0,
    effectId: 8,
    effectType: 'begin-track-load',
    payload: { selectionId: 'selection-1', loadToken: 3 },
  });
  assert.equal(assertDeclarativeEffect(constructed), true);
  assertRecursivelyFrozen(constructed);
});

function beginLoading(run = 'session-1') {
  const initial = createInitialSessionState(parseRunQuery(`?run=${run}`));
  const selecting = reduceSession(initial, { type: 'choose-track' }).state;
  return reduceSession(selecting, {
    type: 'file-selected',
    selectionId: 'selection-1',
  });
}

function successfulLoadEvent(loadingState, overrides = {}) {
  const load = loadingState.activeLoad;
  return {
    type: 'load-succeeded',
    sessionId: load.sessionId,
    generationId: load.generationId,
    effectId: load.effectId,
    effectType: load.effectType,
    loadToken: load.loadToken,
    loadedSessionId: 'loaded-session-1',
    assetIdentity: ASSET_IDENTITY,
    experimentConfigIdentity: EXPERIMENT_CONFIG_IDENTITY,
    ...overrides,
  };
}

function readyState(run = 'session-1') {
  const loading = beginLoading(run).state;
  return reduceSession(loading, successfulLoadEvent(loading)).state;
}

function teardownSettlement(state, cleanup = { status: 'succeeded', cause: null }) {
  return {
    type: 'application-teardown-settled',
    sessionId: state.teardown.sessionId,
    generationId: state.teardown.generationId,
    effectId: state.teardown.effectId,
    effectType: 'application-teardown',
    cleanup,
  };
}

function generationSettlement(state, cleanup = { status: 'succeeded', cause: null }) {
  return {
    type: 'generation-cleanup-settled',
    sessionId: state.sessionId,
    generationId: state.generationTermination.generationId,
    effectId: state.generationTermination.effectId,
    effectType: 'terminate-generation',
    cleanup,
  };
}

function effectSucceeded(effect) {
  return {
    type: 'effect-succeeded',
    sessionId: effect.sessionId,
    generationId: effect.generationId,
    effectId: effect.effectId,
    effectType: effect.effectType,
  };
}

function effectFailed(effect, cause) {
  return {
    type: 'effect-failed',
    sessionId: effect.sessionId,
    generationId: effect.generationId,
    effectId: effect.effectId,
    effectType: effect.effectType,
    cause,
  };
}

test('T4-LOADING-LIFECYCLE selects, loads, cancels, errors, and unloads deterministically', () => {
  assert.deepEqual(LOAD_FAILURE_CAUSES, [
    'track-read-failed',
    'track-identity-failed',
    'track-metadata-invalid',
    'track-decode-failed',
    'track-bounds-invalid',
  ]);
  assert.deepEqual(CLEANUP_FAILURE_CAUSES, ['context-close-failed']);

  const initial = createInitialSessionState(parseRunQuery('?run=session-1'));
  const selecting = reduceSession(initial, { type: 'choose-track' }).state;
  const cancelledSelection = reduceSession(selecting, { type: 'selection-cancelled' });
  assert.equal(cancelledSelection.state.phase, 'awaiting-track');
  assert.equal(cancelledSelection.state.loadedSessionId, null);
  assert.deepEqual(cancelledSelection.state.pendingEffects, []);
  assert.deepEqual(cancelledSelection.effects, []);

  const loadingResult = beginLoading();
  const loading = loadingResult.state;
  assert.equal(loading.phase, 'loading-track');
  assert.equal(loading.resourceDisposition, 'loading');
  assert.deepEqual(loading.activeLoad, {
    sessionId: 'session-1',
    generationId: 0,
    effectId: 2,
    effectType: 'begin-track-load',
    loadToken: 1,
    selectionId: 'selection-1',
  });
  assert.deepEqual(loadingResult.effects, [{
    sessionId: 'session-1',
    generationId: 0,
    effectId: 2,
    effectType: 'begin-track-load',
    payload: { selectionId: 'selection-1', loadToken: 1 },
  }]);
  assert.deepEqual(loading.pendingEffects, loadingResult.effects);
  assert.equal(loading.nextEffectId, 3);
  assert.equal(loading.nextLoadToken, 2);

  const readyResult = reduceSession(loading, successfulLoadEvent(loading));
  assert.equal(readyResult.state.phase, 'ready');
  assert.equal(readyResult.state.loadedSessionId, 'loaded-session-1');
  assert.equal(readyResult.state.activeLoad, null);
  assert.equal(readyResult.state.resourceDisposition, 'loaded');
  assert.deepEqual(readyResult.state.pendingEffects, []);
  assert.deepEqual(readyResult.effects, []);

  const cancelledLoading = reduceSession(beginLoading().state, { type: 'cancel-loading' });
  assert.equal(cancelledLoading.state.phase, 'teardown-in-progress');
  assert.equal(cancelledLoading.state.activeLoad, null);
  assert.equal(cancelledLoading.state.resourceDisposition, 'teardown-pending');
  assert.deepEqual(cancelledLoading.effects, [
    {
      sessionId: 'session-1',
      generationId: 0,
      effectId: 3,
      effectType: 'cancel-track-load',
      payload: { loadToken: 1 },
    },
    {
      sessionId: 'session-1',
      generationId: 0,
      effectId: 4,
      effectType: 'application-teardown',
      payload: { reason: 'load-cancelled', loadToken: 1, loadedSessionId: null },
    },
  ]);
  assert.deepEqual(cancelledLoading.state.pendingEffects, [cancelledLoading.effects[1]]);
  assert.deepEqual(cancelledLoading.state.teardown, {
    reason: 'load-cancelled',
    targetPhase: 'awaiting-track',
    sessionId: 'session-1',
    generationId: 0,
    effectId: 4,
    effectType: 'application-teardown',
  });
  const cancelledSettled = reduceSession(
    cancelledLoading.state,
    teardownSettlement(cancelledLoading.state, {
      status: 'failed',
      cause: 'context-close-failed',
    }),
  );
  assert.equal(cancelledSettled.state.phase, 'error');
  assert.equal(cancelledSettled.state.recoveryAction, 'reload');
  assert.deepEqual(cancelledSettled.state.cleanup, {
    status: 'failed',
    cause: 'context-close-failed',
  });
  assert.equal(cancelledSettled.state.resourceDisposition, 'release-failed');
  assert.deepEqual(cancelledSettled.state.pendingEffects, []);

  const failedLoading = beginLoading().state;
  const failedLoad = reduceSession(failedLoading, {
    type: 'load-failed',
    sessionId: failedLoading.activeLoad.sessionId,
    generationId: failedLoading.activeLoad.generationId,
    effectId: failedLoading.activeLoad.effectId,
    effectType: failedLoading.activeLoad.effectType,
    loadToken: failedLoading.activeLoad.loadToken,
    cause: 'track-identity-failed',
  });
  assert.equal(failedLoad.state.phase, 'error');
  assert.equal(failedLoad.state.activeLoad, null);
  assert.deepEqual(failedLoad.state.terminal, {
    cause: 'track-identity-failed',
    diagnostics: [],
  });
  assert.equal(failedLoad.state.recoveryAction, null);
  assert.deepEqual(failedLoad.effects, [{
    sessionId: 'session-1',
    generationId: 0,
    effectId: 3,
    effectType: 'application-teardown',
    payload: { reason: 'load-failed', loadToken: 1, loadedSessionId: null },
  }]);
  const failedSettled = reduceSession(
    failedLoad.state,
    teardownSettlement(failedLoad.state),
  );
  assert.equal(failedSettled.state.phase, 'error');
  assert.equal(failedSettled.state.recoveryAction, 'choose-track');
  assert.equal(failedSettled.state.resourceDisposition, 'released');
  const recovered = reduceSession(failedSettled.state, { type: 'choose-track' });
  assert.equal(recovered.state.phase, 'selecting-track');
  assert.equal(recovered.state.terminal.cause, null);
  assert.equal(recovered.state.recoveryAction, null);

  const ready = readyState();
  const unloading = reduceSession(ready, { type: 'unload-track' });
  assert.equal(unloading.state.phase, 'teardown-in-progress');
  assert.equal(unloading.state.loadedSessionId, 'loaded-session-1');
  assert.deepEqual(unloading.effects, [{
    sessionId: 'session-1',
    generationId: 0,
    effectId: 3,
    effectType: 'application-teardown',
    payload: {
      reason: 'unload-track',
      loadToken: null,
      loadedSessionId: 'loaded-session-1',
    },
  }]);
  const unloaded = reduceSession(unloading.state, teardownSettlement(unloading.state));
  assert.equal(unloaded.state.phase, 'awaiting-track');
  assert.equal(unloaded.state.loadedSessionId, null);
  assert.equal(unloaded.state.resourceDisposition, 'released');

  const closed = reduceSession(readyState(), { type: 'unexpected-context-closed' });
  assert.equal(closed.state.phase, 'error');
  assert.equal(closed.state.acceptedTap, false);
  assert.equal(closed.state.evidence.status, 'none');
  assert.equal(closed.state.loadedSessionId, 'loaded-session-1');
  assert.deepEqual(closed.state.terminal, {
    cause: 'runtime-context-closed',
    diagnostics: [],
  });
  assert.deepEqual(closed.effects, [{
    sessionId: 'session-1',
    generationId: 0,
    effectId: 3,
    effectType: 'application-teardown',
    payload: {
      reason: 'unexpected-context-closed',
      loadToken: null,
      loadedSessionId: 'loaded-session-1',
    },
  }]);
  const closedSettled = reduceSession(closed.state, teardownSettlement(closed.state));
  assert.equal(closedSettled.state.phase, 'error');
  assert.equal(closedSettled.state.loadedSessionId, null);
  assert.equal(closedSettled.state.recoveryAction, 'choose-track');
  assertRecursivelyFrozen(closedSettled);
});

function assertPureDataGraph(value, seen = new Set()) {
  if (value === null
      || typeof value === 'boolean'
      || typeof value === 'string'
      || (typeof value === 'number' && Number.isFinite(value))) {
    return;
  }
  assert.equal(typeof value, 'object');
  assert.equal(seen.has(value), false, 'pure state/effect data must be acyclic');
  seen.add(value);
  assert.equal(ArrayBuffer.isView(value), false);
  assert.equal(value instanceof ArrayBuffer, false);
  assert.equal(value instanceof Date, false);
  assert.equal(value instanceof Error, false);
  const prototype = Object.getPrototypeOf(value);
  assert.ok(prototype === Object.prototype || prototype === Array.prototype);
  for (const key of Reflect.ownKeys(value)) {
    assert.equal(typeof key, 'string');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (key !== 'length') {
      assert.equal(descriptor.enumerable, true);
    }
    assert.equal(Object.hasOwn(descriptor, 'value'), true);
    assertPureDataGraph(descriptor.value, seen);
  }
  seen.delete(value);
}

function assertNoOp(result, state) {
  assert.equal(result.state, state);
  assert.deepEqual(result.effects, []);
  assertRecursivelyFrozen(result);
}

test('T4-STALE-VALIDATION rejects hostile shapes and ignores stale ownership callbacks', () => {
  const loading = beginLoading().state;
  const validSuccess = successfulLoadEvent(loading);
  for (const overrides of [
    { sessionId: 'session-2' },
    { generationId: 1 },
    { effectId: loading.activeLoad.effectId + 1 },
    { loadToken: loading.activeLoad.loadToken + 1 },
  ]) {
    assertNoOp(reduceSession(loading, { ...validSuccess, ...overrides }), loading);
  }

  const cancelled = reduceSession(loading, { type: 'cancel-loading' }).state;
  assertNoOp(reduceSession(cancelled, validSuccess), cancelled);
  const staleTeardown = teardownSettlement(cancelled);
  staleTeardown.effectId += 1;
  assertNoOp(reduceSession(cancelled, staleTeardown), cancelled);

  const ready = reduceSession(loading, validSuccess).state;
  assertNoOp(reduceSession(ready, validSuccess), ready);
  assertNoOp(reduceSession(ready, {
    ...validSuccess,
    assetIdentity: Object.freeze({ ...ASSET_IDENTITY }),
    effectId: validSuccess.effectId + 1,
  }), ready);

  assert.throws(
    () => reduceSession(loading, {
      ...validSuccess,
      assetIdentity: Object.freeze({ ...ASSET_IDENTITY }),
    }),
    /locked authorities/,
  );
  assert.throws(
    () => reduceSession(loading, {
      type: 'load-failed',
      sessionId: loading.activeLoad.sessionId,
      generationId: loading.activeLoad.generationId,
      effectId: loading.activeLoad.effectId,
      effectType: loading.activeLoad.effectType,
      loadToken: loading.activeLoad.loadToken,
      cause: 'raw-exception-message',
    }),
    TypeError,
  );

  const initial = createInitialSessionState(parseRunQuery('?run=session-1'));
  assertNoOp(reduceSession(initial, { type: 'unload-track' }), initial);
  for (const malformedEvent of [
    { type: 'choose-track', extra: true },
    { type: 'unknown-event' },
    { type: 'file-selected', selectionId: '' },
    { type: 'file-selected', selectionId: 'x'.repeat(129) },
    { type: 'file-selected', selectionId: 'not-an-opaque-id.mp3' },
    Object.assign(Object.create({ inherited: true }), { type: 'choose-track' }),
    { type: 'choose-track', [Symbol('extra')]: true },
  ]) {
    assert.throws(() => reduceSession(initial, malformedEvent), TypeError);
  }
  const nonEnumerableEvent = { type: 'choose-track' };
  Object.defineProperty(nonEnumerableEvent, 'extra', { value: true });
  assert.throws(() => reduceSession(initial, nonEnumerableEvent), TypeError);
  const eventGetterCounter = { count: 0 };
  const accessorEvent = Object.defineProperty({}, 'type', {
    enumerable: true,
    get() {
      eventGetterCounter.count += 1;
      return 'choose-track';
    },
  });
  assert.throws(() => reduceSession(initial, accessorEvent), TypeError);
  assert.equal(eventGetterCounter.count, 0);

  const run = parseRunQuery('?run=smoke-playing');
  const smokeState = createInitialSessionState(run);
  assert.equal(smokeState.runContext.assignedClass, null);
  assert.equal(smokeState.runContext.slot, null);
  assert.equal(smokeState.runContext.scored, false);
  const structurallyEquivalentRun = Object.freeze({ ...run });
  assert.throws(() => createInitialSessionState(structurallyEquivalentRun), TypeError);
  const runWithSymbol = { ...run, [Symbol('extra')]: true };
  Object.freeze(runWithSymbol);
  assert.throws(() => createInitialSessionState(runWithSymbol), TypeError);
  const runGetterCounter = { count: 0 };
  const accessorRun = Object.defineProperties({}, Object.fromEntries(
    Object.entries(run).map(([key, value]) => [key, {
      enumerable: true,
      get() {
        runGetterCounter.count += 1;
        return value;
      },
    }]),
  ));
  Object.freeze(accessorRun);
  assert.throws(() => createInitialSessionState(accessorRun), TypeError);
  assert.equal(runGetterCounter.count, 0);

  const mutablePayload = { selectionId: 'selection-safe', loadToken: 9 };
  const effect = createDeclarativeEffect({
    sessionId: 'session-1',
    generationId: 0,
    effectId: 9,
    effectType: 'begin-track-load',
    payload: mutablePayload,
  });
  mutablePayload.selectionId = 'selection-mutated';
  assert.equal(effect.payload.selectionId, 'selection-safe');
  assert.equal(assertDeclarativeEffect(effect), true);
  for (const malformedEffect of [
    {
      sessionId: 'session-1',
      generationId: 0,
      effectId: Number.POSITIVE_INFINITY,
      effectType: 'open-track-picker',
      payload: {},
    },
    {
      sessionId: 'session-1',
      generationId: 0,
      effectId: 1,
      effectType: 'begin-track-load',
      payload: { selectionId: new ArrayBuffer(8), loadToken: 1 },
    },
    {
      sessionId: 'session-1',
      generationId: 0,
      effectId: 1,
      effectType: 'begin-track-load',
      payload: { selectionId: 'not-an-opaque-id.mp3', loadToken: 1 },
    },
    Object.assign(Object.create({ inherited: true }), {
      sessionId: 'session-1',
      generationId: 0,
      effectId: 1,
      effectType: 'open-track-picker',
      payload: {},
    }),
  ]) {
    assert.throws(() => createDeclarativeEffect(malformedEffect), TypeError);
  }
  const effectGetterCounter = { count: 0 };
  const accessorPayload = Object.defineProperties({}, {
    selectionId: {
      enumerable: true,
      get() {
        effectGetterCounter.count += 1;
        return 'selection-safe';
      },
    },
    loadToken: { enumerable: true, value: 1 },
  });
  assert.throws(() => createDeclarativeEffect({
    sessionId: 'session-1',
    generationId: 0,
    effectId: 1,
    effectType: 'begin-track-load',
    payload: accessorPayload,
  }), TypeError);
  assert.equal(effectGetterCounter.count, 0);

  const cleanupGetterCounter = { count: 0 };
  const accessorCleanup = Object.defineProperties({}, {
    status: {
      enumerable: true,
      get() {
        cleanupGetterCounter.count += 1;
        return 'succeeded';
      },
    },
    cause: { enumerable: true, value: null },
  });
  assert.throws(() => reduceSession(cancelled, {
    ...teardownSettlement(cancelled),
    cleanup: accessorCleanup,
  }), TypeError);
  assert.equal(cleanupGetterCounter.count, 0);

  assertPureDataGraph(initial);
  assertPureDataGraph(effect);
  assertPureDataGraph(cancelled);
});

function tapEvent({
  eventTimestampMs,
  observedNowMs = eventTimestampMs,
  audioNow,
  mappedTapAudioTime = audioNow + (eventTimestampMs - observedNowMs) / 1_000,
  outputSampleRate = 48_000,
  contextState = 'running',
}) {
  return {
    type: 'tap',
    eventTimestampMs,
    observedNowMs,
    mappedTapAudioTime,
    audioNow,
    outputSampleRate,
    contextState,
  };
}

function expectedEffect(state, effectId, generationId, effectType, payload) {
  return {
    sessionId: state.sessionId,
    generationId,
    effectId,
    effectType,
    payload,
  };
}

test('T4-FIRST-TAP-TRACKING freezes cold provenance and owns one resumable cadence generation', () => {
  const ready = readyState();
  assert.equal(ready.estimatorSnapshot, null);
  assert.equal(ready.nextSourceSequence, null);

  const invalidFirstEvent = tapEvent({
    eventTimestampMs: 1_000,
    observedNowMs: 1_101,
    audioNow: 5,
  });
  assertNoOp(reduceSession(ready, invalidFirstEvent), ready);

  const firstEvent = tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  });
  const first = reduceSession(ready, firstEvent);
  assert.equal(first.state.phase, 'tracking');
  assert.equal(first.state.activeGenerationId, 1);
  assert.equal(first.state.nextGenerationId, 2);
  assert.equal(first.state.acceptedTap, true);
  assert.equal(first.state.runContext.contextFrozenAtFirstAcceptedTap, true);
  assert.equal(first.state.estimatorSnapshot.timestampWindowMs.at(-1), 1_000);
  assert.equal(first.state.lastMappedTapAudioTime, 5);
  assert.equal(first.state.lastAudioNow, 5);
  assert.equal(first.state.outputSampleRate, 48_000);
  assert.equal(first.state.silenceDeadlineTimestampMs, 2_800);
  assert.deepEqual(first.state.predictions, []);
  assert.equal(first.state.nextSourceSequence, 2);
  assert.equal(first.state.resumeEffectId, 3);
  assert.deepEqual(first.effects, [
    expectedEffect(ready, 3, 1, 'resume-context', {
      loadedSessionId: 'loaded-session-1',
    }),
    expectedEffect(ready, 4, 1, 'schedule-acknowledgment', {
      sourceId: 'generation-1-source-1',
      mappedTapAudioTime: 5,
      scheduledAudioTime: 5.005,
    }),
    expectedEffect(ready, 5, 1, 'set-idle-deadline', {
      deadlineTimestampMs: 2_800,
    }),
  ]);
  assert.deepEqual(first.state.pendingEffects, [first.effects[0], first.effects[1]],
    'resume and every unsettled failure-reportable scheduling effect retain exact ownership');
  assert.equal(first.state.nextEffectId, 6);
  assertRecursivelyFrozen(first);
  assertPureDataGraph(first);
  first.effects.forEach((effect) => assert.equal(assertDeclarativeEffect(effect), true));

  const secondEvent = tapEvent({
    eventTimestampMs: 1_500,
    audioNow: 5.5,
    contextState: 'suspended',
  });
  const second = reduceSession(first.state, secondEvent);
  assert.equal(second.state.phase, 'tracking');
  assert.equal(second.state.activeGenerationId, 1);
  assert.equal(second.state.resumeEffectId, 3);
  assert.deepEqual(second.state.pendingEffects, [first.effects[0], second.effects[0]]);
  assert.equal(second.state.silenceDeadlineTimestampMs, 2_400);
  assert.equal(second.state.nextSourceSequence, 3);
  assert.deepEqual(second.effects, [
    expectedEffect(first.state, 6, 1, 'schedule-acknowledgment', {
      sourceId: 'generation-1-source-2',
      mappedTapAudioTime: 5.5,
      scheduledAudioTime: 5.52,
    }),
    expectedEffect(first.state, 7, 1, 'cancel-deadline', {
      deadlineTimestampMs: 2_800,
    }),
    expectedEffect(first.state, 8, 1, 'set-idle-deadline', {
      deadlineTimestampMs: 2_400,
    }),
  ]);
  assert.equal(second.effects.some((effect) => effect.effectType === 'resume-context'), false);

  for (const staleDeadline of [
    { sessionId: 'session-2' },
    { generationId: 2 },
    { deadlineTimestampMs: 2_401 },
  ]) {
    assertNoOp(reduceSession(second.state, {
      type: 'idle-deadline',
      sessionId: second.state.sessionId,
      generationId: second.state.activeGenerationId,
      deadlineTimestampMs: second.state.silenceDeadlineTimestampMs,
      ...staleDeadline,
    }), second.state);
  }

  const idleTermination = reduceSession(second.state, {
    type: 'idle-deadline',
    sessionId: second.state.sessionId,
    generationId: second.state.activeGenerationId,
    deadlineTimestampMs: second.state.silenceDeadlineTimestampMs,
  });
  assert.equal(idleTermination.state.phase, 'generation-settling');
  assert.equal(idleTermination.state.loadedSessionId, 'loaded-session-1');
  assert.equal(idleTermination.state.activeGenerationId, 1);
  assert.equal(idleTermination.state.estimatorSnapshot, second.state.estimatorSnapshot);
  assert.equal(idleTermination.state.silenceDeadlineTimestampMs, 2_400);
  assert.deepEqual(idleTermination.state.predictions, second.state.predictions);
  assert.equal(idleTermination.state.resumeEffectId, 3);
  assert.equal(idleTermination.state.nextSourceSequence, 3);
  assert.deepEqual(idleTermination.state.terminal, {
    cause: null,
    diagnostics: [],
  });
  assert.equal(idleTermination.state.terminalDraft, null);
  assert.deepEqual(idleTermination.state.generationTermination, {
    generationId: 1,
    effectId: 9,
    targetPhase: 'ready',
    cause: 'unstable-silence',
  });
  assert.deepEqual(idleTermination.state.pendingEffects, idleTermination.effects);
  assert.deepEqual(idleTermination.effects, [
    expectedEffect(second.state, 9, 1, 'terminate-generation', {
      reason: 'unstable-silence',
      audioNow: 5.5,
    }),
  ]);

  const invalidLater = reduceSession(second.state, tapEvent({
    eventTimestampMs: 1_500,
    audioNow: 5.6,
  }));
  assert.equal(invalidLater.state.phase, 'terminating-failure');
  assert.equal(invalidLater.state.loadedSessionId, 'loaded-session-1');
  assert.equal(invalidLater.state.activeGenerationId, 1);
  assert.equal(invalidLater.state.estimatorSnapshot, second.state.estimatorSnapshot);
  assert.deepEqual(invalidLater.state.predictions, second.state.predictions);
  assert.deepEqual(invalidLater.state.pendingEffects, [invalidLater.effects.at(-1)]);
  assert.deepEqual(invalidLater.state.terminal, {
    cause: 'tap-timestamp-invalid',
    diagnostics: [],
  });
  assert.deepEqual(invalidLater.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'cancel-deadline',
    'terminate-generation',
  ]);
  assert.equal(invalidLater.effects[0].payload.terminalDraft,
    invalidLater.state.terminalDraft);
  assert.deepEqual(invalidLater.effects.slice(1), [
    expectedEffect(second.state, 10, 1, 'cancel-deadline', {
      deadlineTimestampMs: 2_400,
    }),
    expectedEffect(second.state, 11, 1, 'terminate-generation', {
      reason: 'tap-timestamp-invalid',
      audioNow: 5.6,
    }),
  ]);

  assert.throws(() => reduceSession(ready, {
    ...firstEvent,
    mappedTapAudioTime: firstEvent.mappedTapAudioTime + 1e-6,
  }), /mappedTapAudioTime/);
  assert.throws(() => reduceSession(ready, {
    ...firstEvent,
    audioContext: {},
  }), TypeError);
});

function armCadence(audioOverride = null) {
  let state = readyState();
  const results = [];
  for (let index = 0; index < 5; index += 1) {
    const eventTimestampMs = 1_000 + index * 500;
    const audioNow = index === 4 && audioOverride !== null
      ? audioOverride
      : 10 + index * 0.5;
    const result = reduceSession(state, tapEvent({ eventTimestampMs, audioNow }));
    results.push(result);
    state = result.state;
  }
  return { state, results };
}

function futurePredictions(state, audioNow) {
  const oneSample = 1 / state.outputSampleRate;
  return state.predictions.filter(
    (prediction) => prediction.scheduledAudioTime > audioNow + oneSample,
  );
}

test('T4-ARMED-RECONCILIATION reanchors an exact two-hit grid without duplicate audio', () => {
  assert.equal(EFFECT_TYPES.includes('schedule-predictions'), true);
  const armedRun = armCadence();
  const armed = armedRun.state;
  const armedResult = armedRun.results.at(-1);
  assert.equal(armed.phase, 'armed');
  assert.equal(armed.estimatorSnapshot.armed, true);
  assert.equal(armed.estimatorSnapshot.estimatedBpmExact, 120);
  assert.equal(armed.silenceDeadlineTimestampMs, 3_900);
  assert.deepEqual(armed.predictions, [
    { sourceId: 'generation-1-source-6', scheduledAudioTime: 12.5 },
    { sourceId: 'generation-1-source-7', scheduledAudioTime: 13 },
  ]);
  assert.deepEqual(armedResult.effects.map((effect) => effect.effectType), [
    'schedule-acknowledgment',
    'cancel-deadline',
    'set-lock-deadline',
    'schedule-predictions',
  ]);
  assert.deepEqual(armedResult.effects.at(-1).payload, {
    predictions: armed.predictions,
  });
  assert.equal(futurePredictions(armed, 12).length, 2);
  assertRecursivelyFrozen(armedResult);
  assertPureDataGraph(armedResult);

  const upperInclusiveTime = armed.predictions[0].scheduledAudioTime + 0.060;
  const upperInclusive = reduceSession(armed, tapEvent({
    eventTimestampMs: 3_500,
    audioNow: upperInclusiveTime,
  }));
  assert.equal(upperInclusive.effects.some(
    (effect) => effect.effectType === 'schedule-acknowledgment',
  ), false);
  assert.deepEqual(upperInclusive.effects.map((effect) => effect.effectType), [
    'cancel-deadline',
    'set-lock-deadline',
    'cancel-predictions',
    'schedule-predictions',
  ]);
  assert.deepEqual(upperInclusive.effects[2].payload, {
    sourceIds: ['generation-1-source-7'],
    audioNow: upperInclusiveTime,
  });
  assert.deepEqual(upperInclusive.state.predictions, [
    { sourceId: 'generation-1-source-6', scheduledAudioTime: 12.5 },
    { sourceId: 'generation-1-source-8', scheduledAudioTime: upperInclusiveTime + 0.5 },
    { sourceId: 'generation-1-source-9', scheduledAudioTime: upperInclusiveTime + 1 },
  ]);
  assert.equal(futurePredictions(upperInclusive.state, upperInclusiveTime).length, 2);

  const lowerInclusiveTime = armed.predictions[0].scheduledAudioTime - 0.060;
  const lowerInclusive = reduceSession(armed, tapEvent({
    eventTimestampMs: 3_500,
    audioNow: lowerInclusiveTime,
  }));
  assert.equal(lowerInclusive.effects.some(
    (effect) => effect.effectType === 'schedule-acknowledgment',
  ), false);
  assert.deepEqual(lowerInclusive.state.predictions, [
    { sourceId: 'generation-1-source-6', scheduledAudioTime: 12.5 },
    { sourceId: 'generation-1-source-8', scheduledAudioTime: lowerInclusiveTime + 0.5 },
  ]);
  assert.equal(futurePredictions(lowerInclusive.state, lowerInclusiveTime).length, 2);

  const justOverTime = armed.predictions[0].scheduledAudioTime + 0.060001;
  const justOver = reduceSession(armed, tapEvent({
    eventTimestampMs: 3_500,
    audioNow: justOverTime,
  }));
  assert.deepEqual(justOver.effects.map((effect) => effect.effectType), [
    'schedule-acknowledgment',
    'cancel-deadline',
    'set-lock-deadline',
    'cancel-predictions',
    'schedule-predictions',
  ]);
  assert.deepEqual(justOver.effects[0].payload, {
    sourceId: 'generation-1-source-8',
    mappedTapAudioTime: justOverTime,
    scheduledAudioTime: justOverTime + 0.005,
  });
  assert.deepEqual(justOver.effects[3].payload.sourceIds, ['generation-1-source-7']);
  assert.equal(futurePredictions(justOver.state, justOverTime).length, 2);
  assert.equal(new Set(justOver.state.predictions.map(({ sourceId }) => sourceId)).size,
    justOver.state.predictions.length);
  assert.equal(new Set(justOver.state.predictions.map(
    ({ scheduledAudioTime }) => scheduledAudioTime,
  )).size, justOver.state.predictions.length);

  const oneSample = 1 / armed.outputSampleRate;
  const secondPredictionTime = armed.predictions[1].scheduledAudioTime;
  const equalityAudioNow = secondPredictionTime - oneSample;
  assert.equal(equalityAudioNow + oneSample, secondPredictionTime);
  const atBoundary = reduceSession(armed, tapEvent({
    eventTimestampMs: 3_500,
    audioNow: equalityAudioNow,
  }));
  assert.equal(atBoundary.effects.some(
    (effect) => effect.effectType === 'schedule-acknowledgment',
  ), false);
  assert.deepEqual(atBoundary.state.predictions.slice(0, 2), armed.predictions);
  assert.equal(atBoundary.effects.at(-1).effectType, 'schedule-predictions');
  assert.equal(atBoundary.effects.at(-1).payload.predictions.length, 2);
  assert.equal(futurePredictions(atBoundary.state, equalityAudioNow).length, 2);

  const beforeBoundaryAudioNow = secondPredictionTime - oneSample - 1e-9;
  assert.equal(secondPredictionTime > beforeBoundaryAudioNow + oneSample, true);
  const beforeBoundary = reduceSession(armed, tapEvent({
    eventTimestampMs: 3_500,
    audioNow: beforeBoundaryAudioNow,
  }));
  assert.deepEqual(beforeBoundary.state.predictions.slice(0, 2), armed.predictions);
  assert.equal(beforeBoundary.effects.at(-1).payload.predictions.length, 1);
  assert.equal(futurePredictions(beforeBoundary.state, beforeBoundaryAudioNow).length, 2);

  const destabilized = reduceSession(armed, tapEvent({
    eventTimestampMs: 3_600,
    audioNow: 12.6,
  }));
  assert.equal(destabilized.state.phase, 'tracking');
  assert.equal(destabilized.state.estimatorSnapshot.armed, false);
  assert.deepEqual(destabilized.effects.map((effect) => effect.effectType), [
    'schedule-acknowledgment',
    'cancel-deadline',
    'set-idle-deadline',
    'cancel-predictions',
  ]);
  assert.deepEqual(destabilized.effects.at(-1).payload, {
    sourceIds: ['generation-1-source-7'],
    audioNow: 12.6,
  });
  assert.deepEqual(destabilized.state.predictions, [
    { sourceId: 'generation-1-source-6', scheduledAudioTime: 12.5 },
  ]);
  assert.equal(futurePredictions(destabilized.state, 12.6).length, 0);

  const ended = reduceSession(destabilized.state, {
    type: 'source-ended',
    sessionId: destabilized.state.sessionId,
    generationId: destabilized.state.activeGenerationId,
    sourceId: 'generation-1-source-6',
  });
  assert.deepEqual(ended.state.predictions, []);
  assert.deepEqual(ended.effects, []);
  for (const stale of [
    { sessionId: 'session-2' },
    { generationId: 2 },
    { sourceId: 'generation-1-source-unknown' },
  ]) {
    assertNoOp(reduceSession(destabilized.state, {
      type: 'source-ended',
      sessionId: destabilized.state.sessionId,
      generationId: destabilized.state.activeGenerationId,
      sourceId: 'generation-1-source-6',
      ...stale,
    }), destabilized.state);
  }

  const tooLateRun = armCadence(Number.MAX_VALUE);
  const tooLate = tooLateRun.results.at(-1);
  const beforeTooLate = tooLateRun.results.at(-2).state;
  assert.equal(tooLate.state.phase, 'terminating-failure');
  assert.equal(tooLate.state.activeGenerationId, 1);
  assert.deepEqual(tooLate.state.predictions, beforeTooLate.predictions);
  assert.deepEqual(tooLate.state.terminal, {
    cause: 'tap-grid-too-late',
    diagnostics: [],
  });
  assert.deepEqual(tooLate.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'cancel-deadline',
    'terminate-generation',
  ]);
  assert.equal(tooLate.effects.some(({ effectType }) => (
    effectType === 'schedule-acknowledgment' || effectType === 'schedule-predictions'
  )), false);
  assert.deepEqual(tooLate.effects.slice(1), [
    expectedEffect(beforeTooLate, 16, 1, 'cancel-deadline', {
      deadlineTimestampMs: 3_400,
    }),
    expectedEffect(beforeTooLate, 17, 1, 'terminate-generation', {
      reason: 'tap-grid-too-late',
      audioNow: Number.MAX_VALUE,
    }),
  ]);
  for (const result of [...armedRun.results, upperInclusive, lowerInclusive, justOver,
    atBoundary, beforeBoundary, destabilized]) {
    assert.ok(futurePredictions(result.state, result.state.lastAudioNow).length <= 2);
  }
});

function armCadenceFromState(initialState, bpm) {
  const intervalMs = 60_000 / bpm;
  let state = initialState;
  for (let index = 0; index < 5; index += 1) {
    const eventTimestampMs = 1_000 + index * intervalMs;
    const audioNow = 10 + index * intervalMs / 1_000;
    state = reduceSession(state, tapEvent({ eventTimestampMs, audioNow })).state;
  }
  return state;
}

function armCadenceAtBpm(bpm, run = 'session-1') {
  return armCadenceFromState(readyState(run), bpm);
}

function lockDeadlineEvent(state, overrides = {}) {
  const lastTimestampMs = state.estimatorSnapshot.timestampWindowMs.at(-1);
  const lockDeadlineAudioTime = state.lastMappedTapAudioTime
    + (state.silenceDeadlineTimestampMs - lastTimestampMs) / 1_000;
  return {
    type: 'lock-deadline',
    sessionId: state.sessionId,
    generationId: state.activeGenerationId,
    deadlineTimestampMs: state.silenceDeadlineTimestampMs,
    lockDeadlineAudioTime,
    audioNow: lockDeadlineAudioTime,
    outputSampleRate: state.outputSampleRate,
    ...overrides,
  };
}

test('T4-ATOMIC-LOCK classifies cadence once and commits one immutable handoff plan', () => {
  const armed = armCadenceAtBpm(110);
  assert.equal(armed.phase, 'armed');
  const locked = reduceSession(armed, lockDeadlineEvent(armed));
  assert.equal(locked.state.phase, 'handoff');
  assert.deepEqual(locked.state.matchDecision, {
    estimatedBpmExact: armed.estimatorSnapshot.estimatedBpmExact,
    withinApplicationWindow: true,
    actualClass: 'CENTER',
    assignedClass: 'CENTER',
    assignedClassMatched: true,
  });
  assert.equal(locked.state.handoffPlan.generationId, 'generation-1');
  assert.equal(locked.state.handoffPlan.assetIdentity, ASSET_IDENTITY);
  assert.equal(locked.state.handoffPlan.experimentConfigIdentity, EXPERIMENT_CONFIG_IDENTITY);
  assert.equal(locked.state.handoffPlan.beatTimes.length, 8);
  assert.equal(locked.state.silenceDeadlineTimestampMs, null);
  assert.equal(Object.isFrozen(locked.state.handoffPlan), true);
  assert.deepEqual(locked.effects.map(({ effectType }) => effectType), [
    'cancel-deadline',
    'commit-handoff-plan',
  ]);
  assert.equal(locked.effects[1].payload.plan, locked.state.handoffPlan,
    'effect must preserve the planner authority object rather than clone its identities');
  assertRecursivelyFrozen(locked);
  assertPureDataGraph(locked);

  for (const stale of [
    { sessionId: 'session-2' },
    { generationId: 2 },
    { deadlineTimestampMs: armed.silenceDeadlineTimestampMs + 1 },
  ]) {
    assertNoOp(reduceSession(armed, lockDeadlineEvent(armed, stale)), armed);
  }
  assertNoOp(reduceSession(locked.state, lockDeadlineEvent(armed)), locked.state);

  for (const [bpm, actualClass] of [[107, 'LOW_EDGE'], [113, 'HIGH_EDGE']]) {
    const edge = armCadenceAtBpm(bpm);
    const result = reduceSession(edge, lockDeadlineEvent(edge));
    assert.equal(result.state.phase, 'handoff');
    assert.equal(result.state.matchDecision.withinApplicationWindow, true);
    assert.equal(result.state.matchDecision.actualClass, actualClass);
  }

  const wrongClass = armCadenceAtBpm(107.5);
  const wrongClassResult = reduceSession(wrongClass, lockDeadlineEvent(wrongClass));
  assert.equal(wrongClassResult.state.phase, 'handoff');
  assert.equal(wrongClassResult.state.matchDecision.actualClass, 'LOW_EDGE');
  assert.equal(wrongClassResult.state.matchDecision.assignedClassMatched, false);
});

test('T4-GENERATION-SETTLEMENT retains ownership until exact cleanup settlement', () => {
  const trackingFirst = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  })).state;
  const tracking = reduceSession(trackingFirst, tapEvent({
    eventTimestampMs: 1_500,
    audioNow: 5.5,
  })).state;
  const idleStart = reduceSession(tracking, {
    type: 'idle-deadline',
    sessionId: tracking.sessionId,
    generationId: tracking.activeGenerationId,
    deadlineTimestampMs: tracking.silenceDeadlineTimestampMs,
  });
  assert.equal(idleStart.state.phase, 'generation-settling');
  assert.equal(idleStart.state.activeGenerationId, 1);
  assert.equal(idleStart.state.estimatorSnapshot, tracking.estimatorSnapshot);
  assert.equal(idleStart.state.predictions, tracking.predictions);
  assert.equal(idleStart.state.loadedSessionId, tracking.loadedSessionId);
  assert.equal(idleStart.state.terminalDraft, null);
  assert.deepEqual(idleStart.state.terminal, { cause: null, diagnostics: [] });
  assert.deepEqual(idleStart.effects.map(({ effectType }) => effectType), [
    'terminate-generation',
  ]);
  assert.deepEqual(idleStart.state.pendingEffects, idleStart.effects);
  assert.deepEqual(idleStart.state.generationTermination, {
    generationId: 1,
    effectId: idleStart.effects[0].effectId,
    targetPhase: 'ready',
    cause: 'unstable-silence',
  });

  const validIdleSettlement = generationSettlement(idleStart.state);
  for (const overrides of [
    { sessionId: 'session-2' },
    { generationId: 2 },
    { effectId: validIdleSettlement.effectId + 1 },
  ]) {
    assertNoOp(reduceSession(idleStart.state, {
      ...validIdleSettlement,
      ...overrides,
    }), idleStart.state);
  }
  assert.throws(() => reduceSession(idleStart.state, {
    ...validIdleSettlement,
    effectType: 'application-teardown',
  }), /cleanup settlement ownership is invalid/);
  const idleSettled = reduceSession(idleStart.state, validIdleSettlement);
  assert.equal(idleSettled.state.phase, 'ready');
  assert.equal(idleSettled.state.loadedSessionId, 'loaded-session-1');
  assert.equal(idleSettled.state.activeGenerationId, null);
  assert.equal(idleSettled.state.estimatorSnapshot, null);
  assert.equal(idleSettled.state.lastMappedTapAudioTime, null);
  assert.equal(idleSettled.state.lastAudioNow, null);
  assert.equal(idleSettled.state.outputSampleRate, null);
  assert.equal(idleSettled.state.silenceDeadlineTimestampMs, null);
  assert.deepEqual(idleSettled.state.predictions, []);
  assert.equal(idleSettled.state.nextSourceSequence, null);
  assert.equal(idleSettled.state.resumeEffectId, null);
  assert.equal(idleSettled.state.generationTermination, null);
  assert.equal(idleSettled.state.terminalDraft, null);
  assert.deepEqual(idleSettled.state.terminal, { cause: null, diagnostics: [] });
  assert.deepEqual(idleSettled.state.cleanup, { status: 'succeeded', cause: null });
  assert.deepEqual(idleSettled.state.pendingEffects, []);
  assertNoOp(reduceSession(idleSettled.state, validIdleSettlement), idleSettled.state);

  const failureTrackingFirst = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  })).state;
  const failureTracking = reduceSession(failureTrackingFirst, tapEvent({
    eventTimestampMs: 1_500,
    audioNow: 5.5,
  })).state;
  const invalidStart = reduceSession(failureTracking, tapEvent({
    eventTimestampMs: 1_500,
    audioNow: 5.6,
  }));
  assert.equal(invalidStart.state.phase, 'terminating-failure');
  assert.equal(invalidStart.state.activeGenerationId, 1);
  assert.equal(invalidStart.state.estimatorSnapshot, failureTracking.estimatorSnapshot);
  assert.equal(invalidStart.state.silenceDeadlineTimestampMs,
    failureTracking.silenceDeadlineTimestampMs);
  assert.deepEqual(invalidStart.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'cancel-deadline',
    'terminate-generation',
  ]);
  assert.deepEqual(invalidStart.state.pendingEffects, [invalidStart.effects.at(-1)]);
  assert.deepEqual(invalidStart.state.generationTermination, {
    generationId: 1,
    effectId: invalidStart.effects.at(-1).effectId,
    targetPhase: 'evidence-pending',
    cause: 'tap-timestamp-invalid',
  });
  assert.deepEqual(invalidStart.state.terminalDraft, {
    sessionId: 'session-1',
    generationId: 1,
    cause: 'tap-timestamp-invalid',
    runValue: 'session-1',
    recordKind: 'scored',
    acceptedTap: true,
    estimatedBpmExact: 120,
    matchDecision: null,
    attempts: [],
    pairedWarmedAutoFailure: null,
  });
  assert.equal(invalidStart.effects[0].payload.terminalDraft,
    invalidStart.state.terminalDraft);
  assertRecursivelyFrozen(invalidStart.state.terminalDraft);
  assertPureDataGraph(invalidStart.state.terminalDraft);

  const failedSettlementEvent = generationSettlement(invalidStart.state, {
    status: 'failed',
    cause: 'source-stop-failed',
  });
  const cleanupGetterCounter = { count: 0 };
  const accessorCleanup = Object.defineProperties({}, {
    status: {
      enumerable: true,
      get() {
        cleanupGetterCounter.count += 1;
        return 'succeeded';
      },
    },
    cause: { enumerable: true, value: null },
  });
  for (const cleanup of [
    accessorCleanup,
    { status: 'succeeded', cause: null, extra: true },
    { status: 'succeeded', cause: null, [Symbol('extra')]: true },
    { status: 'failed', cause: 'context-close-failed' },
  ]) {
    assert.throws(() => reduceSession(invalidStart.state, {
      ...failedSettlementEvent,
      cleanup,
    }), TypeError);
  }
  assert.equal(cleanupGetterCounter.count, 0);

  const draftAuthority = invalidStart.state.terminalDraft;
  const loadedSessionAuthority = invalidStart.state.loadedSessionId;
  const invalidSettled = reduceSession(invalidStart.state, failedSettlementEvent);
  assert.equal(invalidSettled.state.phase, 'terminating-failure');
  assert.equal(invalidSettled.state.resourceDisposition, 'teardown-pending');
  assert.equal(invalidSettled.state.activeGenerationId,
    invalidStart.state.activeGenerationId);
  assert.equal(invalidSettled.state.generationTermination, null);
  assert.deepEqual(invalidSettled.state.cleanup, {
    status: 'failed',
    cause: 'source-stop-failed',
  });
  assert.deepEqual(invalidSettled.state.terminal, {
    cause: 'tap-timestamp-invalid',
    diagnostics: [
      { cause: 'source-stop-failed' },
      { cause: 'generation-cleanup-failed' },
    ],
  });
  assert.equal(invalidSettled.state.terminalDraft, draftAuthority,
    'cleanup failure cannot replace the frozen first terminal authority');
  assert.equal(invalidSettled.state.terminalDraft.cause, 'tap-timestamp-invalid');
  assert.deepEqual(invalidSettled.effects.map(({ effectType }) => effectType), [
    'application-teardown',
  ]);
  assert.deepEqual(invalidSettled.state.pendingEffects, [invalidSettled.effects[0]]);
  assert.equal(invalidSettled.state.loadedSessionId, loadedSessionAuthority);
  assertNoOp(reduceSession(invalidSettled.state, failedSettlementEvent), invalidSettled.state);

  const invalidTeardownSettled = reduceSession(
    invalidSettled.state,
    teardownSettlement(invalidSettled.state),
  );
  assert.equal(invalidTeardownSettled.state.phase, 'evidence-pending');
  assert.equal(invalidTeardownSettled.state.evidence.status, 'pending');
  assert.equal(invalidTeardownSettled.state.activeGenerationId, null);
  assert.equal(invalidTeardownSettled.state.loadedSessionId, null);
  assert.deepEqual(invalidTeardownSettled.state.pendingEffects, []);
  assert.equal(invalidTeardownSettled.state.terminalDraft, draftAuthority);
  assert.deepEqual(invalidTeardownSettled.state.terminal, invalidSettled.state.terminal);
  assert.equal(invalidTeardownSettled.state.resourceDisposition, 'released');

  const tooLateRun = armCadence(Number.MAX_VALUE);
  const gridTooLate = tooLateRun.results.at(-1);
  assert.equal(gridTooLate.state.phase, 'terminating-failure');
  assert.equal(gridTooLate.state.activeGenerationId, 1);
  assert.deepEqual(gridTooLate.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'cancel-deadline',
    'terminate-generation',
  ]);
  assert.equal(gridTooLate.effects.some(({ effectType }) => (
    effectType === 'schedule-acknowledgment' || effectType === 'schedule-predictions'
  )), false);
  const gridSettled = reduceSession(
    gridTooLate.state,
    generationSettlement(gridTooLate.state),
  );
  assert.equal(gridSettled.state.phase, 'evidence-pending');
  assert.equal(gridSettled.state.terminal.cause, 'tap-grid-too-late');

  const late = armCadenceAtBpm(110);
  const beatDurationSeconds = 60 / late.estimatorSnapshot.estimatedBpmExact;
  const lateStart = reduceSession(late, lockDeadlineEvent(late, {
    audioNow: late.lastMappedTapAudioTime + 4 * beatDurationSeconds + 0.100,
  }));
  assert.equal(lateStart.state.phase, 'terminating-failure');
  assert.equal(lateStart.state.activeGenerationId, 1);
  assert.deepEqual(lateStart.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'cancel-deadline',
    'terminate-generation',
  ]);
  assert.equal(lateStart.effects[0].payload.terminalDraft, lateStart.state.terminalDraft);
  assert.equal(lateStart.state.terminalDraft.matchDecision,
    lateStart.state.matchDecision);
  assert.equal(lateStart.state.terminalDraft.cause, 'lock-timer-too-late');
});

test('T4-GENERATION-CLEANUP-FAIL-COLD-SCORED', () => {
  const coldScoredReady = readyState();
  assert.equal(coldScoredReady.runContext.thermalState, 'cold');
  assert.equal(coldScoredReady.runContext.recordKind, 'scored');
  const loadedSessionId = coldScoredReady.loadedSessionId;

  const firstTap = reduceSession(coldScoredReady, tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  })).state;
  const tracking = reduceSession(firstTap, tapEvent({
    eventTimestampMs: 1_500,
    audioNow: 5.5,
  })).state;
  const terminalStart = reduceSession(tracking, tapEvent({
    eventTimestampMs: 1_500,
    audioNow: 5.6,
  }));
  assert.equal(terminalStart.state.phase, 'terminating-failure');
  assert.equal(terminalStart.state.terminal.cause, 'tap-timestamp-invalid');
  const firstTerminalDraft = terminalStart.state.terminalDraft;

  const cleanupFailed = reduceSession(
    terminalStart.state,
    generationSettlement(terminalStart.state, {
      status: 'failed',
      cause: 'source-stop-failed',
    }),
  );
  assert.equal(cleanupFailed.state.terminal.cause, 'tap-timestamp-invalid');
  assert.equal(cleanupFailed.state.terminalDraft, firstTerminalDraft,
    'generation cleanup failure cannot replace the first terminal draft authority');
  assert.deepEqual(cleanupFailed.state.cleanup, {
    status: 'failed',
    cause: 'source-stop-failed',
  });
  assert.equal(cleanupFailed.state.terminal.diagnostics.filter(
    ({ cause }) => cause === 'source-stop-failed',
  ).length, 1);

  assert.deepEqual(
    cleanupFailed.effects.map(({ effectType }) => effectType),
    ['application-teardown'],
    'failed generation cleanup after a product terminal must emit exactly one application teardown',
  );
  const teardownEffect = cleanupFailed.effects[0];
  assert.deepEqual(teardownEffect, {
    sessionId: terminalStart.state.sessionId,
    generationId: terminalStart.state.activeGenerationId,
    effectId: teardownEffect.effectId,
    effectType: 'application-teardown',
    payload: {
      reason: 'generation-cleanup-failed',
      loadToken: null,
      loadedSessionId,
    },
  });
  assert.equal(cleanupFailed.effects.filter(
    ({ effectType }) => effectType === 'capture-terminal-draft',
  ).length, 0);
  assert.equal(cleanupFailed.state.phase, 'terminating-failure');
  assert.equal(cleanupFailed.state.resourceDisposition, 'teardown-pending');
  assert.equal(cleanupFailed.state.loadedSessionId, loadedSessionId);
  assert.deepEqual(cleanupFailed.state.pendingEffects, [teardownEffect]);
  assert.deepEqual(cleanupFailed.state.teardown, {
    reason: 'generation-cleanup-failed',
    targetPhase: 'evidence-pending',
    sessionId: teardownEffect.sessionId,
    generationId: teardownEffect.generationId,
    effectId: teardownEffect.effectId,
    effectType: teardownEffect.effectType,
  });

  const resetWhileTeardownPending = reduceSession(
    cleanupFailed.state,
    { type: 'reset-session' },
  );
  assert.notEqual(resetWhileTeardownPending.state.phase, 'ready');
  assert.equal(
    resetWhileTeardownPending.state.phase === 'ready'
      && resetWhileTeardownPending.state.loadedSessionId === loadedSessionId,
    false,
    'reset cannot reuse the teardown-owned loaded session',
  );
  assertNoOp(resetWhileTeardownPending, cleanupFailed.state);
});

test('T4-GENERATION-CLEANUP-FAIL-NO-TERMINAL', () => {
  const tracking = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  })).state;
  const generationStopping = reduceSession(tracking, {
    type: 'idle-deadline',
    sessionId: tracking.sessionId,
    generationId: tracking.activeGenerationId,
    deadlineTimestampMs: tracking.silenceDeadlineTimestampMs,
  });
  assert.equal(generationStopping.state.phase, 'generation-settling');
  assert.equal(generationStopping.state.terminal.cause, null);
  assert.equal(generationStopping.state.terminalDraft, null);

  const cleanupFailed = reduceSession(
    generationStopping.state,
    generationSettlement(generationStopping.state, {
      status: 'failed',
      cause: 'source-stop-failed',
    }),
  );
  assert.equal(cleanupFailed.state.terminal.cause, 'schedule-failed');
  assert.equal(cleanupFailed.state.terminalDraft.cause, 'schedule-failed');
  assert.deepEqual(cleanupFailed.state.cleanup, {
    status: 'failed',
    cause: 'source-stop-failed',
  });
  assert.deepEqual(cleanupFailed.state.terminal.diagnostics, [
    { cause: 'source-stop-failed' },
  ]);
  assert.deepEqual(cleanupFailed.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'application-teardown',
  ]);
  assert.equal(cleanupFailed.effects.filter(
    ({ effectType }) => effectType === 'application-teardown',
  ).length, 1);
  const teardownEffect = cleanupFailed.effects.at(-1);
  assert.equal(teardownEffect.payload.reason, 'generation-cleanup-failed');
  assert.equal(teardownEffect.payload.loadedSessionId, tracking.loadedSessionId);
  assert.equal(cleanupFailed.state.phase, 'terminating-failure');
  assert.equal(cleanupFailed.state.resourceDisposition, 'teardown-pending');
  assertNoOp(
    reduceSession(cleanupFailed.state, { type: 'reset-session' }),
    cleanupFailed.state,
  );

  const teardownSettled = reduceSession(
    cleanupFailed.state,
    teardownSettlement(cleanupFailed.state),
  );
  assert.equal(teardownSettled.state.phase, 'evidence-pending');
  assert.equal(teardownSettled.state.loadedSessionId, null);
  assert.equal(teardownSettled.state.resourceDisposition, 'released');
  assert.equal(teardownSettled.state.terminal.cause, 'schedule-failed');
  assert.deepEqual(teardownSettled.state.terminal.diagnostics, [
    { cause: 'source-stop-failed' },
  ]);
  assert.deepEqual(teardownSettled.effects, []);
});

test('T4-GENERATION-CLEANUP-FAIL-DUPLICATE', () => {
  const firstTap = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  })).state;
  const tracking = reduceSession(firstTap, tapEvent({
    eventTimestampMs: 1_500,
    audioNow: 5.5,
  })).state;
  const terminalStart = reduceSession(tracking, tapEvent({
    eventTimestampMs: 1_500,
    audioNow: 5.6,
  }));
  const firstCause = terminalStart.state.terminal.cause;
  const firstTerminalDraft = terminalStart.state.terminalDraft;
  const firstEvidence = terminalStart.state.evidence;
  const failedSettlementEvent = generationSettlement(terminalStart.state, {
    status: 'failed',
    cause: 'source-stop-failed',
  });

  const firstSettlement = reduceSession(terminalStart.state, failedSettlementEvent);
  assert.equal(firstSettlement.state.terminal.cause, firstCause);
  assert.equal(firstSettlement.state.terminalDraft, firstTerminalDraft);
  assert.equal(firstSettlement.state.evidence, firstEvidence);
  assert.equal(firstSettlement.state.terminal.diagnostics.filter(
    ({ cause }) => cause === 'source-stop-failed',
  ).length, 1);
  assert.deepEqual(firstSettlement.effects.map(({ effectType }) => effectType), [
    'application-teardown',
  ]);
  assert.equal(firstSettlement.effects.filter(
    ({ effectType }) => effectType === 'capture-terminal-draft',
  ).length, 0);

  const duplicateSettlement = reduceSession(firstSettlement.state, failedSettlementEvent);
  assertNoOp(duplicateSettlement, firstSettlement.state);
  assert.equal(duplicateSettlement.state.terminal.cause, firstCause);
  assert.equal(duplicateSettlement.state.terminalDraft, firstTerminalDraft);
  assert.equal(duplicateSettlement.state.evidence, firstEvidence);
  assert.equal(duplicateSettlement.state.terminal.diagnostics.filter(
    ({ cause }) => cause === 'source-stop-failed',
  ).length, 1);
  assert.equal(firstSettlement.effects.concat(duplicateSettlement.effects).filter(
    ({ effectType }) => effectType === 'application-teardown',
  ).length, 1);
  assert.equal(firstSettlement.effects.concat(duplicateSettlement.effects).filter(
    ({ effectType }) => effectType === 'capture-terminal-draft',
  ).length, 0);
});

test('T4-GENERATION-CLEANUP-FAIL-TEARDOWN-SETTLES', () => {
  function beginFailedGenerationCleanup() {
    const firstTap = reduceSession(readyState(), tapEvent({
      eventTimestampMs: 1_000,
      audioNow: 5,
    })).state;
    const tracking = reduceSession(firstTap, tapEvent({
      eventTimestampMs: 1_500,
      audioNow: 5.5,
    })).state;
    const terminalStart = reduceSession(tracking, tapEvent({
      eventTimestampMs: 1_500,
      audioNow: 5.6,
    }));
    const cleanupFailed = reduceSession(
      terminalStart.state,
      generationSettlement(terminalStart.state, {
        status: 'failed',
        cause: 'source-stop-failed',
      }),
    );
    return { terminalStart, cleanupFailed };
  }

  for (const teardownCleanup of [
    { status: 'succeeded', cause: null },
    { status: 'failed', cause: 'context-close-failed' },
  ]) {
    const { terminalStart, cleanupFailed } = beginFailedGenerationCleanup();
    const firstCause = terminalStart.state.terminal.cause;
    const firstTerminalDraft = terminalStart.state.terminalDraft;
    const failedGenerationDiagnostics = cleanupFailed.state.terminal.diagnostics;
    const teardownSettled = reduceSession(
      cleanupFailed.state,
      teardownSettlement(cleanupFailed.state, teardownCleanup),
    );

    assert.equal(teardownSettled.state.phase, 'evidence-pending');
    assert.equal(teardownSettled.state.loadedSessionId, null);
    assert.equal(teardownSettled.state.activeGenerationId, null);
    assert.equal(teardownSettled.state.generationTermination, null);
    assert.equal(teardownSettled.state.terminal.cause, firstCause);
    assert.equal(teardownSettled.state.terminalDraft, firstTerminalDraft);
    assert.deepEqual(
      teardownSettled.state.terminal.diagnostics,
      teardownCleanup.status === 'failed'
        ? [...failedGenerationDiagnostics, { cause: 'context-close-failed' }]
        : failedGenerationDiagnostics,
    );
    assert.deepEqual(teardownSettled.state.cleanup, teardownCleanup);
    assert.equal(
      teardownSettled.state.resourceDisposition,
      teardownCleanup.status === 'failed' ? 'release-failed' : 'released',
    );
    assert.equal(teardownSettled.state.evidence.status, 'pending');
    assert.equal(
      teardownSettled.state.evidence.terminalRecordReceiptId,
      terminalStart.state.evidence.terminalRecordReceiptId,
    );
    assert.deepEqual(teardownSettled.state.pendingEffects, []);
    assert.equal(teardownSettled.state.teardown, null);
    assert.deepEqual(teardownSettled.effects, []);
    assertNoOp(
      reduceSession(teardownSettled.state, { type: 'reset-session' }),
      teardownSettled.state,
    );

    const evidenceResolved = reduceSession(teardownSettled.state, {
      type: 'evidence-resolved',
      terminalRecordReceiptId: teardownSettled.state.evidence.terminalRecordReceiptId,
      verdict: 'intentional',
      downloaded: true,
    });
    assert.equal(evidenceResolved.state.phase, 'evidence-resolved');
    const reset = reduceSession(evidenceResolved.state, { type: 'reset-session' });
    assert.equal(reset.state.phase, 'awaiting-track');
    assert.equal(reset.state.loadedSessionId, null);
    assert.equal(reset.state.recoveryAction, 'reload');
    assert.deepEqual(reset.effects, []);
  }
});

test('T4-GENERATION-CLEANUP-SUCCESS', () => {
  const readyWithoutTerminal = readyState();
  const trackingWithoutTerminal = reduceSession(readyWithoutTerminal, tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  })).state;
  const nonTerminalStopping = reduceSession(trackingWithoutTerminal, {
    type: 'idle-deadline',
    sessionId: trackingWithoutTerminal.sessionId,
    generationId: trackingWithoutTerminal.activeGenerationId,
    deadlineTimestampMs: trackingWithoutTerminal.silenceDeadlineTimestampMs,
  });
  assert.equal(nonTerminalStopping.state.terminal.cause, null);
  const nonTerminalSuccess = reduceSession(
    nonTerminalStopping.state,
    generationSettlement(nonTerminalStopping.state),
  );
  assert.equal(nonTerminalSuccess.state.phase, 'ready');
  assert.equal(nonTerminalSuccess.state.loadedSessionId, readyWithoutTerminal.loadedSessionId);
  assert.equal(nonTerminalSuccess.state.activeGenerationId, null);
  assert.equal(nonTerminalSuccess.state.terminal.cause, null);
  assert.equal(nonTerminalSuccess.state.terminalDraft, null);
  assert.deepEqual(nonTerminalSuccess.state.cleanup, {
    status: 'succeeded',
    cause: null,
  });
  assert.equal(nonTerminalSuccess.state.resourceDisposition, 'loaded');
  assert.equal(nonTerminalSuccess.state.teardown, null);
  assert.deepEqual(nonTerminalSuccess.effects, []);
  assertNoOp(
    reduceSession(nonTerminalSuccess.state, { type: 'reset-session' }),
    nonTerminalSuccess.state,
  );

  const readyWithTerminal = readyState();
  const firstTap = reduceSession(readyWithTerminal, tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  })).state;
  const trackingWithTerminal = reduceSession(firstTap, tapEvent({
    eventTimestampMs: 1_500,
    audioNow: 5.5,
  })).state;
  const terminalStart = reduceSession(trackingWithTerminal, tapEvent({
    eventTimestampMs: 1_500,
    audioNow: 5.6,
  }));
  const firstCause = terminalStart.state.terminal.cause;
  const firstTerminalDraft = terminalStart.state.terminalDraft;
  const terminalSuccess = reduceSession(
    terminalStart.state,
    generationSettlement(terminalStart.state),
  );
  assert.equal(terminalSuccess.state.phase, 'evidence-pending');
  assert.equal(terminalSuccess.state.loadedSessionId, readyWithTerminal.loadedSessionId);
  assert.equal(terminalSuccess.state.terminal.cause, firstCause);
  assert.equal(terminalSuccess.state.terminalDraft, firstTerminalDraft);
  assert.deepEqual(terminalSuccess.state.cleanup, {
    status: 'succeeded',
    cause: null,
  });
  assert.equal(terminalSuccess.state.resourceDisposition, 'loaded');
  assert.equal(terminalSuccess.state.teardown, null);
  assert.equal(terminalSuccess.effects.some(
    ({ effectType }) => effectType === 'application-teardown',
  ), false);
  assert.deepEqual(terminalSuccess.effects, []);

  const evidenceResolved = reduceSession(terminalSuccess.state, {
    type: 'evidence-resolved',
    terminalRecordReceiptId: terminalSuccess.state.evidence.terminalRecordReceiptId,
    verdict: 'intentional',
    downloaded: true,
  });
  const reset = reduceSession(evidenceResolved.state, { type: 'reset-session' });
  assert.equal(reset.state.phase, 'ready');
  assert.equal(reset.state.loadedSessionId, readyWithTerminal.loadedSessionId);
  assert.equal(reset.state.recoveryAction, null);
  assert.deepEqual(reset.effects, []);
});

test('T4-NO-MATCH-LOCK bypasses the planner and maps excessive timer lateness', () => {
  const outside = armCadenceAtBpm(100);
  const noMatch = reduceSession(outside, lockDeadlineEvent(outside));
  assert.equal(noMatch.state.phase, 'generation-settling');
  assert.equal(noMatch.state.handoffPlan, null);
  assert.deepEqual(noMatch.state.matchDecision, {
    estimatedBpmExact: outside.estimatorSnapshot.estimatedBpmExact,
    withinApplicationWindow: false,
    actualClass: null,
    assignedClass: 'CENTER',
    assignedClassMatched: false,
  });
  assert.deepEqual(noMatch.state.pendingAttempt, {
    outcome: 'cadence-unqualified',
    generationId: 1,
    estimatedBpmExact: outside.estimatorSnapshot.estimatedBpmExact,
    actualClass: null,
    assignedClass: 'CENTER',
    assignedClassMatched: false,
  });
  assert.deepEqual(noMatch.effects.map(({ effectType }) => effectType), [
    'cancel-deadline',
    'terminate-generation',
  ]);
  assert.equal(noMatch.effects.at(-1).payload.reason, 'no-match');

  const late = armCadenceAtBpm(110);
  const beatDurationSeconds = 60 / late.estimatorSnapshot.estimatedBpmExact;
  const lateEvent = lockDeadlineEvent(late, {
    audioNow: late.lastMappedTapAudioTime + 4 * beatDurationSeconds + 0.100,
  });
  const lateResult = reduceSession(late, lateEvent);
  assert.equal(lateResult.state.phase, 'terminating-failure');
  assert.equal(lateResult.state.handoffPlan, null);
  assert.equal(lateResult.state.terminal.cause, 'lock-timer-too-late');
  assert.deepEqual(lateResult.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'cancel-deadline',
    'terminate-generation',
  ]);
  assert.equal(lateResult.effects.at(-1).payload.reason, 'lock-timer-too-late');
});

test('T4-NO-MATCH-PROTOCOL retains two retries and escalates the third attempt', () => {
  const loadedSessionId = 'loaded-session-1';
  let state = readyState();
  let frozenRunContext = null;

  for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
    const armed = armCadenceFromState(state, 100);
    assert.equal(armed.phase, 'armed');
    assert.equal(armed.activeGenerationId, attemptNumber);
    assert.equal(armed.nextGenerationId, attemptNumber + 1);
    assert.equal(armed.loadedSessionId, loadedSessionId);
    assert.equal(armed.runContext.contextFrozenAtFirstAcceptedTap, true);
    if (frozenRunContext === null) {
      frozenRunContext = armed.runContext;
    } else {
      assert.equal(armed.runContext, frozenRunContext,
        'retry must retain the genuine first-tap-frozen cold context');
    }

    const lock = reduceSession(armed, lockDeadlineEvent(armed));
    if (attemptNumber < 3) {
      assert.equal(lock.state.phase, 'generation-settling');
      assert.equal(lock.state.activeGenerationId, attemptNumber);
      assert.equal(lock.state.attempts.length, attemptNumber - 1);
      assert.equal(lock.state.pendingAttempt.generationId, attemptNumber);
      assert.equal(lock.state.terminalDraft, null);
      assert.deepEqual(lock.effects.map(({ effectType }) => effectType), [
        'cancel-deadline',
        'terminate-generation',
      ]);

      const settled = reduceSession(lock.state, generationSettlement(lock.state));
      assert.equal(settled.state.phase, 'no-match');
      assert.equal(settled.state.loadedSessionId, loadedSessionId);
      assert.equal(settled.state.activeGenerationId, null);
      assert.equal(settled.state.attempts.length, attemptNumber - 1);
      assert.equal(settled.state.pendingAttempt.generationId, attemptNumber);

      const retried = reduceSession(settled.state, { type: 'try-again' });
      assert.equal(retried.state.phase, 'ready');
      assert.equal(retried.state.loadedSessionId, loadedSessionId);
      assert.equal(retried.state.runContext, frozenRunContext);
      assert.equal(retried.state.nextGenerationId, attemptNumber + 1);
      assert.equal(retried.state.attempts.length, attemptNumber);
      assert.equal(retried.state.attempts.at(-1).generationId, attemptNumber);
      assert.equal(retried.state.attempts.at(-1).outcome, 'cadence-unqualified');
      assert.equal(retried.state.pendingAttempt, null);
      assert.equal(retried.state.matchDecision, null);
      assert.equal(retried.state.handoffPlan, null);
      assert.deepEqual(retried.effects, []);
      assertNoOp(reduceSession(retried.state, { type: 'try-again' }), retried.state);
      state = retried.state;
      continue;
    }

    assert.equal(lock.state.phase, 'terminating-failure');
    assert.equal(lock.state.activeGenerationId, 3);
    assert.equal(lock.state.pendingAttempt, null);
    assert.equal(lock.state.attempts.length, 3);
    assert.deepEqual(lock.state.attempts.map(({ generationId }) => generationId), [1, 2, 3]);
    assert.deepEqual(lock.state.attempts.map(({ outcome }) => outcome), [
      'cadence-unqualified',
      'cadence-unqualified',
      'cadence-unqualified',
    ]);
    assert.equal(lock.state.terminal.cause, 'cadence-unqualified');
    assert.equal(lock.state.terminalDraft.cause, 'cadence-unqualified');
    assert.deepEqual(lock.state.terminalDraft.attempts.map(({ generationId }) => generationId),
      [1, 2, 3]);
    assert.deepEqual(lock.effects.map(({ effectType }) => effectType), [
      'capture-terminal-draft',
      'cancel-deadline',
      'terminate-generation',
    ]);
    assert.equal(lock.effects[0].payload.terminalDraft, lock.state.terminalDraft);
    assert.equal(lock.effects.at(-1).payload.reason, 'cadence-unqualified');

    const settled = reduceSession(lock.state, generationSettlement(lock.state));
    assert.equal(settled.state.phase, 'evidence-pending');
    assert.equal(settled.state.evidence.status, 'pending');
    assert.equal(settled.state.loadedSessionId, loadedSessionId);
    assert.equal(settled.state.activeGenerationId, null);
    assert.equal(settled.state.attempts.length, 3);
    assert.equal(settled.state.terminal.cause, 'cadence-unqualified');
    assert.equal(settled.state.terminalDraft, lock.state.terminalDraft);
    assertNoOp(reduceSession(settled.state, { type: 'try-again' }), settled.state);
    assertNoOp(
      reduceSession(settled.state, generationSettlement(lock.state)),
      settled.state,
    );
  }
});

test('T4-FIRST-CAUSE-EFFECT-FAILURES owns exact callbacks and tears down only after capture', () => {
  const firstTap = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  }));
  const resumeEffect = firstTap.effects[0];
  assert.deepEqual(firstTap.state.pendingResume, {
    sessionId: 'session-1',
    generationId: 1,
    effectId: resumeEffect.effectId,
    effectType: 'resume-context',
  });

  for (const overrides of [
    { sessionId: 'session-2' },
    { generationId: 2 },
    { effectId: resumeEffect.effectId + 1 },
  ]) {
    assertNoOp(reduceSession(firstTap.state, {
      ...effectFailed(resumeEffect, 'context-resume-failed'),
      ...overrides,
    }), firstTap.state);
  }
  assert.throws(() => reduceSession(firstTap.state, {
    ...effectFailed(resumeEffect, 'context-resume-failed'),
    effectType: 'unknown-effect',
  }), TypeError);
  assert.throws(
    () => reduceSession(firstTap.state, effectFailed(resumeEffect, 'raw-resume-rejection')),
    TypeError,
  );
  const hostileFailure = effectFailed(resumeEffect, 'context-resume-failed');
  Object.defineProperty(hostileFailure, 'cause', {
    enumerable: true,
    get() {
      throw new Error('must not execute callback getters');
    },
  });
  assert.throws(() => reduceSession(firstTap.state, hostileFailure), TypeError);

  const resumeSucceeded = reduceSession(firstTap.state, effectSucceeded(resumeEffect));
  assert.equal(resumeSucceeded.state.phase, 'tracking');
  assert.equal(resumeSucceeded.state.pendingResume, null);
  assert.equal(resumeSucceeded.state.resumeEffectId, null);
  assert.deepEqual(resumeSucceeded.state.pendingEffects, [
    firstTap.effects.find(({ effectType }) => effectType === 'schedule-acknowledgment'),
  ]);
  assert.equal(resumeSucceeded.state.estimatorSnapshot, firstTap.state.estimatorSnapshot);
  assert.deepEqual(resumeSucceeded.effects, []);
  assertNoOp(
    reduceSession(resumeSucceeded.state, effectSucceeded(resumeEffect)),
    resumeSucceeded.state,
  );

  const resumeFailure = reduceSession(
    firstTap.state,
    effectFailed(resumeEffect, 'context-resume-failed'),
  );
  assert.equal(resumeFailure.state.phase, 'terminating-failure');
  assert.equal(resumeFailure.state.loadedSessionId, 'loaded-session-1');
  assert.equal(resumeFailure.state.activeGenerationId, 1);
  assert.equal(resumeFailure.state.estimatorSnapshot, firstTap.state.estimatorSnapshot);
  assert.equal(resumeFailure.state.pendingResume, firstTap.state.pendingResume);
  assert.equal(resumeFailure.state.resourceDisposition, 'teardown-pending');
  assert.equal(resumeFailure.state.terminal.cause, 'context-resume-failed');
  assert.deepEqual(resumeFailure.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'application-teardown',
  ]);
  assert.equal(resumeFailure.effects[0].payload.terminalDraft,
    resumeFailure.state.terminalDraft);
  assert.deepEqual(resumeFailure.state.pendingEffects, [resumeFailure.effects[1]]);
  assert.deepEqual(resumeFailure.state.teardown, {
    reason: 'context-resume-failed',
    targetPhase: 'evidence-pending',
    sessionId: 'session-1',
    generationId: 1,
    effectId: resumeFailure.effects[1].effectId,
    effectType: 'application-teardown',
  });

  const staleApplicationSettlement = teardownSettlement(resumeFailure.state);
  staleApplicationSettlement.generationId = 0;
  assertNoOp(
    reduceSession(resumeFailure.state, staleApplicationSettlement),
    resumeFailure.state,
  );
  const cleanupFailed = reduceSession(resumeFailure.state, teardownSettlement(
    resumeFailure.state,
    { status: 'failed', cause: 'context-close-failed' },
  ));
  assert.equal(cleanupFailed.state.phase, 'evidence-pending');
  assert.equal(cleanupFailed.state.loadedSessionId, null);
  assert.equal(cleanupFailed.state.activeGenerationId, null);
  assert.equal(cleanupFailed.state.estimatorSnapshot, null);
  assert.equal(cleanupFailed.state.handoffPlan, null);
  assert.equal(cleanupFailed.state.trackSource, null);
  assert.equal(cleanupFailed.state.terminal.cause, 'context-resume-failed');
  assert.deepEqual(cleanupFailed.state.terminal.diagnostics, [
    { cause: 'context-close-failed' },
  ]);
  assert.equal(cleanupFailed.state.terminalDraft, resumeFailure.state.terminalDraft);
  assert.equal(cleanupFailed.state.evidence.status, 'pending');
  assert.equal(cleanupFailed.state.resourceDisposition, 'release-failed');

  const armed = armCadenceAtBpm(110);
  const handoff = reduceSession(armed, lockDeadlineEvent(armed));
  const commitEffect = handoff.effects.at(-1);
  assert.deepEqual(handoff.state.pendingHandoffCommit, {
    sessionId: 'session-1',
    generationId: 1,
    effectId: commitEffect.effectId,
    effectType: 'commit-handoff-plan',
  });
  assert.deepEqual(handoff.state.pendingEffects, [
    ...armed.pendingEffects,
    commitEffect,
  ]);
  assertNoOp(reduceSession(handoff.state, {
    ...effectFailed(commitEffect, 'schedule-failed'),
    effectId: commitEffect.effectId - 1,
  }), handoff.state);
  const scheduleFailure = reduceSession(
    handoff.state,
    effectFailed(commitEffect, 'schedule-failed'),
  );
  assert.equal(scheduleFailure.state.phase, 'terminating-failure');
  assert.equal(scheduleFailure.state.terminal.cause, 'schedule-failed');
  assert.equal(scheduleFailure.state.handoffPlan, handoff.state.handoffPlan);
  assert.deepEqual(scheduleFailure.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'terminate-generation',
  ]);

  const pendingResume = firstTap.state.pendingResume;
  const idle = reduceSession(firstTap.state, {
    type: 'idle-deadline',
    sessionId: firstTap.state.sessionId,
    generationId: firstTap.state.activeGenerationId,
    deadlineTimestampMs: firstTap.state.silenceDeadlineTimestampMs,
  }).state;
  const idleSettled = reduceSession(idle, generationSettlement(idle)).state;
  assert.deepEqual(idleSettled.retiredResumes, [pendingResume]);
  const staleResumeSuccess = reduceSession(idleSettled, effectSucceeded(resumeEffect));
  assert.equal(staleResumeSuccess.state.phase, 'ready');
  assert.equal(staleResumeSuccess.state.activeGenerationId, null);
  assert.deepEqual(staleResumeSuccess.effects.map(({ effectType }) => effectType), [
    'reconcile-stale-resume',
  ]);
  assert.deepEqual(staleResumeSuccess.effects[0].payload, {
    loadedSessionId: 'loaded-session-1',
    staleGenerationId: 1,
    currentGenerationId: null,
  });
  assertPureDataGraph(staleResumeSuccess);
  assertNoOp(
    reduceSession(staleResumeSuccess.state, effectSucceeded(resumeEffect)),
    staleResumeSuccess.state,
  );

  const idleSettledForRace = reduceSession(idle, generationSettlement(idle)).state;
  const newer = reduceSession(idleSettledForRace, tapEvent({
    eventTimestampMs: 2_000,
    audioNow: 6,
  })).state;
  assert.equal(newer.activeGenerationId, 2);
  const retiredSuccessDuringNewGeneration = reduceSession(
    newer,
    effectSucceeded(resumeEffect),
  );
  assert.equal(retiredSuccessDuringNewGeneration.state.activeGenerationId, 2);
  assert.deepEqual(retiredSuccessDuringNewGeneration.state.retiredResumes, []);
  assert.deepEqual(retiredSuccessDuringNewGeneration.effects, []);
});

test('T4-RUNTIME-INTERRUPTION freezes the serial winner before generation or application cleanup', () => {
  const armed = armCadenceAtBpm(110);
  const interrupted = reduceSession(armed, {
    type: 'runtime-interrupted',
    reason: 'hidden',
    audioNow: armed.lastAudioNow + 0.010,
  });
  assert.equal(interrupted.state.phase, 'interrupted');
  assert.equal(interrupted.state.terminal.cause, 'runtime-context-interrupted');
  assert.equal(interrupted.state.activeGenerationId, 1);
  assert.equal(interrupted.state.estimatorSnapshot, armed.estimatorSnapshot);
  assert.deepEqual(interrupted.state.interruption, {
    reason: 'hidden',
    foregroundReturned: false,
    cleanupSettled: false,
  });
  assert.deepEqual(interrupted.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'cancel-deadline',
    'terminate-generation',
  ]);
  assert.equal(interrupted.effects[0].payload.terminalDraft,
    interrupted.state.terminalDraft);
  assertNoOp(
    reduceSession(interrupted.state, { type: 'unexpected-context-closed' }),
    interrupted.state,
  );
  const lateResumeFailure = reduceSession(
    interrupted.state,
    effectFailed(armed.pendingResume, 'context-resume-failed'),
  );
  assert.equal(lateResumeFailure.state.phase, 'interrupted');
  assert.equal(lateResumeFailure.state.terminal.cause, 'runtime-context-interrupted');
  assert.equal(lateResumeFailure.state.pendingResume, null);
  assert.deepEqual(lateResumeFailure.effects, []);

  const foregroundEarly = reduceSession(interrupted.state, {
    type: 'foreground-restored',
  });
  assert.equal(foregroundEarly.state.phase, 'interrupted');
  assert.equal(foregroundEarly.state.interruption.foregroundReturned, true);
  const foregroundThenSettled = reduceSession(
    foregroundEarly.state,
    generationSettlement(foregroundEarly.state),
  );
  assert.equal(foregroundThenSettled.state.phase, 'evidence-pending');
  assert.equal(foregroundThenSettled.state.evidence.status, 'pending');
  assert.equal(foregroundThenSettled.state.terminal.cause, 'runtime-context-interrupted');

  const activeAgain = armCadenceAtBpm(110);
  const interruptedAgain = reduceSession(activeAgain, {
    type: 'runtime-interrupted',
    reason: 'suspended',
    audioNow: activeAgain.lastAudioNow + 0.010,
  });
  const settledHidden = reduceSession(
    interruptedAgain.state,
    generationSettlement(interruptedAgain.state),
  );
  assert.equal(settledHidden.state.phase, 'interrupted');
  assert.equal(settledHidden.state.activeGenerationId, null);
  assert.equal(settledHidden.state.interruption.cleanupSettled, true);
  const restored = reduceSession(settledHidden.state, { type: 'foreground-restored' });
  assert.equal(restored.state.phase, 'evidence-pending');
  assert.equal(restored.state.evidence.status, 'pending');

  const active = armCadenceAtBpm(110);
  const closed = reduceSession(active, { type: 'unexpected-context-closed' });
  assert.equal(closed.state.phase, 'terminating-failure');
  assert.equal(closed.state.terminal.cause, 'runtime-context-closed');
  assert.equal(closed.state.loadedSessionId, 'loaded-session-1');
  assert.equal(closed.state.activeGenerationId, 1);
  assert.equal(closed.state.estimatorSnapshot, active.estimatorSnapshot);
  assert.equal(closed.state.handoffPlan, active.handoffPlan);
  assert.deepEqual(closed.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'application-teardown',
  ]);
  assertNoOp(reduceSession(closed.state, {
    type: 'runtime-interrupted',
    reason: 'hidden',
    audioNow: active.lastAudioNow + 0.020,
  }), closed.state);
  const closedSettled = reduceSession(closed.state, teardownSettlement(closed.state));
  assert.equal(closedSettled.state.phase, 'evidence-pending');
  assert.equal(closedSettled.state.terminal.cause, 'runtime-context-closed');
  assert.equal(closedSettled.state.loadedSessionId, null);

  const startup = reduceSession(
    reduceSession(readyState(), tapEvent({
      eventTimestampMs: 1_000,
      audioNow: 5,
    })).state,
    { type: 'startup-fatal', cause: 'startup-timeout' },
  );
  assert.equal(startup.state.terminal.cause, 'startup-timeout');
  assert.deepEqual(startup.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'application-teardown',
  ]);
  const applicationFatalBase = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  })).state;
  const applicationFatal = reduceSession(applicationFatalBase, {
    type: 'application-fatal',
    cause: 'startup-timeout',
  });
  assert.equal(applicationFatal.state.terminal.cause, 'startup-timeout');
  assert.deepEqual(applicationFatal.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'application-teardown',
  ]);
  assert.throws(() => reduceSession(active, {
    type: 'runtime-interrupted',
    reason: 'page-became-weird',
    audioNow: active.lastAudioNow + 0.030,
  }), TypeError);
  assert.throws(() => reduceSession(active, {
    type: 'startup-fatal',
    cause: 'raw-exception',
  }), TypeError);
});

function committedHandoff(run = 'session-1') {
  const armed = armCadenceAtBpm(110, run);
  const locked = reduceSession(armed, lockDeadlineEvent(armed));
  const commitEffect = locked.effects.at(-1);
  const committed = reduceSession(locked.state, effectSucceeded(commitEffect));
  return {
    armed,
    locked,
    commitEffect,
    state: committed.state,
  };
}

function trackLifecycleEvent(type, state, overrides = {}) {
  const event = {
    type,
    sessionId: state.trackSource.sessionId,
    generationId: state.trackSource.generationId,
    sourceId: state.trackSource.sourceId,
  };
  if (type === 'natural-track-end') {
    event.audioNow = state.lastAudioNow + 1;
  }
  return { ...event, ...overrides };
}

test('T4-SERIAL-LOCK-CANCEL makes queue order authoritative and owns handoff playback', () => {
  const armed = armCadenceAtBpm(110);
  const oldLockEvent = lockDeadlineEvent(armed);
  const lockFirst = reduceSession(armed, oldLockEvent);
  assert.equal(lockFirst.state.phase, 'handoff');
  assert.equal(Object.hasOwn(lockFirst.state, 'locked'), false);
  const estimatorAtLock = lockFirst.state.estimatorSnapshot;
  const cancellingTap = tapEvent({
    eventTimestampMs: armed.estimatorSnapshot.timestampWindowMs.at(-1) + 25,
    audioNow: armed.lastAudioNow + 0.025,
  });
  const cancelled = reduceSession(lockFirst.state, cancellingTap);
  assert.equal(cancelled.state.phase, 'cancelling');
  assert.equal(cancelled.state.estimatorSnapshot, estimatorAtLock);
  assert.equal(cancelled.state.estimatorSnapshot.timestampWindowMs.includes(
    cancellingTap.eventTimestampMs,
  ), false);
  assert.equal(cancelled.state.activeGenerationId, armed.activeGenerationId);
  assert.equal(cancelled.state.nextGenerationId, armed.nextGenerationId);
  assert.equal(cancelled.state.terminal.cause, 'trial-cancelled');
  assert.deepEqual(cancelled.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'terminate-generation',
  ]);
  assert.equal(cancelled.effects.some(({ effectType }) => (
    effectType === 'resume-context'
      || effectType === 'schedule-acknowledgment'
      || effectType === 'set-idle-deadline'
      || effectType === 'set-lock-deadline'
  )), false);
  assertNoOp(reduceSession(cancelled.state, {
    type: 'source-ended',
    sessionId: cancelled.state.sessionId,
    generationId: cancelled.state.activeGenerationId,
    sourceId: cancelled.state.predictions[0].sourceId,
  }), cancelled.state);

  const tapFirstEvent = tapEvent({
    eventTimestampMs: armed.estimatorSnapshot.timestampWindowMs.at(-1) + 500,
    audioNow: armed.lastAudioNow + 0.5,
  });
  const tapFirst = reduceSession(armed, tapFirstEvent);
  assert.equal(tapFirst.state.phase, 'armed');
  assert.equal(tapFirst.state.activeGenerationId, armed.activeGenerationId);
  assert.equal(tapFirst.state.estimatorSnapshot.timestampWindowMs.at(-1),
    tapFirstEvent.eventTimestampMs);
  assert.notEqual(tapFirst.state.silenceDeadlineTimestampMs,
    armed.silenceDeadlineTimestampMs);
  assertNoOp(reduceSession(tapFirst.state, oldLockEvent), tapFirst.state);

  const committed = committedHandoff();
  assert.equal(committed.state.phase, 'handoff');
  assert.equal(committed.state.pendingHandoffCommit, null);
  assert.deepEqual(committed.state.trackSource, {
    sessionId: 'session-1',
    generationId: 1,
    sourceId: 'generation-1-track-source',
  });
  assertNoOp(reduceSession(committed.state, {
    ...effectSucceeded(committed.commitEffect),
    effectId: committed.commitEffect.effectId + 1,
  }), committed.state);
  assertNoOp(reduceSession(committed.state, trackLifecycleEvent(
    'song-only-boundary',
    committed.state,
    { sourceId: 'generation-1-track-source-stale' },
  )), committed.state);
  const playing = reduceSession(
    committed.state,
    trackLifecycleEvent('song-only-boundary', committed.state),
  );
  assert.equal(playing.state.phase, 'playing');
  assert.equal(playing.state.trackSource, committed.state.trackSource);
  assert.deepEqual(playing.effects, []);
  assertNoOp(
    reduceSession(playing.state, trackLifecycleEvent('song-only-boundary', playing.state)),
    playing.state,
  );

  const settled = reduceSession(cancelled.state, generationSettlement(cancelled.state));
  assert.equal(settled.state.phase, 'evidence-pending');
  assert.equal(settled.state.activeGenerationId, null);
  assert.equal(settled.state.terminal.cause, 'trial-cancelled');
  assertNoOp(reduceSession(settled.state, cancellingTap), settled.state);
});

test('T4-SCORED-CANCELLATION-COMPLETION converges through one capture-before-stop path', () => {
  for (const phase of ['handoff', 'playing']) {
    const committed = committedHandoff();
    const active = phase === 'playing'
      ? reduceSession(
        committed.state,
        trackLifecycleEvent('song-only-boundary', committed.state),
      ).state
      : committed.state;
    const cancelled = reduceSession(active, tapEvent({
      eventTimestampMs: active.estimatorSnapshot.timestampWindowMs.at(-1) + 25,
      audioNow: active.lastAudioNow + 0.025,
    }));
    assert.equal(cancelled.state.phase, 'cancelling');
    assert.equal(cancelled.state.terminal.cause, 'trial-cancelled');
    assert.equal(cancelled.state.trackSource, active.trackSource);
    assert.deepEqual(cancelled.effects.map(({ effectType }) => effectType), [
      'capture-terminal-draft',
      'terminate-generation',
    ]);
    assert.equal(cancelled.effects[0].payload.terminalDraft,
      cancelled.state.terminalDraft);
    const generationSettled = reduceSession(
      cancelled.state,
      generationSettlement(cancelled.state, phase === 'playing'
        ? { status: 'failed', cause: 'source-stop-failed' }
        : { status: 'succeeded', cause: null }),
    );
    if (phase === 'handoff') {
      assert.equal(generationSettled.state.phase, 'evidence-pending');
      assert.equal(generationSettled.state.evidence.status, 'pending');
      assert.equal(generationSettled.state.trackSource, null);
      assert.equal(generationSettled.state.terminal.cause, 'trial-cancelled');
    } else {
      assert.equal(generationSettled.state.phase, 'terminating-failure');
      assert.equal(generationSettled.state.resourceDisposition, 'teardown-pending');
      assert.equal(generationSettled.state.terminal.cause, 'trial-cancelled');
      assert.deepEqual(generationSettled.state.terminal.diagnostics, [
        { cause: 'source-stop-failed' },
        { cause: 'generation-cleanup-failed' },
      ]);
      assert.deepEqual(generationSettled.effects.map(({ effectType }) => effectType), [
        'application-teardown',
      ]);
      assert.deepEqual(generationSettled.state.pendingEffects, [generationSettled.effects[0]]);
      assert.equal(generationSettled.state.trackSource, active.trackSource);
      assert.equal(generationSettled.state.loadedSessionId, active.loadedSessionId);

      const teardownSettled = reduceSession(
        generationSettled.state,
        teardownSettlement(generationSettled.state),
      );
      assert.equal(teardownSettled.state.phase, 'evidence-pending');
      assert.equal(teardownSettled.state.evidence.status, 'pending');
      assert.equal(teardownSettled.state.trackSource, null);
      assert.equal(teardownSettled.state.loadedSessionId, null);
      assert.equal(teardownSettled.state.terminal.cause, 'trial-cancelled');
      assert.deepEqual(teardownSettled.state.terminal.diagnostics,
        generationSettled.state.terminal.diagnostics);
      assert.equal(teardownSettled.state.resourceDisposition, 'released');
    }
  }

  const handoff = committedHandoff().state;
  assertNoOp(reduceSession(handoff, {
    type: 'end-trial',
    audioNow: handoff.lastAudioNow + 1,
  }), handoff);
  for (const completionType of ['end-trial', 'natural-track-end']) {
    const committed = committedHandoff();
    const playing = reduceSession(
      committed.state,
      trackLifecycleEvent('song-only-boundary', committed.state),
    ).state;
    const completionEvent = completionType === 'end-trial'
      ? { type: 'end-trial', audioNow: playing.lastAudioNow + 1 }
      : trackLifecycleEvent('natural-track-end', playing);
    const completing = reduceSession(playing, completionEvent);
    assert.equal(completing.state.phase, 'cancelling');
    assert.equal(completing.state.terminal.cause, 'trial-complete');
    assert.equal(completing.state.trackSource, playing.trackSource);
    assert.deepEqual(completing.effects.map(({ effectType }) => effectType), [
      'capture-terminal-draft',
      'terminate-generation',
    ]);
    assertNoOp(reduceSession(completing.state, completionType === 'end-trial'
      ? trackLifecycleEvent('natural-track-end', playing)
      : { type: 'end-trial', audioNow: playing.lastAudioNow + 1 }), completing.state);
    const settled = reduceSession(
      completing.state,
      generationSettlement(completing.state),
    );
    assert.equal(settled.state.phase, 'evidence-pending');
    assert.equal(settled.state.terminal.cause, 'trial-complete');
    assert.equal(settled.state.trackSource, null);
  }
});

test('T4-SMOKE-CANCELLATION-PROBE requires a later tap and exactly settles replacement ownership', () => {
  for (const run of ['smoke-crossfade', 'smoke-playing']) {
    const committed = committedHandoff(run);
    const active = run === 'smoke-playing'
      ? reduceSession(
        committed.state,
        trackLifecycleEvent('song-only-boundary', committed.state),
      ).state
      : committed.state;
    const cancellationTimestampMs = active.estimatorSnapshot.timestampWindowMs.at(-1) + 25;
    const cancellationTap = tapEvent({
      eventTimestampMs: cancellationTimestampMs,
      audioNow: active.lastAudioNow + 0.025,
    });
    const cancelling = reduceSession(active, cancellationTap);
    assert.equal(cancelling.state.phase, 'cancelling');
    assert.equal(cancelling.state.estimatorSnapshot, active.estimatorSnapshot);
    assert.equal(cancelling.state.activeGenerationId, 1);
    assert.equal(cancelling.state.terminal.cause, 'trial-cancelled');
    assert.deepEqual(cancelling.state.smokeProbe, {
      status: 'cancellation-settling',
      cancellationPhase: run === 'smoke-crossfade' ? 'crossfade' : 'playing',
      cancellationGenerationId: 1,
      cancellationTapTimestampMs: cancellationTimestampMs,
      replacementGenerationId: null,
      acknowledgmentEffectId: null,
      probeEffectId: null,
      probeSourceId: null,
      holdMilliseconds: null,
      rampMilliseconds: null,
      stopMilliseconds: null,
      probeCleanup: null,
    });

    const ready = reduceSession(
      cancelling.state,
      generationSettlement(cancelling.state),
    );
    assert.equal(ready.state.phase, 'ready');
    assert.equal(ready.state.activeGenerationId, null);
    assert.equal(ready.state.evidence.status, 'terminal-captured');
    assert.equal(ready.state.evidence.terminalRecordReceiptId,
      `terminal-record-${run}-generation-1`);
    assert.equal(ready.state.terminal.cause, 'trial-cancelled');
    assert.equal(ready.state.terminalDraft, cancelling.state.terminalDraft);
    assert.deepEqual(ready.state.smokeProbe, {
      ...cancelling.state.smokeProbe,
      status: 'awaiting-tap',
    });
    assertNoOp(reduceSession(ready.state, { type: 'unload-track' }), ready.state);

    assertNoOp(reduceSession(ready.state, tapEvent({
      eventTimestampMs: cancellationTimestampMs,
      audioNow: active.lastAudioNow + 0.050,
    })), ready.state);
    const replacementTap = tapEvent({
      eventTimestampMs: cancellationTimestampMs + 1,
      audioNow: active.lastAudioNow + 0.051,
    });
    const probing = reduceSession(ready.state, replacementTap);
    assert.equal(probing.state.phase, 'smoke-probing');
    assert.equal(probing.state.activeGenerationId, 2);
    assert.equal(probing.state.nextGenerationId, 3);
    assert.equal(probing.state.estimatorSnapshot, null);
    assert.deepEqual(probing.state.predictions, []);
    assert.equal(probing.state.silenceDeadlineTimestampMs, null);
    assert.deepEqual(probing.effects.map(({ effectType }) => effectType), [
      'resume-context',
      'schedule-acknowledgment',
      'run-smoke-probe',
    ]);
    assert.equal(probing.effects.filter(({ effectType }) => (
      effectType === 'schedule-acknowledgment'
    )).length, 1);
    assert.equal(probing.effects.some(({ effectType }) => (
      effectType === 'set-idle-deadline'
        || effectType === 'set-lock-deadline'
        || effectType === 'schedule-predictions'
    )), false);
    const probeEffect = probing.effects.at(-1);
    assert.deepEqual(probeEffect.payload, {
      loadedSessionId: 'loaded-session-1',
      sourceId: 'generation-2-source-1',
      tapTimestampMs: cancellationTimestampMs + 1,
      mappedTapAudioTime: replacementTap.mappedTapAudioTime,
      scheduledAudioTime: replacementTap.audioNow + 0.005,
      holdMilliseconds: 250,
      rampMilliseconds: 20,
      stopMilliseconds: 25,
    });
    assert.deepEqual(probing.state.smokeProbe, {
      status: 'probe-pending',
      cancellationPhase: run === 'smoke-crossfade' ? 'crossfade' : 'playing',
      cancellationGenerationId: 1,
      cancellationTapTimestampMs: cancellationTimestampMs,
      replacementGenerationId: 2,
      acknowledgmentEffectId: probing.effects[1].effectId,
      probeEffectId: probeEffect.effectId,
      probeSourceId: 'generation-2-source-1',
      holdMilliseconds: 250,
      rampMilliseconds: 20,
      stopMilliseconds: 25,
      probeCleanup: null,
    });
    assert.deepEqual(probing.state.pendingEffects, [
      probing.effects[0],
      probing.effects[1],
      probeEffect,
    ]);
    const acknowledgmentFailure = reduceSession(
      probing.state,
      effectFailed(probing.effects[1], 'schedule-failed'),
    );
    assert.equal(acknowledgmentFailure.state.phase, 'terminating-failure');
    assert.equal(acknowledgmentFailure.state.terminal.cause, 'trial-cancelled');
    assert.deepEqual(acknowledgmentFailure.state.terminal.diagnostics, [
      { cause: 'schedule-failed' },
    ]);
    assert.equal(acknowledgmentFailure.state.terminalDraft, probing.state.terminalDraft);
    assert.deepEqual(
      acknowledgmentFailure.effects.map(({ effectType }) => effectType),
      ['terminate-generation'],
    );
    assert.equal(acknowledgmentFailure.effects[0].payload.reason, 'schedule-failed');

    const resumeFailure = reduceSession(
      probing.state,
      effectFailed(probing.effects[0], 'context-resume-failed'),
    );
    assert.equal(resumeFailure.state.phase, 'terminating-failure');
    assert.equal(resumeFailure.state.terminal.cause, 'trial-cancelled');
    assert.deepEqual(resumeFailure.state.terminal.diagnostics, [
      { cause: 'context-resume-failed' },
    ]);
    assert.equal(resumeFailure.state.terminalDraft, probing.state.terminalDraft);
    assert.equal(resumeFailure.state.evidence, probing.state.evidence);
    assert.deepEqual(
      resumeFailure.effects.map(({ effectType }) => effectType),
      ['application-teardown'],
    );
    assert.equal(resumeFailure.effects[0].payload.reason, 'context-resume-failed');
    const resumeFailureSettled = reduceSession(
      resumeFailure.state,
      teardownSettlement(resumeFailure.state),
    );
    assert.equal(resumeFailureSettled.state.phase, 'evidence-pending');
    assert.equal(resumeFailureSettled.state.loadedSessionId, null);
    assert.equal(resumeFailureSettled.state.activeGenerationId, null);
    assert.equal(resumeFailureSettled.state.terminal.cause, 'trial-cancelled');
    assert.deepEqual(resumeFailureSettled.state.terminal.diagnostics, [
      { cause: 'context-resume-failed' },
    ]);
    assertNoOp(reduceSession(
      resumeFailureSettled.state,
      effectFailed(probing.effects[0], 'context-resume-failed'),
    ), resumeFailureSettled.state);
    assertNoOp(reduceSession(probing.state, replacementTap), probing.state);

    const staleProbeSettlement = {
      type: 'smoke-probe-settled',
      sessionId: probeEffect.sessionId,
      generationId: probeEffect.generationId,
      effectId: probeEffect.effectId + 1,
      effectType: probeEffect.effectType,
      cleanup: { status: 'succeeded', cause: null },
    };
    assertNoOp(reduceSession(probing.state, staleProbeSettlement), probing.state);
    const probeSettlement = {
      ...staleProbeSettlement,
      effectId: probeEffect.effectId,
      cleanup: run === 'smoke-playing'
        ? { status: 'failed', cause: 'source-stop-failed' }
        : { status: 'succeeded', cause: null },
    };
    const settled = reduceSession(probing.state, probeSettlement);
    assert.equal(settled.state.phase, 'evidence-pending');
    assert.equal(settled.state.activeGenerationId, null);
    assert.deepEqual(settled.state.smokeProbe, {
      status: 'completed',
      cancellationPhase: run === 'smoke-crossfade' ? 'crossfade' : 'playing',
      cancellationGenerationId: 1,
      cancellationTapTimestampMs: cancellationTimestampMs,
      replacementGenerationId: 2,
      acknowledgmentEffectId: probing.effects[1].effectId,
      probeEffectId: probeEffect.effectId,
      probeSourceId: 'generation-2-source-1',
      holdMilliseconds: 250,
      rampMilliseconds: 20,
      stopMilliseconds: 25,
      probeCleanup: probeSettlement.cleanup,
    });
    assert.equal(settled.state.pendingResume, null);
    assert.deepEqual(settled.state.pendingEffects, []);
    assert.equal(settled.state.terminal.cause, 'trial-cancelled');
    if (run === 'smoke-playing') {
      assert.deepEqual(settled.state.terminal.diagnostics, [
        { cause: 'source-stop-failed' },
      ]);
    }
    assertNoOp(reduceSession(settled.state, probeSettlement), settled.state);
    assertPureDataGraph(settled);
    assertRecursivelyFrozen(settled);
  }
});

test('T4-EVIDENCE-RESET-ADVANCEMENT gates warmed context and preserves paired auto-failure', () => {
  const coldCommitted = committedHandoff();
  const coldPlaying = reduceSession(
    coldCommitted.state,
    trackLifecycleEvent('song-only-boundary', coldCommitted.state),
  ).state;
  const coldCompleting = reduceSession(coldPlaying, {
    type: 'end-trial',
    audioNow: coldPlaying.lastAudioNow + 1,
  });
  assert.equal(coldCompleting.state.evidence.status, 'terminal-captured');
  assert.equal(coldCompleting.state.evidence.downloaded, false);
  assert.match(coldCompleting.state.evidence.terminalRecordReceiptId,
    /^terminal-record-session-1-generation-[1-9][0-9]*$/);
  assert.equal(coldCompleting.state.terminalDraft.pairedWarmedAutoFailure, null);
  const coldPending = reduceSession(
    coldCompleting.state,
    generationSettlement(coldCompleting.state),
  ).state;
  assert.equal(coldPending.phase, 'evidence-pending');
  assertNoOp(reduceSession(coldPending, { type: 'reset-session' }), coldPending);
  assertNoOp(reduceSession(coldPending, {
    type: 'evidence-resolved',
    terminalRecordReceiptId: 'terminal-record-session-1-generation-999',
    verdict: 'intentional',
    downloaded: true,
  }), coldPending);
  const resolved = reduceSession(coldPending, {
    type: 'evidence-resolved',
    terminalRecordReceiptId: coldPending.evidence.terminalRecordReceiptId,
    verdict: 'intentional',
    downloaded: true,
  });
  assert.equal(resolved.state.phase, 'evidence-resolved');
  assert.deepEqual(resolved.state.evidence, {
    status: 'resolved',
    terminalRecordReceiptId: coldPending.evidence.terminalRecordReceiptId,
    verdict: 'intentional',
    downloaded: true,
  });
  const warmed = reduceSession(resolved.state, { type: 'reset-session' });
  assert.equal(warmed.state.phase, 'ready');
  assert.equal(warmed.state.loadedSessionId, 'loaded-session-1');
  assert.equal(warmed.state.runContext.runValue, 'session-1');
  assert.equal(warmed.state.runContext.thermalState, 'warmed');
  assert.equal(warmed.state.runContext.contextFrozenAtFirstAcceptedTap, false);
  assert.equal(warmed.state.runContext.assignedClass, 'LOW_EDGE');
  assert.deepEqual(warmed.state.evidence, {
    status: 'none',
    terminalRecordReceiptId: null,
    verdict: null,
    downloaded: false,
  });
  assert.equal(warmed.state.terminalDraft, null);
  assert.equal(warmed.state.pairedWarmedAutoFailure, null);
  assert.deepEqual(warmed.effects, []);
  assertNoOp(reduceSession(warmed.state, { type: 'reset-session' }), warmed.state);

  const warmedFirstTap = reduceSession(warmed.state, tapEvent({
    eventTimestampMs: 5_000,
    audioNow: 9,
  }));
  const warmedFailure = reduceSession(warmedFirstTap.state, tapEvent({
    eventTimestampMs: 5_200,
    observedNowMs: 5_400,
    audioNow: 9.2,
  }));
  const warmedPending = reduceSession(
    warmedFailure.state,
    generationSettlement(warmedFailure.state),
  ).state;
  const warmedResolved = reduceSession(warmedPending, {
    type: 'evidence-resolved',
    terminalRecordReceiptId: warmedPending.evidence.terminalRecordReceiptId,
    verdict: 'not-judged',
    downloaded: true,
  }).state;
  const warmedReset = reduceSession(warmedResolved, { type: 'reset-session' });
  assert.equal(warmedReset.state.phase, 'teardown-in-progress');
  assert.equal(warmedReset.state.loadedSessionId, 'loaded-session-1');
  assert.deepEqual(warmedReset.effects.map(({ effectType }) => effectType), [
    'application-teardown',
  ]);
  assert.equal(warmedReset.effects[0].payload.reason, 'protocol-reset');
  const failedWarmedRelease = reduceSession(
    warmedReset.state,
    teardownSettlement(warmedReset.state, {
      status: 'failed',
      cause: 'context-close-failed',
    }),
  );
  assert.equal(failedWarmedRelease.state.phase, 'error');
  assert.equal(failedWarmedRelease.state.recoveryAction, 'reload');
  assert.equal(failedWarmedRelease.state.resourceDisposition, 'release-failed');
  assertNoOp(
    reduceSession(failedWarmedRelease.state, { type: 'choose-track' }),
    failedWarmedRelease.state,
  );
  const warmedReleased = reduceSession(
    warmedReset.state,
    teardownSettlement(warmedReset.state),
  );
  assert.equal(warmedReleased.state.phase, 'awaiting-track');
  assert.equal(warmedReleased.state.loadedSessionId, null);
  assert.equal(warmedReleased.state.recoveryAction, 'reload');
  assert.deepEqual(warmedReleased.state.evidence, {
    status: 'none',
    terminalRecordReceiptId: null,
    verdict: null,
    downloaded: false,
  });

  const coldFirstTap = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  }));
  const fatal = reduceSession(
    coldFirstTap.state,
    effectFailed(coldFirstTap.effects[0], 'context-resume-failed'),
  );
  assert.equal(fatal.state.phase, 'terminating-failure');
  assert.deepEqual(fatal.state.pairedWarmedAutoFailure, {
    cause: 'paired-session-unavailable',
    runValue: 'session-1',
    slot: 2,
    thermalState: 'warmed',
    assignedClass: 'LOW_EDGE',
  });
  assert.equal(fatal.state.terminalDraft.pairedWarmedAutoFailure,
    fatal.state.pairedWarmedAutoFailure);
  assert.equal(fatal.effects[0].payload.terminalDraft, fatal.state.terminalDraft);
  const fatalPending = reduceSession(fatal.state, teardownSettlement(fatal.state)).state;
  assert.equal(fatalPending.loadedSessionId, null);
  assert.equal(fatalPending.phase, 'evidence-pending');
  const fatalResolved = reduceSession(fatalPending, {
    type: 'evidence-resolved',
    terminalRecordReceiptId: fatalPending.evidence.terminalRecordReceiptId,
    verdict: 'not-judged',
    downloaded: true,
  }).state;
  const fatalReset = reduceSession(fatalResolved, { type: 'reset-session' });
  assert.equal(fatalReset.state.phase, 'awaiting-track');
  assert.equal(fatalReset.state.recoveryAction, 'reload');
  assert.equal(fatalReset.state.pairedWarmedAutoFailure, null);
  assert.deepEqual(fatalReset.effects, []);

  assert.throws(() => reduceSession(coldPending, {
    type: 'evidence-resolved',
    terminalRecordReceiptId: coldPending.evidence.terminalRecordReceiptId,
    verdict: 'maybe',
    downloaded: true,
  }), TypeError);
  assert.throws(() => reduceSession(coldPending, {
    type: 'evidence-resolved',
    terminalRecordReceiptId: coldPending.evidence.terminalRecordReceiptId,
    verdict: 'intentional',
    downloaded: false,
  }), TypeError);
});

test('T4-REVIEW-PROVENANCE-CLOSURE rejects forged authorities and malformed settlement headers', () => {
  const forgedWarmedContext = Object.freeze({
    runValue: 'session-1',
    session: 'session-1',
    slot: 2,
    thermalState: 'warmed',
    assignedClass: 'LOW_EDGE',
    recordKind: 'scored',
    cancellationPhase: null,
    scored: true,
    contextFrozenAtFirstAcceptedTap: false,
  });
  assert.throws(
    () => createInitialSessionState(forgedWarmedContext),
    /genuine run context/,
  );

  const counterfeitPlan = Object.freeze({
    generationId: 'generation-1',
    assetIdentity: ASSET_IDENTITY,
    experimentConfigIdentity: EXPERIMENT_CONFIG_IDENTITY,
  });
  assert.throws(() => createDeclarativeEffect({
    sessionId: 'session-1',
    generationId: 1,
    effectId: 1,
    effectType: 'commit-handoff-plan',
    payload: { plan: counterfeitPlan },
  }), /genuine handoff plan/);

  const tracking = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  })).state;
  const settling = reduceSession(tracking, {
    type: 'idle-deadline',
    sessionId: tracking.sessionId,
    generationId: tracking.activeGenerationId,
    deadlineTimestampMs: tracking.silenceDeadlineTimestampMs,
  }).state;
  const validSettlement = generationSettlement(settling);
  for (const malformed of [
    { ...validSettlement, generationId: 0 },
    { ...validSettlement, effectType: 'application-teardown' },
    { ...validSettlement, effectType: 'not-a-closed-effect-type' },
  ]) {
    assert.throws(
      () => reduceSession(settling, malformed),
      /cleanup settlement ownership is invalid/,
    );
  }
});

test('T4-REVIEW-EVIDENCE-CONTROLS uses the approved verdict enum and permits resolved Unload', () => {
  const firstTap = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  })).state;
  const terminating = reduceSession(firstTap, tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5.1,
  })).state;
  const evidencePending = reduceSession(
    terminating,
    generationSettlement(terminating),
  ).state;
  assert.equal(evidencePending.phase, 'evidence-pending');

  const receiptId = evidencePending.evidence.terminalRecordReceiptId;
  assert.throws(() => reduceSession(evidencePending, {
    type: 'evidence-resolved',
    terminalRecordReceiptId: receiptId,
    verdict: 'not-intentional',
    downloaded: true,
  }), /closed verdict/);
  const resolved = reduceSession(evidencePending, {
    type: 'evidence-resolved',
    terminalRecordReceiptId: receiptId,
    verdict: 'mechanical',
    downloaded: true,
  });
  assert.equal(resolved.state.phase, 'evidence-resolved');
  assert.equal(resolved.state.evidence.verdict, 'mechanical');

  const unloading = reduceSession(resolved.state, { type: 'unload-track' });
  assert.equal(unloading.state.phase, 'teardown-in-progress');
  assert.equal(unloading.state.teardown.reason, 'unload-track');
  assert.deepEqual(unloading.effects.map(({ effectType }) => effectType), [
    'application-teardown',
  ]);
});

test('T4-REVIEW-EFFECT-OWNERSHIP reconciles resumes and owns source scheduling failures', () => {
  const firstTap = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  }));
  const resumeEffect = firstTap.effects.find(({ effectType }) => effectType === 'resume-context');
  const acknowledgmentEffect = firstTap.effects.find(
    ({ effectType }) => effectType === 'schedule-acknowledgment',
  );
  assert.ok(resumeEffect);
  assert.ok(acknowledgmentEffect);

  const settling = reduceSession(firstTap.state, {
    type: 'idle-deadline',
    sessionId: firstTap.state.sessionId,
    generationId: firstTap.state.activeGenerationId,
    deadlineTimestampMs: firstTap.state.silenceDeadlineTimestampMs,
  }).state;
  const resumeBeforeCleanup = reduceSession(settling, effectSucceeded(resumeEffect));
  assert.equal(resumeBeforeCleanup.state.phase, 'generation-settling');
  assert.equal(resumeBeforeCleanup.state.pendingResume, null);
  assert.deepEqual(resumeBeforeCleanup.effects.map(({ effectType }) => effectType), [
    'reconcile-stale-resume',
  ]);
  assert.deepEqual(resumeBeforeCleanup.effects[0].payload, {
    loadedSessionId: 'loaded-session-1',
    staleGenerationId: 1,
    currentGenerationId: null,
  });
  const settledAfterResume = reduceSession(
    resumeBeforeCleanup.state,
    generationSettlement(resumeBeforeCleanup.state),
  );
  assert.deepEqual(settledAfterResume.state.retiredResumes, []);

  const settledBeforeResume = reduceSession(
    settling,
    generationSettlement(settling),
  );
  assert.equal(settledBeforeResume.state.retiredResumes.length, 1);
  const resumeAfterCleanup = reduceSession(
    settledBeforeResume.state,
    effectSucceeded(resumeEffect),
  );
  assert.deepEqual(resumeAfterCleanup.state.retiredResumes, []);
  assert.deepEqual(resumeAfterCleanup.effects.map(({ effectType }) => effectType), [
    'reconcile-stale-resume',
  ]);

  const newerGeneration = reduceSession(settledBeforeResume.state, tapEvent({
    eventTimestampMs: 2_000,
    audioNow: 6,
  })).state;
  const oldResumeDuringNewGeneration = reduceSession(
    newerGeneration,
    effectSucceeded(resumeEffect),
  );
  assert.deepEqual(oldResumeDuringNewGeneration.state.retiredResumes, []);
  assert.deepEqual(oldResumeDuringNewGeneration.effects, []);

  const schedulingFailure = reduceSession(
    firstTap.state,
    effectFailed(acknowledgmentEffect, 'schedule-failed'),
  );
  assert.equal(schedulingFailure.state.phase, 'terminating-failure');
  assert.equal(schedulingFailure.state.terminal.cause, 'schedule-failed');
  assert.deepEqual(schedulingFailure.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'cancel-deadline',
    'terminate-generation',
  ]);

  const schedulingSuccess = reduceSession(
    firstTap.state,
    effectSucceeded(acknowledgmentEffect),
  );
  assert.deepEqual(schedulingSuccess.effects, []);
  assertNoOp(reduceSession(
    schedulingSuccess.state,
    effectFailed(acknowledgmentEffect, 'schedule-failed'),
  ), schedulingSuccess.state);

  const secondTap = reduceSession(firstTap.state, tapEvent({
    eventTimestampMs: 1_500,
    audioNow: 5.5,
  }));
  const secondAcknowledgment = secondTap.effects.find(
    ({ effectType }) => effectType === 'schedule-acknowledgment',
  );
  assert.ok(secondAcknowledgment);
  assert.equal(secondTap.state.pendingEffects.includes(acknowledgmentEffect), false,
    'the serial coordinator settles the prior scheduling batch before a later activation');
  assert.equal(secondTap.state.pendingEffects.includes(secondAcknowledgment), true);
  assertNoOp(reduceSession(
    secondTap.state,
    effectFailed(acknowledgmentEffect, 'schedule-failed'),
  ), secondTap.state);
  const currentSchedulingFailure = reduceSession(
    secondTap.state,
    effectFailed(secondAcknowledgment, 'schedule-failed'),
  );
  assert.equal(currentSchedulingFailure.state.phase, 'terminating-failure');
  assert.equal(currentSchedulingFailure.state.terminal.cause, 'schedule-failed');

  const armed = armCadenceAtBpm(120);
  const predictionEffect = armed.pendingEffects.find(
    ({ effectType }) => effectType === 'schedule-predictions',
  );
  assert.ok(predictionEffect);
  const predictionFailure = reduceSession(
    armed,
    effectFailed(predictionEffect, 'schedule-failed'),
  );
  assert.equal(predictionFailure.state.phase, 'terminating-failure');
  assert.equal(predictionFailure.state.terminal.cause, 'schedule-failed');
});

test('T4-REVIEW-FAIL-CLOSED-CLEANUP makes cleanup failure terminal or reload-only', () => {
  const firstTap = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  })).state;
  const settling = reduceSession(firstTap, {
    type: 'idle-deadline',
    sessionId: firstTap.sessionId,
    generationId: firstTap.activeGenerationId,
    deadlineTimestampMs: firstTap.silenceDeadlineTimestampMs,
  }).state;
  const failedGenerationCleanup = reduceSession(
    settling,
    generationSettlement(settling, {
      status: 'failed',
      cause: 'source-stop-failed',
    }),
  );
  assert.equal(failedGenerationCleanup.state.phase, 'terminating-failure');
  assert.equal(failedGenerationCleanup.state.terminal.cause, 'schedule-failed');
  assert.deepEqual(failedGenerationCleanup.state.terminal.diagnostics, [
    { cause: 'source-stop-failed' },
  ]);
  assert.equal(failedGenerationCleanup.state.activeGenerationId, 1);
  assert.equal(failedGenerationCleanup.state.evidence.status, 'terminal-captured');
  assert.deepEqual(failedGenerationCleanup.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'application-teardown',
  ]);
  assert.equal(failedGenerationCleanup.effects[0].payload.terminalDraft,
    failedGenerationCleanup.state.terminalDraft);

  const failedFinalClose = reduceSession(
    failedGenerationCleanup.state,
    teardownSettlement(failedGenerationCleanup.state, {
      status: 'failed',
      cause: 'context-close-failed',
    }),
  );
  assert.equal(failedFinalClose.state.phase, 'evidence-pending');
  assert.equal(failedFinalClose.state.recoveryAction, 'reload');
  assert.equal(failedFinalClose.state.resourceDisposition, 'release-failed');
  assert.deepEqual(failedFinalClose.state.terminal.diagnostics, [
    { cause: 'source-stop-failed' },
    { cause: 'context-close-failed' },
  ]);

  const cancelledLoading = reduceSession(beginLoading().state, {
    type: 'cancel-loading',
  }).state;
  const failedLoadingClose = reduceSession(
    cancelledLoading,
    teardownSettlement(cancelledLoading, {
      status: 'failed',
      cause: 'context-close-failed',
    }),
  );
  assert.equal(failedLoadingClose.state.phase, 'error');
  assert.equal(failedLoadingClose.state.recoveryAction, 'reload');
  assert.equal(failedLoadingClose.state.resourceDisposition, 'release-failed');
  assertNoOp(
    reduceSession(failedLoadingClose.state, { type: 'choose-track' }),
    failedLoadingClose.state,
  );

  const unloading = reduceSession(readyState(), { type: 'unload-track' }).state;
  const failedUnloadClose = reduceSession(
    unloading,
    teardownSettlement(unloading, {
      status: 'failed',
      cause: 'context-close-failed',
    }),
  );
  assert.equal(failedUnloadClose.state.phase, 'error');
  assert.equal(failedUnloadClose.state.recoveryAction, 'reload');
  assert.equal(failedUnloadClose.state.resourceDisposition, 'release-failed');
  assertNoOp(
    reduceSession(failedUnloadClose.state, { type: 'choose-track' }),
    failedUnloadClose.state,
  );
});

test('T4-REVIEW-INVALID-TIMING-BOUNDARY keeps non-finite values out of pure events', () => {
  const active = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  })).state;
  assert.throws(() => reduceSession(active, {
    ...tapEvent({ eventTimestampMs: Number.NaN, audioNow: 5.1 }),
    mappedTapAudioTime: Number.NaN,
  }), /tap clock values are invalid/);
  for (const audioNow of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.throws(() => reduceSession(active, {
      type: 'tap-timing-invalid',
      audioNow,
    }), /teardown clock is invalid/);
  }
  const terminated = reduceSession(active, {
    type: 'tap-timing-invalid',
    audioNow: 5.1,
  });
  assert.equal(terminated.state.phase, 'terminating-failure');
  assert.equal(terminated.state.terminal.cause, 'tap-timestamp-invalid');
  assert.deepEqual(terminated.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'cancel-deadline',
    'terminate-generation',
  ]);
});

test('T8-ROLLBACK-FAULT-POLICY-HANDOFF', () => {
  const firstTap = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  }));
  const acknowledgmentEffect = firstTap.effects.find(
    ({ effectType }) => effectType === 'schedule-acknowledgment',
  );
  assert.notEqual(acknowledgmentEffect, undefined);
  assert.equal(firstTap.state.terminal.cause, null);
  assert.equal(firstTap.state.terminalDraft, null);

  const failed = reduceSession(
    firstTap.state,
    effectFailed(acknowledgmentEffect, 'schedule-failed'),
  );
  assert.equal(failed.state.phase, 'terminating-failure');
  assert.deepEqual(failed.state.terminal, {
    cause: 'schedule-failed',
    diagnostics: [],
  });
  assert.equal(failed.state.terminalDraft.cause, 'schedule-failed');
  assert.equal(Object.isFrozen(failed.state.terminalDraft), true);
  assert.deepEqual(failed.effects.map(({ effectType }) => effectType), [
    'capture-terminal-draft',
    'cancel-deadline',
    'terminate-generation',
  ]);
  assert.equal(failed.effects[0].payload.terminalDraft, failed.state.terminalDraft);
  const terminateEffect = failed.effects.at(-1);
  assert.deepEqual(terminateEffect.payload, {
    reason: 'schedule-failed',
    audioNow: firstTap.state.lastAudioNow,
  });
  assert.deepEqual(failed.state.generationTermination, {
    generationId: firstTap.state.activeGenerationId,
    effectId: terminateEffect.effectId,
    targetPhase: 'evidence-pending',
    cause: 'schedule-failed',
  });
  assert.deepEqual(failed.state.pendingEffects, [terminateEffect]);
  assert.equal(
    failed.effects.some(({ effectType }) => effectType === 'application-teardown'),
    false,
  );
  assertNoOp(
    reduceSession(failed.state, effectFailed(acknowledgmentEffect, 'schedule-failed')),
    failed.state,
  );
});

test('T8-CLEANUP-FAULT-FACT-POLICY', () => {
  const tracking = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  })).state;
  const armed = armCadenceAtBpm(110);
  const handoff = reduceSession(armed, lockDeadlineEvent(armed)).state;
  const committed = committedHandoff();
  const playing = reduceSession(
    committed.state,
    trackLifecycleEvent('song-only-boundary', committed.state),
  ).state;

  for (const active of [tracking, armed, handoff, playing]) {
    const fact = Object.freeze({
      type: 'generation-cleanup-faulted',
      sessionId: active.sessionId,
      generationId: active.activeGenerationId,
      sourceId: 'unregistered-source',
      cause: 'source-stop-failed',
    });
    let faulted;
    assert.doesNotThrow(() => {
      faulted = reduceSession(active, fact);
    });

    const ownsDeadline = active.silenceDeadlineTimestampMs !== null;
    assert.equal(faulted.state.phase, 'terminating-failure');
    assert.equal(faulted.state.terminal.cause, 'schedule-failed');
    assert.equal(faulted.state.terminalDraft.cause, 'schedule-failed');
    assert.equal(faulted.state.evidence.status, 'terminal-captured');
    assert.deepEqual(faulted.state.generationTermination, {
      generationId: active.activeGenerationId,
      effectId: active.nextEffectId + (ownsDeadline ? 2 : 1),
      targetPhase: 'evidence-pending',
      cause: 'schedule-failed',
    });
    const expectedEffects = [
      expectedEffect(active, active.nextEffectId, active.activeGenerationId,
        'capture-terminal-draft', {
          terminalDraft: faulted.state.terminalDraft,
        }),
    ];
    if (ownsDeadline) {
      expectedEffects.push(expectedEffect(
        active,
        active.nextEffectId + 1,
        active.activeGenerationId,
        'cancel-deadline',
        { deadlineTimestampMs: active.silenceDeadlineTimestampMs },
      ));
    }
    expectedEffects.push(expectedEffect(
      active,
      active.nextEffectId + (ownsDeadline ? 2 : 1),
      active.activeGenerationId,
      'terminate-generation',
      { reason: 'schedule-failed', audioNow: active.lastAudioNow },
    ));
    assert.deepEqual(faulted.effects, expectedEffects);
    assert.deepEqual(faulted.state.pendingEffects, [faulted.effects.at(-1)]);

    const duplicate = reduceSession(faulted.state, fact);
    assertNoOp(duplicate, faulted.state);
    assert.equal(faulted.effects.concat(duplicate.effects).filter(
      ({ effectType }) => effectType === 'capture-terminal-draft',
    ).length, 1);
    assert.equal(faulted.effects.concat(duplicate.effects).filter(
      ({ effectType }) => effectType === 'terminate-generation',
    ).length, 1);

    const settled = reduceSession(faulted.state, generationSettlement(faulted.state));
    assert.equal(settled.state.phase, 'evidence-pending');
    assert.equal(settled.state.evidence.status, 'pending');
    assert.equal(settled.state.terminal.cause, 'schedule-failed');
    assertNoOp(reduceSession(settled.state, fact), settled.state);
  }

  const staleBase = reduceSession(readyState(), tapEvent({
    eventTimestampMs: 1_000,
    audioNow: 5,
  })).state;
  const ownFact = {
    type: 'generation-cleanup-faulted',
    sessionId: staleBase.sessionId,
    generationId: staleBase.activeGenerationId,
    sourceId: 'unregistered-source',
    cause: 'source-stop-failed',
  };
  assertNoOp(reduceSession(staleBase, {
    ...ownFact,
    sessionId: 'session-2',
  }), staleBase);
  assertNoOp(reduceSession(staleBase, {
    ...ownFact,
    generationId: staleBase.activeGenerationId + 1,
  }), staleBase);

  const smokeCommitted = committedHandoff('smoke-playing');
  const smokePlaying = reduceSession(
    smokeCommitted.state,
    trackLifecycleEvent('song-only-boundary', smokeCommitted.state),
  ).state;
  const cancellationTimestampMs = smokePlaying.estimatorSnapshot.timestampWindowMs.at(-1) + 25;
  const smokeCancelling = reduceSession(smokePlaying, tapEvent({
    eventTimestampMs: cancellationTimestampMs,
    audioNow: smokePlaying.lastAudioNow + 0.025,
  })).state;
  const smokeReady = reduceSession(
    smokeCancelling,
    generationSettlement(smokeCancelling),
  ).state;
  const smokeProbing = reduceSession(smokeReady, tapEvent({
    eventTimestampMs: cancellationTimestampMs + 1,
    audioNow: smokePlaying.lastAudioNow + 0.051,
  })).state;
  assert.equal(smokeProbing.phase, 'smoke-probing');
  const smokeProbeOwner = smokeProbing.smokeProbe;
  const smokeFault = reduceSession(smokeProbing, {
    type: 'generation-cleanup-faulted',
    sessionId: smokeProbing.sessionId,
    generationId: smokeProbing.activeGenerationId,
    sourceId: smokeProbing.smokeProbe.probeSourceId,
    cause: 'source-stop-failed',
  });
  assertNoOp(smokeFault, smokeProbing);
  assert.equal(smokeFault.state.smokeProbe, smokeProbeOwner);

  for (const malformed of [
    { ...ownFact, cause: 'context-close-failed' },
    { ...ownFact, sessionId: '' },
    { ...ownFact, sessionId: 'x'.repeat(129) },
    { ...ownFact, sessionId: 'not_opaque' },
    { ...ownFact, sourceId: '' },
    { ...ownFact, sourceId: 'x'.repeat(129) },
    { ...ownFact, sourceId: 'not.opaque' },
    { ...ownFact, generationId: 0 },
    { ...ownFact, generationId: -1 },
    { ...ownFact, generationId: 1.5 },
    { ...ownFact, generationId: Number.MAX_SAFE_INTEGER + 1 },
    { ...ownFact, extra: true },
    { ...ownFact, [Symbol('extra')]: true },
    Object.assign(Object.create(null), ownFact),
    Object.assign(Object.create({ inherited: true }), ownFact),
    [ownFact],
  ]) {
    assert.throws(() => reduceSession(staleBase, malformed), TypeError);
  }
  for (const missingKey of Reflect.ownKeys(ownFact)) {
    const missing = { ...ownFact };
    delete missing[missingKey];
    assert.throws(() => reduceSession(staleBase, missing), TypeError);
  }

  const accessorReads = { count: 0 };
  for (const accessorKey of Reflect.ownKeys(ownFact)) {
    const accessorFact = { ...ownFact };
    Object.defineProperty(accessorFact, accessorKey, {
      enumerable: true,
      get() {
        accessorReads.count += 1;
        return ownFact[accessorKey];
      },
    });
    assert.throws(() => reduceSession(staleBase, accessorFact), TypeError);
  }
  assert.equal(accessorReads.count, 0);

  const hostileProxy = new Proxy(ownFact, {
    getPrototypeOf() {
      throw new TypeError('hostile proxy');
    },
  });
  assert.throws(() => reduceSession(staleBase, hostileProxy), TypeError);
  const revoked = Proxy.revocable(ownFact, {});
  revoked.revoke();
  assert.throws(() => reduceSession(staleBase, revoked.proxy), TypeError);
});
