import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDeadlineClockEvent,
  createTapClockEvent,
} from '../src/browser/clock-adapter.mjs';

const clock = Object.freeze({
  audioNow: 5,
  contextState: 'running',
  outputSampleRate: 48_000,
});

test('T9-CLOCK maps event time into the audio clock without rounding', () => {
  assert.deepEqual(createTapClockEvent(995, 1_000, clock), {
    type: 'tap',
    eventTimestampMs: 995,
    observedNowMs: 1_000,
    mappedTapAudioTime: 4.995,
    audioNow: 5,
    contextState: 'running',
    outputSampleRate: 48_000,
  });
});

test('T9-CLOCK maps late lock timers to a past-or-current audio deadline', () => {
  assert.deepEqual(createDeadlineClockEvent(
    'lock-deadline',
    { sessionId: 'session-1', generationId: 2 },
    1_000,
    1_020,
    clock,
  ), {
    type: 'lock-deadline',
    sessionId: 'session-1',
    generationId: 2,
    deadlineTimestampMs: 1_000,
    lockDeadlineAudioTime: 4.98,
    audioNow: 5,
    outputSampleRate: 48_000,
  });
});

test('T9-CLOCK rejects malformed or impossible mappings', () => {
  assert.throws(() => createTapClockEvent(-Infinity, 1, clock), /invalid/);
  assert.throws(
    () => createDeadlineClockEvent(
      'lock-deadline',
      { sessionId: 'session-1', generationId: 2 },
      0,
      10_000,
      { ...clock, audioNow: 1 },
    ),
    /invalid/,
  );
});
