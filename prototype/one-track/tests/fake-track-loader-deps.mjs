import { TRACK_METADATA } from '../src/track-metadata.mjs';
import { ONE_TRACK_CONFIG } from '../src/config.mjs';

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export async function flushMicrotasks(turns = 4) {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

function operation(mode, value) {
  if (mode === 'deferred') {
    return deferred();
  }
  if (mode === 'never') {
    return { promise: new Promise(() => {}) };
  }
  if (mode === 'reject') {
    return { promise: Promise.reject(new Error('PRIVATE_DEPENDENCY_MESSAGE')) };
  }
  return { promise: Promise.resolve(value) };
}

export function createFakeTrackLoaderDeps(options = {}) {
  const events = [];
  const deadlines = [];
  const contexts = [];
  const rawBytes = new ArrayBuffer(TRACK_METADATA.compressedBytes);
  new Uint8Array(rawBytes, 0, 4).set([83, 69, 67, 82]);

  const file = {
    name: options.filename ?? 'PRIVATE-FILENAME-DO-NOT-LEAK.mp3',
    type: options.mimeType ?? TRACK_METADATA.allowedMimeType,
    size: options.size ?? TRACK_METADATA.compressedBytes,
  };

  const decoded = {
    duration: options.duration ?? TRACK_METADATA.decodedDurationSeconds,
    numberOfChannels: options.channels ?? TRACK_METADATA.decodedChannelCount,
    sampleRate: options.sampleRate ?? TRACK_METADATA.decodedSampleRate,
    length: options.frames ?? TRACK_METADATA.decodedFrameCount,
    copyFromChannel(destination, channelNumber, startInChannel = 0) {
      if (destination.length > 4_096) {
        throw new Error('unbounded copy requested');
      }
      events.push(Object.freeze({
        type: 'copy',
        channelNumber,
        startInChannel,
        sampleCount: destination.length,
      }));
      const cueFrame = Math.floor(
        ONE_TRACK_CONFIG.targetEntryDownbeatSeconds * TRACK_METADATA.decodedSampleRate,
      );
      const cueEnd = cueFrame + Math.ceil(0.050 * TRACK_METADATA.decodedSampleRate);
      const energetic = options.cueEnergetic !== false
        && startInChannel < cueEnd
        && startInChannel + destination.length > cueFrame;
      destination.fill(energetic ? 0.10 : 0.001);
    },
    getChannelData() {
      events.push(Object.freeze({ type: 'forbidden-full-channel-view' }));
      throw new Error('full-channel view is forbidden');
    },
  };

  const readOperation = operation(options.readMode, rawBytes);
  const hashOperation = operation(
    options.hashMode,
    options.sha256 ?? TRACK_METADATA.sha256,
  );
  const decodeOperation = operation(options.decodeMode, decoded);
  const closeOperations = [];
  const resumeOperations = [];
  const suspendOperations = [];

  const deps = {
    readFile(selectedFile) {
      events.push(Object.freeze({ type: 'read', sameFile: selectedFile === file }));
      return readOperation.promise;
    },
    sha256(bytes) {
      events.push(Object.freeze({ type: 'hash', sameBytes: bytes === rawBytes }));
      return hashOperation.promise;
    },
    createAudioContext() {
      events.push(Object.freeze({ type: 'allocate-context' }));
      const closeOperation = operation(options.closeMode, undefined);
      const resumeOperation = operation(options.resumeMode, undefined);
      const suspendOperation = operation(options.suspendMode, undefined);
      closeOperations.push(closeOperation);
      resumeOperations.push(resumeOperation);
      suspendOperations.push(suspendOperation);
      const context = {
        state: options.contextState ?? 'suspended',
        onstatechange: null,
        decodeAudioData(bytes) {
          events.push(Object.freeze({ type: 'decode', sameBytes: bytes === rawBytes }));
          return decodeOperation.promise;
        },
        resume() {
          events.push(Object.freeze({ type: 'resume' }));
          if (options.resumeMode === 'non-thenable') return undefined;
          return resumeOperation.promise;
        },
        suspend() {
          events.push(Object.freeze({ type: 'suspend' }));
          if (options.suspendMode === 'non-thenable') return undefined;
          return suspendOperation.promise;
        },
        close() {
          events.push(Object.freeze({ type: 'close' }));
          if (options.closeMode === 'non-thenable') return undefined;
          return closeOperation.promise.then((value) => {
            context.state = 'closed';
            return value;
          });
        },
      };
      contexts.push(context);
      return context;
    },
    createDeadline(kind, milliseconds) {
      if (options.deadlineCreateThrows === true && kind === 'context-close') {
        throw new Error('PRIVATE_CLOSE_DEADLINE_CREATE');
      }
      const timer = deferred();
      const record = {
        kind,
        milliseconds,
        cancelled: false,
        fire() { timer.resolve(); },
      };
      deadlines.push(record);
      const deadline = {
        cancel() {
          record.cancelled = true;
        },
      };
      if (options.deadlinePromiseAccessorBomb === true && kind === 'context-close') {
        let reads = 0;
        Object.defineProperty(deadline, 'promise', {
          enumerable: true,
          get() {
            reads += 1;
            if (reads > 1) throw new Error('PRIVATE_DEADLINE_ACCESSOR');
            return timer.promise;
          },
        });
      } else {
        deadline.promise = timer.promise;
      }
      return deadline;
    },
  };

  return {
    deps,
    events,
    deadlines,
    contexts,
    file,
    rawBytes,
    decoded,
    readOperation,
    hashOperation,
    decodeOperation,
    closeOperations,
    resumeOperations,
    suspendOperations,
  };
}
