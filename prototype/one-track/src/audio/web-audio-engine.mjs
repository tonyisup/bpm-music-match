import { assertBuildIdentity } from '../build-identity.mjs';
import { assertHandoffPlan } from '../core/handoff-planner.mjs';
import { assertLoadedSessionCapability } from '../browser/loaded-session.mjs';
import { synthesizePercussionBuffer } from './percussion-buffer.mjs';
import { createEqualPowerCurves, equalPowerGainsAtProgress } from './audio-math.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';
const MAX_IDENTIFIER_LENGTH = 128;
const GENERATION_CLEANUP_DEADLINE_MS = 100;
const CANCELLATION_RAMP_SECONDS = 0.020;
const CANCELLATION_STOP_SECONDS = 0.025;
const DIRECT_TAP_REQUEST_KEYS = Object.freeze([
  'sessionId', 'generationId', 'effectId', 'sourceId', 'scheduledAudioTime',
]);
const PREDICTION_SCHEDULE_REQUEST_KEYS = Object.freeze([
  'sessionId', 'generationId', 'effectId', 'predictions',
]);
const PREDICTION_REQUEST_KEYS = Object.freeze(['sourceId', 'scheduledAudioTime']);
const PREDICTION_CANCELLATION_REQUEST_KEYS = Object.freeze([
  'sessionId', 'generationId', 'effectId', 'sourceIds', 'audioNow',
]);
const HANDOFF_REQUEST_KEYS = Object.freeze([
  'sessionId', 'generationId', 'effectId', 'plan',
]);
const TERMINATION_REQUEST_KEYS = Object.freeze([
  'sessionId', 'generationId', 'effectId', 'terminalRecordReceipt', 'audioNow',
]);
const GENERATION_PHASES = Object.freeze({
  STARTING: 'starting',
  ACTIVE: 'active',
  CLEANUP_FAULTED: 'cleanup-faulted',
  ROLLING_BACK: 'rolling-back',
  ROLLED_BACK: 'rolled-back',
  TERMINATING: 'terminating',
  TERMINATED: 'terminated',
  TERMINAL_FAILED: 'terminal-failed',
});
const genuineEngines = new WeakSet();
const capabilityEngineAuthorities = new WeakMap();
const genuineGenerationCleanupResults = new WeakMap();
const claimedGenerationCleanupResults = new WeakSet();

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

function isIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH;
}

function assertHeader(request, expectedSessionId) {
  if (request === null
      || typeof request !== 'object'
      || Array.isArray(request)
      || Object.getPrototypeOf(request) !== Object.prototype
      || request.sessionId !== expectedSessionId
      || !Number.isSafeInteger(request.generationId)
      || request.generationId <= 0
      || !Number.isSafeInteger(request.effectId)
      || request.effectId <= 0) {
    throw new TypeError('engine request ownership is invalid');
  }
}

function snapshotClosedRequest(request, expectedKeys, errorMessage, state) {
  const generation = state.generation;
  const generationPhase = generation?.phase;
  const generationTermination = generation?.termination;
  const completedTermination = state.completedTermination;
  const snapshot = {};
  let valid = request !== null
    && typeof request === 'object'
    && !Array.isArray(request);
  try {
    valid &&= Object.getPrototypeOf(request) === Object.prototype;
    const keys = valid ? Reflect.ownKeys(request) : [];
    valid &&= keys.length === expectedKeys.length
      && keys.every((key) => typeof key === 'string' && expectedKeys.includes(key));
    if (valid) {
      for (const key of expectedKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(request, key);
        if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
          valid = false;
          break;
        }
        snapshot[key] = descriptor.value;
      }
    }
  } catch {
    valid = false;
  }
  if (state.generation !== generation
      || generation?.phase !== generationPhase
      || generation?.termination !== generationTermination
      || state.completedTermination !== completedTermination) {
    valid = false;
  }
  if (!valid) throw new TypeError(errorMessage);
  return Object.freeze(snapshot);
}

function snapshotClosedDenseArray(
  value,
  { minimumLength = 0, maximumLength = Number.MAX_SAFE_INTEGER } = {},
  errorMessage,
  state,
) {
  const generation = state.generation;
  const generationPhase = generation?.phase;
  const generationTermination = generation?.termination;
  const completedTermination = state.completedTermination;
  const snapshot = [];
  let valid = false;
  try {
    valid = Array.isArray(value);
    valid &&= Object.getPrototypeOf(value) === Array.prototype;
    const keys = valid ? Reflect.ownKeys(value) : [];
    const lengthDescriptor = valid
      ? Object.getOwnPropertyDescriptor(value, 'length')
      : undefined;
    const length = lengthDescriptor?.value;
    valid &&= lengthDescriptor !== undefined
      && Object.hasOwn(lengthDescriptor, 'value')
      && Number.isSafeInteger(length)
      && length >= minimumLength
      && length <= maximumLength
      && keys.length === length + 1
      && keys[length] === 'length';
    if (valid) {
      for (let index = 0; index < length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (keys[index] !== key
            || descriptor === undefined
            || !Object.hasOwn(descriptor, 'value')) {
          valid = false;
          break;
        }
        snapshot[index] = descriptor.value;
      }
    }
  } catch {
    valid = false;
  }
  if (state.generation !== generation
      || generation?.phase !== generationPhase
      || generation?.termination !== generationTermination
      || state.completedTermination !== completedTermination) {
    valid = false;
  }
  if (!valid) throw new TypeError(errorMessage);
  return Object.freeze(snapshot);
}

function frozenSettlement(status, cause) {
  return Object.freeze({ status, cause });
}

function createSignal() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createGenerationTransaction(generationId) {
  return {
    kind: 'transaction',
    generationId,
    phase: GENERATION_PHASES.STARTING,
    firstFailureCause: null,
    lastAudioNow: null,
    pendingResume: null,
    resumeSettlement: null,
    staleResumeReconciliation: null,
    lifetime: { signal: createSignal(), released: false },
    borrow: null,
    borrowReleased: null,
    executor: null,
    sources: new Map(),
    predictions: new Map(),
    track: null,
    graph: null,
    activePlan: null,
    preterminalCleanupFault: null,
    termination: null,
  };
}

const ENGINE_STATE_KEYS = Object.freeze(['generation', 'completedTermination']);
const LIVE_TRANSACTION_KEYS = Object.freeze([
  'kind',
  'generationId',
  'phase',
  'firstFailureCause',
  'lastAudioNow',
  'pendingResume',
  'resumeSettlement',
  'staleResumeReconciliation',
  'lifetime',
  'borrow',
  'borrowReleased',
  'executor',
  'sources',
  'predictions',
  'track',
  'graph',
  'activePlan',
  'preterminalCleanupFault',
  'termination',
]);
const PRETERMINAL_CLEANUP_FAULT_KEYS = Object.freeze([
  'cause',
  'sourceId',
  'factOffered',
]);
const TOMBSTONE_KEYS = Object.freeze(['kind', 'generationId', 'phase', 'termination']);
const LIVE_TERMINATION_KEYS = Object.freeze([
  'terminalRecordReceipt',
  'cleanupPromise',
  'result',
]);
const COMPLETED_TERMINATION_KEYS = Object.freeze([
  'generationId',
  'terminalRecordReceipt',
  'cleanupPromise',
  'result',
]);

function assertExactOwnDataKeys(value, expectedKeys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} ownership invariant failed`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length
      || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new TypeError(`${label} ownership invariant failed`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label} ownership invariant failed`);
    }
  }
}

function assertTerminationMetadata(termination, { completed = false } = {}) {
  assertExactOwnDataKeys(
    termination,
    completed ? COMPLETED_TERMINATION_KEYS : LIVE_TERMINATION_KEYS,
    completed ? 'completed termination' : 'failed termination',
  );
  if (!(termination.cleanupPromise instanceof Promise)
      || termination.result === null
      || !Object.isFrozen(termination.result)
      || (completed && !Number.isSafeInteger(termination.generationId))) {
    throw new TypeError('termination metadata ownership invariant failed');
  }
}

function assertPreterminalCleanupFault(fault) {
  assertExactOwnDataKeys(
    fault,
    PRETERMINAL_CLEANUP_FAULT_KEYS,
    'preterminal cleanup fault',
  );
  if (fault.cause !== 'source-stop-failed'
      || !isIdentifier(fault.sourceId)
      || typeof fault.factOffered !== 'boolean'
      || !Object.isFrozen(fault)) {
    throw new TypeError('preterminal cleanup fault ownership invariant failed');
  }
}

function assertEngineOwnershipState(state, { beforeCompaction = null } = {}) {
  assertExactOwnDataKeys(state, ENGINE_STATE_KEYS, 'engine state');
  if (state.completedTermination !== null) {
    assertTerminationMetadata(state.completedTermination, { completed: true });
    if (!Object.isFrozen(state.completedTermination)) {
      throw new TypeError('completed termination ownership invariant failed');
    }
  }
  const owner = state.generation;
  if (owner === null) return true;
  if (owner.kind === 'transaction') {
    assertExactOwnDataKeys(owner, LIVE_TRANSACTION_KEYS, 'live transaction');
    if (owner.preterminalCleanupFault !== null) {
      assertPreterminalCleanupFault(owner.preterminalCleanupFault);
    }
    if ((owner.phase === GENERATION_PHASES.CLEANUP_FAULTED)
        !== (owner.preterminalCleanupFault !== null)) {
      throw new TypeError('preterminal cleanup fault phase invariant failed');
    }
    if (beforeCompaction !== null) {
      if (owner !== beforeCompaction
          || owner.phase !== GENERATION_PHASES.TERMINAL_FAILED
          || owner.sources.size !== 0
          || owner.predictions.size !== 0
          || owner.track !== null
          || owner.graph !== null
          || owner.executor !== null
          || owner.activePlan !== null
          || owner.pendingResume !== null
          || owner.lifetime !== null
          || owner.borrow !== null
          || owner.borrowReleased !== null
          || owner.resumeSettlement !== null
          || owner.staleResumeReconciliation !== null
          || owner.preterminalCleanupFault !== null) {
        throw new TypeError('pre-compaction ownership invariant failed');
      }
      assertTerminationMetadata(owner.termination);
    }
    return true;
  }
  if (owner.kind !== 'terminal-tombstone') {
    throw new TypeError('generation owner ownership invariant failed');
  }
  assertExactOwnDataKeys(owner, TOMBSTONE_KEYS, 'terminal tombstone');
  assertTerminationMetadata(owner.termination);
  if (owner.phase !== GENERATION_PHASES.TERMINAL_FAILED
      || !Object.isFrozen(owner)
      || !Object.isFrozen(owner.termination)) {
    throw new TypeError('terminal tombstone ownership invariant failed');
  }
  return true;
}

function captureThenable(value) {
  if (value instanceof Promise) return value;
  let then;
  try { then = value?.then; } catch { return null; }
  if (typeof then !== 'function') return null;
  return new Promise((resolve, reject) => {
    try { Reflect.apply(then, value, [resolve, reject]); } catch (error) { reject(error); }
  });
}

function readCleanupOwnership(ownership) {
  if (ownership === null
      || typeof ownership !== 'object'
      || Array.isArray(ownership)
      || Object.getPrototypeOf(ownership) !== Object.prototype
      || Reflect.ownKeys(ownership).length !== 5) {
    throw new TypeError('generation cleanup ownership is invalid');
  }
  return ownership;
}

function assertCleanupOwnership(candidate, ownership) {
  const expected = genuineGenerationCleanupResults.get(candidate);
  const supplied = readCleanupOwnership(ownership);
  if (expected === undefined
      || expected.engine !== supplied.engine
      || expected.loadedSessionCapability !== supplied.loadedSessionCapability
      || expected.sessionId !== supplied.sessionId
      || expected.generationId !== supplied.generationId
      || expected.terminalRecordReceipt !== supplied.terminalRecordReceipt) {
    throw new TypeError('genuine generation cleanup result required');
  }
}

export function assertGenerationCleanupResult(candidate, ownership) {
  assertCleanupOwnership(candidate, ownership);
  return true;
}

export function claimGenerationCleanupResult(candidate, ownership) {
  assertCleanupOwnership(candidate, ownership);
  if (claimedGenerationCleanupResults.has(candidate)) {
    throw new TypeError('generation cleanup result already claimed');
  }
  claimedGenerationCleanupResults.add(candidate);
  return true;
}

export function createWebAudioEngine(options) {
  if (options === null
      || typeof options !== 'object'
      || Array.isArray(options)
      || Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError('Web Audio engine options are invalid');
  }
  const {
    loadedSessionCapability,
    sessionId,
    assertTerminalRecordReceipt,
    createCleanupDeadline,
    failureInjector,
    onEvent,
  } = options;
  assertLoadedSessionCapability(loadedSessionCapability);
  if (!isIdentifier(sessionId)
      || typeof assertTerminalRecordReceipt !== 'function'
      || typeof createCleanupDeadline !== 'function'
      || typeof failureInjector !== 'function'
      || typeof onEvent !== 'function') {
    throw new TypeError('Web Audio engine dependencies are invalid');
  }
  if (capabilityEngineAuthorities.has(loadedSessionCapability)) {
    throw new TypeError('loaded session capability is already bound to an engine');
  }

  const state = {
    generation: null,
    completedTermination: null,
  };
  assertEngineOwnershipState(state);
  let activeRequestCapture = null;
  let activeSourceCallbackSettlement = null;
  const terminateDuringFaultConsumer = Object.freeze({});

  function callbackSettlementAdmitsTerminalCapture(commandCapability) {
    const authority = activeSourceCallbackSettlement;
    if (commandCapability !== terminateDuringFaultConsumer
        || authority === null
        || authority.stage !== 'fault-consumer'
        || state.generation !== authority.transaction) return false;
    const { transaction } = authority;
    const initialFaultOwner = transaction.phase === GENERATION_PHASES.CLEANUP_FAULTED
      && transaction.termination === null
      && transaction.preterminalCleanupFault?.factOffered === true;
    const exactTerminalReplay = transaction.phase === GENERATION_PHASES.TERMINATING
      && transaction.termination !== null;
    return initialFaultOwner || exactTerminalReplay;
  }

  function capturePublicRequest(errorMessage, capture, commandCapability = null) {
    if (activeRequestCapture !== null) {
      activeRequestCapture.reentered = true;
      throw new TypeError(errorMessage);
    }
    if (activeSourceCallbackSettlement !== null
        && !callbackSettlementAdmitsTerminalCapture(commandCapability)) {
      throw new TypeError(errorMessage);
    }
    const authority = { reentered: false };
    activeRequestCapture = authority;
    try {
      const captured = capture();
      if (authority.reentered) throw new TypeError(errorMessage);
      return captured;
    } finally {
      if (activeRequestCapture === authority) activeRequestCapture = null;
    }
  }

  function inject(step) {
    failureInjector(step);
  }

  function freezeFailedTerminationMetadata(termination) {
    return Object.freeze({
      terminalRecordReceipt: termination.terminalRecordReceipt,
      cleanupPromise: termination.cleanupPromise,
      result: termination.result,
    });
  }

  function compactFailedTransaction(transaction, termination, cleanupPromise) {
    if (state.generation !== transaction
        || transaction.kind !== 'transaction'
        || transaction.phase !== GENERATION_PHASES.TERMINAL_FAILED
        || transaction.termination !== termination
        || termination.cleanupPromise !== cleanupPromise) return;
    transaction.staleResumeReconciliation = null;
    assertEngineOwnershipState(state, { beforeCompaction: transaction });
    inject('ownership:before-compaction-asserted');
    if (state.generation !== transaction
        || transaction.phase !== GENERATION_PHASES.TERMINAL_FAILED
        || transaction.termination !== termination) {
      throw new TypeError('failed owner changed during compaction');
    }
    const tombstone = Object.freeze({
      kind: 'terminal-tombstone',
      generationId: transaction.generationId,
      phase: GENERATION_PHASES.TERMINAL_FAILED,
      termination: freezeFailedTerminationMetadata(termination),
    });
    state.generation = tombstone;
    assertEngineOwnershipState(state);
    inject('ownership:after-compaction-asserted');
  }

  function scheduleFailedTransactionCompaction(transaction, termination, cleanupPromise) {
    const dependencies = [
      transaction.borrowReleased,
      transaction.staleResumeReconciliation,
    ].filter((candidate) => candidate instanceof Promise);
    const readiness = dependencies.length === 0
      ? Promise.resolve()
      : Promise.allSettled(dependencies).then(() => undefined);

    transaction.sources.clear();
    transaction.predictions.clear();
    transaction.track = null;
    transaction.graph = null;
    transaction.executor = null;
    transaction.activePlan = null;
    transaction.pendingResume = null;
    transaction.lifetime = null;
    transaction.borrow = null;
    transaction.borrowReleased = null;
    transaction.resumeSettlement = null;
    transaction.staleResumeReconciliation = dependencies.length === 0 ? null : readiness;

    readiness.then(
      () => compactFailedTransaction(transaction, termination, cleanupPromise),
      () => compactFailedTransaction(transaction, termination, cleanupPromise),
    ).catch((error) => {
      queueMicrotask(() => { throw error; });
    });
  }

  function isCurrentGenerationTransaction(transaction) {
    return transaction !== null
      && state.generation === transaction
      && transaction.kind === 'transaction';
  }

  function isOrdinaryGenerationPhase(transaction) {
    return transaction?.phase === GENERATION_PHASES.STARTING
      || transaction?.phase === GENERATION_PHASES.ACTIVE;
  }

  function mayUseGeneration(transaction) {
    return isCurrentGenerationTransaction(transaction)
      && isOrdinaryGenerationPhase(transaction);
  }

  function injectGeneration(transaction, step) {
    inject(step);
    if (!mayUseGeneration(transaction)) throw new TypeError();
  }

  function allocationFrozen(transaction) {
    return transaction?.phase === GENERATION_PHASES.CLEANUP_FAULTED
      || transaction?.phase === GENERATION_PHASES.ROLLING_BACK
      || transaction?.phase === GENERATION_PHASES.TERMINATING
      || transaction?.phase === GENERATION_PHASES.TERMINAL_FAILED;
  }

  function sourceSnapshot(record) {
    return Object.freeze({
      sourceId: record.sourceId,
      scheduledAudioTime: record.scheduledAudioTime,
      generationId: record.generationId,
      role: record.role,
      startCommitted: record.startCommitted,
      intentionallyStopping: record.intentionallyStopping,
      ended: record.ended,
      disconnected: record.disconnected,
    });
  }

  function inspect() {
    const transaction = state.generation;
    return Object.freeze({
      sessionId,
      generationId: isOrdinaryGenerationPhase(transaction)
        ? transaction.generationId
        : null,
      allocationFrozen: allocationFrozen(transaction),
      pendingResumeKey: mayUseGeneration(transaction)
        ? transaction.pendingResume?.key ?? null
        : null,
      graphCreated: isCurrentGenerationTransaction(transaction)
        && transaction.graph !== null,
      predictions: Object.freeze(isCurrentGenerationTransaction(transaction)
        ? [...transaction.predictions.values()].map(sourceSnapshot)
        : []),
      track: isCurrentGenerationTransaction(transaction) && transaction.track !== null
        ? sourceSnapshot(transaction.track)
        : null,
    });
  }

  function disconnectRecord(record) {
    if (record.disconnected) return !record.disconnectFailed;
    let disconnectFailed = false;
    try { record.node.onended = null; } catch { disconnectFailed = true; }
    try { record.node.disconnect(); } catch { disconnectFailed = true; }
    try { record.node.buffer = null; } catch { disconnectFailed = true; }
    record.disconnectFailed ||= disconnectFailed;
    record.disconnected = true;
    return !record.disconnectFailed;
  }

  function attemptSourceStop(record, audioTime) {
    if (!record.startCommitted || record.ended || record.stopAttempted) return true;
    record.intentionallyStopping = true;
    record.stopAttempted = true;
    try {
      record.node.stop(audioTime);
      return true;
    } catch {
      return false;
    }
  }

  function poisonPendingResume(transaction, failureCause) {
    if (transaction.pendingResume === null) return;
    transaction.pendingResume.failureCause ??= failureCause;
    transaction.pendingResume.stale = true;
  }

  function reconcileStaleResume(transaction) {
    // One generation-bound transaction owns stale suspension. Waiting for the
    // borrow prevents an old finalizer from racing a later generation, while
    // caching the promise prevents duplicate native suspend calls.
    if (transaction.staleResumeReconciliation !== null) {
      return transaction.staleResumeReconciliation;
    }
    if (transaction.borrowReleased === null) {
      throw new TypeError('generation borrow release barrier is unavailable');
    }
    transaction.staleResumeReconciliation = transaction.borrowReleased.then(
      () => loadedSessionCapability.suspend('stale-generation-resume'),
    ).then(
      () => 'suspended',
      () => 'failed',
    );
    return transaction.staleResumeReconciliation;
  }

  function revokeCallbackAuthority(records) {
    for (const record of records) record.callbackAuthority = false;
  }

  function settleSourceCallback(record) {
    if (activeSourceCallbackSettlement !== null) {
      const authority = activeSourceCallbackSettlement;
      const transaction = authority.transaction;
      const exactInstalledRecord = record.transaction === transaction
        && transaction.sources.get(record.sourceId) === record;
      const ordinaryCallbackAuthority = exactInstalledRecord
        && record.callbackAuthority
        && isCurrentGenerationTransaction(transaction)
        && isOrdinaryGenerationPhase(transaction);
      const faultConsumerEvidence = exactInstalledRecord
        && authority.stage === 'fault-consumer'
        && isCurrentGenerationTransaction(transaction)
        && (transaction.phase === GENERATION_PHASES.CLEANUP_FAULTED
          || (transaction.phase === GENERATION_PHASES.TERMINATING
            && transaction.termination !== null));
      if ((ordinaryCallbackAuthority || faultConsumerEvidence)
          && !authority.pending.has(record)) {
        authority.pending.add(record);
        authority.worklist.push(record);
      }
      return;
    }

    const authority = {
      owner: record,
      transaction: record.transaction,
      stage: 'native',
      pending: new Set([record]),
      worklist: [record],
      cursor: 0,
      hasAbrupt: false,
      abruptValue: undefined,
    };
    activeSourceCallbackSettlement = authority;
    try {
      while (authority.cursor < authority.worklist.length) {
        const currentRecord = authority.worklist[authority.cursor];
        authority.cursor += 1;
        if (currentRecord !== authority.owner
            && currentRecord.transaction !== authority.transaction) continue;

        const transaction = currentRecord.transaction;
        const startingPhase = transaction.phase;
        const startingTermination = transaction.termination;
        const exactOrdinaryAuthority = currentRecord.callbackAuthority
          && isCurrentGenerationTransaction(transaction)
          && (startingPhase === GENERATION_PHASES.STARTING
            || startingPhase === GENERATION_PHASES.ACTIVE)
          && transaction.sources.get(currentRecord.sourceId) === currentRecord;
        if (currentRecord !== authority.owner && !exactOrdinaryAuthority) continue;

        authority.stage = 'native';
        if (!currentRecord.ended) {
          currentRecord.ended = true;
          currentRecord.endedSignal.resolve();
        }
        const disconnected = disconnectRecord(currentRecord);
        if (!exactOrdinaryAuthority) break;
        if (!currentRecord.callbackAuthority
            || !isCurrentGenerationTransaction(transaction)
            || transaction.phase !== startingPhase
            || transaction.termination !== startingTermination
            || transaction.sources.get(currentRecord.sourceId) !== currentRecord) break;

        if (!disconnected) {
          transaction.phase = GENERATION_PHASES.CLEANUP_FAULTED;
          revokeCallbackAuthority([...transaction.sources.values()]);
          transaction.preterminalCleanupFault = Object.freeze({
            cause: 'source-stop-failed',
            sourceId: currentRecord.sourceId,
            factOffered: true,
          });
          authority.pending.clear();
          authority.worklist.length = authority.cursor;
          authority.stage = 'fault-consumer';
          const fact = Object.freeze({
            type: 'generation-cleanup-faulted',
            sessionId,
            generationId: currentRecord.generationId,
            sourceId: currentRecord.sourceId,
            cause: 'source-stop-failed',
          });
          try { onEvent(fact); } catch { /* frozen ownership remains authoritative */ }
          break;
        }

        currentRecord.callbackAuthority = false;
        // Logical source IDs are reusable bookkeeping values. Only the exact private
        // record currently installed in the registry can authorize state mutation.
        if (!isCurrentGenerationTransaction(transaction)
            || transaction.phase !== startingPhase
            || transaction.termination !== startingTermination
            || transaction.sources.get(currentRecord.sourceId) !== currentRecord) break;
        transaction.sources.delete(currentRecord.sourceId);
        if (transaction.predictions.get(currentRecord.sourceId) === currentRecord) {
          transaction.predictions.delete(currentRecord.sourceId);
        }
        if (transaction.track === currentRecord) transaction.track = null;

        authority.stage = 'ordinary-consumer';
        try {
          onEvent(Object.freeze({
            type: currentRecord.role === 'track' ? 'natural-track-end' : 'source-ended',
            sessionId,
            generationId: currentRecord.generationId,
            sourceId: currentRecord.sourceId,
            intentional: currentRecord.intentionallyStopping,
          }));
        } catch (abruptValue) {
          if (!authority.hasAbrupt) {
            authority.hasAbrupt = true;
            authority.abruptValue = abruptValue;
          }
        }
        if (!isCurrentGenerationTransaction(transaction)
            || transaction.phase !== startingPhase
            || transaction.termination !== startingTermination
            || !isOrdinaryGenerationPhase(transaction)) break;
      }
    } finally {
      authority.pending.clear();
      authority.worklist.length = 0;
      if (activeSourceCallbackSettlement === authority) {
        activeSourceCallbackSettlement = null;
      }
    }
    if (authority.hasAbrupt) throw authority.abruptValue;
  }

  function releaseGenerationBorrow(transaction) {
    const { lifetime } = transaction;
    if (!lifetime.released) {
      lifetime.released = true;
      lifetime.signal.resolve();
    }
    transaction.executor = null;
  }

  function clearGenerationOwnership(
    transaction,
    { failureCause = 'schedule-failed' } = {},
  ) {
    if (!mayUseGeneration(transaction)) return false;
    transaction.phase = GENERATION_PHASES.ROLLING_BACK;
    transaction.firstFailureCause ??= failureCause;
    poisonPendingResume(transaction, failureCause);
    const records = [...transaction.sources.values()];
    revokeCallbackAuthority(records);
    let cleanupSucceeded = true;
    for (const record of records) {
      if (!attemptSourceStop(record, transaction.lastAudioNow ?? 0)) cleanupSucceeded = false;
      if (!disconnectRecord(record)) cleanupSucceeded = false;
    }
    const graph = transaction.graph;
    if (graph !== null) {
      for (const node of Object.values(graph)) {
        try { node.disconnect(); } catch { cleanupSucceeded = false; }
      }
    }
    if (!isCurrentGenerationTransaction(transaction)
        || transaction.phase !== GENERATION_PHASES.ROLLING_BACK) return false;
    if (!cleanupSucceeded) {
      transaction.phase = GENERATION_PHASES.CLEANUP_FAULTED;
      transaction.preterminalCleanupFault = Object.freeze({
        cause: 'source-stop-failed',
        sourceId: records[0]?.sourceId ?? `generation-${transaction.generationId}-rollback`,
        factOffered: false,
      });
      assertEngineOwnershipState(state);
      return false;
    }
    transaction.sources.clear();
    transaction.predictions.clear();
    transaction.track = null;
    transaction.activePlan = null;
    transaction.graph = null;
    releaseGenerationBorrow(transaction);
    transaction.phase = GENERATION_PHASES.ROLLED_BACK;
    if (state.generation === transaction) state.generation = null;
    return true;
  }

  function createGraph(transaction, context) {
    if (!mayUseGeneration(transaction) || allocationFrozen(transaction)) {
      throw new TypeError('generation allocation is frozen');
    }
    if (transaction.graph !== null) return transaction.graph;
    const allocated = [];
    try {
      const percussionTrim = context.createGain(); allocated.push(percussionTrim); injectGeneration(transaction, 'graph:allocate-percussion-trim');
      const percussionCrossfade = context.createGain(); allocated.push(percussionCrossfade); injectGeneration(transaction, 'graph:allocate-percussion-crossfade');
      const trackTrim = context.createGain(); allocated.push(trackTrim); injectGeneration(transaction, 'graph:allocate-track-trim');
      const trackCrossfade = context.createGain(); allocated.push(trackCrossfade); injectGeneration(transaction, 'graph:allocate-track-crossfade');
      const master = context.createGain(); allocated.push(master); injectGeneration(transaction, 'graph:allocate-master');
      percussionTrim.gain.setValueAtTime(0.25, context.currentTime); injectGeneration(transaction, 'graph:automate-percussion-trim');
      percussionCrossfade.gain.setValueAtTime(1, context.currentTime); injectGeneration(transaction, 'graph:automate-percussion-crossfade');
      trackTrim.gain.setValueAtTime(0.50, context.currentTime); injectGeneration(transaction, 'graph:automate-track-trim');
      trackCrossfade.gain.setValueAtTime(0, context.currentTime); injectGeneration(transaction, 'graph:automate-track-crossfade');
      master.gain.setValueAtTime(0.70, context.currentTime); injectGeneration(transaction, 'graph:automate-master');
      percussionTrim.connect(percussionCrossfade); injectGeneration(transaction, 'graph:connect-percussion-trim');
      percussionCrossfade.connect(master); injectGeneration(transaction, 'graph:connect-percussion-crossfade');
      trackTrim.connect(trackCrossfade); injectGeneration(transaction, 'graph:connect-track-trim');
      trackCrossfade.connect(master); injectGeneration(transaction, 'graph:connect-track-crossfade');
      master.connect(context.destination); injectGeneration(transaction, 'graph:connect-master');
      const graph = { percussionTrim, percussionCrossfade, trackTrim, trackCrossfade, master };
      transaction.graph = graph;
      return graph;
    } catch (error) {
      for (const node of allocated) {
        try { node.disconnect(); } catch { /* continue rollback */ }
      }
      throw error;
    }
  }

  function createPercussionAudioBuffer(transaction, context) {
    const synthesis = synthesizePercussionBuffer({
      recipeId: 'kick-snare-v1',
      sampleRate: context.sampleRate,
    });
    const audioBuffer = context.createBuffer(1, synthesis.frameCount, synthesis.sampleRate);
    injectGeneration(transaction, 'source:allocate-percussion-buffer');
    audioBuffer.copyToChannel(synthesis.preTrimMonoSamples, 0);
    return audioBuffer;
  }

  function schedulePercussion(transaction, context, request, role) {
    if (!mayUseGeneration(transaction) || allocationFrozen(transaction)) {
      throw new TypeError('generation allocation is frozen');
    }
    if (!isIdentifier(request.sourceId)
        || !Number.isFinite(request.scheduledAudioTime)
        || request.scheduledAudioTime < 0
        || transaction.sources.has(request.sourceId)) {
      throw new TypeError('percussion schedule is invalid');
    }
    transaction.lastAudioNow = context.currentTime;
    const graph = createGraph(transaction, context);
    const source = context.createBufferSource();
    const endedSignal = createSignal();
    const record = {
      sourceId: request.sourceId,
      scheduledAudioTime: request.scheduledAudioTime,
      generationId: request.generationId,
      transaction,
      role,
      startCommitted: false,
      stopAttempted: false,
      intentionallyStopping: false,
      ended: false,
      disconnected: false,
      disconnectFailed: false,
      callbackAuthority: false,
      node: source,
      endedSignal,
    };
    transaction.sources.set(record.sourceId, record);
    if (role === 'prediction') transaction.predictions.set(record.sourceId, record);
    injectGeneration(transaction, 'source:allocate');
    source.onended = () => settleSourceCallback(record);
    source.buffer = createPercussionAudioBuffer(transaction, context);
    source.connect(graph.percussionTrim); injectGeneration(transaction, 'source:connect');
    source.start(request.scheduledAudioTime);
    record.startCommitted = true;
    injectGeneration(transaction, 'source:start');
    injectGeneration(transaction, 'source:registry');
    record.callbackAuthority = true;
    return record;
  }

  function executeDirectTap(transaction, request) {
    return transaction.executor(({ context }) => (
      schedulePercussion(transaction, context, request, 'acknowledgment')
    ));
  }

  function directTap(rawRequest) {
    const request = capturePublicRequest('direct tap request is not closed', () => {
      const captured = snapshotClosedRequest(
        rawRequest,
        DIRECT_TAP_REQUEST_KEYS,
        'direct tap request is not closed',
        state,
      );
      assertHeader(captured, sessionId);
      if (allocationFrozen(state.generation)) {
        throw new TypeError('generation allocation is frozen');
      }
      if (state.generation !== null
          && state.generation.generationId !== captured.generationId) {
        throw new TypeError('another generation is active');
      }
      return captured;
    });
    if (state.generation === null) {
      state.generation = createGenerationTransaction(request.generationId);
      assertEngineOwnershipState(state);
    }
    const transaction = state.generation;
    if (!mayUseGeneration(transaction)) {
      throw new TypeError('generation allocation is frozen');
    }

    if (transaction.pendingResume !== null) {
      const pending = transaction.pendingResume;
      try {
        executeDirectTap(transaction, request);
      } catch {
        if (mayUseGeneration(transaction)) pending.failureCause = 'schedule-failed';
        clearGenerationOwnership(transaction);
      }
      return Object.freeze({
        resumeKey: pending.key,
        reusedPendingResume: true,
        settlement: pending.settlement,
      });
    }

    const key = `${sessionId}:${request.generationId}:${request.effectId}`;
    if (transaction.executor !== null && !transaction.lifetime.released) {
      try {
        executeDirectTap(transaction, request);
        const settlement = mayUseGeneration(transaction)
          ? frozenSettlement('succeeded', null)
          : frozenSettlement('failed', 'schedule-failed');
        return Object.freeze({
          resumeKey: key,
          reusedPendingResume: false,
          settlement: Promise.resolve(settlement),
        });
      } catch {
        clearGenerationOwnership(transaction);
        return Object.freeze({
          resumeKey: key,
          reusedPendingResume: false,
          settlement: Promise.resolve(frozenSettlement('failed', 'schedule-failed')),
        });
      }
    }

    const settlementSignal = createSignal();
    const pending = {
      key,
      settlement: settlementSignal.promise,
      failureCause: null,
      stale: false,
    };
    transaction.pendingResume = pending;
    const { lifetime } = transaction;
    let operation;
    let trackedBorrow;
    trackedBorrow = Promise.resolve().then(() => operation);
    transaction.borrow = trackedBorrow;
    transaction.borrowReleased = trackedBorrow.then(() => undefined, () => undefined);
    transaction.borrowReleased.then(() => {
      if (mayUseGeneration(transaction) && transaction.borrow === trackedBorrow) {
        transaction.borrow = null;
      }
    });
    try {
      operation = loadedSessionCapability.borrowForGeneration(
        request.generationId,
        (resources) => {
          if (!mayUseGeneration(transaction)) return lifetime.signal.promise;
          transaction.executor = (callback) => callback(resources);
          transaction.resumeSettlement = resources.resumeSettlement;
          try {
            executeDirectTap(transaction, request);
          } catch (error) {
            if (mayUseGeneration(transaction)) pending.failureCause = 'schedule-failed';
            const ownershipCleared = clearGenerationOwnership(transaction);
            if (!ownershipCleared
                && isCurrentGenerationTransaction(transaction)
                && transaction.phase === GENERATION_PHASES.CLEANUP_FAULTED) {
              settlementSignal.resolve(frozenSettlement('failed', pending.failureCause));
              return lifetime.signal.promise;
            }
            throw error;
          }
          return lifetime.signal.promise;
        },
      );
    } catch {
      clearGenerationOwnership(transaction);
      settlementSignal.resolve(frozenSettlement('failed', 'schedule-failed'));
      return Object.freeze({
        resumeKey: key,
        reusedPendingResume: false,
        settlement: pending.settlement,
      });
    }
    if (transaction.resumeSettlement === null) {
      clearGenerationOwnership(transaction);
      settlementSignal.resolve(frozenSettlement('failed', 'schedule-failed'));
      return Object.freeze({
        resumeKey: key,
        reusedPendingResume: false,
        settlement: pending.settlement,
      });
    }
    const resumeOutcome = Promise.resolve(transaction.resumeSettlement).then(
      () => {
        if (mayUseGeneration(transaction)
            && pending.failureCause === null
            && !pending.stale) {
          if (transaction.phase === GENERATION_PHASES.STARTING) {
            transaction.phase = GENERATION_PHASES.ACTIVE;
          }
          return frozenSettlement('succeeded', null);
        }
        return reconcileStaleResume(transaction).then(() => (
          frozenSettlement('failed', pending.failureCause ?? 'schedule-failed')
        ));
      },
      (error) => {
        const cause = error?.code === 'context-resume-failed'
          ? 'context-resume-failed'
          : 'schedule-failed';
        transaction.firstFailureCause ??= cause;
        if (mayUseGeneration(transaction)) {
          clearGenerationOwnership(transaction, { failureCause: cause });
        }
        return reconcileStaleResume(transaction).then(() => (
          frozenSettlement('failed', cause)
        ));
      },
    ).finally(() => {
      if (mayUseGeneration(transaction) && transaction.pendingResume === pending) {
        transaction.pendingResume = null;
        transaction.resumeSettlement = null;
      }
    });
    settlementSignal.resolve(resumeOutcome);
    return Object.freeze({
      resumeKey: key,
      reusedPendingResume: false,
      settlement: pending.settlement,
    });
  }

  function runBorrowCommand(
    transaction,
    request,
    callback,
    successResult = frozenSettlement('succeeded', null),
  ) {
    const pending = transaction.pendingResume;
    if (!mayUseGeneration(transaction)
        || transaction.executor === null
        || transaction.lifetime.released) {
      clearGenerationOwnership(transaction);
      return Promise.resolve(frozenSettlement('failed', 'schedule-failed'));
    }
    try {
      callback(transaction.executor);
    } catch {
      if (mayUseGeneration(transaction) && pending !== null) {
        pending.failureCause = 'schedule-failed';
      }
      clearGenerationOwnership(transaction);
      return pending?.settlement ?? Promise.resolve(frozenSettlement('failed', 'schedule-failed'));
    }
    if (pending !== null) {
      return pending.settlement.then((settlement) => (
        settlement.status === 'succeeded' ? successResult : settlement
      ));
    }
    return Promise.resolve(successResult);
  }

  function schedulePredictions(rawRequest) {
    const captured = capturePublicRequest('prediction schedule request is invalid', () => {
      const request = snapshotClosedRequest(
        rawRequest,
        PREDICTION_SCHEDULE_REQUEST_KEYS,
        'prediction schedule request is invalid',
        state,
      );
      assertHeader(request, sessionId);
      const transaction = state.generation;
      const transactionPhase = transaction?.phase;
      const transactionTermination = transaction?.termination;
      const completedTermination = state.completedTermination;
      if (transaction?.generationId !== request.generationId
          || !mayUseGeneration(transaction)
          || allocationFrozen(transaction)) {
        throw new TypeError('prediction schedule request is invalid');
      }
      const capturedPredictions = snapshotClosedDenseArray(
        request.predictions,
        { minimumLength: 1, maximumLength: 2 },
        'prediction schedule request is invalid',
        state,
      );
      const predictions = new Array(capturedPredictions.length);
      for (let index = 0; index < capturedPredictions.length; index += 1) {
        const prediction = snapshotClosedRequest(
          capturedPredictions[index],
          PREDICTION_REQUEST_KEYS,
          'prediction schedule is invalid',
          state,
        );
        predictions[index] = Object.freeze({
          sourceId: prediction.sourceId,
          scheduledAudioTime: prediction.scheduledAudioTime,
          generationId: request.generationId,
        });
      }
      Object.freeze(predictions);
      if (state.generation !== transaction
          || transaction?.phase !== transactionPhase
          || transaction?.termination !== transactionTermination
          || state.completedTermination !== completedTermination
          || !mayUseGeneration(transaction)) {
        throw new TypeError('prediction schedule request is invalid');
      }
      return Object.freeze({ request, transaction, predictions });
    });
    const { request, transaction, predictions } = captured;
    return runBorrowCommand(transaction, request, (execute) => execute(({ context }) => {
      for (let index = 0; index < predictions.length; index += 1) {
        schedulePercussion(transaction, context, predictions[index], 'prediction');
      }
    }));
  }

  function cancelPredictions(rawRequest) {
    const captured = capturePublicRequest('prediction cancellation request is invalid', () => {
      const request = snapshotClosedRequest(
        rawRequest,
        PREDICTION_CANCELLATION_REQUEST_KEYS,
        'prediction cancellation request is invalid',
        state,
      );
      assertHeader(request, sessionId);
      const transaction = state.generation;
      const transactionPhase = transaction?.phase;
      const transactionTermination = transaction?.termination;
      const completedTermination = state.completedTermination;
      if (!Number.isFinite(request.audioNow)
          || request.audioNow < 0
          || transaction?.generationId !== request.generationId
          || !mayUseGeneration(transaction)) {
        throw new TypeError('prediction cancellation request is invalid');
      }
      const sourceIds = snapshotClosedDenseArray(
        request.sourceIds,
        {},
        'prediction cancellation request is invalid',
        state,
      );
      if (state.generation !== transaction
          || transaction?.phase !== transactionPhase
          || transaction?.termination !== transactionTermination
          || state.completedTermination !== completedTermination
          || !mayUseGeneration(transaction)) {
        throw new TypeError('prediction cancellation request is invalid');
      }
      return Object.freeze({ request, transaction, sourceIds });
    });
    const { request, transaction, sourceIds } = captured;
    const cancelledSourceIds = [];
    const success = Object.freeze({
      status: 'succeeded',
      cause: null,
      cancelledSourceIds,
    });
    return runBorrowCommand(transaction, request, (execute) => execute(({ context }) => {
      transaction.lastAudioNow = request.audioNow;
      const oneSampleDuration = 1 / context.sampleRate;
      for (let index = 0; index < sourceIds.length; index += 1) {
        const sourceId = sourceIds[index];
        const record = transaction.predictions.get(sourceId);
        if (record === undefined) continue;
        if (record.scheduledAudioTime > request.audioNow + oneSampleDuration) {
          if (!attemptSourceStop(record, request.audioNow)) {
            throw new TypeError('prediction source stop failed');
          }
          injectGeneration(transaction, 'source:stop-prediction');
          cancelledSourceIds.push(sourceId);
        }
      }
      Object.freeze(cancelledSourceIds);
    }), success);
  }

  function createTrackSource(transaction, context, request, plan) {
    const graph = createGraph(transaction, context);
    const sourceId = `handoff-${request.generationId}-track`;
    if (transaction.sources.has(sourceId)) throw new TypeError('track source already exists');
    const source = context.createBufferSource();
    const endedSignal = createSignal();
    const record = {
      sourceId,
      scheduledAudioTime: plan.trackStartAudioTime,
      generationId: request.generationId,
      transaction,
      role: 'track',
      startCommitted: false,
      stopAttempted: false,
      intentionallyStopping: false,
      ended: false,
      disconnected: false,
      disconnectFailed: false,
      callbackAuthority: false,
      node: source,
      endedSignal,
    };
    transaction.sources.set(sourceId, record);
    transaction.track = record;
    injectGeneration(transaction, 'handoff:track-allocate');
    source.onended = () => settleSourceCallback(record);
    source.buffer = request.resources.buffer;
    source.connect(graph.trackTrim); injectGeneration(transaction, 'handoff:track-connect');
    const duration = plan.naturalTrackEndAudioTime - plan.trackStartAudioTime;
    source.start(plan.trackStartAudioTime, plan.trackStartOffsetSeconds, duration);
    record.startCommitted = true;
    injectGeneration(transaction, 'handoff:track-start');
    injectGeneration(transaction, 'handoff:track-registry');
    record.callbackAuthority = true;
    return record;
  }

  function assertExactPredictionSnapshot(transaction, plan) {
    const expected = plan.sourceClassifications;
    if (transaction.predictions.size !== expected.length) {
      throw new TypeError('handoff prediction registry does not match plan');
    }
    for (const classification of expected) {
      const record = transaction.predictions.get(classification.sourceId);
      if (record === undefined
          || record.transaction !== transaction
          || !Object.is(record.scheduledAudioTime, classification.scheduledAudioTime)) {
        throw new TypeError('handoff prediction registry does not match plan');
      }
    }
  }

  function executeHandoff(transaction, resources, request) {
    const { context } = resources;
    const { plan } = request;
    assertExactPredictionSnapshot(transaction, plan);
    const graph = createGraph(transaction, context);
    graph.percussionTrim.gain.setValueAtTime(plan.percussionTrimGain, plan.audioNow);
    graph.trackTrim.gain.setValueAtTime(plan.trackTrimGain, plan.audioNow);
    graph.master.gain.setValueAtTime(plan.masterGain, plan.audioNow);
    const curves = createEqualPowerCurves(plan.crossfadeCurveSampleCount);
    const duration = plan.crossfadeEndAudioTime - plan.crossfadeStartAudioTime;
    graph.percussionCrossfade.gain.setValueCurveAtTime(
      curves.percussion,
      plan.crossfadeStartAudioTime,
      duration,
    );
    injectGeneration(transaction, 'handoff:automate-percussion');
    graph.trackCrossfade.gain.setValueCurveAtTime(
      curves.music,
      plan.crossfadeStartAudioTime,
      duration,
    );
    injectGeneration(transaction, 'handoff:automate-track');

    for (const sourceId of plan.cancelSourceIds) {
      const record = transaction.predictions.get(sourceId);
      if (record === undefined) throw new TypeError('handoff cancel source is absent');
      if (!attemptSourceStop(record, plan.audioNow)) {
        throw new TypeError('handoff source stop failed');
      }
      injectGeneration(transaction, 'handoff:cancel-source');
    }
    for (let index = 0; index < plan.beatTimes.length; index += 1) {
      if (plan.adoptedSourceIdsByBeat[index].length !== 0) continue;
      schedulePercussion(transaction, context, {
        sourceId: `handoff-${request.generationId}-beat-${index + 1}`,
        scheduledAudioTime: plan.beatTimes[index],
        generationId: request.generationId,
      }, 'handoff');
      injectGeneration(transaction, 'handoff:beat-registry');
    }
    createTrackSource(transaction, context, { ...request, resources }, plan);
    transaction.lastAudioNow = plan.audioNow;
    transaction.activePlan = plan;
  }

  function commitHandoff(rawRequest) {
    const captured = capturePublicRequest('handoff request is not closed', () => {
      const request = snapshotClosedRequest(
        rawRequest,
        HANDOFF_REQUEST_KEYS,
        'handoff request is not closed',
        state,
      );
      assertHeader(request, sessionId);
      const transaction = state.generation;
      const transactionPhase = transaction?.phase;
      const transactionTermination = transaction?.termination;
      const completedTermination = state.completedTermination;
      assertHandoffPlan(request.plan);
      if (request.plan.generationId !== `generation-${request.generationId}`
          || transaction?.generationId !== request.generationId
          || !mayUseGeneration(transaction)
          || allocationFrozen(transaction)) {
        throw new TypeError('generation is not active');
      }
      if (state.generation !== transaction
          || transaction?.phase !== transactionPhase
          || transaction?.termination !== transactionTermination
          || state.completedTermination !== completedTermination) {
        throw new TypeError('generation is not active');
      }
      return Object.freeze({ request, transaction });
    });
    const { request, transaction } = captured;
    try {
      return runBorrowCommand(transaction, request, (execute) => execute((resources) => {
        executeHandoff(transaction, resources, request);
      }));
    } catch {
      clearGenerationOwnership(transaction);
      return Promise.resolve(frozenSettlement('failed', 'schedule-failed'));
    }
  }

  function heldCrossfadeValues(transaction, audioNow) {
    if (transaction.activePlan === null) {
      return { percussion: transaction.graph?.percussionCrossfade.gain.value ?? 1, music: 0 };
    }
    const plan = transaction.activePlan;
    const progress = (audioNow - plan.crossfadeStartAudioTime)
      / (plan.crossfadeEndAudioTime - plan.crossfadeStartAudioTime);
    return equalPowerGainsAtProgress(Math.max(0, Math.min(1, progress)));
  }

  function mintCleanupResult(status, cause, sourceStopSettled, ownership) {
    const result = Object.freeze({
      scope: 'generation',
      status,
      cause,
      sourceReferencesCleared: true,
      sourceStopSettled,
    });
    genuineGenerationCleanupResults.set(result, Object.freeze(ownership));
    return result;
  }

  function terminateGeneration(rawRequest) {
    const captured = capturePublicRequest('generation termination request is invalid', () => {
      const request = snapshotClosedRequest(
        rawRequest,
        TERMINATION_REQUEST_KEYS,
        'generation termination request is invalid',
        state,
      );
      assertHeader(request, sessionId);
      if (!Number.isFinite(request.audioNow)
          || request.audioNow < 0) {
        throw new TypeError('generation termination request is invalid');
      }
      const transaction = state.generation;
      const transactionPhase = transaction?.phase;
      const transactionTermination = transaction?.termination;
      const completedTerminationBefore = state.completedTermination;
      assertTerminalRecordReceipt(request.terminalRecordReceipt);
      if (transaction?.termination !== null && transaction?.termination !== undefined) {
        if (transaction.generationId !== request.generationId
            || transaction.termination.terminalRecordReceipt !== request.terminalRecordReceipt) {
          throw new TypeError('another generation termination owns the engine');
        }
        if (state.generation !== transaction
            || transaction.phase !== transactionPhase
            || transaction.termination !== transactionTermination
            || state.completedTermination !== completedTerminationBefore) {
          throw new TypeError('generation termination request is invalid');
        }
        return Object.freeze({ cleanupPromise: transaction.termination.cleanupPromise });
      }
      const completedTermination = state.completedTermination;
      if (completedTermination?.generationId === request.generationId) {
        if (completedTermination.terminalRecordReceipt !== request.terminalRecordReceipt) {
          throw new TypeError('another generation termination owns the engine');
        }
        if (state.generation !== transaction
            || transaction?.phase !== transactionPhase
            || transaction?.termination !== transactionTermination
            || state.completedTermination !== completedTerminationBefore) {
          throw new TypeError('generation termination request is invalid');
        }
        return Object.freeze({ cleanupPromise: completedTermination.cleanupPromise });
      }
      const cleanupFaultedOwner = isCurrentGenerationTransaction(transaction)
        && transaction.phase === GENERATION_PHASES.CLEANUP_FAULTED
        && transaction.preterminalCleanupFault !== null;
      if (transaction?.generationId !== request.generationId
          || (!mayUseGeneration(transaction) && !cleanupFaultedOwner)) {
        throw new TypeError('generation is not active');
      }
      if (state.generation !== transaction
          || transaction.phase !== transactionPhase
          || transaction.termination !== transactionTermination
          || state.completedTermination !== completedTerminationBefore) {
        throw new TypeError('generation termination request is invalid');
      }
      return Object.freeze({ cleanupPromise: null, request, transaction });
    }, terminateDuringFaultConsumer);
    if (captured.cleanupPromise !== null) return captured.cleanupPromise;
    const { request, transaction } = captured;

    const preterminalCleanupFault = transaction.preterminalCleanupFault;
    transaction.phase = GENERATION_PHASES.TERMINATING;
    transaction.preterminalCleanupFault = null;
    let resolveCleanupPromise;
    let rejectCleanupPromise;
    const cleanupPromise = new Promise((resolve, reject) => {
      resolveCleanupPromise = resolve;
      rejectCleanupPromise = reject;
    });
    const termination = {
      terminalRecordReceipt: request.terminalRecordReceipt,
      cleanupPromise,
      result: null,
    };
    transaction.termination = termination;
    const pendingAtTermination = transaction.pendingResume;
    poisonPendingResume(transaction, 'schedule-failed');
    const borrowToRelease = transaction.borrowReleased;
    transaction.borrow = null;
    const records = [...transaction.sources.values()];
    revokeCallbackAuthority(records);
    const graph = transaction.graph;
    const generationId = transaction.generationId;
    let setupFailed = false;
    if (graph !== null) {
      let held = null;
      try {
        held = heldCrossfadeValues(transaction, request.audioNow);
      } catch {
        setupFailed = true;
      }
      if (held !== null) {
        for (const [node, value] of [
          [graph.percussionCrossfade, held.percussion],
          [graph.trackCrossfade, held.music],
        ]) {
          try {
            const parameter = node.gain;
            parameter.cancelScheduledValues(request.audioNow);
            parameter.setValueAtTime(value, request.audioNow);
            parameter.linearRampToValueAtTime(0, request.audioNow + CANCELLATION_RAMP_SECONDS);
          } catch {
            setupFailed = true;
          }
        }
      }
    }
    for (const record of records) {
      if (!attemptSourceStop(record, request.audioNow + CANCELLATION_STOP_SECONDS)) {
        setupFailed = true;
      }
    }
    const faultConsumerSettlement = activeSourceCallbackSettlement;
    if (faultConsumerSettlement !== null
        && faultConsumerSettlement.stage === 'fault-consumer'
        && faultConsumerSettlement.transaction === transaction
        && state.generation === transaction
        && transaction.phase === GENERATION_PHASES.TERMINATING
        && transaction.termination === termination) {
      for (const record of records) {
        if (!faultConsumerSettlement.pending.has(record) || record.ended) continue;
        record.ended = true;
        record.endedSignal.resolve();
      }
    }

    transaction.sources.clear();
    transaction.predictions.clear();
    transaction.track = null;
    transaction.graph = null;
    transaction.executor = null;
    transaction.pendingResume = null;
    transaction.resumeSettlement = null;
    transaction.activePlan = null;

    const ownership = {
      engine,
      loadedSessionCapability,
      sessionId,
      generationId,
      terminalRecordReceipt: request.terminalRecordReceipt,
    };
    const cleanupOperation = (async () => {
      let sourceStopSettled = !setupFailed;
      let cause = preterminalCleanupFault?.cause
        ?? (setupFailed ? 'source-stop-failed' : null);
      let deadline = null;
      let deadlineOutcome = null;
      let cancelDeadline = null;
      const pendingSourceSettlement = records.some((record) => !record.ended);
      const staleResumeReconciliation = pendingAtTermination === null
        ? null
        : reconcileStaleResume(transaction);
      if (pendingSourceSettlement
          || borrowToRelease !== null
          || staleResumeReconciliation !== null) {
        try {
          deadline = createCleanupDeadline('generation-cleanup', GENERATION_CLEANUP_DEADLINE_MS);
          let deadlinePromiseValue;
          let deadlineCancel;
          try {
            deadlinePromiseValue = deadline?.promise;
            deadlineCancel = deadline?.cancel;
          } catch {
            throw new TypeError();
          }
          const deadlinePromise = captureThenable(deadlinePromiseValue);
          if (deadlinePromise === null || typeof deadlineCancel !== 'function') throw new TypeError();
          cancelDeadline = () => Reflect.apply(deadlineCancel, deadline, []);
          deadlineOutcome = deadlinePromise.then(() => 'deadline', () => 'deadline');
        } catch {
          if (cause === null) cause = 'cleanup-timeout';
        }
      }
      if (!setupFailed && pendingSourceSettlement) {
        if (deadlineOutcome === null) {
          sourceStopSettled = false;
          cause ??= 'cleanup-timeout';
        } else {
          const allEnded = Promise.all(records.map(({ ended, endedSignal }) => (
            ended ? Promise.resolve() : endedSignal.promise
          ))).then(() => 'settled');
          const outcome = await Promise.race([allEnded, deadlineOutcome]);
          sourceStopSettled = outcome === 'settled' || records.every(({ ended }) => ended);
          if (!sourceStopSettled) cause ??= 'cleanup-timeout';
        }
      }
      for (const record of records) {
        if (!disconnectRecord(record)) cause ??= 'source-stop-failed';
      }
      if (graph !== null) {
        for (const node of Object.values(graph)) {
          try { node.disconnect(); } catch { cause ??= 'source-stop-failed'; }
        }
      }
      releaseGenerationBorrow(transaction);
      if (borrowToRelease !== null) {
        if (deadlineOutcome === null) {
          cause ??= 'cleanup-timeout';
        } else {
          const releaseOutcome = await Promise.race([
            borrowToRelease.then(() => 'released'),
            deadlineOutcome,
          ]);
          if (releaseOutcome !== 'released') cause ??= 'cleanup-timeout';
        }
      }
      if (staleResumeReconciliation !== null) {
        if (deadlineOutcome === null) {
          cause ??= 'cleanup-timeout';
        } else {
          const reconciliationOutcome = await Promise.race([
            staleResumeReconciliation,
            deadlineOutcome,
          ]);
          if (reconciliationOutcome !== 'suspended') cause ??= 'cleanup-timeout';
        }
      }
      const result = mintCleanupResult(
        cause === null ? 'succeeded' : 'failed',
        cause === null ? null : 'source-stop-failed',
        sourceStopSettled,
        ownership,
      );
      try { cancelDeadline?.(); } catch { /* immutable result is already determined */ }
      return result;
    })();
    cleanupOperation.then(
      (result) => {
        try {
          if (isCurrentGenerationTransaction(transaction)
              && transaction.termination === termination
              && termination.cleanupPromise === cleanupPromise) {
            termination.result = result;
            if (result.status === 'succeeded') {
              transaction.phase = GENERATION_PHASES.TERMINATED;
              state.completedTermination = Object.freeze({
                generationId,
                terminalRecordReceipt: termination.terminalRecordReceipt,
                cleanupPromise,
                result,
              });
              if (state.generation === transaction) state.generation = null;
            } else {
              transaction.phase = GENERATION_PHASES.TERMINAL_FAILED;
              scheduleFailedTransactionCompaction(transaction, termination, cleanupPromise);
            }
          }
          resolveCleanupPromise(result);
        } catch (error) {
          rejectCleanupPromise(error);
        }
      },
      (error) => {
        try {
          if (isCurrentGenerationTransaction(transaction)
              && transaction.termination === termination
              && termination.cleanupPromise === cleanupPromise) {
            transaction.phase = GENERATION_PHASES.TERMINAL_FAILED;
          }
        } catch (finalizationError) {
          rejectCleanupPromise(finalizationError);
          return;
        }
        rejectCleanupPromise(error);
      }
    );
    return cleanupPromise;
  }

  const engine = Object.freeze({
    inspect,
    directTap,
    schedulePredictions,
    cancelPredictions,
    commitHandoff,
    terminateGeneration,
  });
  genuineEngines.add(engine);
  capabilityEngineAuthorities.set(loadedSessionCapability, engine);
  return engine;
}
