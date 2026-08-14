class FakeAudioBuffer {
  constructor({ length, numberOfChannels, sampleRate }) {
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new TypeError('buffer length must be a positive safe integer');
    }
    if (!Number.isSafeInteger(numberOfChannels) || numberOfChannels <= 0) {
      throw new TypeError('numberOfChannels must be a positive safe integer');
    }
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new TypeError('sampleRate must be finite and positive');
    }
    this.length = length;
    this.numberOfChannels = numberOfChannels;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }

  getChannelData(channel) {
    const data = this._channels[channel];
    if (data === undefined) {
      throw new RangeError('channel index is out of range');
    }
    return data;
  }
}

class FakeAudioParam {
  constructor(defaultValue) {
    this.defaultValue = defaultValue;
    this.value = defaultValue;
    this.events = [];
  }

  setValueAtTime(value, time) {
    this.#assertFinite(value, time);
    this.events.push({ type: 'set', value, time });
    this.value = value;
    return this;
  }

  setValueCurveAtTime(values, startTime, duration) {
    if (!(values instanceof Float32Array) || values.length < 2) {
      throw new TypeError('curve must be a Float32Array with at least two values');
    }
    if (!Number.isFinite(startTime) || !Number.isFinite(duration) || duration <= 0) {
      throw new TypeError('curve timing must be finite with positive duration');
    }
    this.events.push({
      type: 'curve',
      values: Float32Array.from(values),
      startTime,
      duration,
    });
    return this;
  }

  cancelAndHoldAtTime(time) {
    if (!Number.isFinite(time)) {
      throw new TypeError('hold time must be finite');
    }
    const value = this.valueAtTime(time);
    this.events.push({ type: 'hold', value, time });
    this.value = value;
    return this;
  }

  cancelScheduledValues(time) {
    if (!Number.isFinite(time)) {
      throw new TypeError('cancellation time must be finite');
    }
    const value = this.valueAtTime(time);
    this.events.push({ type: 'hold', value, time });
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value, endTime) {
    this.#assertFinite(value, endTime);
    const anchor = this.events.at(-1);
    const startTime = anchor?.time ?? anchor?.startTime ?? 0;
    const startValue = this.valueAtTime(startTime);
    this.events.push({
      type: 'linear-ramp',
      startTime,
      startValue,
      endTime,
      value,
    });
    this.value = value;
    return this;
  }

  valueAtTime(time) {
    let value = this.defaultValue;
    for (const event of this.events) {
      if (event.type === 'set' && time >= event.time) {
        value = event.value;
      } else if (event.type === 'curve' && time >= event.startTime) {
        const progress = Math.min(1, (time - event.startTime) / event.duration);
        const position = progress * (event.values.length - 1);
        const lowerIndex = Math.floor(position);
        const upperIndex = Math.min(event.values.length - 1, lowerIndex + 1);
        const fraction = position - lowerIndex;
        value = event.values[lowerIndex]
          + fraction * (event.values[upperIndex] - event.values[lowerIndex]);
      } else if (event.type === 'hold' && time >= event.time) {
        value = event.value;
      } else if (event.type === 'linear-ramp' && time >= event.startTime) {
        const progress = event.endTime === event.startTime
          ? 1
          : Math.min(1, (time - event.startTime) / (event.endTime - event.startTime));
        value = event.startValue + progress * (event.value - event.startValue);
      }
    }
    return value;
  }

  #assertFinite(value, time) {
    if (!Number.isFinite(value) || !Number.isFinite(time)) {
      throw new TypeError('automation values and times must be finite');
    }
  }
}

class FakeAudioNode {
  constructor(context) {
    this.context = context;
    this._inputs = [];
    this._connections = [];
  }

  connect(destination, output = 0, input = 0) {
    if (!(destination instanceof FakeAudioNode)) {
      throw new TypeError('destination must be an audio node from the fake context');
    }
    const connection = { source: this, destination, output, input };
    this._connections.push(connection);
    destination._inputs.push(connection);
    return destination;
  }

  disconnect() {
    for (const connection of this._connections.splice(0)) {
      const index = connection.destination._inputs.indexOf(connection);
      if (index >= 0) {
        connection.destination._inputs.splice(index, 1);
      }
    }
  }
}

class FakeAudioBufferSourceNode extends FakeAudioNode {
  constructor(context) {
    super(context);
    this.buffer = null;
    this.onended = null;
    this._start = null;
    this._stopTime = null;
  }

  start(when = 0, offset = 0) {
    if (this._start !== null) {
      throw new Error('source may only be started once');
    }
    if (!Number.isFinite(when) || !Number.isFinite(offset) || when < 0 || offset < 0) {
      throw new TypeError('source start values must be finite and nonnegative');
    }
    if (!(this.buffer instanceof FakeAudioBuffer)) {
      throw new TypeError('source buffer must be assigned before start');
    }
    this._start = { when, offset };
  }

  stop(when = 0) {
    if (!Number.isFinite(when) || when < 0) {
      throw new TypeError('source stop time must be finite and nonnegative');
    }
    this._stopTime = this._stopTime === null ? when : Math.min(this._stopTime, when);
  }

  _naturalEndTime() {
    if (this._start === null || this.buffer === null) {
      return Number.POSITIVE_INFINITY;
    }
    return this._start.when + Math.max(0, this.buffer.duration - this._start.offset);
  }

  _endTime() {
    return Math.min(this._naturalEndTime(), this._stopTime ?? Number.POSITIVE_INFINITY);
  }
}

class FakeGainNode extends FakeAudioNode {
  constructor(context) {
    super(context);
    this.gain = new FakeAudioParam(1);
  }
}

class FakeChannelMergerNode extends FakeAudioNode {
  constructor(context, numberOfInputs) {
    super(context);
    this.numberOfInputs = numberOfInputs;
  }
}

class FakeDestinationNode extends FakeAudioNode {}

function addChannel(target, source) {
  for (let index = 0; index < target.length; index += 1) {
    target[index] += source[index] ?? 0;
  }
}

export class FakeOfflineAudioContext {
  constructor(numberOfChannelsOrOptions, length, sampleRate) {
    const options = typeof numberOfChannelsOrOptions === 'object'
      ? numberOfChannelsOrOptions
      : { numberOfChannels: numberOfChannelsOrOptions, length, sampleRate };
    this.numberOfChannels = options.numberOfChannels;
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    this.currentTime = 0;
    this.destination = new FakeDestinationNode(this);
    this.createdSources = [];
    this.createdGains = [];
    this.createdMergers = [];
    this._rendered = false;
  }

  createBuffer(numberOfChannels, length, sampleRate) {
    return new FakeAudioBuffer({ numberOfChannels, length, sampleRate });
  }

  createBufferSource() {
    const source = new FakeAudioBufferSourceNode(this);
    this.createdSources.push(source);
    return source;
  }

  createGain() {
    const gain = new FakeGainNode(this);
    this.createdGains.push(gain);
    return gain;
  }

  createChannelMerger(numberOfInputs) {
    const merger = new FakeChannelMergerNode(this, numberOfInputs);
    this.createdMergers.push(merger);
    return merger;
  }

  async startRendering() {
    if (this._rendered) {
      throw new Error('offline context may only render once');
    }
    this._rendered = true;
    const memo = new Map();
    const renderNode = (node) => {
      if (memo.has(node)) {
        return memo.get(node);
      }
      let channels;
      if (node instanceof FakeAudioBufferSourceNode) {
        const output = new Float32Array(this.length);
        if (node._start !== null) {
          const endTime = node._endTime();
          const sourceData = node.buffer.getChannelData(0);
          for (let index = 0; index < output.length; index += 1) {
            const time = index / this.sampleRate;
            if (time < node._start.when || time >= endTime) {
              continue;
            }
            const sourceIndex = Math.floor(
              (time - node._start.when + node._start.offset) * node.buffer.sampleRate,
            );
            if (sourceIndex >= 0 && sourceIndex < sourceData.length) {
              output[index] = sourceData[sourceIndex];
            }
          }
        }
        channels = [output];
      } else if (node instanceof FakeGainNode) {
        const output = new Float32Array(this.length);
        for (const connection of node._inputs) {
          const upstream = renderNode(connection.source)[connection.output] ?? new Float32Array(this.length);
          addChannel(output, upstream);
        }
        for (let index = 0; index < output.length; index += 1) {
          output[index] *= node.gain.valueAtTime(index / this.sampleRate);
        }
        channels = [output];
      } else if (node instanceof FakeChannelMergerNode) {
        channels = Array.from(
          { length: node.numberOfInputs },
          () => new Float32Array(this.length),
        );
        for (const connection of node._inputs) {
          const upstreamChannels = renderNode(connection.source);
          const upstream = upstreamChannels[connection.output] ?? upstreamChannels[0];
          addChannel(channels[connection.input], upstream);
        }
      } else if (node instanceof FakeDestinationNode) {
        channels = Array.from(
          { length: this.numberOfChannels },
          () => new Float32Array(this.length),
        );
        for (const connection of node._inputs) {
          const upstreamChannels = renderNode(connection.source);
          for (let channel = 0; channel < channels.length; channel += 1) {
            addChannel(channels[channel], upstreamChannels[channel] ?? upstreamChannels[0]);
          }
        }
      } else {
        throw new TypeError('unknown fake audio node');
      }
      memo.set(node, channels);
      return channels;
    };

    const renderedChannels = renderNode(this.destination);
    const rendered = new FakeAudioBuffer({
      length: this.length,
      numberOfChannels: this.numberOfChannels,
      sampleRate: this.sampleRate,
    });
    renderedChannels.forEach((channel, index) => rendered.getChannelData(index).set(channel));

    const duration = this.length / this.sampleRate;
    const ended = this.createdSources
      .filter((source) => source._start !== null && source._endTime() <= duration)
      .toSorted((left, right) => left._endTime() - right._endTime());
    for (const source of ended) {
      this.currentTime = source._endTime();
      source.onended?.();
    }
    this.currentTime = duration;
    return rendered;
  }
}

export function createFakeOfflineAudioContextFactory(registry = []) {
  return (options) => {
    const context = new FakeOfflineAudioContext(options);
    registry.push(context);
    return context;
  };
}
