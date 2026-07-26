import assert from 'node:assert/strict';

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

export function sequenceGetter(target, propertyName, values) {
  assert.equal(values.length > 0, true, 'sequence getter requires at least one value');
  let reads = 0;
  Object.defineProperty(target, propertyName, {
    configurable: true,
    enumerable: true,
    get() {
      const value = values[Math.min(reads, values.length - 1)];
      reads += 1;
      if (value instanceof Error) throw value;
      return value;
    },
  });
  return {
    get reads() {
      return reads;
    },
  };
}

export function hexBytes(hex) {
  assert.match(hex, /^(?:[0-9a-fA-F]{2})+$/);
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
}

export class FakeFileInput {
  constructor(value = '') {
    this.currentValue = value;
    this.clearCount = 0;
  }

  get value() {
    return this.currentValue;
  }

  set value(nextValue) {
    this.currentValue = nextValue;
    if (nextValue === '') this.clearCount += 1;
  }

  clear() {
    this.value = '';
  }
}

export class FakeFile {
  constructor({
    bytes = Uint8Array.from({ length: 64 }, (_, index) => (index * 17) % 256),
    name = 'private-user-track.mp3',
    type = 'audio/mpeg',
    size = bytes.byteLength,
    read = null,
  } = {}) {
    this.bytes = Uint8Array.from(bytes);
    this.type = type;
    this.size = size;
    this.arrayBufferCalls = 0;
    this.nameReads = 0;
    this.read = read;
    Object.defineProperty(this, 'name', {
      enumerable: true,
      configurable: false,
      get: () => {
        this.nameReads += 1;
        return name;
      },
    });
  }

  arrayBuffer() {
    this.arrayBufferCalls += 1;
    if (this.read !== null) return this.read();
    return Promise.resolve(this.bytes.slice().buffer);
  }
}

export class FakeAudioBuffer {
  constructor({
    numberOfChannels = 2,
    sampleRate = 8_000,
    length = 16_000,
    duration = length / sampleRate,
    sampleAt = ({ frame }) => (frame % 23 === 0 ? 0.05 : 0.02),
  } = {}) {
    this.numberOfChannels = numberOfChannels;
    this.sampleRate = sampleRate;
    this.length = length;
    this.duration = duration;
    this.copyFrameCount = length;
    this.sampleAt = sampleAt;
    this.copyCalls = [];
    this.getChannelDataCalls = 0;
  }

  copyFromChannel(destination, channelNumber, startInChannel = 0) {
    assert.equal(destination instanceof Float32Array, true, 'copy destination must be fixed Float32Array scratch');
    assert.equal(destination.byteOffset, 0, 'copy destination must not be a subarray/view offset');
    assert.equal(
      destination.buffer.byteLength,
      destination.byteLength,
      'copy destination must own its complete fixed scratch buffer',
    );
    assert.equal(Number.isInteger(channelNumber), true);
    assert.equal(Number.isInteger(startInChannel), true);
    assert.equal(startInChannel >= 0, true);
    assert.equal(startInChannel + destination.length <= this.copyFrameCount, true);
    this.copyCalls.push({ destination, channelNumber, startInChannel, length: destination.length });
    for (let index = 0; index < destination.length; index += 1) {
      destination[index] = this.sampleAt({
        channel: channelNumber,
        frame: startInChannel + index,
      });
    }
  }

  getChannelData() {
    this.getChannelDataCalls += 1;
    throw new Error('getChannelData() is forbidden at the enrollment browser boundary');
  }
}

export class FakeBufferSource {
  constructor(context) {
    this.context = context;
    this.buffer = null;
    this.onended = null;
    this.connections = [];
    this.startCalls = [];
    this.stopCalls = [];
    this.settled = false;
  }

  connect(target) {
    this.context.operations.push('source.connect');
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.context.operations.push('source.disconnect');
    this.connections.length = 0;
  }

  start(...args) {
    this.context.operations.push('source.start');
    this.startCalls.push(args);
  }

  stop(...args) {
    this.context.operations.push('source.stop');
    this.stopCalls.push(args);
  }

  finish() {
    if (this.settled) return;
    this.settled = true;
    this.context.operations.push('source.ended');
    this.onended?.();
  }
}

export class FakeAudioContext {
  constructor({
    audioBuffer = new FakeAudioBuffer(),
    currentTime = 10,
    decode = null,
    resume = null,
    close = null,
    sourceFactory = null,
  } = {}) {
    this.audioBuffer = audioBuffer;
    this.currentTime = currentTime;
    this.sampleRate = audioBuffer.sampleRate;
    this.state = 'suspended';
    this.destination = Object.freeze({ kind: 'destination' });
    this.decodeImpl = decode;
    this.resumeImpl = resume;
    this.closeImpl = close;
    this.sourceFactory = sourceFactory;
    this.operations = [];
    this.decodeCalls = [];
    this.resumeCalls = 0;
    this.closeCalls = 0;
    this.sources = [];
  }

  decodeAudioData(bytes) {
    this.operations.push('context.decodeAudioData');
    this.decodeCalls.push(bytes);
    if (this.decodeImpl !== null) return this.decodeImpl(bytes);
    return Promise.resolve(this.audioBuffer);
  }

  resume() {
    this.operations.push('context.resume');
    this.resumeCalls += 1;
    if (this.resumeImpl !== null) return this.resumeImpl();
    this.state = 'running';
    return Promise.resolve();
  }

  createBufferSource() {
    this.operations.push('context.createBufferSource');
    const source = this.sourceFactory === null
      ? new FakeBufferSource(this)
      : this.sourceFactory(this);
    this.sources.push(source);
    return source;
  }

  close() {
    this.operations.push('context.close');
    this.closeCalls += 1;
    if (this.closeImpl !== null) return this.closeImpl();
    this.state = 'closed';
    return Promise.resolve();
  }
}

export function timerHarness() {
  let nextId = 1;
  const active = new Map();
  const calls = [];

  return {
    setTimeoutFn(callback, delay) {
      const id = nextId;
      nextId += 1;
      calls.push({ id, delay });
      active.set(id, { callback, delay });
      return id;
    },
    clearTimeoutFn(id) {
      active.delete(id);
    },
    fire(id) {
      const timer = active.get(id);
      if (timer === undefined) throw new Error(`unknown timer ${id}`);
      active.delete(id);
      timer.callback();
    },
    fireDelay(delay) {
      const match = [...active].find(([, timer]) => timer.delay === delay);
      if (match === undefined) throw new Error(`no active ${delay} ms timer`);
      const [id] = match;
      this.fire(id);
    },
    has(id) {
      return active.has(id);
    },
    activeDelays() {
      return [...active.values()].map(({ delay }) => delay);
    },
    get calls() {
      return calls.slice();
    },
    get size() {
      return active.size;
    },
  };
}

export function cryptoHarness({ digestHex = 'AB'.repeat(32), digest = null } = {}) {
  const calls = [];
  return {
    calls,
    digest(algorithm, bytes) {
      calls.push({ algorithm, bytes });
      if (digest !== null) return digest(algorithm, bytes);
      return Promise.resolve(hexBytes(digestHex).buffer);
    },
  };
}

export function containsBinary(value, seen = new Set()) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (seen.has(value)) return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && Object.hasOwn(descriptor, 'value') && containsBinary(descriptor.value, seen)) {
      return true;
    }
  }
  return false;
}
