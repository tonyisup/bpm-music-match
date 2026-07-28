import { assertBuildIdentity } from '../build-identity.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return Object.freeze(value);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (sorted.length === 0) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function roundTiesAwayFromZero(value) {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

function createSnapshot(timestampWindowMs) {
  const rawIntervalsMs = timestampWindowMs.slice(1).map(
    (timestampMs, index) => timestampMs - timestampWindowMs[index],
  );
  const rangeEligibleIntervalsMs = rawIntervalsMs.filter(
    (intervalMs) => intervalMs >= 250 && intervalMs <= 2_000,
  );
  const seedMedianMs = median(rangeEligibleIntervalsMs);
  const validIntervalsMs = seedMedianMs === null
    ? []
    : rangeEligibleIntervalsMs.filter(
      (intervalMs) => Math.abs(intervalMs - seedMedianMs) / seedMedianMs <= 0.20,
    );
  const stableMedianMs = median(validIntervalsMs);
  const meanIntervalMs = validIntervalsMs.length === 0
    ? null
    : validIntervalsMs.reduce((sum, intervalMs) => sum + intervalMs, 0)
      / validIntervalsMs.length;
  const populationStdDevMs = meanIntervalMs === null
    ? null
    : Math.sqrt(
      validIntervalsMs.reduce(
        (sum, intervalMs) => sum + (intervalMs - meanIntervalMs) ** 2,
        0,
      ) / validIntervalsMs.length,
    );
  const coefficientOfVariation = populationStdDevMs === null
    ? null
    : populationStdDevMs / meanIntervalMs;
  const armed = validIntervalsMs.length >= 4 && coefficientOfVariation <= 0.05;
  const estimatedBpmExact = stableMedianMs === null ? null : 60_000 / stableMedianMs;
  const estimatedBpmDisplay = estimatedBpmExact === null
    ? null
    : roundTiesAwayFromZero(estimatedBpmExact);
  const silenceTimeoutMs = stableMedianMs === null
    ? 1_800
    : Math.min(Math.max(1.5 * stableMedianMs, 900), 1_800);
  const latestTimestampMs = timestampWindowMs.at(-1);
  const silenceDeadlineTimestampMs = latestTimestampMs === undefined
    ? null
    : latestTimestampMs + silenceTimeoutMs;

  return deepFreeze({
    timestampWindowMs,
    rawIntervalsMs,
    rangeEligibleIntervalsMs,
    seedMedianMs,
    validIntervalsMs,
    stableMedianMs,
    meanIntervalMs,
    populationStdDevMs,
    coefficientOfVariation,
    armed,
    estimatedBpmExact,
    estimatedBpmDisplay,
    silenceTimeoutMs,
    silenceDeadlineTimestampMs,
  });
}

export function createTapEstimatorSnapshot() {
  return createSnapshot([]);
}

function rejectTap(reason, snapshot) {
  return Object.freeze({
    type: 'tap-rejected',
    reason,
    snapshot,
  });
}

export function admitTap(snapshot, eventTimestampMs, observedNowMs) {
  if (!Number.isFinite(eventTimestampMs)) {
    return rejectTap('timestamp-not-finite', snapshot);
  }
  if (!Number.isFinite(observedNowMs)) {
    return rejectTap('observed-now-not-finite', snapshot);
  }

  const previousTimestampMs = snapshot.timestampWindowMs.at(-1);
  if (previousTimestampMs !== undefined && eventTimestampMs <= previousTimestampMs) {
    return rejectTap('timestamp-not-increasing', snapshot);
  }
  if (eventTimestampMs - observedNowMs > 16) {
    return rejectTap('timestamp-too-far-future', snapshot);
  }
  if (observedNowMs - eventTimestampMs > 100) {
    return rejectTap('timestamp-too-late', snapshot);
  }

  const timestampWindowMs = [...snapshot.timestampWindowMs, eventTimestampMs].slice(-8);
  return deepFreeze({
    type: 'tap-accepted',
    snapshot: createSnapshot(timestampWindowMs),
  });
}
