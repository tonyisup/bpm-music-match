import test from 'node:test';
import assert from 'node:assert/strict';

import {
  admitTap,
  createTapEstimatorSnapshot,
} from '../src/core/tap-estimator.mjs';

const SNAPSHOT_KEYS = Object.freeze([
  'timestampWindowMs',
  'rawIntervalsMs',
  'rangeEligibleIntervalsMs',
  'seedMedianMs',
  'validIntervalsMs',
  'stableMedianMs',
  'meanIntervalMs',
  'populationStdDevMs',
  'coefficientOfVariation',
  'armed',
  'estimatedBpmExact',
  'estimatedBpmDisplay',
  'silenceTimeoutMs',
  'silenceDeadlineTimestampMs',
]);

function assertRecursivelyFrozen(value) {
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') {
      assertRecursivelyFrozen(child);
    }
  }
}

function accept(snapshot, eventTimestampMs, observedNowMs = eventTimestampMs) {
  const result = admitTap(snapshot, eventTimestampMs, observedNowMs);
  assert.deepEqual(Object.keys(result), ['type', 'snapshot']);
  assert.equal(result.type, 'tap-accepted');
  assert.deepEqual(Object.keys(result.snapshot), SNAPSHOT_KEYS);
  assertRecursivelyFrozen(result);
  return result.snapshot;
}

function reject(snapshot, eventTimestampMs, observedNowMs, expectedReason) {
  const result = admitTap(snapshot, eventTimestampMs, observedNowMs);
  assert.deepEqual(Object.keys(result), ['type', 'reason', 'snapshot']);
  assert.equal(result.type, 'tap-rejected');
  assert.equal(result.reason, expectedReason);
  assert.strictEqual(result.snapshot, snapshot);
  assertRecursivelyFrozen(result);
}

function snapshotForIntervals(intervalsMs, firstTimestampMs = 0) {
  let snapshot = createTapEstimatorSnapshot();
  let timestampMs = firstTimestampMs;
  snapshot = accept(snapshot, timestampMs);
  for (const intervalMs of intervalsMs) {
    timestampMs += intervalMs;
    snapshot = accept(snapshot, timestampMs);
  }
  return snapshot;
}

test('T2-SNAPSHOT-PROVENANCE and T2-FLOATING-BOUNDARIES reject forged state first and preserve inclusive numeric contracts', () => {
  const expectedSnapshotError = 'snapshot must be a genuine tap estimator snapshot';
  const mutableLookalike = { timestampWindowMs: [] };
  const untrustedCalls = [
    () => admitTap({}, 0, 0),
    () => admitTap(mutableLookalike, Number.NaN, 0),
    () => admitTap(Object.freeze({ timestampWindowMs: Object.freeze([1_000, 0]) }), 1, 1),
    () => admitTap(Object.freeze({ timestampWindowMs: Object.freeze([0, Number.NaN]) }), 1, 1),
  ];
  let untrustedResult;
  for (const call of untrustedCalls) {
    assert.throws(() => {
      untrustedResult = call();
    }, (error) => {
      assert.strictEqual(error.constructor, TypeError);
      assert.equal(error.message, expectedSnapshotError);
      return true;
    });
    assert.equal(untrustedResult, undefined);
  }
  mutableLookalike.timestampWindowMs.push(123);
  assert.deepEqual(mutableLookalike.timestampWindowMs, [123]);

  const genuine = createTapEstimatorSnapshot();
  for (const observedNowMs of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    reject(genuine, 0, observedNowMs, 'observed-now-not-finite');
  }

  const lowerRangeBoundary = snapshotForIntervals([250, 249.999]);
  assert.deepEqual(lowerRangeBoundary.timestampWindowMs, [0, 250, 499.999]);
  assert.equal(lowerRangeBoundary.rawIntervalsMs[0], 250);
  assert.ok(lowerRangeBoundary.rawIntervalsMs[1] < 250);
  assert.deepEqual(lowerRangeBoundary.rangeEligibleIntervalsMs, [250]);

  const upperRangeBoundary = snapshotForIntervals([2_000, 2_000.001]);
  assert.deepEqual(upperRangeBoundary.timestampWindowMs, [0, 2_000, 4_000.001]);
  assert.equal(upperRangeBoundary.rawIntervalsMs[0], 2_000);
  assert.ok(upperRangeBoundary.rawIntervalsMs[1] > 2_000);
  assert.deepEqual(upperRangeBoundary.rangeEligibleIntervalsMs, [2_000]);

  const inclusiveRetention = snapshotForIntervals([400, 500, 500, 500, 600]);
  assert.equal(inclusiveRetention.seedMedianMs, 500);
  assert.deepEqual(inclusiveRetention.validIntervalsMs, [400, 500, 500, 500, 600]);
  assert.equal(inclusiveRetention.stableMedianMs, 500);

  const outsideRetention = snapshotForIntervals([
    400, 500, 500, 500, 600, 399.999, 600.001,
  ]);
  assert.equal(outsideRetention.seedMedianMs, 500);
  assert.deepEqual(outsideRetention.validIntervalsMs, [400, 500, 500, 500, 600]);
  assert.equal(outsideRetention.validIntervalsMs.includes(
    outsideRetention.rawIntervalsMs.at(-2),
  ), false);
  assert.equal(outsideRetention.validIntervalsMs.includes(
    outsideRetention.rawIntervalsMs.at(-1),
  ), false);
  assert.equal(outsideRetention.stableMedianMs, 500);
});

test('T2-TIMESTAMP-ADMISSION rejects invalid timing and retains eight accepted taps with adjacent range filtering', () => {
  const initial = createTapEstimatorSnapshot();
  assert.deepEqual(Object.keys(initial), SNAPSHOT_KEYS);
  assert.deepEqual(initial.timestampWindowMs, []);
  assertRecursivelyFrozen(initial);

  const first = accept(initial, 1_000, 1_000);
  reject(first, Number.NaN, 1_000, 'timestamp-not-finite');
  reject(first, Number.POSITIVE_INFINITY, 1_000, 'timestamp-not-finite');
  reject(first, 1_000, 1_000, 'timestamp-not-increasing');
  reject(first, 999, 1_000, 'timestamp-not-increasing');
  reject(first, 1_016.001, 1_000, 'timestamp-too-far-future');
  reject(first, 1_000.001, 1_100.002, 'timestamp-too-late');

  assert.deepEqual(accept(first, 1_016, 1_000).timestampWindowMs, [1_000, 1_016]);
  assert.deepEqual(accept(first, 1_001, 1_101).timestampWindowMs, [1_000, 1_001]);

  let windowed = createTapEstimatorSnapshot();
  for (let timestampMs = 0; timestampMs <= 4_500; timestampMs += 500) {
    windowed = accept(windowed, timestampMs);
  }
  assert.deepEqual(windowed.timestampWindowMs, [
    1_000, 1_500, 2_000, 2_500, 3_000, 3_500, 4_000, 4_500,
  ]);
  assert.deepEqual(windowed.rawIntervalsMs, [500, 500, 500, 500, 500, 500, 500]);
  assert.deepEqual(windowed.rangeEligibleIntervalsMs, [500, 500, 500, 500, 500, 500, 500]);

  let ranged = createTapEstimatorSnapshot();
  for (const timestampMs of [0, 250, 2_250, 2_500, 2_700]) {
    ranged = accept(ranged, timestampMs);
  }
  assert.deepEqual(ranged.timestampWindowMs, [0, 250, 2_250, 2_500, 2_700]);
  assert.deepEqual(ranged.rawIntervalsMs, [250, 2_000, 250, 200]);
  assert.deepEqual(ranged.rangeEligibleIntervalsMs, [250, 2_000, 250]);
});

test('T2-INTERVAL-OUTLIERS uses normative medians and one inclusive single-pass filter while retaining delayed endpoints', () => {
  const inclusive = snapshotForIntervals([400, 500, 600]);
  assert.equal(inclusive.seedMedianMs, 500);
  assert.deepEqual(inclusive.validIntervalsMs, [400, 500, 600]);
  assert.equal(inclusive.stableMedianMs, 500);

  const even = snapshotForIntervals([400, 500, 600, 700]);
  assert.equal(even.seedMedianMs, 550);
  assert.deepEqual(even.validIntervalsMs, [500, 600]);
  assert.equal(even.stableMedianMs, 550);

  const singlePass = snapshotForIntervals([400, 400, 400, 500, 600, 600]);
  assert.equal(singlePass.seedMedianMs, 450);
  assert.deepEqual(singlePass.validIntervalsMs, [400, 400, 400, 500]);
  assert.equal(singlePass.stableMedianMs, 400);

  const delayed = snapshotForIntervals([500, 2_100, 500, 500, 500, 500]);
  assert.deepEqual(delayed.timestampWindowMs, [0, 500, 2_600, 3_100, 3_600, 4_100, 4_600]);
  assert.deepEqual(delayed.rawIntervalsMs, [500, 2_100, 500, 500, 500, 500]);
  assert.deepEqual(delayed.rangeEligibleIntervalsMs, [500, 500, 500, 500, 500]);
  assert.equal(delayed.seedMedianMs, 500);
  assert.deepEqual(delayed.validIntervalsMs, [500, 500, 500, 500, 500]);
  assert.equal(delayed.stableMedianMs, 500);
});

test('T2-STABILITY uses population CV with inclusive four-interval and five-percent arming plus delayed recovery', () => {
  const threeValid = snapshotForIntervals([500, 500, 500]);
  assert.equal(threeValid.meanIntervalMs, 500);
  assert.equal(threeValid.populationStdDevMs, 0);
  assert.equal(threeValid.coefficientOfVariation, 0);
  assert.equal(threeValid.armed, false);

  const inclusiveFivePercent = snapshotForIntervals([475, 475, 525, 525]);
  assert.equal(inclusiveFivePercent.meanIntervalMs, 500);
  assert.equal(inclusiveFivePercent.populationStdDevMs, 25);
  assert.equal(inclusiveFivePercent.coefficientOfVariation, 0.05);
  assert.equal(inclusiveFivePercent.armed, true);

  const outsideFivePercent = snapshotForIntervals([474.999, 474.999, 525.001, 525.001]);
  assert.ok(outsideFivePercent.coefficientOfVariation > 0.05);
  assert.equal(outsideFivePercent.armed, false);

  for (const bpm of [107, 110, 113]) {
    const intervalMs = 60_000 / bpm;
    const cadence = snapshotForIntervals([intervalMs, intervalMs, intervalMs, intervalMs]);
    assert.equal(cadence.validIntervalsMs.length, 4);
    assert.equal(cadence.armed, true);
    assert.equal(cadence.estimatedBpmExact, 60_000 / cadence.stableMedianMs);
    assert.ok(Math.abs(cadence.estimatedBpmExact - bpm) < 1e-12);
  }

  let recovering = snapshotForIntervals([500, 500, 500, 500]);
  assert.equal(recovering.armed, true);
  recovering = accept(recovering, recovering.timestampWindowMs.at(-1) + 600);
  assert.ok(recovering.coefficientOfVariation > 0.05);
  assert.equal(recovering.armed, false);
  for (let count = 0; count < 7; count += 1) {
    recovering = accept(recovering, recovering.timestampWindowMs.at(-1) + 500);
  }
  assert.deepEqual(recovering.rawIntervalsMs, [500, 500, 500, 500, 500, 500, 500]);
  assert.equal(recovering.coefficientOfVariation, 0);
  assert.equal(recovering.armed, true);
});

test('T2-SILENCE refreshes bootstrap deadlines and applies interior plus inclusive lower and upper clamps', () => {
  const initial = createTapEstimatorSnapshot();
  const bootstrap = accept(initial, 1_000, 1_100);
  assert.notStrictEqual(bootstrap, initial);
  assert.equal(bootstrap.stableMedianMs, null);
  assert.equal(bootstrap.silenceTimeoutMs, 1_800);
  assert.equal(bootstrap.silenceDeadlineTimestampMs, 2_800);

  const nonEstimableRefresh = accept(bootstrap, 1_100, 1_100);
  assert.equal(nonEstimableRefresh.stableMedianMs, null);
  assert.equal(nonEstimableRefresh.silenceTimeoutMs, 1_800);
  assert.equal(nonEstimableRefresh.silenceDeadlineTimestampMs, 2_900);

  const lowerClamped = snapshotForIntervals([500]);
  assert.equal(lowerClamped.silenceTimeoutMs, 900);
  assert.equal(lowerClamped.silenceDeadlineTimestampMs, 1_400);
  assert.equal(snapshotForIntervals([600]).silenceTimeoutMs, 900);

  const interior = snapshotForIntervals([800]);
  assert.equal(interior.silenceTimeoutMs, 1_200);
  assert.equal(interior.silenceDeadlineTimestampMs, 2_000);

  assert.equal(snapshotForIntervals([1_200]).silenceTimeoutMs, 1_800);
  const upperClamped = snapshotForIntervals([1_500]);
  assert.equal(upperClamped.silenceTimeoutMs, 1_800);
  assert.equal(upperClamped.silenceDeadlineTimestampMs, 3_300);
});

test('T2-DISPLAY rounds positive ties away from zero without changing exact cadence policy fields', () => {
  const tieIntervalMs = 60_000 / 60.5;
  const tie = snapshotForIntervals([
    tieIntervalMs,
    tieIntervalMs,
    tieIntervalMs,
    tieIntervalMs,
  ]);
  assert.equal(tie.estimatedBpmDisplay, 61);
  assert.equal(tie.estimatedBpmExact, 60_000 / tie.stableMedianMs);
  assert.equal(tie.estimatedBpmExact, 60.5);

  const mean = tie.validIntervalsMs.reduce((sum, value) => sum + value, 0)
    / tie.validIntervalsMs.length;
  const populationStdDev = Math.sqrt(
    tie.validIntervalsMs.reduce((sum, value) => sum + (value - mean) ** 2, 0)
      / tie.validIntervalsMs.length,
  );
  assert.equal(tie.coefficientOfVariation, populationStdDev / mean);
  assert.equal(tie.armed, tie.validIntervalsMs.length >= 4
    && tie.coefficientOfVariation <= 0.05);
  assert.equal(tie.silenceDeadlineTimestampMs,
    tie.timestampWindowMs.at(-1) + 1.5 * tie.stableMedianMs);

  const policyFields = {
    estimatedBpmExact: tie.estimatedBpmExact,
    coefficientOfVariation: tie.coefficientOfVariation,
    armed: tie.armed,
    silenceDeadlineTimestampMs: tie.silenceDeadlineTimestampMs,
  };
  assert.throws(() => {
    tie.estimatedBpmDisplay = 999;
  }, TypeError);
  assert.deepEqual({
    estimatedBpmExact: tie.estimatedBpmExact,
    coefficientOfVariation: tie.coefficientOfVariation,
    armed: tie.armed,
    silenceDeadlineTimestampMs: tie.silenceDeadlineTimestampMs,
  }, policyFields);

  const belowTieIntervalMs = 60_000 / 60.499;
  const belowTie = snapshotForIntervals([
    belowTieIntervalMs,
    belowTieIntervalMs,
    belowTieIntervalMs,
    belowTieIntervalMs,
  ]);
  assert.equal(belowTie.estimatedBpmDisplay, 60);
  assert.ok(belowTie.estimatedBpmExact > 60.49);
});
