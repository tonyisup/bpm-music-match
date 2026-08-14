import { assertBuildIdentity } from '../build-identity.mjs';
import {
  ASSET_IDENTITY,
  EXPERIMENT_CONFIG_IDENTITY,
  ONE_TRACK_CONFIG,
} from '../config.mjs';
import { TRACK_METADATA } from '../track-metadata.mjs';
import { acceptValidatedLoadReceipt } from './loaded-session.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';
const MAX_COMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_DECODED_DURATION_SECONDS = 360;
const MAX_DECODED_PCM_BYTES = 160 * 1024 * 1024;
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 96_000;
const BOUNDED_EDGE_SAMPLE_COUNT = 4_096;
const CUE_WINDOW_SECONDS = 0.050;
const MIN_CUE_RMS = 0.010;
const MIN_CUE_PEAK = 0.050;
const HASH_DECODE_DEADLINE_MS = 15_000;
const CONTEXT_CLOSE_DEADLINE_MS = 1_000;

const genuineValidatedLoadReceipts = new WeakSet();
const consumedValidatedLoadReceipts = new WeakSet();
const validatedLoadPayloads = new WeakMap();

const CANCELLED = Object.freeze({ kind: 'cancelled' });
const DEADLINE = Object.freeze({ kind: 'deadline' });

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

export class LocalTrackLoaderError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LocalTrackLoaderError';
    this.code = code;
    Object.freeze(this);
  }
}

function fail(code) {
  throw new LocalTrackLoaderError(code);
}

function createSignal() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function captureThenable(value) {
  if (value instanceof Promise) return value;
  let then;
  try {
    then = value?.then;
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

function readDependency(dependencies, name) {
  let value;
  try {
    value = dependencies[name];
  } catch {
    fail('loader-dependencies-invalid');
  }
  if (typeof value !== 'function') {
    fail('loader-dependencies-invalid');
  }
  return value.bind(dependencies);
}

function createDeadline(createDeadline, kind, milliseconds) {
  let deadline;
  try {
    deadline = createDeadline(kind, milliseconds);
  } catch {
    fail('loader-deadline-invalid');
  }
  let promiseValue;
  let cancel;
  try {
    promiseValue = deadline?.promise;
    cancel = deadline?.cancel;
  } catch {
    fail('loader-deadline-invalid');
  }
  const promise = captureThenable(promiseValue);
  if (!isObject(deadline) || promise === null || typeof cancel !== 'function') {
    fail('loader-deadline-invalid');
  }
  return Object.freeze({
    promise,
    cancel() {
      try {
        cancel.call(deadline);
      } catch {
        // Timer cancellation cannot rewrite an observed loader outcome.
      }
    },
  });
}

function operationOutcome(operation, failureCode) {
  const promise = captureThenable(operation);
  if (promise === null) {
    return Promise.resolve({ kind: 'failed', code: failureCode });
  }
  return promise.then(
    (value) => ({ kind: 'value', value }),
    () => ({ kind: 'failed', code: failureCode }),
  );
}

async function awaitOperation(operation, attempt, failureCode, deadline = null) {
  const contenders = [
    operationOutcome(operation, failureCode),
    attempt.invalidation.promise.then(() => CANCELLED),
  ];
  if (deadline !== null) {
    contenders.push(Promise.resolve(deadline.promise).then(
      () => DEADLINE,
      () => DEADLINE,
    ));
  }
  const outcome = await Promise.race(contenders);
  if (outcome === CANCELLED || !attempt.isCurrent()) {
    fail('track-load-cancelled');
  }
  if (outcome === DEADLINE) {
    attempt.invalidate();
    fail('track-load-deadline');
  }
  if (outcome.kind === 'failed') {
    fail(outcome.code);
  }
  return outcome.value;
}

function captureFileFacts(file) {
  if (!isObject(file)) fail('track-identity-failed');
  let name;
  let type;
  let size;
  try {
    name = file.name;
    type = file.type;
    size = file.size;
  } catch {
    fail('track-identity-failed');
  }
  if (typeof name !== 'string' || typeof type !== 'string') {
    fail('track-identity-failed');
  }
  const dotIndex = name.lastIndexOf('.');
  const extensionMatches = dotIndex >= 0
    && name.slice(dotIndex) === TRACK_METADATA.allowedExtension;
  const mimeMatches = type === TRACK_METADATA.allowedMimeType;
  if (!extensionMatches || !mimeMatches) fail('track-identity-failed');
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_COMPRESSED_BYTES) {
    fail('track-bounds-invalid');
  }
  if (size !== TRACK_METADATA.compressedBytes) fail('track-identity-failed');
  return true;
}

function captureDecodedFacts(buffer) {
  if (!isObject(buffer)) fail('track-decode-failed');
  let duration;
  let channelCount;
  let sampleRate;
  let frameCount;
  let copyFromChannel;
  try {
    duration = buffer.duration;
    channelCount = buffer.numberOfChannels;
    sampleRate = buffer.sampleRate;
    frameCount = buffer.length;
    copyFromChannel = buffer.copyFromChannel;
  } catch {
    fail('track-metadata-invalid');
  }
  if (!Number.isFinite(duration) || duration < 0
      || !Number.isSafeInteger(channelCount)
      || !Number.isFinite(sampleRate)
      || !Number.isSafeInteger(frameCount)
      || frameCount < 0) {
    fail('track-metadata-invalid');
  }
  const decodedPcmBytes = frameCount * channelCount * 4;
  if (duration > MAX_DECODED_DURATION_SECONDS
      || channelCount < 1 || channelCount > 2
      || sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE
      || !Number.isSafeInteger(decodedPcmBytes)
      || decodedPcmBytes > MAX_DECODED_PCM_BYTES) {
    fail('track-bounds-invalid');
  }
  if (Math.abs(duration - TRACK_METADATA.decodedDurationSeconds)
        > TRACK_METADATA.decodedDurationToleranceSeconds
      || channelCount !== TRACK_METADATA.decodedChannelCount
      || sampleRate !== TRACK_METADATA.decodedSampleRate
      || frameCount !== TRACK_METADATA.decodedFrameCount
      || decodedPcmBytes !== TRACK_METADATA.calculatedDecodedPcmBytes) {
    fail('track-metadata-invalid');
  }
  if (typeof copyFromChannel !== 'function') fail('track-metadata-invalid');
  return Object.freeze({
    duration,
    channelCount,
    sampleRate,
    frameCount,
    copyFromChannel: copyFromChannel.bind(buffer),
  });
}

function copyBoundedSamples(facts, channelNumber, startFrame, sampleCount) {
  const samples = new Float32Array(sampleCount);
  try {
    facts.copyFromChannel(samples, channelNumber, startFrame);
  } catch {
    fail('track-metadata-invalid');
  }
  for (let index = 0; index < samples.length; index += 1) {
    if (!Number.isFinite(samples[index])) fail('track-metadata-invalid');
  }
  return samples;
}

function validateBoundedSamples(buffer) {
  const facts = captureDecodedFacts(buffer);
  const cueStart = Math.floor(
    ONE_TRACK_CONFIG.targetEntryDownbeatSeconds * facts.sampleRate,
  );
  const cueSamples = Math.ceil(CUE_WINDOW_SECONDS * facts.sampleRate);
  if (cueStart < 0 || cueStart + cueSamples > facts.frameCount) {
    fail('track-metadata-invalid');
  }
  let squareSum = 0;
  let peak = 0;
  let count = 0;
  for (let channel = 0; channel < facts.channelCount; channel += 1) {
    copyBoundedSamples(facts, channel, 0, BOUNDED_EDGE_SAMPLE_COUNT);
    copyBoundedSamples(
      facts,
      channel,
      facts.frameCount - BOUNDED_EDGE_SAMPLE_COUNT,
      BOUNDED_EDGE_SAMPLE_COUNT,
    );
    const cue = copyBoundedSamples(facts, channel, cueStart, cueSamples);
    for (let index = 0; index < cue.length; index += 1) {
      const absolute = Math.abs(cue[index]);
      squareSum += cue[index] * cue[index];
      if (absolute > peak) peak = absolute;
      count += 1;
    }
  }
  const rms = Math.sqrt(squareSum / count);
  if (!Number.isFinite(rms) || rms < MIN_CUE_RMS || peak < MIN_CUE_PEAK) {
    fail('track-metadata-invalid');
  }
  return true;
}

async function closeFailedAttempt(attempt, createDeadlineDependency, notifyContextCleared) {
  if (attempt.closePromise !== null) return attempt.closePromise;
  const context = attempt.context;
  if (context === null) return true;
  attempt.allocationFrozen = true;
  attempt.closePromise = (async () => {
    let state;
    try {
      state = context.state;
    } catch {
      state = null;
    }
    if (state === 'closed') {
      attempt.context = null;
      notifyContextCleared();
      return true;
    }
    let closeResult;
    try {
      closeResult = context.close();
    } catch {
      return false;
    }
    const closePromise = captureThenable(closeResult);
    if (closePromise === null) return false;
    const closeOutcome = closePromise.then(
      () => 'closed',
      () => 'failed',
    );
    closeOutcome.then((outcome) => {
      if (outcome === 'closed' && attempt.context === context) {
        attempt.context = null;
        notifyContextCleared();
      }
    });
    let deadline;
    try {
      deadline = createDeadline(
        createDeadlineDependency,
        'context-close',
        CONTEXT_CLOSE_DEADLINE_MS,
      );
    } catch {
      return false;
    }
    const outcome = await Promise.race([
      closeOutcome,
      deadline.promise.then(() => 'timed-out', () => 'timed-out'),
    ]);
    if (outcome !== 'timed-out') deadline.cancel();
    return outcome === 'closed';
  })();
  return attempt.closePromise;
}

function validateLoadedSessionId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    fail('loaded-session-id-invalid');
  }
  return value;
}

function mintValidatedLoadReceipt(payload) {
  const receipt = Object.freeze(Object.create(null));
  genuineValidatedLoadReceipts.add(receipt);
  validatedLoadPayloads.set(receipt, payload);
  return receipt;
}

// This is the only cross-module receipt authority. loaded-session imports it,
// but no receipt ever leaves the loader-to-owner handoff. The circular import is
// initialization-safe because neither module calls the other at module scope.
export function assertAndConsumeValidatedLoadReceipt(receipt) {
  if (!isObject(receipt)
      || !genuineValidatedLoadReceipts.has(receipt)
      || consumedValidatedLoadReceipts.has(receipt)) {
    throw new TypeError('validated load receipt must be genuine and unused');
  }
  consumedValidatedLoadReceipts.add(receipt);
  const payload = validatedLoadPayloads.get(receipt);
  validatedLoadPayloads.delete(receipt);
  return payload;
}

export function createLocalTrackLoader(dependencies) {
  if (!isObject(dependencies)) fail('loader-dependencies-invalid');
  const readFile = readDependency(dependencies, 'readFile');
  const sha256 = readDependency(dependencies, 'sha256');
  const createAudioContext = readDependency(dependencies, 'createAudioContext');
  const createDeadlineDependency = readDependency(dependencies, 'createDeadline');

  let state = 'idle';
  let activeAttempt = null;
  let loadedCapability = null;
  let allocatedContextCount = 0;
  let loadedSessionCount = 0;
  let nextToken = 1;

  function diagnostics() {
    return Object.freeze({
      state,
      allocatedContextCount,
      loadedSessionCount,
    });
  }

  function contextCleared() {
    allocatedContextCount = 0;
  }

  function onOwnerRelease(event) {
    loadedCapability = null;
    loadedSessionCount = 0;
    if (event.contextCleared === true) contextCleared();
    if (event.status === 'succeeded') {
      state = 'idle';
    } else {
      state = 'recovery';
    }
  }

  async function performLoad(request, attempt) {
    let file = null;
    let rawBytes = null;
    let decodedBuffer = null;
    let aggregateDeadline = null;
    try {
      if (!isObject(request)) fail('track-identity-failed');
      const loadedSessionId = validateLoadedSessionId(request.loadedSessionId);
      file = request.file;
      request = null;
      captureFileFacts(file);

      let readOperation;
      try {
        readOperation = readFile(file);
      } catch {
        fail('track-read-failed');
      }
      file = null;
      rawBytes = await awaitOperation(
        readOperation,
        attempt,
        'track-read-failed',
      );
      if (!isObject(rawBytes)
          || rawBytes.byteLength !== TRACK_METADATA.compressedBytes) {
        fail('track-identity-failed');
      }

      aggregateDeadline = createDeadline(
        createDeadlineDependency,
        'hash-decode',
        HASH_DECODE_DEADLINE_MS,
      );
      let hashOperation;
      try {
        hashOperation = sha256(rawBytes);
      } catch {
        fail('track-identity-failed');
      }
      const digest = await awaitOperation(
        hashOperation,
        attempt,
        'track-identity-failed',
        aggregateDeadline,
      );
      if (typeof digest !== 'string' || digest !== TRACK_METADATA.sha256) {
        fail('track-identity-failed');
      }

      if (!attempt.isCurrent() || attempt.allocationFrozen) {
        fail('track-load-cancelled');
      }
      let context;
      try {
        context = createAudioContext();
      } catch {
        fail('track-decode-failed');
      }
      if (!isObject(context)) fail('track-decode-failed');
      attempt.context = context;
      allocatedContextCount = 1;
      if (typeof context.decodeAudioData !== 'function'
          || typeof context.resume !== 'function'
          || typeof context.suspend !== 'function'
          || typeof context.close !== 'function') {
        fail('track-decode-failed');
      }
      let contextState;
      try {
        contextState = context.state;
      } catch {
        fail('track-decode-failed');
      }
      if (contextState === 'closed') fail('track-decode-failed');

      let decodeOperation;
      try {
        decodeOperation = context.decodeAudioData(rawBytes);
      } catch {
        fail('track-decode-failed');
      }
      rawBytes = null;
      decodedBuffer = await awaitOperation(
        decodeOperation,
        attempt,
        'track-decode-failed',
        aggregateDeadline,
      );
      let decodedContextState;
      try {
        decodedContextState = context.state;
      } catch {
        fail('track-decode-failed');
      }
      if (decodedContextState === 'closed') fail('track-decode-failed');
      validateBoundedSamples(decodedBuffer);
      if (!attempt.isCurrent() || attempt.allocationFrozen) {
        fail('track-load-cancelled');
      }

      aggregateDeadline.cancel();
      aggregateDeadline = null;
      attempt.allocationFrozen = true;
      const receipt = mintValidatedLoadReceipt(Object.freeze({
        loadedSessionId,
        context,
        buffer: decodedBuffer,
        assetIdentity: ASSET_IDENTITY,
        experimentConfigIdentity: EXPERIMENT_CONFIG_IDENTITY,
        createDeadline: createDeadlineDependency,
        onOwnerRelease,
      }));
      decodedBuffer = null;
      attempt.context = null;
      const capability = acceptValidatedLoadReceipt(receipt);
      loadedCapability = capability;
      loadedSessionCount = 1;
      state = 'loaded';
      activeAttempt = null;
      return capability;
    } catch (error) {
      attempt.invalidate();
      attempt.allocationFrozen = true;
      const closed = await closeFailedAttempt(
        attempt,
        createDeadlineDependency,
        contextCleared,
      );
      if (!closed && attempt.context !== null) {
        state = 'recovery';
      } else if (state !== 'recovery') {
        state = 'idle';
      }
      if (activeAttempt === attempt) activeAttempt = null;
      if (error instanceof LocalTrackLoaderError) throw error;
      throw new LocalTrackLoaderError('track-decode-failed');
    } finally {
      file = null;
      rawBytes = null;
      decodedBuffer = null;
      if (aggregateDeadline !== null) aggregateDeadline.cancel();
    }
  }

  function load(request) {
    if (state === 'recovery') {
      return Promise.reject(new LocalTrackLoaderError('loader-recovery-required'));
    }
    if (state !== 'idle' || activeAttempt !== null || loadedCapability !== null) {
      return Promise.reject(new LocalTrackLoaderError('track-load-active'));
    }
    state = 'loading';
    const invalidation = createSignal();
    const token = nextToken;
    nextToken += 1;
    const attempt = {
      token,
      invalidation,
      allocationFrozen: false,
      context: null,
      closePromise: null,
      invalidated: false,
      isCurrent() {
        return activeAttempt === attempt && !attempt.invalidated;
      },
      invalidate() {
        if (attempt.invalidated) return;
        attempt.invalidated = true;
        attempt.allocationFrozen = true;
        invalidation.resolve();
      },
    };
    activeAttempt = attempt;
    return performLoad(request, attempt);
  }

  function cancel() {
    if (activeAttempt === null) return false;
    const attempt = activeAttempt;
    attempt.invalidate();
    return true;
  }

  async function teardown(reason) {
    if (loadedCapability !== null) {
      return loadedCapability.unload(reason);
    }
    if (activeAttempt !== null) {
      const attempt = activeAttempt;
      attempt.invalidate();
      await closeFailedAttempt(
        attempt,
        createDeadlineDependency,
        contextCleared,
      );
    }
    return undefined;
  }

  return Object.freeze({
    load,
    cancel,
    teardown,
    getDiagnostics: diagnostics,
  });
}
