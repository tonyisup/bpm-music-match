import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionCoordinator } from '../src/browser/coordinator.mjs';
import { parseRunQuery } from '../src/core/run-context.mjs';

async function flush(turns = 8) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

function createFixture() {
  const calls = [];
  const states = [];
  const timers = [];
  const capability = Object.freeze({
    snapshotAudioClock() {
      return Object.freeze({
        audioNow: 10,
        contextState: 'suspended',
        outputSampleRate: 48_000,
      });
    },
  });
  const loader = Object.freeze({
    load(request) {
      calls.push({ type: 'load', request });
      return Promise.resolve(capability);
    },
    cancel() { calls.push({ type: 'cancel' }); return true; },
    teardown(reason) { calls.push({ type: 'teardown', reason }); return Promise.resolve(); },
  });
  const engine = Object.freeze({
    directTap(request) {
      calls.push({ type: 'direct-tap', request });
      return Object.freeze({
        settlement: Promise.resolve(Object.freeze({ status: 'succeeded', cause: null })),
      });
    },
    schedulePredictions(request) {
      calls.push({ type: 'schedule-predictions', request });
      return Promise.resolve(Object.freeze({ status: 'succeeded', cause: null }));
    },
    cancelPredictions(request) {
      calls.push({ type: 'cancel-predictions', request });
      return Promise.resolve(Object.freeze({ status: 'succeeded', cause: null }));
    },
    commitHandoff(request) {
      calls.push({ type: 'commit-handoff', request });
      return Promise.resolve(Object.freeze({ status: 'succeeded', cause: null }));
    },
    terminateGeneration(request) {
      calls.push({ type: 'terminate-generation', request });
      return Object.freeze({ cleanupPromise: new Promise(() => {}) });
    },
  });
  let now = 1_000;
  const coordinator = createSessionCoordinator({
    runContext: parseRunQuery('?run=session-1'),
    loader,
    createEngine(options) { calls.push({ type: 'create-engine', options }); return engine; },
    openTrackPicker() { calls.push({ type: 'open-picker' }); },
    setTimer(callback, milliseconds) {
      const timer = { callback, milliseconds, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) { timer.cleared = true; },
    nowMilliseconds() { return now; },
    onState(state) { states.push(state); },
  });
  return {
    calls,
    states,
    timers,
    coordinator,
    setNow(value) { now = value; },
  };
}

test('T9-COORDINATOR keeps the selected track out of reducer state and starts the engine', async () => {
  const fixture = createFixture();
  const selectedTrack = { name: 'PRIVATE-TRACK-NAME.mp3' };
  fixture.coordinator.chooseTrack();
  fixture.coordinator.selectFile(selectedTrack);
  assert.equal(fixture.coordinator.inspect().phase, 'loading-track');
  await flush();
  assert.equal(fixture.coordinator.inspect().phase, 'ready');
  assert.equal(fixture.calls.find(({ type }) => type === 'load').request.file, selectedTrack);
  assert.equal(JSON.stringify(fixture.states).includes(selectedTrack.name), false);
  assert.equal(fixture.calls.some(({ type }) => type === 'create-engine'), true);
});

test('T9-COORDINATOR schedules direct audio during the tap dispatch and settles reducer effects', async () => {
  const fixture = createFixture();
  fixture.coordinator.chooseTrack();
  fixture.coordinator.selectFile({});
  await flush();

  fixture.coordinator.tap(1_000);
  assert.equal(fixture.calls.some(({ type }) => type === 'direct-tap'), true);
  assert.equal(fixture.coordinator.inspect().phase, 'tracking');
  assert.equal(fixture.timers.length, 1);
  await flush();
  assert.equal(fixture.coordinator.inspect().pendingResume, null);
  assert.equal(fixture.coordinator.inspect().pendingEffects.length, 0);
});

test('T9-COORDINATOR converts a late idle timer into an owned reducer event', async () => {
  const fixture = createFixture();
  fixture.coordinator.chooseTrack();
  fixture.coordinator.selectFile({});
  await flush();
  fixture.coordinator.tap(1_000);
  await flush();
  fixture.setNow(3_000);
  fixture.timers[0].callback();
  assert.equal(fixture.coordinator.inspect().phase, 'generation-settling');
});
