import { TRACK_METADATA } from '../src/track-metadata.mjs';
import { ONE_TRACK_CONFIG } from '../src/config.mjs';

const OWNERSHIP_CHECKPOINT_LABELS = Object.freeze([
  'ownership:before-compaction-asserted',
  'ownership:after-compaction-asserted',
]);
const OWNERSHIP_CHECKPOINT_LABEL_SET = new Set(OWNERSHIP_CHECKPOINT_LABELS);

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeAudioParam {
  constructor(value = 1) {
    this.value = value;
    this.events = [];
  }

  setValueAtTime(value, time) {
    this.events.push(Object.freeze({ type: 'set', value, time }));
    this.value = value;
    return this;
  }

  setValueCurveAtTime(values, startTime, duration) {
    this.events.push(Object.freeze({
      type: 'curve',
      values: Float32Array.from(values),
      startTime,
      duration,
    }));
    this.value = values.at(-1);
    return this;
  }

  cancelScheduledValues(time) {
    const value = this.valueAtTime(time);
    this.events.push(Object.freeze({ type: 'cancel', time, value }));
    return this;
  }

  linearRampToValueAtTime(value, endTime) {
    const prior = this.events.at(-1);
    const startTime = prior?.time ?? prior?.startTime ?? 0;
    const startValue = this.valueAtTime(startTime);
    this.events.push(Object.freeze({
      type: 'linear-ramp', startTime, startValue, value, endTime,
    }));
    this.value = value;
    return this;
  }

  valueAtTime(time) {
    let value = 1;
    for (const event of this.events) {
      if (event.type === 'set' && time >= event.time) value = event.value;
      if (event.type === 'curve' && time >= event.startTime) {
        const progress = Math.max(0, Math.min(1, (time - event.startTime) / event.duration));
        const position = progress * (event.values.length - 1);
        const lower = Math.floor(position);
        const upper = Math.min(lower + 1, event.values.length - 1);
        value = event.values[lower] + (event.values[upper] - event.values[lower])
          * (position - lower);
      }
      if (event.type === 'cancel' && time >= event.time) value = event.value;
      if (event.type === 'linear-ramp' && time >= event.startTime) {
        const progress = Math.max(0, Math.min(
          1,
          (time - event.startTime) / (event.endTime - event.startTime),
        ));
        value = event.startValue + (event.value - event.startValue) * progress;
      }
    }
    return value;
  }
}

class FakeNode {
  constructor(context, kind) {
    this.context = context;
    this.kind = kind;
    this.connections = [];
    this.disconnected = false;
    this.disconnectCalls = 0;
  }

  connect(destination) {
    this.context.record('connect', { from: this.kind, to: destination.kind });
    this.connections.push(destination);
    return destination;
  }

  disconnect() {
    this.context.record('disconnect', { kind: this.kind });
    this.disconnectCalls += 1;
    this.context.onDisconnect?.(this);
    this.connections.length = 0;
    this.disconnected = true;
  }
}

class FakeGainNode extends FakeNode {
  constructor(context) {
    super(context, 'gain');
    this.gain = new FakeAudioParam(1);
  }
}

class FakeAudioBuffer {
  constructor(numberOfChannels, length, sampleRate, allocateChannels = true) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = allocateChannels
      ? Array.from({ length: numberOfChannels }, () => new Float32Array(length))
      : null;
  }

  copyToChannel(samples, channel) {
    this.channels[channel].set(samples);
  }

  copyFromChannel(destination, channel, start = 0) {
    const cueFrame = Math.floor(ONE_TRACK_CONFIG.targetEntryDownbeatSeconds * this.sampleRate);
    const cueEnd = cueFrame + Math.ceil(0.050 * this.sampleRate);
    const energetic = start < cueEnd && start + destination.length > cueFrame;
    destination.fill(energetic ? 0.1 : 0.001);
  }
}

class FakeBufferSource extends FakeNode {
  constructor(context) {
    super(context, 'source');
    this._buffer = null;
    this.bufferClearCalls = 0;
    this._onended = null;
    this.onendedClearCalls = 0;
    this.endedCallbackHistory = [];
    this.startRecord = null;
    this.stopTime = null;
    this.stopCalls = 0;
    this.ended = false;
    this.suppressEnded = false;
  }

  get buffer() {
    return this._buffer;
  }

  set buffer(value) {
    if (value === null) this.bufferClearCalls += 1;
    this._buffer = value;
  }

  get onended() {
    return this._onended;
  }

  set onended(callback) {
    if (callback === null) this.onendedClearCalls += 1;
    this._onended = callback;
    if (typeof callback === 'function') this.endedCallbackHistory.push(callback);
  }

  start(when, offset = 0, duration = undefined) {
    if (this.startRecord !== null) throw new Error('source-started-twice');
    this.context.record('start', { when, offset, duration });
    this.startRecord = Object.freeze({ when, offset, duration });
  }

  stop(when) {
    this.context.record('stop', { when });
    this.stopCalls += 1;
    this.stopTime = this.stopTime === null ? when : Math.min(this.stopTime, when);
    this.context.onStop?.(this);
    if (this.context.stopEndedMode === 'sync') this.fireCurrentEndedCallback();
    if (this.context.stopEndedMode === 'microtask') {
      queueMicrotask(() => this.fireCurrentEndedCallback());
    }
  }

  fireCurrentEndedCallback() {
    if (this.ended || typeof this._onended !== 'function') return false;
    this.ended = true;
    this._onended();
    return true;
  }

  fireCapturedEndedCallback(index = -1) {
    const callback = this.endedCallbackHistory.at(index);
    if (typeof callback !== 'function') return false;
    this.ended = true;
    callback();
    return true;
  }

  naturalEndTime() {
    if (this.startRecord === null || this.buffer === null) return Number.POSITIVE_INFINITY;
    const available = this.startRecord.duration
      ?? Math.max(0, this.buffer.duration - this.startRecord.offset);
    return this.startRecord.when + available;
  }

  endTime() {
    return Math.min(this.naturalEndTime(), this.stopTime ?? Number.POSITIVE_INFINITY);
  }
}

export function createFakeAudioHarness({
  resumeMode = 'resolve',
  suspendMode = 'resolve',
  stopEndedMode = 'none',
  onStop = null,
  onDisconnect = null,
} = {}) {
  const events = [];
  const deadlines = [];
  const observedOwnershipCheckpointLabels = [];
  const resumeDeferred = deferred();
  const suspendDeferred = deferred();
  const suspendStarted = deferred();
  const closeDeferred = deferred();
  const rawBytes = new ArrayBuffer(TRACK_METADATA.compressedBytes);
  const decodedBuffer = new FakeAudioBuffer(
    TRACK_METADATA.decodedChannelCount,
    TRACK_METADATA.decodedFrameCount,
    TRACK_METADATA.decodedSampleRate,
    false,
  );
  const file = Object.freeze({
    name: 'PRIVATE-FAKE-AUDIO.mp3',
    type: TRACK_METADATA.allowedMimeType,
    size: TRACK_METADATA.compressedBytes,
  });

  const context = {
    state: 'suspended',
    currentTime: 10,
    sampleRate: TRACK_METADATA.decodedSampleRate,
    destination: null,
    onstatechange: null,
    stopEndedMode,
    onStop,
    onDisconnect,
    sources: [],
    gains: [],
    record(type, detail = {}) {
      events.push(Object.freeze({ type, ...detail }));
    },
    decodeAudioData() {
      events.push(Object.freeze({ type: 'decode' }));
      return Promise.resolve(decodedBuffer);
    },
    createGain() {
      this.record('allocate-gain');
      const gain = new FakeGainNode(this);
      this.gains.push(gain);
      return gain;
    },
    createBufferSource() {
      this.record('allocate-source');
      const source = new FakeBufferSource(this);
      this.sources.push(source);
      return source;
    },
    createBuffer(numberOfChannels, length, sampleRate) {
      this.record('allocate-buffer');
      return new FakeAudioBuffer(numberOfChannels, length, sampleRate);
    },
    resume() {
      this.record('resume');
      if (resumeMode === 'reject') return Promise.reject(new Error('PRIVATE-RESUME'));
      if (resumeMode === 'deferred') {
        return resumeDeferred.promise.then(() => { this.state = 'running'; });
      }
      this.state = 'running';
      return Promise.resolve();
    },
    suspend() {
      this.record('suspend');
      suspendStarted.resolve();
      if (suspendMode === 'reject') return Promise.reject(new Error('PRIVATE-SUSPEND'));
      if (suspendMode === 'deferred') {
        return suspendDeferred.promise.then(() => { this.state = 'suspended'; });
      }
      this.state = 'suspended';
      return Promise.resolve();
    },
    close() {
      this.record('close');
      return closeDeferred.promise.then(() => { this.state = 'closed'; });
    },
  };
  context.destination = new FakeNode(context, 'destination');

  function createDeadline(kind, milliseconds) {
    const signal = deferred();
    const deadline = {
      kind,
      milliseconds,
      cancelled: false,
      promise: signal.promise,
      cancel() { deadline.cancelled = true; },
      fire() { signal.resolve(); },
    };
    deadlines.push(deadline);
    return deadline;
  }

  function recordOwnershipCheckpoint(label) {
    if (typeof label !== 'string') {
      throw new TypeError('privacy-safe ownership checkpoint label must be a string');
    }
    if (!label.startsWith('ownership:')) return false;
    if (!OWNERSHIP_CHECKPOINT_LABEL_SET.has(label)) {
      throw new TypeError('unsupported privacy-safe ownership checkpoint label');
    }
    observedOwnershipCheckpointLabels.push(label);
    return true;
  }

  function ownershipCheckpointLabels() {
    return Object.freeze([...observedOwnershipCheckpointLabels]);
  }

  function ownershipCheckpointCounts() {
    return Object.freeze(Object.fromEntries(OWNERSHIP_CHECKPOINT_LABELS.map((label) => [
      label,
      observedOwnershipCheckpointLabels.filter((candidate) => candidate === label).length,
    ])));
  }

  const dependencies = Object.freeze({
    readFile() { events.push(Object.freeze({ type: 'read' })); return Promise.resolve(rawBytes); },
    sha256() { events.push(Object.freeze({ type: 'hash' })); return Promise.resolve(TRACK_METADATA.sha256); },
    createAudioContext() { events.push(Object.freeze({ type: 'allocate-context' })); return context; },
    createDeadline,
  });

  function advanceTo(audioTime) {
    context.currentTime = audioTime;
    for (const source of context.sources) {
      if (!source.ended && !source.suppressEnded && source.endTime() <= audioTime) {
        source.ended = true;
        source.onended?.();
      }
    }
  }

  return Object.freeze({
    dependencies,
    events,
    deadlines,
    context,
    decodedBuffer,
    file,
    resumeDeferred,
    suspendDeferred,
    suspendStarted,
    closeDeferred,
    recordOwnershipCheckpoint,
    ownershipCheckpointLabels,
    ownershipCheckpointCounts,
    advanceTo,
  });
}

export function createReceiptAuthority() {
  const receipts = new WeakSet();
  return Object.freeze({
    mint() {
      const receipt = Object.freeze(Object.create(null));
      receipts.add(receipt);
      return receipt;
    },
    assert(candidate) {
      if (candidate === null || typeof candidate !== 'object' || !receipts.has(candidate)) {
        throw new TypeError('genuine terminal record receipt required');
      }
      return true;
    },
  });
}
