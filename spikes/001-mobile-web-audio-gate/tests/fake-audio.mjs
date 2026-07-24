export class FakeAudioParam {
  constructor(context, value = 1) {
    this.context = context;
    this.value = value;
    this.calls = [];
  }

  setValueAtTime(value, time) {
    this.context.step('param.setValueAtTime');
    this.value = value;
    this.calls.push(['setValueAtTime', value, time]);
  }

  setValueCurveAtTime(curve, time, duration) {
    this.context.step('param.setValueCurveAtTime');
    this.calls.push(['setValueCurveAtTime', curve, time, duration]);
  }

  cancelScheduledValues(time) {
    this.context.step('param.cancelScheduledValues', false);
    this.calls.push(['cancelScheduledValues', time]);
  }

  linearRampToValueAtTime(value, time) {
    this.context.step('param.linearRampToValueAtTime', false);
    this.value = value;
    this.calls.push(['linearRampToValueAtTime', value, time]);
  }
}

class FakeNode {
  constructor(context, kind) {
    this.context = context;
    this.kind = kind;
    this.connections = [];
    this.disconnected = false;
  }

  connect(target) {
    this.context.step(`${this.kind}.connect`);
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.context.step(`${this.kind}.disconnect`, false);
    this.disconnected = true;
    this.connections = [];
  }
}

export class FakeGainNode extends FakeNode {
  constructor(context) {
    super(context, 'gain');
    this.gain = new FakeAudioParam(context);
  }
}

export class FakeBufferSourceNode extends FakeNode {
  constructor(context) {
    super(context, 'source');
    this.buffer = null;
    this.onended = null;
    this.startCalls = [];
    this.stopCalls = [];
  }

  start(...args) {
    this.context.step('source.start');
    this.startCalls.push(args);
  }

  stop(...args) {
    this.context.step('source.stop', false);
    this.stopCalls.push(args);
  }

  finish() {
    this.onended?.();
  }
}

export class FakeAudioContext {
  constructor({ currentTime = 10, state = 'running', failAt = null } = {}) {
    this.currentTime = currentTime;
    this.sampleRate = 44100;
    this.state = state;
    this.failAt = failAt;
    this.operationCount = 0;
    this.operations = [];
    this.destination = { kind: 'destination' };
    this.gains = [];
    this.sources = [];
    this.closeCalls = 0;
  }

  step(label, throwable = true) {
    this.operationCount += 1;
    this.operations.push(label);
    if (throwable && this.failAt === this.operationCount) {
      throw new Error(`injected failure at ${label}`);
    }
  }

  createGain() {
    this.step('context.createGain');
    const node = new FakeGainNode(this);
    this.gains.push(node);
    return node;
  }

  createBufferSource() {
    this.step('context.createBufferSource');
    const node = new FakeBufferSourceNode(this);
    this.sources.push(node);
    return node;
  }

  createBuffer(channels, length, sampleRate) {
    this.step('context.createBuffer');
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData(channel) { return data[channel]; },
    };
  }

  async close() {
    this.closeCalls += 1;
    this.state = 'closed';
  }
}

export function timerHarness() {
  const callbacks = new Map();
  let nextId = 1;
  return {
    setTimeoutFn(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeoutFn(id) {
      callbacks.delete(id);
    },
    fireAll() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
    get size() {
      return callbacks.size;
    },
  };
}
