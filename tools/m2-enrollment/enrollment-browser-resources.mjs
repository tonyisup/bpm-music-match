import { assertEnrollmentBuildCommit } from './enrollment-build.mjs';

assertEnrollmentBuildCommit('__ENROLLMENT_BUILD_COMMIT__');

import {
  COUNTER_KEYS,
  createDeferred,
  isObjectLike,
  typedError,
} from './enrollment-browser-shared.mjs';

const CONTEXT_CLOSE_DEADLINE_MILLISECONDS = 1_000;
const PREVIEW_STOP_DEADLINE_MILLISECONDS = 1_000;

function snapshotMethod(value, methodName, errorCode) {
  let method;
  try {
    method = value[methodName];
  } catch {
    throw typedError(errorCode);
  }
  if (typeof method !== 'function') throw typedError(errorCode);
  return (...args) => method.call(value, ...args);
}

function snapshotContext(value, close) {
  if (!isObjectLike(value)) throw typedError('track-decode-failed');
  let destination;
  try {
    destination = value.destination;
  } catch {
    throw typedError('track-decode-failed');
  }
  if (!isObjectLike(destination)) throw typedError('track-decode-failed');
  return {
    value,
    destination,
    close,
    createBufferSource: snapshotMethod(value, 'createBufferSource', 'track-decode-failed'),
    decodeAudioData: snapshotMethod(value, 'decodeAudioData', 'track-decode-failed'),
    resume: snapshotMethod(value, 'resume', 'track-decode-failed'),
  };
}

function snapshotDecodedBuffer(value) {
  if (!isObjectLike(value)) throw typedError('track-decode-failed');
  let metadata;
  let copyFromChannel;
  try {
    metadata = {
      durationSeconds: value.duration,
      channelCount: value.numberOfChannels,
      sampleRate: value.sampleRate,
      frameCount: value.length,
    };
    copyFromChannel = value.copyFromChannel;
  } catch {
    throw typedError('track-decode-failed');
  }
  if (typeof copyFromChannel !== 'function') throw typedError('track-decode-failed');
  return {
    value,
    metadata: Object.freeze(metadata),
    copyFromChannel: (...args) => copyFromChannel.call(value, ...args),
  };
}

function snapshotSource(value) {
  if (!isObjectLike(value)) throw typedError('preview-start-failed');
  return {
    value,
    connect: snapshotMethod(value, 'connect', 'preview-start-failed'),
    disconnect: snapshotMethod(value, 'disconnect', 'preview-start-failed'),
    start: snapshotMethod(value, 'start', 'preview-start-failed'),
    stop: snapshotMethod(value, 'stop', 'preview-start-failed'),
  };
}

export function createResourceBoundary({
  createAudioContext,
  setTimeoutFn,
  clearTimeoutFn,
}) {
  const counters = Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0]));

  function changeCounter(key, amount) {
    const nextValue = counters[key] + amount;
    if (!COUNTER_KEYS.includes(key) || !Number.isSafeInteger(nextValue) || nextValue < 0) {
      throw new Error('internal resource counter invariant failed');
    }
    counters[key] = nextValue;
  }

  function createOwner() {
    return {
      sha256: null,
      rawBuffer: null,
      decodedBuffer: null,
      decoded: null,
      context: null,
      registry: null,
      preview: null,
      acceptDecodedSettlements: true,
      allocationsFrozen: false,
      allocationInProgress: false,
      closeStarted: false,
      closeOutcomePromise: null,
      resourcesReleased: false,
      teardownPromise: null,
      teardownResult: null,
    };
  }

  function snapshotCounters() {
    return Object.fromEntries(COUNTER_KEYS.map((key) => [key, counters[key]]));
  }

  function ownRaw(resourceOwner, rawBuffer) {
    if (resourceOwner.allocationsFrozen || resourceOwner.rawBuffer !== null) {
      throw new Error('internal raw-buffer ownership invariant failed');
    }
    resourceOwner.rawBuffer = rawBuffer;
    changeCounter('rawBuffers', 1);
  }

  function releaseRaw(resourceOwner) {
    if (resourceOwner.rawBuffer === null) return;
    resourceOwner.rawBuffer = null;
    changeCounter('rawBuffers', -1);
  }

  function allocateContext(resourceOwner) {
    if (resourceOwner.allocationsFrozen || resourceOwner.context !== null) {
      throw typedError('track-decode-failed');
    }

    resourceOwner.allocationInProgress = true;
    try {
      let contextValue;
      try {
        contextValue = createAudioContext();
      } catch {
        throw typedError('track-decode-failed');
      }
      if (!isObjectLike(contextValue)) throw typedError('track-decode-failed');

      let close = null;
      try {
        close = snapshotMethod(contextValue, 'close', 'track-decode-failed');
      } catch {
        resourceOwner.context = { value: contextValue, close: null };
        changeCounter('contexts', 1);
        throw typedError('track-decode-failed');
      }

      resourceOwner.context = { value: contextValue, close };
      changeCounter('contexts', 1);
      const context = snapshotContext(contextValue, close);
      resourceOwner.context = context;
      resourceOwner.registry = new Set();
      changeCounter('sourceRegistries', 1);
      return context;
    } catch {
      throw typedError('track-decode-failed');
    } finally {
      resourceOwner.allocationInProgress = false;
    }
  }

  function captureDecodedBuffer(value) {
    return snapshotDecodedBuffer(value);
  }

  function ownDecodedBuffer(resourceOwner, decodedBuffer) {
    if (!resourceOwner.acceptDecodedSettlements || resourceOwner.allocationsFrozen) return false;
    if (resourceOwner.decodedBuffer !== null) {
      throw new Error('internal decoded-buffer ownership invariant failed');
    }
    resourceOwner.decodedBuffer = decodedBuffer;
    changeCounter('decodedBuffers', 1);
    return true;
  }

  function activePreviewRecord(resourceOwner) {
    const record = resourceOwner?.preview ?? null;
    return record !== null && !record.settled ? record : null;
  }

  function settleSource(resourceOwner, record) {
    if (record.settled) return;
    record.settled = true;
    const source = record.source;
    record.source = null;
    try {
      source?.disconnect();
    } catch {
      // A disconnected or closed source is already application-settled.
    }
    resourceOwner.registry?.delete(record);
    if (resourceOwner.preview === record) resourceOwner.preview = null;
    changeCounter('previewSources', -1);
    record.settlement.resolve();
  }

  function requestSourceStop(resourceOwner, record) {
    if (record.settled) return true;
    if (record.stopRequested) return record.stopFailed !== true;
    record.stopRequested = true;
    try {
      record.source.stop();
      return true;
    } catch {
      record.stopFailed = true;
      return false;
    }
  }

  function waitForSourceSettlement(record) {
    if (record.settled) return Promise.resolve({ kind: 'settled' });
    if (record.settlementWaitPromise !== null) return record.settlementWaitPromise;
    let timerId = null;
    let resolveTimeout;
    const timeout = new Promise((resolve) => {
      resolveTimeout = resolve;
    });
    try {
      timerId = setTimeoutFn(() => {
        timerId = null;
        resolveTimeout({ kind: 'timeout' });
      }, PREVIEW_STOP_DEADLINE_MILLISECONDS);
    } catch {
      record.settlementWaitPromise = Promise.resolve({ kind: 'timer-failed' });
      return record.settlementWaitPromise;
    }
    record.settlementWaitPromise = Promise.race([
      record.settlement.promise.then(() => ({ kind: 'settled' })),
      timeout,
    ]).then((outcome) => {
      if (timerId !== null) {
        const activeTimerId = timerId;
        timerId = null;
        try {
          clearTimeoutFn(activeTimerId);
        } catch {
          // Timer cleanup cannot replace source-settlement truth.
        }
      }
      return outcome;
    });
    return record.settlementWaitPromise;
  }

  function createSourceRecord(resourceOwner, { offsetSeconds, startedAtContextTime }) {
    if (resourceOwner.allocationsFrozen || resourceOwner.context === null) {
      throw typedError('preview-invalidated');
    }
    let sourceValue;
    try {
      sourceValue = resourceOwner.context.createBufferSource();
    } catch {
      throw typedError('preview-start-failed');
    }
    const source = snapshotSource(sourceValue);
    const record = {
      source,
      settlement: createDeferred(),
      settlementWaitPromise: null,
      settled: false,
      stopRequested: false,
      stopFailed: false,
      offsetSeconds,
      startedAtContextTime,
    };
    resourceOwner.registry.add(record);
    resourceOwner.preview = record;
    changeCounter('previewSources', 1);
    return record;
  }

  function startSource(resourceOwner, record) {
    try {
      record.source.value.buffer = resourceOwner.decodedBuffer.value;
      record.source.value.onended = () => settleSource(resourceOwner, record);
      record.source.connect(resourceOwner.context.destination);
      record.source.start(0, record.offsetSeconds);
    } catch {
      settleSource(resourceOwner, record);
      throw typedError('preview-start-failed');
    }
  }

  function readCurrentTime(resourceOwner, errorCode) {
    let currentTime;
    try {
      currentTime = resourceOwner.context.value.currentTime;
    } catch {
      throw typedError(errorCode);
    }
    if (!Number.isFinite(currentTime) || currentTime < 0) throw typedError(errorCode);
    return currentTime;
  }

  function releaseSuccessfullyClosedOwner(resourceOwner) {
    if (resourceOwner.resourcesReleased) return;
    resourceOwner.resourcesReleased = true;
    releaseRaw(resourceOwner);
    for (const record of [...(resourceOwner.registry ?? [])]) settleSource(resourceOwner, record);
    if (resourceOwner.decodedBuffer !== null) {
      resourceOwner.decodedBuffer = null;
      resourceOwner.decoded = null;
      changeCounter('decodedBuffers', -1);
    }
    if (resourceOwner.context !== null) {
      resourceOwner.context = null;
      changeCounter('contexts', -1);
    }
    if (resourceOwner.registry !== null) {
      resourceOwner.registry.clear();
      resourceOwner.registry = null;
      changeCounter('sourceRegistries', -1);
    }
    resourceOwner.preview = null;
  }

  function genuineCloseOutcome(resourceOwner) {
    let closeResult;
    try {
      closeResult = resourceOwner.context.close();
    } catch {
      return Promise.resolve({ kind: 'rejected' });
    }
    if (!isObjectLike(closeResult)) return Promise.resolve({ kind: 'rejected' });

    let thenMethod;
    try {
      thenMethod = closeResult.then;
    } catch {
      return Promise.resolve({ kind: 'rejected' });
    }
    if (typeof thenMethod !== 'function') return Promise.resolve({ kind: 'rejected' });

    return new Promise((resolve, reject) => {
      try {
        thenMethod.call(closeResult, resolve, reject);
      } catch (error) {
        reject(error);
      }
    }).then(
      () => ({ kind: 'closed' }),
      () => ({ kind: 'rejected' }),
    );
  }

  function startContextClose(resourceOwner) {
    if (!resourceOwner.allocationsFrozen || resourceOwner.allocationInProgress) {
      throw new Error('context close began before allocation state was fixed');
    }
    if (resourceOwner.closeStarted) return resourceOwner.closeOutcomePromise;
    resourceOwner.closeStarted = true;

    if (resourceOwner.context === null) {
      releaseSuccessfullyClosedOwner(resourceOwner);
      resourceOwner.closeOutcomePromise = Promise.resolve({ kind: 'closed' });
      return resourceOwner.closeOutcomePromise;
    }

    const actualOutcome = genuineCloseOutcome(resourceOwner);
    actualOutcome.then((outcome) => {
      if (outcome.kind === 'closed') releaseSuccessfullyClosedOwner(resourceOwner);
    });

    let timerId = null;
    let resolveTimeout;
    const timeout = new Promise((resolve) => {
      resolveTimeout = resolve;
    });
    try {
      timerId = setTimeoutFn(() => {
        timerId = null;
        resolveTimeout({ kind: 'timeout' });
      }, CONTEXT_CLOSE_DEADLINE_MILLISECONDS);
    } catch {
      resourceOwner.closeOutcomePromise = Promise.resolve({ kind: 'rejected' });
      return resourceOwner.closeOutcomePromise;
    }
    resourceOwner.closeOutcomePromise = Promise.race([actualOutcome, timeout]).then((outcome) => {
      if (timerId !== null) {
        const activeTimerId = timerId;
        timerId = null;
        try {
          clearTimeoutFn(activeTimerId);
        } catch {
          // Timer cleanup cannot rewrite genuine close settlement.
        }
      }
      return outcome;
    });
    return resourceOwner.closeOutcomePromise;
  }

  function beginTeardown(resourceOwner) {
    resourceOwner.allocationsFrozen = true;
    resourceOwner.acceptDecodedSettlements = false;
    releaseRaw(resourceOwner);
    for (const record of resourceOwner.registry ?? []) requestSourceStop(resourceOwner, record);

    if (resourceOwner.allocationInProgress) {
      return Promise.resolve().then(() => startContextClose(resourceOwner));
    }
    return startContextClose(resourceOwner);
  }

  return Object.freeze({
    activePreviewRecord,
    allocateContext,
    beginTeardown,
    captureDecodedBuffer,
    createOwner,
    createSourceRecord,
    ownDecodedBuffer,
    ownRaw,
    readCurrentTime,
    releaseRaw,
    requestSourceStop,
    settleSource,
    snapshotCounters,
    startSource,
    waitForSourceSettlement,
  });
}
