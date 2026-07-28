import test from 'node:test';
import assert from 'node:assert/strict';

import * as plannerModule from '../src/core/handoff-planner.mjs';
import {
  HandoffPlannerFailure,
  createHandoffPlan,
  createPredictionOwnershipSnapshot,
} from '../src/core/handoff-planner.mjs';
import {
  ASSET_IDENTITY,
  EXPERIMENT_CONFIG_IDENTITY,
} from '../src/config.mjs';

function ownership(predictions = []) {
  return createPredictionOwnershipSnapshot({
    ownedSourceIds: predictions.map(({ sourceId }) => sourceId),
    predictions,
  });
}

function validInput(overrides = {}) {
  const estimatedBpmExact = 108;
  const lastTapAudioTime = 10;
  return {
    generationId: 'generation-1',
    assetIdentity: ASSET_IDENTITY,
    experimentConfigIdentity: EXPERIMENT_CONFIG_IDENTITY,
    estimatedBpmExact,
    lastTapAudioTime,
    candidateBeat1AudioTime: lastTapAudioTime + 60 / estimatedBpmExact,
    lockDeadlineAudioTime: 10.35,
    audioNow: 10.4,
    outputSampleRate: 48_000,
    ownershipSnapshot: ownership(),
    ...overrides,
  };
}

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function nextUp(value) {
  if (Number.isNaN(value) || value === Number.POSITIVE_INFINITY) {
    return value;
  }
  if (Object.is(value, -0)) {
    return Number.MIN_VALUE;
  }
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  let bits = view.getBigUint64(0, false);
  bits += value >= 0 ? 1n : -1n;
  view.setBigUint64(0, bits, false);
  return view.getFloat64(0, false);
}

function assertRecursivelyFrozen(value) {
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') {
      assertRecursivelyFrozen(child);
    }
  }
}

test('T3-TIMING creates one immutable eight-beat handoff aligned to the locked track authority', () => {
  const input = validInput();
  const plan = createHandoffPlan(input);
  const handoffBeatDurationSeconds = 60 / 110;
  const beat1 = input.candidateBeat1AudioTime;

  assert.equal(plan.generationId, input.generationId);
  assert.strictEqual(plan.assetIdentity, ASSET_IDENTITY);
  assert.strictEqual(plan.experimentConfigIdentity, EXPERIMENT_CONFIG_IDENTITY);
  assert.equal(plan.estimatedBpmExact, input.estimatedBpmExact);
  assert.equal(plan.estimatedBeatDurationSeconds, 60 / input.estimatedBpmExact);
  assert.equal(plan.handoffBpm, 110);
  assert.equal(plan.trackBpm, 110);
  assert.equal(plan.tempoSnapBpm, 2);
  assert.equal(plan.lastTapAudioTime, input.lastTapAudioTime);
  assert.equal(plan.candidateBeat1AudioTime, input.candidateBeat1AudioTime);
  assert.equal(plan.lockDeadlineAudioTime, input.lockDeadlineAudioTime);
  assert.equal(plan.audioNow, input.audioNow);
  assertClose(plan.timerLatenessSeconds, 0.05);
  assert.equal(plan.skippedBeatCount, 0);
  assert.equal(plan.handoffBeat1AudioTime, beat1);
  assert.equal(plan.handoffBeatDurationSeconds, handoffBeatDurationSeconds);
  assert.equal(plan.beatTimes.length, 8);
  for (let index = 0; index < 8; index += 1) {
    assertClose(plan.beatTimes[index], beat1 + index * handoffBeatDurationSeconds);
    if (index > 0) {
      assert.ok(plan.beatTimes[index] > plan.beatTimes[index - 1]);
    }
  }
  assert.equal(plan.trackStartAudioTime, beat1);
  assertClose(plan.trackStartOffsetSeconds, 17.579 - 4 * handoffBeatDurationSeconds);
  assertClose(plan.crossfadeStartAudioTime, beat1 + 3 * handoffBeatDurationSeconds);
  assertClose(plan.curatedDownbeatAudioTime, beat1 + 4 * handoffBeatDurationSeconds);
  assertClose(plan.crossfadeEndAudioTime, beat1 + 7 * handoffBeatDurationSeconds);
  assertClose(plan.songOnlyStartAudioTime, beat1 + 8 * handoffBeatDurationSeconds);
  assertClose(plan.minimumRequiredAudioEndTime, plan.crossfadeEndAudioTime + 2);
  assertClose(
    plan.naturalTrackEndAudioTime,
    beat1 + (122.01795833333334 - plan.trackStartOffsetSeconds),
  );
  assert.equal(plan.percussionRecipeId, 'kick-snare-v1');
  assert.equal(plan.percussionTrimGain, 0.25);
  assert.equal(plan.trackTrimGain, 0.5);
  assert.equal(plan.masterGain, 0.7);
  assert.equal(plan.crossfadeCurveSampleCount, 128);
  assert.equal(plan.crossfadeCurveId, 'equal-power-sin-cos-v1');
  assert.deepEqual(plan.bridgeSourceIds, []);
  assert.deepEqual(plan.adoptedSourceIdsByBeat, [[], [], [], [], [], [], [], []]);
  assert.deepEqual(plan.cancelSourceIds, []);
  assert.deepEqual(plan.sourceClassifications, []);
  assert.equal(Object.isFrozen(plan), true);
});

test('T3-CATCH-UP preserves measured phase for zero, one, or two advances and accepts equality', () => {
  const base = validInput();
  const period = 60 / base.estimatedBpmExact;
  const candidate = base.candidateBeat1AudioTime;
  const cases = [
    { audioNow: candidate - 0.1, skipped: 0 },
    { audioNow: candidate - 0.05, skipped: 1 },
    { audioNow: candidate + period - 0.05, skipped: 2 },
  ];

  for (const { audioNow, skipped } of cases) {
    const plan = createHandoffPlan(validInput({ audioNow }));
    assert.equal(plan.skippedBeatCount, skipped);
    assertClose(plan.handoffBeat1AudioTime, candidate + skipped * period);
    assertClose(plan.handoffBeat1AudioTime, base.lastTapAudioTime + (skipped + 1) * period);
  }
});

test('T3-CATCH-UP converts a too-close prediction to bridge ownership after advancing beat one', () => {
  const base = validInput();
  const sourceId = 'due-candidate';
  const plan = createHandoffPlan(validInput({
    audioNow: base.candidateBeat1AudioTime - 0.05,
    ownershipSnapshot: ownership([{
      sourceId,
      scheduledAudioTime: base.candidateBeat1AudioTime,
    }]),
  }));

  assert.equal(plan.skippedBeatCount, 1);
  assert.deepEqual(plan.bridgeSourceIds, [sourceId]);
  assert.deepEqual(plan.adoptedSourceIdsByBeat[0], []);
  assert.deepEqual(plan.cancelSourceIds, []);
});

test('T3-CATCH-UP throws a stable typed failure before a third advance', () => {
  const base = validInput();
  const period = 60 / base.estimatedBpmExact;
  assert.throws(
    () => createHandoffPlan(validInput({
      audioNow: base.candidateBeat1AudioTime + 2 * period - 0.05,
    })),
    (error) => {
      assert.strictEqual(error.constructor, HandoffPlannerFailure);
      assert.equal(error.code, 'catch-up-limit-exceeded');
      assert.equal(error.message, 'handoff candidate requires more than two catch-up beats');
      return true;
    },
  );
});

test('T3-OWNERSHIP snapshots zero, one, and two sources by immutable defensive copy', () => {
  for (const count of [0, 1, 2]) {
    const ownedSourceIds = Array.from({ length: count }, (_, index) => `source-${index + 1}`);
    const predictions = ownedSourceIds.map((sourceId, index) => ({
      sourceId,
      scheduledAudioTime: 20 + index,
    }));
    const snapshot = createPredictionOwnershipSnapshot({ ownedSourceIds, predictions });
    assert.deepEqual(snapshot, { ownedSourceIds, predictions });
    assertRecursivelyFrozen(snapshot);

    ownedSourceIds.push('late-mutation');
    predictions.push({ sourceId: 'late-mutation', scheduledAudioTime: 99 });
    if (count > 0) {
      predictions[0].scheduledAudioTime = -1;
    }
    assert.equal(snapshot.ownedSourceIds.includes('late-mutation'), false);
    assert.equal(snapshot.predictions.some(({ sourceId }) => sourceId === 'late-mutation'), false);
    if (count > 0) {
      assert.equal(snapshot.predictions[0].scheduledAudioTime, 20);
    }
  }
});

test('T3-OWNERSHIP exhaustively partitions bridge, aligned adoption, and unaligned cancellation', () => {
  const base = validInput();
  const beat1 = base.candidateBeat1AudioTime;
  const beatDuration = 60 / 110;
  const predictions = [
    { sourceId: 'bridge', scheduledAudioTime: beat1 - 0.001 },
    { sourceId: 'beat-1', scheduledAudioTime: beat1 },
    { sourceId: 'beat-2', scheduledAudioTime: beat1 + beatDuration },
    { sourceId: 'cancel', scheduledAudioTime: beat1 + beatDuration + 0.01 },
  ];
  const plan = createHandoffPlan(validInput({ ownershipSnapshot: ownership(predictions) }));

  assert.deepEqual(plan.bridgeSourceIds, ['bridge']);
  assert.deepEqual(plan.adoptedSourceIdsByBeat, [
    ['beat-1'], ['beat-2'], [], [], [], [], [], [],
  ]);
  assert.deepEqual(plan.cancelSourceIds, ['cancel']);
  assert.deepEqual(plan.sourceClassifications.map((classification) => ({
    sourceId: classification.sourceId,
    disposition: classification.disposition,
    adoptedBeatNumber: classification.adoptedBeatNumber,
  })), [
    { sourceId: 'bridge', disposition: 'bridge', adoptedBeatNumber: null },
    { sourceId: 'beat-1', disposition: 'adopt', adoptedBeatNumber: 1 },
    { sourceId: 'beat-2', disposition: 'adopt', adoptedBeatNumber: 2 },
    { sourceId: 'cancel', disposition: 'cancel', adoptedBeatNumber: null },
  ]);

  const partition = [
    ...plan.bridgeSourceIds,
    ...plan.adoptedSourceIdsByBeat.flat(),
    ...plan.cancelSourceIds,
  ];
  assert.deepEqual(partition.toSorted(), predictions.map(({ sourceId }) => sourceId).toSorted());
  assert.equal(new Set(partition).size, partition.length);
  assertRecursivelyFrozen(plan);
});

test('T3-OWNERSHIP uses the explicit output sample for inclusive adoption alignment', () => {
  const base = validInput();
  const oneSample = 1 / base.outputSampleRate;
  const beat1 = base.candidateBeat1AudioTime;
  const predictions = [
    { sourceId: 'inclusive', scheduledAudioTime: beat1 + oneSample },
    { sourceId: 'outside', scheduledAudioTime: beat1 + oneSample + 1e-9 },
  ];
  const plan = createHandoffPlan(validInput({ ownershipSnapshot: ownership(predictions) }));

  assert.equal(plan.oneSampleDurationSeconds, oneSample);
  assert.deepEqual(plan.adoptedSourceIdsByBeat[0], ['inclusive']);
  assert.deepEqual(plan.cancelSourceIds, ['outside']);
  assert.equal(new Set(plan.adoptedSourceIdsByBeat.flat()).size,
    plan.adoptedSourceIdsByBeat.flat().length);
});

test('T3-OWNERSHIP classifies just before, at, and just after the one-sample lifecycle boundary', () => {
  const base = validInput();
  const oneSample = 1 / base.outputSampleRate;
  const lifecycleBoundary = base.audioNow + oneSample;
  const predictions = [
    { sourceId: 'just-before', scheduledAudioTime: lifecycleBoundary - 1e-9 },
    { sourceId: 'equality', scheduledAudioTime: lifecycleBoundary },
    { sourceId: 'just-after', scheduledAudioTime: lifecycleBoundary + 1e-9 },
  ];
  const plan = createHandoffPlan(validInput({ ownershipSnapshot: ownership(predictions) }));

  assert.deepEqual(plan.sourceClassifications.map((classification) => ({
    sourceId: classification.sourceId,
    scheduledAudioTime: classification.scheduledAudioTime,
    lifecycleAtLock: classification.lifecycleAtLock,
    disposition: classification.disposition,
  })), [
    {
      sourceId: 'just-before',
      scheduledAudioTime: lifecycleBoundary - 1e-9,
      lifecycleAtLock: 'started-or-due',
      disposition: 'bridge',
    },
    {
      sourceId: 'equality',
      scheduledAudioTime: lifecycleBoundary,
      lifecycleAtLock: 'started-or-due',
      disposition: 'bridge',
    },
    {
      sourceId: 'just-after',
      scheduledAudioTime: lifecycleBoundary + 1e-9,
      lifecycleAtLock: 'not-started',
      disposition: 'bridge',
    },
  ]);
});

function addHiddenProperty(record, key, value) {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: false,
    value,
    writable: true,
  });
  return record;
}

function addAccessor(record, key, getter) {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    get: getter,
  });
  return record;
}

test('T3-VALIDATION rejects hostile ownership outer records and non-dense arrays without getters', () => {
  for (const candidate of [
    null,
    [],
    Object.assign(Object.create({ inherited: true }), { ownedSourceIds: [], predictions: [] }),
    { ownedSourceIds: [], predictions: [], unknown: true },
    Object.assign({ ownedSourceIds: [], predictions: [] }, { [Symbol('outer')]: true }),
    addHiddenProperty({ predictions: [] }, 'ownedSourceIds', []),
  ]) {
    assert.throws(() => createPredictionOwnershipSnapshot(candidate), TypeError);
  }

  let outerGetterCount = 0;
  const accessorOuter = addAccessor(
    { predictions: [] },
    'ownedSourceIds',
    () => {
      outerGetterCount += 1;
      return [];
    },
  );
  assert.throws(() => createPredictionOwnershipSnapshot(accessorOuter), TypeError);
  assert.equal(outerGetterCount, 0);

  const arrayVariants = [];
  const sparse = [];
  sparse.length = 1;
  arrayVariants.push(sparse);
  const extra = [];
  extra.extra = true;
  arrayVariants.push(extra);
  const symbolic = [];
  symbolic[Symbol('array')] = true;
  arrayVariants.push(symbolic);
  arrayVariants.push(Object.setPrototypeOf([], {}));

  for (const badOwnedSourceIds of arrayVariants) {
    assert.throws(
      () => createPredictionOwnershipSnapshot({
        ownedSourceIds: badOwnedSourceIds,
        predictions: [],
      }),
      TypeError,
    );
  }
  for (const badPredictions of arrayVariants) {
    assert.throws(
      () => createPredictionOwnershipSnapshot({
        ownedSourceIds: [],
        predictions: badPredictions,
      }),
      TypeError,
    );
  }
});

test('T3-VALIDATION rejects hostile prediction entries without invoking accessors', () => {
  const base = { sourceId: 'source-1', scheduledAudioTime: 10 };
  for (const prediction of [
    Object.assign(Object.create({ inherited: true }), base),
    { ...base, unknown: true },
    Object.assign({ ...base }, { [Symbol('entry')]: true }),
    addHiddenProperty({ sourceId: 'source-1' }, 'scheduledAudioTime', 10),
  ]) {
    assert.throws(
      () => createPredictionOwnershipSnapshot({
        ownedSourceIds: ['source-1'],
        predictions: [prediction],
      }),
      TypeError,
    );
  }

  let entryGetterCount = 0;
  const accessorEntry = addAccessor(
    { scheduledAudioTime: 10 },
    'sourceId',
    () => {
      entryGetterCount += 1;
      return 'source-1';
    },
  );
  assert.throws(
    () => createPredictionOwnershipSnapshot({
      ownedSourceIds: ['source-1'],
      predictions: [accessorEntry],
    }),
    TypeError,
  );
  assert.equal(entryGetterCount, 0);
});

test('T3-VALIDATION enforces unique bounded IDs, exact ownership equality, and scheduled times', () => {
  assert.throws(
    () => createPredictionOwnershipSnapshot({
      ownedSourceIds: ['a', 'a'],
      predictions: [
        { sourceId: 'a', scheduledAudioTime: 1 },
        { sourceId: 'b', scheduledAudioTime: 2 },
      ],
    }),
    /ownedSourceIds must contain unique source IDs/,
  );
  assert.throws(
    () => createPredictionOwnershipSnapshot({
      ownedSourceIds: ['a'],
      predictions: [
        { sourceId: 'a', scheduledAudioTime: 1 },
        { sourceId: 'a', scheduledAudioTime: 2 },
      ],
    }),
    /predictions must contain unique source IDs/,
  );

  for (const invalidId of ['', 'x'.repeat(129), 42, null]) {
    assert.throws(
      () => createPredictionOwnershipSnapshot({
        ownedSourceIds: [invalidId],
        predictions: [],
      }),
      /ownedSourceIds source IDs must be nonempty strings of at most 128 characters/,
    );
    assert.throws(
      () => createPredictionOwnershipSnapshot({
        ownedSourceIds: ['valid'],
        predictions: [{ sourceId: invalidId, scheduledAudioTime: 1 }],
      }),
      /prediction sourceId must be a nonempty string of at most 128 characters/,
    );
  }

  assert.throws(
    () => createPredictionOwnershipSnapshot({
      ownedSourceIds: ['owned'],
      predictions: [{ sourceId: 'other', scheduledAudioTime: 1 }],
    }),
    /prediction source IDs must exactly equal ownedSourceIds/,
  );
  for (const scheduledAudioTime of [Number.NaN, Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY, -1]) {
    assert.throws(
      () => createPredictionOwnershipSnapshot({
        ownedSourceIds: ['source-1'],
        predictions: [{ sourceId: 'source-1', scheduledAudioTime }],
      }),
      /scheduledAudioTime must be finite and nonnegative/,
    );
  }
});

test('T3-VALIDATION closes planner input before access and enforces snapshot provenance and authorities', () => {
  assert.equal(Object.keys(validInput()).length, 10);
  for (const candidate of [
    null,
    [],
    Object.assign(Object.create({ inherited: true }), validInput()),
    { ...validInput(), unknown: true },
    Object.assign(validInput(), { [Symbol('outer')]: true }),
    addHiddenProperty({ ...validInput(), generationId: undefined }, 'generationId', 'generation-1'),
  ]) {
    assert.throws(() => createHandoffPlan(candidate), TypeError);
  }

  let getterCount = 0;
  const accessorInput = { ...validInput() };
  delete accessorInput.ownershipSnapshot;
  addAccessor(accessorInput, 'ownershipSnapshot', () => {
    getterCount += 1;
    return ownership();
  });
  assert.throws(() => createHandoffPlan(accessorInput), TypeError);
  assert.equal(getterCount, 0);

  const rawSnapshot = { ownedSourceIds: [], predictions: [] };
  assert.throws(
    () => createHandoffPlan(validInput({ ownershipSnapshot: rawSnapshot })),
    /ownershipSnapshot must be a genuine frozen prediction ownership snapshot/,
  );
  assert.throws(
    () => createHandoffPlan(validInput({
      ownershipSnapshot: Object.freeze({
        ownedSourceIds: Object.freeze([]),
        predictions: Object.freeze([]),
      }),
    })),
    /ownershipSnapshot must be a genuine frozen prediction ownership snapshot/,
  );

  for (const assetIdentity of [
    { ...ASSET_IDENTITY },
    Object.freeze({ ...ASSET_IDENTITY }),
  ]) {
    assert.throws(
      () => createHandoffPlan(validInput({ assetIdentity })),
      /handoff evidence identities must be the locked authorities/,
    );
  }
  for (const experimentConfigIdentity of [
    { ...EXPERIMENT_CONFIG_IDENTITY },
    Object.freeze({ ...EXPERIMENT_CONFIG_IDENTITY }),
  ]) {
    assert.throws(
      () => createHandoffPlan(validInput({ experimentConfigIdentity })),
      /handoff evidence identities must be the locked authorities/,
    );
  }
});

test('T3-VALIDATION rejects invalid generation, numeric domains, and candidate phase', () => {
  for (const generationId of ['', 'g'.repeat(129), 123, null]) {
    assert.throws(
      () => createHandoffPlan(validInput({ generationId })),
      /generationId must be a nonempty string of at most 128 characters/,
    );
  }

  const numericKeys = [
    'estimatedBpmExact',
    'lastTapAudioTime',
    'candidateBeat1AudioTime',
    'lockDeadlineAudioTime',
    'audioNow',
    'outputSampleRate',
  ];
  for (const key of numericKeys) {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () => createHandoffPlan(validInput({ [key]: value })),
        new RegExp(`${key} must be finite`),
      );
    }
  }
  for (const key of ['estimatedBpmExact', 'outputSampleRate']) {
    for (const value of [0, -1]) {
      assert.throws(
        () => createHandoffPlan(validInput({ [key]: value })),
        new RegExp(`${key} must be greater than zero`),
      );
    }
  }
  for (const key of [
    'lastTapAudioTime',
    'candidateBeat1AudioTime',
    'lockDeadlineAudioTime',
    'audioNow',
  ]) {
    assert.throws(
      () => createHandoffPlan(validInput({ [key]: -1 })),
      new RegExp(`${key} must be nonnegative`),
    );
  }

  const base = validInput();
  assert.throws(
    () => createHandoffPlan(validInput({ candidateBeat1AudioTime: base.lastTapAudioTime })),
    /candidateBeat1AudioTime must be greater than lastTapAudioTime/,
  );
  assert.throws(
    () => createHandoffPlan(validInput({
      candidateBeat1AudioTime: base.candidateBeat1AudioTime + 1e-9,
    })),
    /candidateBeat1AudioTime must equal lastTapAudioTime \+ 60 \/ estimatedBpmExact/,
  );
});

test('T3-VALIDATION derives strict frozen track bounds and rejects locked invariant failures', () => {
  assert.equal(typeof plannerModule.deriveHandoffTrackBounds, 'function');
  const lockedInput = {
    handoffBpm: 110,
    targetEntryDownbeatSeconds: 17.579,
    leadInBeats: 4,
    crossfadeEndBeat: 8,
    curatedDownbeatBeat: 5,
    minimumPostCrossfadeTailSeconds: 2,
    decodedDurationSeconds: 122.01795833333334,
  };
  const bounds = plannerModule.deriveHandoffTrackBounds(lockedInput);
  assert.deepEqual(bounds, {
    handoffBeatDurationSeconds: 60 / 110,
    trackStartOffsetSeconds: 17.579 - 4 * (60 / 110),
    minimumDecodedDurationSeconds: 17.579 + (8 - 5) * (60 / 110) + 2,
  });
  assertRecursivelyFrozen(bounds);

  assert.throws(
    () => plannerModule.deriveHandoffTrackBounds({
      ...lockedInput,
      targetEntryDownbeatSeconds: 1,
      leadInBeats: 2,
    }),
    (error) => {
      assert.strictEqual(error.constructor, HandoffPlannerFailure);
      assert.equal(error.code, 'negative-track-start-offset');
      assert.equal(error.message, 'handoff track start offset must be nonnegative');
      return true;
    },
  );
  assert.throws(
    () => plannerModule.deriveHandoffTrackBounds({
      ...lockedInput,
      decodedDurationSeconds: 20,
    }),
    (error) => {
      assert.strictEqual(error.constructor, HandoffPlannerFailure);
      assert.equal(error.code, 'insufficient-track-tail');
      assert.equal(error.message, 'handoff track must include the minimum post-crossfade continuation');
      return true;
    },
  );

  for (const hostile of [
    { ...lockedInput, unknown: true },
    Object.assign({ ...lockedInput }, { [Symbol('bounds')]: true }),
    Object.assign(Object.create({ inherited: true }), lockedInput),
  ]) {
    assert.throws(() => plannerModule.deriveHandoffTrackBounds(hostile), TypeError);
  }
  assert.throws(
    () => plannerModule.deriveHandoffTrackBounds({
      ...lockedInput,
      decodedDurationSeconds: Number.NaN,
    }),
    /decodedDurationSeconds must be finite and greater than zero/,
  );
  assert.throws(
    () => plannerModule.deriveHandoffTrackBounds({
      ...lockedInput,
      handoffBpm: Number.MIN_VALUE,
    }),
    /handoffBpm must produce a finite positive beat duration/,
  );

  let getterCount = 0;
  const accessorBounds = { ...lockedInput };
  delete accessorBounds.handoffBpm;
  addAccessor(accessorBounds, 'handoffBpm', () => {
    getterCount += 1;
    return 110;
  });
  assert.throws(() => plannerModule.deriveHandoffTrackBounds(accessorBounds), TypeError);
  assert.equal(getterCount, 0);
});

test('T3-NUMERIC-BOUNDARIES keeps phase exact, limits adoption to one sample, and rejects reciprocal overflow', () => {
  const largeLastTapAudioTime = 1e14;
  const estimatedBpmExact = 108;
  const exactLargeCandidate = largeLastTapAudioTime + 60 / estimatedBpmExact;
  const largeClockInput = {
    ...validInput(),
    estimatedBpmExact,
    lastTapAudioTime: largeLastTapAudioTime,
    candidateBeat1AudioTime: exactLargeCandidate,
    lockDeadlineAudioTime: exactLargeCandidate - 0.2,
    audioNow: exactLargeCandidate - 0.1,
  };

  assert.throws(
    () => createHandoffPlan({
      ...largeClockInput,
      candidateBeat1AudioTime: exactLargeCandidate + 0.203125,
    }),
    /candidateBeat1AudioTime must equal lastTapAudioTime \+ 60 \/ estimatedBpmExact/,
  );

  const oneSample = 1 / largeClockInput.outputSampleRate;
  const largeClockPlan = createHandoffPlan({
    ...largeClockInput,
    ownershipSnapshot: ownership([
      { sourceId: 'exact-beat', scheduledAudioTime: exactLargeCandidate },
      { sourceId: 'far-outside-sample', scheduledAudioTime: exactLargeCandidate + 0.046875 },
    ]),
  });
  assert.deepEqual(largeClockPlan.adoptedSourceIdsByBeat[0], ['exact-beat']);
  assert.deepEqual(largeClockPlan.cancelSourceIds, ['far-outside-sample']);
  assert.ok(0.046875 > oneSample);

  const ordinary = validInput();
  const exactSampleBoundary = ordinary.candidateBeat1AudioTime + 1 / ordinary.outputSampleRate;
  const nextRepresentableOutside = nextUp(exactSampleBoundary);
  const ordinaryPlan = createHandoffPlan(validInput({
    ownershipSnapshot: ownership([
      { sourceId: 'inclusive-sample', scheduledAudioTime: exactSampleBoundary },
      { sourceId: 'next-double-outside', scheduledAudioTime: nextRepresentableOutside },
    ]),
  }));
  assert.deepEqual(ordinaryPlan.adoptedSourceIdsByBeat[0], ['inclusive-sample']);
  assert.deepEqual(ordinaryPlan.cancelSourceIds, ['next-double-outside']);

  assert.throws(
    () => createHandoffPlan(validInput({ estimatedBpmExact: Number.MIN_VALUE })),
    /estimatedBpmExact must produce a finite positive beat duration/,
  );
  assert.throws(
    () => createHandoffPlan(validInput({ outputSampleRate: Number.MIN_VALUE })),
    /outputSampleRate must produce a finite positive sample duration/,
  );
});

test('T3-VALIDATION returns only normative immutable fields after checking plan invariants', () => {
  const predictions = [
    { sourceId: 'bridge', scheduledAudioTime: 10.1 },
    { sourceId: 'adopt', scheduledAudioTime: validInput().candidateBeat1AudioTime },
    { sourceId: 'cancel', scheduledAudioTime: 11.4 },
  ];
  const snapshot = ownership(predictions);
  const plan = createHandoffPlan(validInput({ ownershipSnapshot: snapshot }));

  assertRecursivelyFrozen(snapshot);
  assertRecursivelyFrozen(plan);
  assert.equal(plan.tempoSnapBpm, 2);
  assert.equal(Object.hasOwn(plan, 'tempoSnapDeltaBpm'), false);
  assertClose(plan.minimumRequiredAudioEndTime, plan.crossfadeEndAudioTime + 2);
  assert.equal(Object.hasOwn(plan, 'minimumRequiredAudioEnd'), false);
  assert.equal(plan.beatTimes.length, 8);
  assert.equal(plan.beatTimes.every(Number.isFinite), true);
  assert.equal(plan.beatTimes.every((time, index) => index === 0 || time > plan.beatTimes[index - 1]), true);
  const partition = [
    ...plan.bridgeSourceIds,
    ...plan.adoptedSourceIdsByBeat.flat(),
    ...plan.cancelSourceIds,
  ];
  assert.deepEqual(partition.toSorted(), snapshot.ownedSourceIds.toSorted());
  assert.equal(new Set(partition).size, snapshot.ownedSourceIds.length);
  assert.ok(plan.naturalTrackEndAudioTime >= plan.minimumRequiredAudioEndTime);
});
