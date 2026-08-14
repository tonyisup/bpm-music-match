import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionCoordinator } from '../src/browser/coordinator.mjs';
import { parseRunQuery } from '../src/core/run-context.mjs';

async function flush(turns = 8) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

function createFixture(overrides = {}) {
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
    ...overrides.loader,
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
    ...overrides.engine,
  });
  let now = 1_000;
  const coordinator = createSessionCoordinator({
    runContext: parseRunQuery('?run=session-1'),
    loader,
    createEngine(options) {
      calls.push({ type: 'create-engine', options });
      return overrides.createEngine === undefined
        ? engine
        : overrides.createEngine(options);
    },
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

test('T9-COORDINATOR turns a synchronous audio command failure into finalizable evidence', async () => {
  const fixture = createFixture({
    loader: {
      teardown(reason) {
        fixture.calls.push({ type: 'teardown', reason });
        return Promise.reject(new Error('synthetic close rejection'));
      },
    },
    engine: {
      directTap() { throw new Error('synthetic direct tap failure'); },
    },
  });
  fixture.coordinator.chooseTrack();
  fixture.coordinator.selectFile({});
  await flush();

  fixture.coordinator.tap(1_000);
  await flush(16);

  assert.equal(fixture.coordinator.inspect().phase, 'evidence-pending');
  assert.deepEqual(fixture.coordinator.inspect().cleanup, {
    status: 'failed',
    cause: 'context-close-failed',
  });
  assert.equal(fixture.coordinator.inspect().loadedSessionId, null);
  assert.equal(fixture.calls.filter(({ type }) => type === 'teardown').length, 1);

  const assessment = {
    recordKind: 'scored',
    verdict: 'not-judged',
    missingBeat: false,
    doubledBeat: false,
    click: false,
    gap: false,
    audibleClipping: false,
    staleAudio: false,
    ownershipLeak: false,
    teardownFailure: true,
  };
  const first = fixture.coordinator.finalizeEvidence(assessment);
  const retry = fixture.coordinator.finalizeEvidence(assessment);
  assert.equal(retry, first);
  assert.match(first.download.href, /^data:application\/json;charset=utf-8,/);
});

test('T9-COORDINATOR contains synchronous loader and engine construction failures', async () => {
  const loadFailure = createFixture({
    loader: {
      load() { throw new Error('synthetic load failure'); },
    },
  });
  loadFailure.coordinator.chooseTrack();
  loadFailure.coordinator.selectFile({});
  await flush();
  assert.equal(loadFailure.coordinator.inspect().phase, 'error');

  const engineFailure = createFixture({
    createEngine() { throw new Error('synthetic engine construction failure'); },
  });
  engineFailure.coordinator.chooseTrack();
  engineFailure.coordinator.selectFile({});
  await flush(16);
  assert.equal(engineFailure.coordinator.inspect().phase, 'error');
  assert.equal(engineFailure.calls.filter(({ type }) => type === 'teardown').length, 1);
});
