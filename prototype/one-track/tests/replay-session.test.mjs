import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  ASSET_IDENTITY,
  EXPERIMENT_CONFIG_IDENTITY,
} from '../src/config.mjs';
import {
  advanceRunContext,
  freezeColdContextAtFirstAcceptedTap,
  parseRunQuery,
} from '../src/core/run-context.mjs';
import {
  createInitialSessionState,
  reduceSession,
} from '../src/core/session-reducer.mjs';
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
  'two-advance-catch-up',
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

function createRunContext(runValue, thermalState) {
  const cold = parseRunQuery(`?run=${runValue}`);
  if (thermalState !== 'warmed') {
    return cold;
  }
  return advanceRunContext(freezeColdContextAtFirstAcceptedTap(cold), {
    evidenceResolved: true,
    downloadGesture: true,
    reset: true,
  });
}

function createReadyState(runValue, thermalState) {
  const initial = createInitialSessionState(createRunContext(runValue, thermalState));
  const selecting = reduceSession(initial, { type: 'choose-track' });
  const loading = reduceSession(selecting.state, {
    type: 'file-selected',
    selectionId: `selection-${runValue}`,
  });
  const effect = loading.effects[0];
  return reduceSession(loading.state, {
    type: 'load-succeeded',
    sessionId: effect.sessionId,
    generationId: effect.generationId,
    effectId: effect.effectId,
    effectType: effect.effectType,
    loadToken: effect.payload.loadToken,
    loadedSessionId: `loaded-${runValue}`,
    assetIdentity: ASSET_IDENTITY,
    experimentConfigIdentity: EXPERIMENT_CONFIG_IDENTITY,
  }).state;
}

function projectTransitions(replay) {
  return replay.transitions.map((transition) => ({
    phase: transition.state.phase,
    activeGenerationId: transition.state.activeGenerationId,
    terminalCause: transition.state.terminal.cause,
    effectTypes: transition.effects.map(({ effectType }) => effectType),
  }));
}

function hashSerialTrace(events, replay) {
  return createHash('sha256').update(JSON.stringify({ events, replay })).digest('hex');
}

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

test('T4-REPLAY-TRACE-INTEGRITY detects a changed stale no-op callback event', () => {
  const fixture = REPLAY_CASES.find(({ name }) => name === 'stale-callbacks');
  assert.notEqual(fixture, undefined);
  const initialState = createReadyState(fixture.runValue, fixture.thermalState);
  const baseline = replaySession(initialState, fixture.events);
  assert.equal(hashSerialTrace(fixture.events, baseline), fixture.expected.traceSha256);

  const mutatedEvents = structuredClone(fixture.events);
  const staleSettlement = mutatedEvents.findLast(
    ({ effectId }) => Number.isSafeInteger(effectId),
  );
  assert.notEqual(staleSettlement, undefined);
  staleSettlement.effectId += 1_000;
  const mutated = replaySession(initialState, mutatedEvents);

  assert.notEqual(
    hashSerialTrace(mutatedEvents, mutated),
    fixture.expected.traceSha256,
    'the complete serial trace must detect changed no-op callback ownership',
  );
});

test('T4-REPLAY-FIXTURES covers the complete serial policy matrix through the real reducer', () => {
  assert.deepEqual(REPLAY_CASES.map(({ name }) => name), REQUIRED_REPLAY_CASES);
  for (const fixture of REPLAY_CASES) {
    assert.deepEqual(Reflect.ownKeys(fixture), [
      'name',
      'runValue',
      'thermalState',
      'events',
      'expected',
    ], fixture.name);
    const initialState = createReadyState(fixture.runValue, fixture.thermalState);
    const replay = replaySession(initialState, fixture.events);
    const expected = fixture.expected;
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
    const matchDecision = [...replay.transitions].reverse().find(
      ({ state }) => state.matchDecision !== null,
    )?.state.matchDecision ?? null;
    if (Object.hasOwn(expected, 'actualClass')) {
      assert.equal(
        matchDecision?.actualClass ?? null,
        expected.actualClass,
        fixture.name,
      );
    }
    if (Object.hasOwn(expected, 'assignedClassMatched')) {
      assert.equal(
        matchDecision?.assignedClassMatched ?? null,
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
    assert.deepEqual(projectTransitions(replay), expected.transitions, fixture.name);
    assert.equal(hashSerialTrace(fixture.events, replay), expected.traceSha256, fixture.name);
    const effectTypes = replay.orderedEffects.map(({ effectType }) => effectType);
    const expectedEffectTypes = expected.transitions.flatMap(({ effectTypes: types }) => types);
    assert.deepEqual(effectTypes, expectedEffectTypes, fixture.name);
    for (const requiredEffectType of expected.requiredEffectTypes ?? []) {
      assert.equal(
        effectTypes.includes(requiredEffectType),
        true,
        `${fixture.name}:${requiredEffectType}`,
      );
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
