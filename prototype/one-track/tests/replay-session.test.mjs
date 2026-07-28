import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRunQuery } from '../src/core/run-context.mjs';
import { createInitialSessionState } from '../src/core/session-reducer.mjs';
import { replaySession } from '../src/replay/replay-session.mjs';
import { REPLAY_CASES } from './fixtures/replay-cases.mjs';

const REQUIRED_REPLAY_CASES = Object.freeze([
  'center-match',
  'low-edge-match',
  'high-edge-match',
  'just-below-window',
  'just-above-window',
  'wrong-assigned-class',
  'three-no-match-attempts',
  'paired-warmed-auto-failure',
  'jitter-outlier-recovery',
  'unstable-silence',
  'tap-before-lock',
  'lock-before-tap',
  'armed-destabilization',
  'bridge-ownership',
  'adopt-ownership',
  'cancel-ownership',
  'catch-up-limit',
  'smoke-crossfade-complete',
  'smoke-playing-complete',
  'visibility-wins-context-race',
  'context-close-wins-visibility-race',
  'resume-failure',
  'teardown-failure',
  'natural-end',
  'end-trial',
  'stale-callbacks',
]);

function assertRecursivelyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    assertRecursivelyFrozen(child, seen);
  }
}

test('T4-REPLAY-FOUNDATION invokes the reducer and returns one immutable ordered trace', () => {
  const initialState = createInitialSessionState(parseRunQuery('?run=session-1'));
  const replay = replaySession(initialState, [
    { type: 'choose-track' },
    { type: 'selection-cancelled' },
  ]);

  assert.equal(replay.initialState, initialState);
  assert.equal(replay.transitions.length, 2);
  assert.deepEqual(replay.transitions.map(({ index, eventType, state, effects }) => ({
    index,
    eventType,
    phase: state.phase,
    effectTypes: effects.map(({ effectType }) => effectType),
  })), [
    {
      index: 0,
      eventType: 'choose-track',
      phase: 'selecting-track',
      effectTypes: ['open-track-picker'],
    },
    {
      index: 1,
      eventType: 'selection-cancelled',
      phase: 'awaiting-track',
      effectTypes: [],
    },
  ]);
  assert.equal(replay.finalState, replay.transitions[1].state);
  assert.deepEqual(replay.orderedEffects, replay.transitions[0].effects);
  assertRecursivelyFrozen(replay);

  const empty = replaySession(initialState, []);
  assert.equal(empty.initialState, initialState);
  assert.equal(empty.finalState, initialState);
  assert.deepEqual(empty.transitions, []);
  assert.deepEqual(empty.orderedEffects, []);

  let getterCalls = 0;
  const hostileEvents = [];
  Object.defineProperty(hostileEvents, '0', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not invoke replay array getters');
    },
  });
  hostileEvents.length = 1;
  assert.throws(() => replaySession(initialState, hostileEvents), TypeError);
  assert.equal(getterCalls, 0);
  assert.throws(() => replaySession(initialState, new Array(1)), TypeError);
  assert.throws(() => replaySession(initialState, Object.assign([], { extra: true })), TypeError);
  assert.throws(() => replaySession({}, []), TypeError);
});

test('T4-REPLAY-FIXTURES covers the complete serial policy matrix through the real reducer', () => {
  assert.deepEqual(REPLAY_CASES.map(({ name }) => name), REQUIRED_REPLAY_CASES);
  for (const fixture of REPLAY_CASES) {
    const scenario = fixture.build();
    const replay = replaySession(scenario.initialState, scenario.events);
    const expected = scenario.expected;
    assert.equal(replay.finalState.phase, expected.finalPhase, fixture.name);
    if (Object.hasOwn(expected, 'terminalCause')) {
      assert.equal(replay.finalState.terminal.cause, expected.terminalCause, fixture.name);
    }
    if (Object.hasOwn(expected, 'attemptCount')) {
      assert.equal(replay.finalState.attempts.length, expected.attemptCount, fixture.name);
    }
    if (Object.hasOwn(expected, 'activeGenerationId')) {
      assert.equal(
        replay.finalState.activeGenerationId,
        expected.activeGenerationId,
        fixture.name,
      );
    }
    if (Object.hasOwn(expected, 'actualClass')) {
      assert.equal(replay.finalState.matchDecision.actualClass, expected.actualClass, fixture.name);
    }
    if (Object.hasOwn(expected, 'assignedClassMatched')) {
      assert.equal(
        replay.finalState.matchDecision.assignedClassMatched,
        expected.assignedClassMatched,
        fixture.name,
      );
    }
    if (Object.hasOwn(expected, 'pairedWarmedAutoFailure')) {
      assert.deepEqual(
        replay.finalState.pairedWarmedAutoFailure,
        expected.pairedWarmedAutoFailure,
        fixture.name,
      );
    }
    if (Object.hasOwn(expected, 'smokeStatus')) {
      assert.equal(replay.finalState.smokeProbe.status, expected.smokeStatus, fixture.name);
    }
    const effectTypes = replay.orderedEffects.map(({ effectType }) => effectType);
    for (const effectType of expected.requiredEffectTypes ?? []) {
      assert.equal(effectTypes.includes(effectType), true, `${fixture.name}:${effectType}`);
    }
    const handoffPlan = [...replay.transitions].reverse().find(
      ({ state }) => state.handoffPlan !== null,
    )?.state.handoffPlan ?? null;
    if (Object.hasOwn(expected, 'ownershipDisposition')) {
      assert.notEqual(handoffPlan, null, fixture.name);
      assert.equal(
        handoffPlan.sourceClassifications.some(({ disposition }) => (
          disposition === expected.ownershipDisposition
        )),
        true,
        fixture.name,
      );
    }
    if (Object.hasOwn(expected, 'skippedBeatCount')) {
      assert.notEqual(handoffPlan, null, fixture.name);
      assert.equal(handoffPlan.skippedBeatCount, expected.skippedBeatCount, fixture.name);
    }
    assertRecursivelyFrozen(replay);
  }
});
