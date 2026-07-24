import test from 'node:test';
import assert from 'node:assert/strict';

import { createEqualPowerCurves } from '../audio-math.mjs';
import { FakeAudioContext, timerHarness } from './fake-audio.mjs';

const ENGINE_URL = new URL('../audio-engine.mjs', import.meta.url);

async function loadEngine() {
  return import(ENGINE_URL);
}

function fixture(overrides = {}) {
  const context = overrides.context ?? new FakeAudioContext();
  const timers = overrides.timers ?? timerHarness();
  const trackBuffer = { name: 'track', duration: 16 };
  const percussionBuffer = { name: 'percussion', duration: 0.08 };
  const terminals = [];
  return {
    context,
    timers,
    trackBuffer,
    percussionBuffer,
    terminals,
    options: {
      context,
      trackBuffer,
      percussionBuffer,
      calibration: { trackTrim: 0.7, percussionTrim: 0.35, masterGain: 0.8 },
      curveFactory: createEqualPowerCurves,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
      onTerminal: (snapshot) => terminals.push(snapshot),
    },
  };
}

test('engine synchronously schedules one owned phase-locked generation', async () => {
  const { createAudioEngine } = await loadEngine();
  const f = fixture();
  let curveCalls = 0;
  const engine = createAudioEngine({
    ...f.options,
    curveFactory: () => { curveCalls += 1; return createEqualPowerCurves(128); },
  });
  const plan = engine.start(1);

  assert.equal(curveCalls, 1);
  assert.equal(f.context.sources.length, 9);
  assert.equal(engine.activeSourceCount, 9);
  assert.equal(plan.beatOneTime, 10.1);
  assert.deepEqual(f.context.sources.slice(0, 8).map((source) => source.startCalls[0]), plan.percussionTimes.map((time) => [time]));
  assert.deepEqual(f.context.sources[8].startCalls[0], [plan.trackStartTime, 0]);
  assert.equal(f.context.sources[8].buffer, f.trackBuffer);
  assert.ok(f.context.sources.every((source) => typeof source.onended === 'function'));

  const curveCallsOnParams = f.context.gains.flatMap((node) => node.gain.calls).filter(([name]) => name === 'setValueCurveAtTime');
  assert.equal(curveCallsOnParams.length, 2);
  assert.ok(curveCallsOnParams.every(([, curve, time, duration]) => curve instanceof Float32Array && curve.length === 128 && time === plan.crossfadeStartTime && duration === 2));
});

test('every throw-prone successful-path step rolls back partial ownership', async () => {
  const { createAudioEngine, AudioEngineError } = await loadEngine();
  const baseline = fixture();
  createAudioEngine(baseline.options).start(1);
  const throwStepCount = baseline.context.operationCount;
  assert.ok(throwStepCount > 20);

  for (let failAt = 1; failAt <= throwStepCount; failAt += 1) {
    const context = new FakeAudioContext({ failAt });
    const f = fixture({ context });
    const engine = createAudioEngine(f.options);
    assert.throws(() => engine.start(1), (error) => error instanceof AudioEngineError && error.code === 'schedule-failed');
    assert.equal(engine.activeSourceCount, 0, `active registry after injected step ${failAt}`);
    assert.ok(context.sources.filter((source) => source.startCalls.length > 0).every((source) => source.stopCalls.length === 1));
    assert.equal(engine.diagnostics.errorCode, 'schedule-failed');
  }
});

test('manual running teardown ramps and settles on deadline when onended is absent', async () => {
  const { createAudioEngine } = await loadEngine();
  const f = fixture();
  const engine = createAudioEngine(f.options);
  engine.start(1);
  const settlement = engine.settle({ generation: 1, cause: 'manual-stop', state: 'stopped', immediate: false });

  assert.equal(f.timers.size, 1);
  assert.equal(f.context.sources.every((source) => source.stopCalls[0][0] === 10.025), true);
  assert.ok(f.context.gains.some((node) => node.gain.calls.some(([name, value, time]) => name === 'linearRampToValueAtTime' && value === 0 && time === 10.02)));
  assert.equal(f.context.closeCalls, 0);

  f.timers.fireAll();
  const snapshot = await settlement;
  assert.equal(snapshot.terminalState, 'stopped');
  assert.equal(snapshot.acceptedCause, 'manual-stop');
  assert.equal(snapshot.activeSourceCount, 0);
  assert.equal(snapshot.teardownSettled, true);
  assert.equal(snapshot.finalContextState, 'closed');
  assert.equal(f.context.closeCalls, 1);
});

test('timer adapters are invoked without rebinding their receiver', async () => {
  const { createAudioEngine } = await loadEngine();
  const f = fixture();
  let callback;
  const setTimeoutFn = function (next) {
    assert.equal(this, undefined);
    callback = next;
    return 17;
  };
  const clearTimeoutFn = function () { assert.equal(this, undefined); };
  const engine = createAudioEngine({ ...f.options, setTimeoutFn, clearTimeoutFn });
  engine.start(1);
  const settlement = engine.settle({ generation: 1, cause: 'manual-stop', state: 'stopped', immediate: false });
  callback();
  const snapshot = await settlement;
  assert.equal(snapshot.terminalState, 'stopped');
});

test('manual Stop holds the computed equal-power point before the ramp', async () => {
  const { createAudioEngine } = await loadEngine();
  const f = fixture();
  const engine = createAudioEngine(f.options);
  const plan = engine.start(1);
  f.context.currentTime = (plan.crossfadeStartTime + plan.crossfadeEndTime) / 2;
  const settlement = engine.settle({ generation: 1, cause: 'manual-stop', state: 'stopped', immediate: false });
  const percussionHold = f.context.gains[0].gain.calls.findLast(([name]) => name === 'setValueAtTime');
  const trackHold = f.context.gains[2].gain.calls.findLast(([name]) => name === 'setValueAtTime');
  assert.ok(Math.abs(percussionHold[1] - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(trackHold[1] - Math.SQRT1_2) < 1e-12);
  f.timers.fireAll();
  await settlement;
});

test('close rejection and terminal observer failure cannot strand settlement', async () => {
  const { createAudioEngine } = await loadEngine();
  const f = fixture();
  f.context.close = async () => { f.context.closeCalls += 1; throw new Error('device close failure'); };
  const engine = createAudioEngine({ ...f.options, onTerminal: () => { throw new Error('observer failure'); } });
  engine.start(1);
  const snapshot = await engine.settle({ generation: 1, cause: 'hidden', state: 'interrupted', immediate: true });
  assert.equal(snapshot.acceptedCause, 'hidden');
  assert.equal(snapshot.errorCode, 'context-close-failed');
  assert.equal(snapshot.activeSourceCount, 0);
  assert.equal(snapshot.teardownSettled, true);
});

test('hidden teardown clears ownership synchronously and first cause wins', async () => {
  const { createAudioEngine } = await loadEngine();
  const f = fixture();
  const engine = createAudioEngine(f.options);
  engine.start(1);

  const hidden = engine.settle({ generation: 1, cause: 'hidden', state: 'interrupted', immediate: true });
  const manual = engine.settle({ generation: 1, cause: 'manual-stop', state: 'stopped', immediate: false });
  assert.strictEqual(manual, hidden);
  assert.equal(engine.activeSourceCount, 0);

  const snapshot = await hidden;
  assert.equal(snapshot.terminalState, 'interrupted');
  assert.equal(snapshot.acceptedCause, 'hidden');
  assert.equal(f.terminals.length, 1);
  assert.deepEqual(f.terminals[0], snapshot);
  assert.equal(f.context.closeCalls, 1);
});

test('every ordered terminal-cause pair preserves the first accepted result', async () => {
  const { createAudioEngine } = await loadEngine();
  const terminals = [
    ['manual-stop', 'stopped'],
    ['hidden', 'interrupted'],
    ['context-suspended', 'interrupted'],
    ['natural-end', 'complete'],
    ['resume-failed', 'runtime-error'],
    ['startup-timeout', 'runtime-error'],
    ['schedule-failed', 'runtime-error'],
  ];
  for (const [firstCause, firstState] of terminals) {
    for (const [secondCause, secondState] of terminals) {
      if (firstCause === secondCause) continue;
      const f = fixture();
      const engine = createAudioEngine(f.options);
      engine.start(1);
      const first = engine.settle({ generation: 1, cause: firstCause, state: firstState, immediate: true });
      const second = engine.settle({ generation: 1, cause: secondCause, state: secondState, immediate: true });
      assert.strictEqual(first, second, `${firstCause} then ${secondCause}`);
      const snapshot = await first;
      assert.equal(snapshot.acceptedCause, firstCause, `${firstCause} then ${secondCause}`);
      assert.equal(snapshot.terminalState, firstState, `${firstCause} then ${secondCause}`);
    }
  }
});

test('natural track completion owns complete and closes exactly once', async () => {
  const { createAudioEngine } = await loadEngine();
  const f = fixture();
  const engine = createAudioEngine(f.options);
  engine.start(1);
  f.context.sources.at(-1).finish();
  await engine.whenSettled();

  assert.equal(f.terminals.length, 1);
  assert.equal(f.terminals[0].terminalState, 'complete');
  assert.equal(f.terminals[0].acceptedCause, 'natural-end');
  assert.equal(f.context.closeCalls, 1);
  f.context.sources.at(-1).finish();
  assert.equal(f.terminals.length, 1);
});

test('stale generation teardown is a no-op', async () => {
  const { createAudioEngine } = await loadEngine();
  const f = fixture();
  const engine = createAudioEngine(f.options);
  engine.start(1);
  const result = await engine.settle({ generation: 2, cause: 'hidden', state: 'interrupted', immediate: true });
  assert.equal(result, null);
  assert.equal(engine.activeSourceCount, 9);
  assert.equal(f.context.closeCalls, 0);
});

test('typed runtime terminal cause is retained as the diagnostic error code', async () => {
  const { createAudioEngine } = await loadEngine();
  const f = fixture();
  const engine = createAudioEngine(f.options);
  engine.start(1);
  const snapshot = await engine.settle({ generation: 1, cause: 'startup-timeout', state: 'runtime-error', immediate: true });
  assert.equal(snapshot.errorCode, 'startup-timeout');
});

test('percussion click is synthesized into the owned context', async () => {
  const { createPercussionBuffer } = await loadEngine();
  const context = new FakeAudioContext();
  const buffer = createPercussionBuffer(context);
  assert.equal(buffer.numberOfChannels, 1);
  assert.equal(buffer.sampleRate, 44100);
  assert.ok(buffer.duration > 0 && buffer.duration <= 0.08);
  const samples = buffer.getChannelData(0);
  assert.ok(samples.every(Number.isFinite));
  assert.ok(samples.some((sample) => sample !== 0));
  assert.ok(Math.max(...samples) <= 0.8);
  assert.ok(Math.min(...samples) >= -0.8);
});
