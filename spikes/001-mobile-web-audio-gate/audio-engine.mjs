import { createGatePlan } from './audio-math.mjs';

export const AUDIO_ENGINE_BUILD_COMMIT = '__BUILD_COMMIT__';

export class AudioEngineError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AudioEngineError';
    this.code = code;
  }
}

export function createPercussionBuffer(context) {
  const sampleRate = context.sampleRate;
  const length = Math.max(1, Math.round(sampleRate * 0.06));
  const buffer = context.createBuffer(1, length, sampleRate);
  const samples = buffer.getChannelData(0);
  let phase = 0;
  for (let index = 0; index < length; index += 1) {
    const progress = index / length;
    const frequency = 900 - 720 * progress;
    phase += (2 * Math.PI * frequency) / sampleRate;
    const envelope = (1 - progress) ** 3;
    samples[index] = Math.sin(phase) * envelope * 0.75;
  }
  return buffer;
}

function safeCall(operation) {
  try {
    operation();
  } catch {
    // Teardown must continue across per-node cleanup failures.
  }
}

class AudioEngine {
  constructor(options) {
    this.context = options.context;
    this.trackBuffer = options.trackBuffer;
    this.percussionBuffer = options.percussionBuffer;
    this.calibration = options.calibration;
    this.curveFactory = options.curveFactory;
    const scheduleTimeout = options.setTimeoutFn ?? globalThis.setTimeout.bind(globalThis);
    const cancelTimeout = options.clearTimeoutFn ?? globalThis.clearTimeout.bind(globalThis);
    this.setTimeoutFn = (callback, milliseconds) => scheduleTimeout(callback, milliseconds);
    this.clearTimeoutFn = (timerId) => cancelTimeout(timerId);
    this.onTerminal = options.onTerminal ?? (() => {});
    this.records = new Map();
    this.graphNodes = [];
    this.graph = null;
    this.activeGeneration = null;
    this.plan = null;
    this.terminal = null;
    this.terminalPromise = null;
    this.resolveTerminal = null;
    this.cleanupTimer = null;
    this.finishing = false;
    this.finalSnapshot = null;
    this.errorCode = null;
    this.scheduledPercussion = 0;
    this.endedPercussion = 0;
    this.trackEnded = false;
    this.closePromise = null;
    this.contextCloseFailed = false;
  }

  get activeSourceCount() {
    return this.records.size;
  }

  get diagnostics() {
    return this.finalSnapshot ?? {
      errorCode: this.errorCode,
      terminalState: this.terminal?.state ?? null,
      acceptedCause: this.terminal?.cause ?? null,
      activeSourceCount: this.records.size,
      teardownSettled: false,
      finalContextState: this.context.state,
      scheduledPercussion: this.scheduledPercussion,
      endedPercussion: this.endedPercussion,
      trackEnded: this.trackEnded,
      plan: this.plan,
    };
  }

  whenSettled() {
    return this.terminalPromise ?? Promise.resolve(this.finalSnapshot);
  }

  createGain(value) {
    const node = this.context.createGain();
    this.graphNodes.push(node);
    node.gain.value = value;
    return node;
  }

  buildGraph() {
    const percussionFade = this.createGain(1);
    const percussionTrim = this.createGain(this.calibration.percussionTrim);
    const trackFade = this.createGain(0);
    const trackTrim = this.createGain(this.calibration.trackTrim);
    const master = this.createGain(this.calibration.masterGain);
    percussionFade.connect(percussionTrim);
    percussionTrim.connect(master);
    trackFade.connect(trackTrim);
    trackTrim.connect(master);
    master.connect(this.context.destination);
    this.graph = { percussionFade, percussionTrim, trackFade, trackTrim, master };
  }

  registerSource(generation, kind, node) {
    const record = {
      generation,
      kind,
      node,
      startCommitted: false,
      intentionallyStopping: false,
      ended: false,
      disconnected: false,
    };
    this.records.set(node, record);
    node.onended = () => this.handleEnded(record);
    return record;
  }

  createAndStartSource(generation, kind, buffer, target, startArgs) {
    const node = this.context.createBufferSource();
    const record = this.registerSource(generation, kind, node);
    node.buffer = buffer;
    node.connect(target);
    node.start(...startArgs);
    record.startCommitted = true;
    return record;
  }

  start(generation) {
    if (this.activeGeneration !== null || this.terminalPromise) {
      throw new AudioEngineError('schedule-failed', 'The single-use engine already owns a generation.');
    }
    this.activeGeneration = generation;
    try {
      this.plan = createGatePlan({ audioNow: this.context.currentTime, assetDurationSeconds: this.trackBuffer.duration });
      const curves = this.curveFactory(128);
      this.buildGraph();
      this.graph.percussionFade.gain.setValueAtTime(1, this.plan.beatOneTime);
      this.graph.trackFade.gain.setValueAtTime(0, this.plan.beatOneTime);
      const crossfadeDuration = this.plan.crossfadeEndTime - this.plan.crossfadeStartTime;
      this.graph.percussionFade.gain.setValueCurveAtTime(curves.percussion, this.plan.crossfadeStartTime, crossfadeDuration);
      this.graph.trackFade.gain.setValueCurveAtTime(curves.music, this.plan.crossfadeStartTime, crossfadeDuration);

      for (const time of this.plan.percussionTimes) {
        this.createAndStartSource(generation, 'percussion', this.percussionBuffer, this.graph.percussionFade, [time]);
        this.scheduledPercussion += 1;
      }
      this.createAndStartSource(generation, 'track', this.trackBuffer, this.graph.trackFade, [this.plan.trackStartTime, this.plan.trackOffset]);
      return this.plan;
    } catch (cause) {
      this.rollbackSchedule(cause);
      throw new AudioEngineError('schedule-failed', 'Failed to create the complete audio schedule.', cause);
    }
  }

  handleEnded(record) {
    if (record.ended) return;
    record.ended = true;
    if (record.kind === 'percussion') this.endedPercussion += 1;
    if (record.kind === 'track') this.trackEnded = true;
    this.disconnectRecord(record);

    if (record.kind === 'track' && !record.intentionallyStopping && !this.terminalPromise) {
      this.settle({ generation: record.generation, cause: 'natural-end', state: 'complete', immediate: true });
      return;
    }
    if (this.terminalPromise && !this.finishing && this.records.size === 0) {
      this.finishSettlement();
    }
  }

  disconnectRecord(record) {
    if (!record.disconnected) {
      safeCall(() => record.node.disconnect());
      record.disconnected = true;
    }
    this.records.delete(record.node);
  }

  stopAndClearAll(stopTime = undefined) {
    for (const record of [...this.records.values()]) {
      record.intentionallyStopping = true;
      if (record.startCommitted && !record.ended) {
        safeCall(() => stopTime === undefined ? record.node.stop() : record.node.stop(stopTime));
      }
      this.disconnectRecord(record);
    }
  }

  cancelAutomation() {
    if (!this.graph) return;
    const now = this.context.currentTime;
    for (const node of [this.graph.percussionFade, this.graph.trackFade]) {
      safeCall(() => node.gain.cancelScheduledValues(now));
    }
  }

  fadeValueAtTime(kind, time) {
    if (time <= this.plan.crossfadeStartTime) return kind === 'percussion' ? 1 : 0;
    if (time >= this.plan.crossfadeEndTime) return kind === 'percussion' ? 0 : 1;
    const progress = (time - this.plan.crossfadeStartTime)
      / (this.plan.crossfadeEndTime - this.plan.crossfadeStartTime);
    const angle = progress * Math.PI / 2;
    return kind === 'percussion' ? Math.cos(angle) : Math.sin(angle);
  }

  rollbackSchedule() {
    this.errorCode = 'schedule-failed';
    this.stopAndClearAll();
    this.cancelAutomation();
    for (const node of this.graphNodes) safeCall(() => node.disconnect());
    this.terminal = { generation: this.activeGeneration, cause: 'schedule-failed', state: 'runtime-error' };
    this.closeContext();
  }

  closeContext() {
    if (!this.closePromise) {
      this.closePromise = Promise.resolve()
        .then(() => this.context.close())
        .catch(() => {
          this.contextCloseFailed = true;
          if (!this.errorCode) this.errorCode = 'context-close-failed';
        });
    }
    return this.closePromise;
  }

  settle({ generation, cause, state, immediate }) {
    if (generation !== this.activeGeneration) return Promise.resolve(null);
    if (this.terminalPromise) return this.terminalPromise;

    this.terminal = { generation, cause, state };
    if (state === 'runtime-error') this.errorCode = cause;
    this.terminalPromise = new Promise((resolve) => {
      this.resolveTerminal = resolve;
    });
    if (immediate) {
      this.cancelAutomation();
      this.stopAndClearAll();
      this.finishSettlement();
      return this.terminalPromise;
    }

    const now = this.context.currentTime;
    if (this.graph) {
      for (const [kind, node] of [['percussion', this.graph.percussionFade], ['track', this.graph.trackFade]]) {
        const heldValue = this.fadeValueAtTime(kind, now);
        safeCall(() => node.gain.cancelScheduledValues(now));
        safeCall(() => node.gain.setValueAtTime(heldValue, now));
        safeCall(() => node.gain.linearRampToValueAtTime(0, now + 0.020));
      }
    }
    for (const record of this.records.values()) {
      record.intentionallyStopping = true;
      if (record.startCommitted && !record.ended) safeCall(() => record.node.stop(now + 0.025));
    }
    this.cleanupTimer = this.setTimeoutFn(() => {
      this.cleanupTimer = null;
      this.stopAndClearAll();
      this.finishSettlement();
    }, 100);
    if (this.records.size === 0) this.finishSettlement();
    return this.terminalPromise;
  }

  async finishSettlement() {
    if (this.finishing || this.finalSnapshot) return;
    this.finishing = true;
    if (this.cleanupTimer !== null) {
      this.clearTimeoutFn(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.stopAndClearAll();
    for (const node of this.graphNodes) safeCall(() => node.disconnect());
    await this.closeContext();
    this.finalSnapshot = Object.freeze({
      errorCode: this.errorCode,
      terminalState: this.terminal.state,
      acceptedCause: this.terminal.cause,
      activeSourceCount: this.records.size,
      teardownSettled: true,
      finalContextState: this.context.state,
      scheduledPercussion: this.scheduledPercussion,
      endedPercussion: this.endedPercussion,
      trackEnded: this.trackEnded,
      plan: this.plan,
    });
    safeCall(() => this.onTerminal(this.finalSnapshot));
    this.resolveTerminal(this.finalSnapshot);
  }
}

export function createAudioEngine(options) {
  return new AudioEngine(options);
}
