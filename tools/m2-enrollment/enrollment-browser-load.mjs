import { assertEnrollmentBuildCommit } from './enrollment-build.mjs';

assertEnrollmentBuildCommit('__ENROLLMENT_BUILD_COMMIT__');

import {
  preflightCompressedBytes,
  validateDecodedBounds,
} from './enrollment-measurements.mjs';
import {
  createDeferred,
  EnrollmentBrowserError,
  isObjectLike,
  typedError,
} from './enrollment-browser-shared.mjs';

const LOAD_DEADLINE_MILLISECONDS = 15_000;
const INSPECTION_FRAMES = 4_096;
const SHA256_BYTE_COUNT = 32;

function digestToLowercaseHex(value) {
  let bytes;
  if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else {
    throw typedError('track-hash-failed');
  }
  if (bytes.byteLength !== SHA256_BYTE_COUNT) throw typedError('track-hash-failed');
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function inspectTrackEdges(decodedBuffer, metadata) {
  const framesToCopy = Math.min(INSPECTION_FRAMES, metadata.frameCount);
  const endStartFrame = metadata.frameCount - framesToCopy;
  for (const startInChannel of [0, endStartFrame]) {
    for (let channelNumber = 0; channelNumber < metadata.channelCount; channelNumber += 1) {
      const scratch = new Float32Array(framesToCopy);
      decodedBuffer.copyFromChannel(scratch, channelNumber, startInChannel);
    }
  }
}

export function createLoadBoundary({
  allowedMimeType,
  digest,
  resources,
  setTimeoutFn,
  clearTimeoutFn,
  onDeadline,
}) {
  let nextTokenId = 1;

  function captureSelection(selection) {
    let file;
    let fileInput;
    try {
      file = selection.file;
      fileInput = selection.fileInput;
    } catch {
      throw typedError('track-selection-invalid');
    }
    if (!isObjectLike(file)) throw typedError('track-selection-invalid');

    try {
      fileInput.value = '';
    } catch {
      throw typedError('file-input-clear-failed');
    }

    let compressedSize;
    try {
      compressedSize = file.size;
    } catch {
      throw typedError('track-metadata-invalid');
    }
    const compressed = preflightCompressedBytes(compressedSize);
    if (!compressed.ok) throw typedError(compressed.errorCode);

    let mimeType;
    try {
      mimeType = file.type;
    } catch {
      throw typedError('track-metadata-invalid');
    }
    if (mimeType !== allowedMimeType) throw typedError('mime-type-mismatch');
    return file;
  }

  function createToken(resourceOwner) {
    return {
      id: nextTokenId++,
      owner: resourceOwner,
      invalidated: false,
      invalidationCode: null,
      invalidation: createDeferred(),
      deadlineTimer: null,
    };
  }

  function clearDeadline(token) {
    if (token.deadlineTimer === null) return;
    const timerId = token.deadlineTimer;
    token.deadlineTimer = null;
    try {
      clearTimeoutFn(timerId);
    } catch {
      // Timer cleanup cannot replace a typed result or strand teardown.
    }
  }

  function invalidate(token, code) {
    if (token === null || token.invalidated) return;
    token.invalidated = true;
    token.invalidationCode = code;
    clearDeadline(token);
    token.invalidation.resolve(code);
  }

  function assertActive(token) {
    if (token.invalidated) throw typedError(token.invalidationCode);
  }

  function cancellableOperation(token, dependencyValue, failureCode) {
    return new Promise((resolve, reject) => {
      Promise.resolve(dependencyValue).then(
        (value) => {
          if (token.invalidated) {
            reject(typedError(token.invalidationCode));
          } else {
            resolve(value);
          }
        },
        () => reject(typedError(token.invalidated ? token.invalidationCode : failureCode)),
      );
      token.invalidation.promise.then((code) => reject(typedError(code)));
    });
  }

  function startDeadline(token) {
    try {
      token.deadlineTimer = setTimeoutFn(() => {
        token.deadlineTimer = null;
        if (token.invalidated) return;
        invalidate(token, 'hash-decode-timeout');
        onDeadline(token);
      }, LOAD_DEADLINE_MILLISECONDS);
    } catch {
      token.deadlineTimer = null;
      throw typedError('load-deadline-failed');
    }
  }

  async function run(token, file) {
    const resourceOwner = token.owner;
    try {
      let readValue;
      try {
        const arrayBufferMethod = file.arrayBuffer;
        if (typeof arrayBufferMethod !== 'function') throw new TypeError('arrayBuffer missing');
        readValue = arrayBufferMethod.call(file);
      } catch {
        throw typedError('track-read-failed');
      }
      const rawBuffer = await cancellableOperation(token, readValue, 'track-read-failed');
      if (!(rawBuffer instanceof ArrayBuffer)) throw typedError('track-read-failed');
      resources.ownRaw(resourceOwner, rawBuffer);
      startDeadline(token);

      let digestValue;
      try {
        digestValue = digest('SHA-256', resourceOwner.rawBuffer);
      } catch {
        throw typedError('track-hash-failed');
      }
      const digestResult = await cancellableOperation(token, digestValue, 'track-hash-failed');
      resourceOwner.sha256 = digestToLowercaseHex(digestResult);

      assertActive(token);
      const context = resources.allocateContext(resourceOwner);
      assertActive(token);

      let decodeValue;
      try {
        decodeValue = context.decodeAudioData(resourceOwner.rawBuffer);
      } catch {
        throw typedError('track-decode-failed');
      }
      const decodedValue = await cancellableOperation(token, decodeValue, 'track-decode-failed');
      resources.releaseRaw(resourceOwner);
      assertActive(token);

      const decodedBuffer = resources.captureDecodedBuffer(decodedValue);
      if (!resources.ownDecodedBuffer(resourceOwner, decodedBuffer)) {
        throw typedError(token.invalidationCode ?? 'load-invalidated');
      }

      const validation = validateDecodedBounds(decodedBuffer.metadata);
      if (!validation.ok) throw typedError('track-bounds-invalid', validation.errorCode);
      try {
        inspectTrackEdges(decodedBuffer, decodedBuffer.metadata);
      } catch {
        throw typedError('track-inspection-failed');
      }

      resourceOwner.decoded = Object.freeze({
        ...decodedBuffer.metadata,
        calculatedDecodedPcmBytes: validation.calculatedDecodedPcmBytes,
      });
      assertActive(token);
      clearDeadline(token);
      return {
        sha256: resourceOwner.sha256,
        decoded: { ...resourceOwner.decoded },
      };
    } catch (error) {
      if (error instanceof EnrollmentBrowserError) throw error;
      throw typedError('track-load-failed');
    }
  }

  return Object.freeze({
    captureSelection,
    clearDeadline,
    createToken,
    invalidate,
    run,
  });
}
