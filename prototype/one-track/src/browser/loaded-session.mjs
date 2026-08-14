import { assertBuildIdentity } from '../build-identity.mjs';
import * as localTrackLoader from './local-track-loader.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';
const CONTEXT_CLOSE_DEADLINE_MS = 1_000;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_RESULT_SCAN_NODES = 1_024;

const genuineCapabilities = new WeakSet();
const capabilityStates = new WeakMap();
const genuineReleaseResults = new WeakSet();
const releaseOwnership = new WeakMap();
const claimedReleaseResults = new WeakSet();

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

export class LoadedSessionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LoadedSessionError';
    this.code = code;
    Object.freeze(this);
  }
}

function failure(code) {
  return new LoadedSessionError(code);
}

function fail(code) {
  throw failure(code);
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function createSignal() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function captureThenable(value) {
  if (!isObject(value)) return null;
  let then;
  try {
    then = value.then;
  } catch {
    return null;
  }
  if (typeof then !== 'function') return null;
  return new Promise((resolve, reject) => {
    try {
      then.call(value, resolve, reject);
    } catch (error) {
      reject(error);
    }
  });
}

function adoptCallbackOperation(value) {
  if (!isObject(value)) {
    return Promise.resolve({ kind: 'value', value });
  }
  let then;
  try {
    then = value.then;
  } catch (error) {
    return Promise.resolve({ kind: 'callback-failed', error });
  }
  if (typeof then !== 'function') {
    return Promise.resolve({ kind: 'value', value });
  }
  return new Promise((resolve) => {
    try {
      Reflect.apply(then, value, [
        (resolvedValue) => resolve({ kind: 'value', value: resolvedValue }),
        (error) => resolve({ kind: 'callback-failed', error }),
      ]);
    } catch (error) {
      resolve({ kind: 'callback-failed', error });
    }
  });
}

function settledOperation(operation, failureCode) {
  const promise = captureThenable(operation);
  if (promise === null) {
    return Promise.resolve({ kind: 'failed', error: failure(failureCode) });
  }
  return promise.then(
    (value) => ({ kind: 'value', value }),
    () => ({ kind: 'failed', error: failure(failureCode) }),
  );
}

function readContextState(context) {
  try {
    return context.state;
  } catch {
    return null;
  }
}

function assertGenerationId(generationId) {
  if (!Number.isSafeInteger(generationId) || generationId <= 0) {
    fail('generation-id-invalid');
  }
}

function assertReason(reason) {
  if (typeof reason !== 'string' || reason.length === 0 || reason.length > MAX_IDENTIFIER_LENGTH) {
    fail('loaded-session-reason-invalid');
  }
}

function assertNoOwnedResourceAlias(candidate, ownedContext, ownedBuffer) {
  const pending = [candidate];
  const seen = new WeakSet();
  let inspected = 0;
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === ownedContext || value === ownedBuffer) {
      fail('owned-resource-export-blocked');
    }
    if (!isObject(value) && typeof value !== 'function') continue;
    let prototype;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      fail('owned-resource-export-blocked');
    }
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) fail('owned-resource-export-blocked');
    } else if (typeof value === 'object') {
      if (prototype !== Object.prototype && prototype !== null) {
        fail('owned-resource-export-blocked');
      }
    } else {
      fail('owned-resource-export-blocked');
    }
    if (seen.has(value)) continue;
    seen.add(value);
    inspected += 1;
    if (inspected > MAX_RESULT_SCAN_NODES) fail('borrow-result-invalid');

    let keys;
    try {
      keys = Reflect.ownKeys(value);
    } catch {
      fail('borrow-result-invalid');
    }
    for (let index = 0; index < keys.length; index += 1) {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, keys[index]);
      } catch {
        fail('borrow-result-invalid');
      }
      if (descriptor === undefined) fail('borrow-result-invalid');
      if (!Object.hasOwn(descriptor, 'value')) fail('borrow-result-invalid');
      pending.push(descriptor.value);
    }
  }
}

function createBorrowResources(state, borrow, resumeSettlement) {
  const resources = {};
  Object.defineProperties(resources, {
    context: {
      enumerable: true,
      get() {
        if (!borrow.resourcesActive || state.unloaded) fail('borrow-expired');
        return state.context;
      },
    },
    buffer: {
      enumerable: true,
      get() {
        if (!borrow.resourcesActive || state.unloaded) fail('borrow-expired');
        return state.buffer;
      },
    },
    resumeSettlement: {
      enumerable: true,
      value: resumeSettlement,
    },
  });
  return Object.freeze(resources);
}

function mintReleaseResult(state, status, cause) {
  const result = Object.freeze({ status, cause });
  genuineReleaseResults.add(result);
  releaseOwnership.set(result, Object.freeze({
    loadedSessionId: state.loadedSessionId,
    capability: state.capability,
  }));
  return result;
}

function notifyOwner(state, status, contextCleared) {
  try {
    state.onOwnerRelease(Object.freeze({ status, contextCleared }));
  } catch {
    // Owner notifications are bookkeeping only and cannot rewrite release history.
  }
}

function createDeadline(state) {
  let deadline;
  try {
    deadline = state.createDeadline('context-close', CONTEXT_CLOSE_DEADLINE_MS);
  } catch {
    fail('context-close-deadline-invalid');
  }
  let promiseValue;
  let cancel;
  try {
    promiseValue = deadline?.promise;
    cancel = deadline?.cancel;
  } catch {
    fail('context-close-deadline-invalid');
  }
  const promise = captureThenable(promiseValue);
  if (!isObject(deadline) || promise === null || typeof cancel !== 'function') {
    fail('context-close-deadline-invalid');
  }
  return Object.freeze({
    promise,
    cancel() {
      try {
        cancel.call(deadline);
      } catch {
        // Timer cancellation cannot rewrite an already observed close outcome.
      }
    },
  });
}

function beginUnload(state, reason) {
  assertReason(reason);
  if (state.unloadPromise !== null) return state.unloadPromise;

  state.unloaded = true;
  state.allocationFrozen = true;
  state.lifecycleInvalidation.resolve();
  if (state.activeBorrow !== null) {
    state.activeBorrow.active = false;
    state.activeBorrow.resourcesActive = false;
    state.activeBorrow.invalidation.resolve();
    state.activeBorrow = null;
  }
  state.buffer = null;

  state.unloadPromise = (async () => {
    const context = state.context;
    if (context === null || readContextState(context) === 'closed') {
      state.context = null;
      const result = mintReleaseResult(state, 'succeeded', null);
      state.releaseResult = result;
      notifyOwner(state, 'succeeded', true);
      return result;
    }

    let closeOperation;
    try {
      closeOperation = context.close();
    } catch {
      closeOperation = null;
    }
    const closePromise = captureThenable(closeOperation);
    if (closePromise === null) {
      const result = mintReleaseResult(state, 'failed', 'context-close-failed');
      state.releaseResult = result;
      notifyOwner(state, 'failed', false);
      return result;
    }

    const closeOutcome = closePromise.then(
      () => 'closed',
      () => 'failed',
    );
    closeOutcome.then((outcome) => {
      if (outcome === 'closed' && state.context === context) {
        state.context = null;
        if (state.releaseResult?.status === 'failed') {
          notifyOwner(state, 'failed', true);
        }
      }
    });
    let deadline;
    try {
      deadline = createDeadline(state);
    } catch {
      const result = mintReleaseResult(state, 'failed', 'context-close-failed');
      state.releaseResult = result;
      notifyOwner(state, 'failed', false);
      return result;
    }
    const outcome = await Promise.race([
      closeOutcome,
      deadline.promise.then(() => 'timed-out', () => 'timed-out'),
    ]);
    if (outcome !== 'timed-out') deadline.cancel();
    if (outcome === 'closed') {
      state.context = null;
      const result = mintReleaseResult(state, 'succeeded', null);
      state.releaseResult = result;
      notifyOwner(state, 'succeeded', true);
      return result;
    }
    const result = mintReleaseResult(state, 'failed', 'context-close-failed');
    state.releaseResult = result;
    notifyOwner(state, 'failed', false);
    return result;
  })();
  return state.unloadPromise;
}

function stateForReceiver(receiver) {
  if (!genuineCapabilities.has(receiver)) fail('loaded-session-capability-receiver-invalid');
  const state = capabilityStates.get(receiver);
  if (state === undefined) fail('loaded-session-capability-receiver-invalid');
  return state;
}

async function borrowForGeneration(generationId, callback) {
  const state = stateForReceiver(this);
  assertGenerationId(generationId);
  if (typeof callback !== 'function') fail('generation-borrow-callback-invalid');
  if (state.unloaded) fail('loaded-session-unloaded');
  if (readContextState(state.context) === 'closed') {
    beginUnload(state, 'unexpected-context-close');
    fail('loaded-session-unloaded');
  }
  if (state.pendingSuspend !== null || state.activeBorrow !== null) {
    fail('parallel-generation-borrow');
  }
  if (state.latestGenerationId !== null && generationId < state.latestGenerationId) {
    fail('stale-generation-borrow');
  }

  const isNewGeneration = generationId !== state.latestGenerationId;
  if (isNewGeneration) state.latestGenerationId = generationId;
  const requiresResume = generationId !== state.resumedGenerationId;
  const resumeAuthorityEpoch = state.resumeAuthorityEpoch;
  const invalidation = createSignal();
  const borrow = {
    active: true,
    resourcesActive: true,
    callbackSettled: false,
    invalidation,
  };
  state.activeBorrow = borrow;

  let resumeOutcome = Promise.resolve({ kind: 'value' });
  if (requiresResume) {
    let resumeOperation;
    try {
      resumeOperation = state.context.resume();
    } catch {
      resumeOperation = null;
    }
    resumeOutcome = settledOperation(resumeOperation, 'context-resume-failed');
  }
  const resumeSettlement = Promise.race([
    resumeOutcome,
    invalidation.promise.then(() => ({ kind: 'invalidated' })),
  ]).then((outcome) => {
    if (outcome.kind === 'invalidated' || state.unloaded) fail('loaded-session-unloaded');
    if (outcome.kind === 'failed') throw outcome.error;
    if (requiresResume && state.resumeAuthorityEpoch === resumeAuthorityEpoch) {
      state.resumedGenerationId = generationId;
    }
    return true;
  });
  borrow.resumeSettlement = resumeSettlement;
  const resources = createBorrowResources(state, borrow, resumeSettlement);
  const borrowResumeOutcome = resumeSettlement.then(
    () => ({ kind: 'value' }),
    (error) => ({ kind: 'failed', error }),
  );

  let callbackOperation;
  try {
    callbackOperation = callback(resources);
  } catch (error) {
    callbackOperation = Promise.reject(error);
  }
  const callbackOutcome = adoptCallbackOperation(callbackOperation).finally(() => {
    borrow.resourcesActive = false;
    borrow.callbackSettled = true;
  });

  try {
    const outcome = await Promise.race([
      Promise.all([borrowResumeOutcome, callbackOutcome]).then((values) => ({
        kind: 'settled',
        resume: values[0],
        callback: values[1],
      })),
      invalidation.promise.then(() => ({ kind: 'invalidated' })),
    ]);
    if (outcome.kind === 'invalidated' || state.unloaded) fail('loaded-session-unloaded');
    if (outcome.resume.kind === 'failed') throw outcome.resume.error;
    if (outcome.callback.kind === 'callback-failed') throw outcome.callback.error;
    assertNoOwnedResourceAlias(outcome.callback.value, state.context, state.buffer);
    return outcome.callback.value;
  } finally {
    borrow.active = false;
    borrow.resourcesActive = false;
    if (state.activeBorrow === borrow) state.activeBorrow = null;
  }
}

async function suspend(reason) {
  const state = stateForReceiver(this);
  assertReason(reason);
  if (state.unloaded) fail('loaded-session-unloaded');
  if (state.pendingSuspend !== null) return state.pendingSuspend.promise;
  if (state.activeBorrow !== null && !state.activeBorrow.callbackSettled) {
    fail('parallel-generation-borrow');
  }
  if (readContextState(state.context) === 'closed') {
    beginUnload(state, 'unexpected-context-close');
    fail('loaded-session-unloaded');
  }

  const resumeBarrier = state.activeBorrow?.resumeSettlement ?? Promise.resolve(true);
  const pending = { promise: null };
  state.resumeAuthorityEpoch += 1;
  state.resumedGenerationId = null;
  state.pendingSuspend = pending;
  pending.promise = (async () => {
    try {
      try {
        await resumeBarrier;
      } catch {
        // A failed/stale resume still requires a best-effort physical suspend.
      }
      if (state.unloaded) fail('loaded-session-unloaded');
      if (readContextState(state.context) === 'closed') {
        beginUnload(state, 'unexpected-context-close');
        fail('loaded-session-unloaded');
      }
      let operation;
      try {
        operation = state.context.suspend();
      } catch {
        operation = null;
      }
      const outcome = await Promise.race([
        settledOperation(operation, 'context-suspend-failed'),
        state.lifecycleInvalidation.promise.then(() => ({ kind: 'invalidated' })),
      ]);
      if (outcome.kind === 'invalidated') fail('loaded-session-unloaded');
      if (outcome.kind === 'failed') throw outcome.error;
      if (state.unloaded) fail('loaded-session-unloaded');
      return true;
    } finally {
      if (state.pendingSuspend === pending) state.pendingSuspend = null;
    }
  })();
  return pending.promise;
}

function resetAfterEvidence() {
  stateForReceiver(this);
  return suspend.call(this, 'reset-after-evidence');
}

function snapshotAudioClock() {
  const state = stateForReceiver(this);
  if (state.unloaded) fail('loaded-session-unloaded');
  const context = state.context;
  let contextState;
  let audioNow;
  let outputSampleRate;
  try {
    contextState = context.state;
    audioNow = context.currentTime;
    outputSampleRate = context.sampleRate;
  } catch {
    fail('audio-clock-invalid');
  }
  if (!['running', 'suspended'].includes(contextState)
      || !Number.isFinite(audioNow)
      || audioNow < 0
      || !Number.isFinite(outputSampleRate)
      || outputSampleRate <= 0
      || !Number.isFinite(1 / outputSampleRate)) {
    fail('audio-clock-invalid');
  }
  return Object.freeze({ audioNow, contextState, outputSampleRate });
}

function unload(reason) {
  return beginUnload(stateForReceiver(this), reason);
}

export function acceptValidatedLoadReceipt(receipt) {
  if (typeof localTrackLoader.assertAndConsumeValidatedLoadReceipt !== 'function') {
    throw new TypeError('validated load receipt authority is unavailable');
  }
  const payload = localTrackLoader.assertAndConsumeValidatedLoadReceipt(receipt);
  if (!isObject(payload)
      || typeof payload.loadedSessionId !== 'string'
      || payload.loadedSessionId.length === 0
      || payload.loadedSessionId.length > MAX_IDENTIFIER_LENGTH
      || !isObject(payload.context)
      || !isObject(payload.buffer)
      || typeof payload.createDeadline !== 'function'
      || typeof payload.onOwnerRelease !== 'function') {
    throw new TypeError('validated load receipt payload is invalid');
  }

  const capability = Object.freeze({
    borrowForGeneration,
    suspend,
    resetAfterEvidence,
    snapshotAudioClock,
    unload,
  });
  const state = {
    capability,
    loadedSessionId: payload.loadedSessionId,
    context: payload.context,
    buffer: payload.buffer,
    assetIdentity: payload.assetIdentity,
    experimentConfigIdentity: payload.experimentConfigIdentity,
    createDeadline: payload.createDeadline,
    onOwnerRelease: payload.onOwnerRelease,
    latestGenerationId: null,
    resumedGenerationId: null,
    resumeAuthorityEpoch: 0,
    activeBorrow: null,
    pendingSuspend: null,
    lifecycleInvalidation: createSignal(),
    allocationFrozen: false,
    unloaded: false,
    unloadPromise: null,
    releaseResult: null,
  };
  genuineCapabilities.add(capability);
  capabilityStates.set(capability, state);

  try {
    payload.context.onstatechange = () => {
      if (!state.unloaded && readContextState(state.context) === 'closed') {
        beginUnload(state, 'unexpected-context-close');
      }
    };
  } catch {
    beginUnload(state, 'unexpected-context-close');
  }
  return capability;
}

export function assertLoadedSessionCapability(candidate) {
  if (!isObject(candidate) || !genuineCapabilities.has(candidate)) {
    throw new TypeError('loaded session capability must be genuine');
  }
  return true;
}

function assertReleaseOwnership(candidate, ownership) {
  if (!isObject(candidate)
      || !genuineReleaseResults.has(candidate)
      || !isObject(ownership)
      || typeof ownership.loadedSessionId !== 'string'
      || !genuineCapabilities.has(ownership.capability)) {
    throw new TypeError('genuine application release result required');
  }
  const expected = releaseOwnership.get(candidate);
  if (expected === undefined
      || expected.loadedSessionId !== ownership.loadedSessionId
      || expected.capability !== ownership.capability) {
    throw new TypeError('genuine application release result required');
  }
}

export function assertApplicationReleaseResult(candidate, ownership) {
  assertReleaseOwnership(candidate, ownership);
  return true;
}

export function claimApplicationReleaseResult(candidate, ownership) {
  assertReleaseOwnership(candidate, ownership);
  if (claimedReleaseResults.has(candidate)) {
    throw new TypeError('application release result already claimed');
  }
  claimedReleaseResults.add(candidate);
  return true;
}
