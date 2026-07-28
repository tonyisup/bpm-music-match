import { assertBuildIdentity } from '../build-identity.mjs';
import {
  ASSET_IDENTITY,
  EXPERIMENT_CONFIG_IDENTITY,
  ONE_TRACK_CONFIG,
} from '../config.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';
const genuineOwnershipSnapshots = new WeakSet();
const MAX_IDENTIFIER_LENGTH = 128;
const OWNERSHIP_INPUT_KEYS = Object.freeze(['ownedSourceIds', 'predictions']);
const PREDICTION_KEYS = Object.freeze(['sourceId', 'scheduledAudioTime']);
const HANDOFF_INPUT_KEYS = Object.freeze([
  'generationId',
  'assetIdentity',
  'experimentConfigIdentity',
  'estimatedBpmExact',
  'lastTapAudioTime',
  'candidateBeat1AudioTime',
  'lockDeadlineAudioTime',
  'audioNow',
  'outputSampleRate',
  'ownershipSnapshot',
]);
const TRACK_BOUNDS_INPUT_KEYS = Object.freeze([
  'handoffBpm',
  'targetEntryDownbeatSeconds',
  'leadInBeats',
  'crossfadeEndBeat',
  'curatedDownbeatBeat',
  'minimumPostCrossfadeTailSeconds',
  'decodedDurationSeconds',
]);

export class HandoffPlannerFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HandoffPlannerFailure';
    this.code = code;
  }
}

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

function readExactOrdinaryDataRecord(candidate, allowedKeys, label) {
  if (candidate === null
      || typeof candidate !== 'object'
      || Array.isArray(candidate)
      || Object.getPrototypeOf(candidate) !== Object.prototype) {
    throw new TypeError(`${label} must be an exact ordinary data record`);
  }
  const ownKeys = Reflect.ownKeys(candidate);
  if (ownKeys.length !== allowedKeys.length
      || ownKeys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))) {
    throw new TypeError(`${label} must be an exact ordinary data record`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  if (allowedKeys.some((key) => {
    const descriptor = descriptors[key];
    return descriptor === undefined
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value');
  })) {
    throw new TypeError(`${label} must be an exact ordinary data record`);
  }
  return Object.fromEntries(allowedKeys.map((key) => [key, descriptors[key].value]));
}

function readDenseOrdinaryArray(candidate, label) {
  if (!Array.isArray(candidate) || Object.getPrototypeOf(candidate) !== Array.prototype) {
    throw new TypeError(`${label} must be a dense ordinary array`);
  }
  const expectedKeys = [
    ...Array.from({ length: candidate.length }, (_, index) => String(index)),
    'length',
  ];
  const ownKeys = Reflect.ownKeys(candidate);
  if (ownKeys.length !== expectedKeys.length
      || ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))) {
    throw new TypeError(`${label} must be a dense ordinary array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const values = expectedKeys.slice(0, -1).map((key) => {
    const descriptor = descriptors[key];
    if (descriptor === undefined
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label} must be a dense ordinary array`);
    }
    return descriptor.value;
  });
  return values;
}

function isBoundedIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH;
}

function isRecursivelyFrozen(value) {
  if (value === null || typeof value !== 'object' || !Object.isFrozen(value)) {
    return false;
  }
  return Object.values(value).every((child) => (
    child === null || typeof child !== 'object' || isRecursivelyFrozen(child)
  ));
}

function classifyOwnedSources(ownershipSnapshot, beatTimes, audioNow, oneSampleDurationSeconds) {
  const bridgeSourceIds = [];
  const adoptedSourceIdsByBeat = Array.from({ length: 8 }, () => []);
  const cancelSourceIds = [];
  const lifecycleBoundaryAudioTime = audioNow + oneSampleDurationSeconds;
  const sourceClassifications = ownershipSnapshot.predictions.map((prediction) => {
    const { sourceId, scheduledAudioTime } = prediction;
    const lifecycleAtLock = scheduledAudioTime > lifecycleBoundaryAudioTime
      ? 'not-started'
      : 'started-or-due';
    let disposition;
    let adoptedBeatNumber = null;

    if (scheduledAudioTime < beatTimes[0]) {
      disposition = 'bridge';
      bridgeSourceIds.push(sourceId);
    } else {
      const matchingBeatIndexes = beatTimes.flatMap((beatTime, index) => {
        const fixedComparisonToleranceSeconds = Number.EPSILON * 4;
        return Math.abs(scheduledAudioTime - beatTime)
          <= oneSampleDurationSeconds + fixedComparisonToleranceSeconds ? [index] : [];
      });
      if (matchingBeatIndexes.length === 1) {
        disposition = 'adopt';
        adoptedBeatNumber = matchingBeatIndexes[0] + 1;
        adoptedSourceIdsByBeat[matchingBeatIndexes[0]].push(sourceId);
      } else {
        disposition = 'cancel';
        cancelSourceIds.push(sourceId);
      }
    }

    return {
      sourceId,
      scheduledAudioTime,
      lifecycleAtLock,
      disposition,
      adoptedBeatNumber,
    };
  });

  const partition = [
    ...bridgeSourceIds,
    ...adoptedSourceIdsByBeat.flat(),
    ...cancelSourceIds,
  ];
  const expectedIds = ownershipSnapshot.ownedSourceIds;
  if (partition.length !== expectedIds.length
      || new Set(partition).size !== partition.length
      || partition.some((sourceId) => !expectedIds.includes(sourceId))) {
    throw new HandoffPlannerFailure(
      'ownership-partition-invalid',
      'handoff ownership partition must classify every owned source exactly once',
    );
  }

  return {
    bridgeSourceIds,
    adoptedSourceIdsByBeat,
    cancelSourceIds,
    sourceClassifications,
  };
}

export function createPredictionOwnershipSnapshot(input) {
  const values = readExactOrdinaryDataRecord(
    input,
    OWNERSHIP_INPUT_KEYS,
    'ownership snapshot input',
  );
  const ownedSourceIds = readDenseOrdinaryArray(values.ownedSourceIds, 'ownedSourceIds');
  const rawPredictions = readDenseOrdinaryArray(values.predictions, 'predictions');
  if (ownedSourceIds.some((sourceId) => !isBoundedIdentifier(sourceId))) {
    throw new TypeError(
      'ownedSourceIds source IDs must be nonempty strings of at most 128 characters',
    );
  }
  if (new Set(ownedSourceIds).size !== ownedSourceIds.length) {
    throw new TypeError('ownedSourceIds must contain unique source IDs');
  }

  const predictions = rawPredictions.map((prediction) => {
    const predictionValues = readExactOrdinaryDataRecord(
      prediction,
      PREDICTION_KEYS,
      'prediction',
    );
    if (!isBoundedIdentifier(predictionValues.sourceId)) {
      throw new TypeError(
        'prediction sourceId must be a nonempty string of at most 128 characters',
      );
    }
    if (!Number.isFinite(predictionValues.scheduledAudioTime)
        || predictionValues.scheduledAudioTime < 0) {
      throw new TypeError('prediction scheduledAudioTime must be finite and nonnegative');
    }
    return {
      sourceId: predictionValues.sourceId,
      scheduledAudioTime: predictionValues.scheduledAudioTime,
    };
  });
  const predictionSourceIds = predictions.map(({ sourceId }) => sourceId);
  if (new Set(predictionSourceIds).size !== predictionSourceIds.length) {
    throw new TypeError('predictions must contain unique source IDs');
  }
  if (predictionSourceIds.length !== ownedSourceIds.length
      || predictionSourceIds.some((sourceId) => !ownedSourceIds.includes(sourceId))) {
    throw new TypeError('prediction source IDs must exactly equal ownedSourceIds');
  }

  const snapshot = deepFreeze({ ownedSourceIds: [...ownedSourceIds], predictions });
  genuineOwnershipSnapshots.add(snapshot);
  return snapshot;
}

export function deriveHandoffTrackBounds(authorityInput) {
  const values = readExactOrdinaryDataRecord(
    authorityInput,
    TRACK_BOUNDS_INPUT_KEYS,
    'handoff track bounds input',
  );
  for (const key of TRACK_BOUNDS_INPUT_KEYS) {
    if (!Number.isFinite(values[key]) || values[key] <= 0) {
      throw new TypeError(`${key} must be finite and greater than zero`);
    }
  }

  const handoffBeatDurationSeconds = 60 / values.handoffBpm;
  if (!Number.isFinite(handoffBeatDurationSeconds) || handoffBeatDurationSeconds <= 0) {
    throw new TypeError('handoffBpm must produce a finite positive beat duration');
  }
  const trackStartOffsetSeconds = values.targetEntryDownbeatSeconds
    - values.leadInBeats * handoffBeatDurationSeconds;
  if (trackStartOffsetSeconds < 0) {
    throw new HandoffPlannerFailure(
      'negative-track-start-offset',
      'handoff track start offset must be nonnegative',
    );
  }
  const minimumDecodedDurationSeconds = values.targetEntryDownbeatSeconds
    + (values.crossfadeEndBeat - values.curatedDownbeatBeat)
      * handoffBeatDurationSeconds
    + values.minimumPostCrossfadeTailSeconds;
  if (minimumDecodedDurationSeconds > values.decodedDurationSeconds) {
    throw new HandoffPlannerFailure(
      'insufficient-track-tail',
      'handoff track must include the minimum post-crossfade continuation',
    );
  }
  return Object.freeze({
    handoffBeatDurationSeconds,
    trackStartOffsetSeconds,
    minimumDecodedDurationSeconds,
  });
}

function validateHandoffInput(input) {
  const values = readExactOrdinaryDataRecord(input, HANDOFF_INPUT_KEYS, 'handoff plan input');
  if (!isBoundedIdentifier(values.generationId)) {
    throw new TypeError('generationId must be a nonempty string of at most 128 characters');
  }
  for (const key of [
    'estimatedBpmExact',
    'lastTapAudioTime',
    'candidateBeat1AudioTime',
    'lockDeadlineAudioTime',
    'audioNow',
    'outputSampleRate',
  ]) {
    if (!Number.isFinite(values[key])) {
      throw new TypeError(`${key} must be finite`);
    }
  }
  for (const key of ['estimatedBpmExact', 'outputSampleRate']) {
    if (values[key] <= 0) {
      throw new TypeError(`${key} must be greater than zero`);
    }
  }
  const estimatedBeatDurationSeconds = 60 / values.estimatedBpmExact;
  if (!Number.isFinite(estimatedBeatDurationSeconds) || estimatedBeatDurationSeconds <= 0) {
    throw new TypeError('estimatedBpmExact must produce a finite positive beat duration');
  }
  const oneSampleDurationSeconds = 1 / values.outputSampleRate;
  if (!Number.isFinite(oneSampleDurationSeconds) || oneSampleDurationSeconds <= 0) {
    throw new TypeError('outputSampleRate must produce a finite positive sample duration');
  }
  for (const key of [
    'lastTapAudioTime',
    'candidateBeat1AudioTime',
    'lockDeadlineAudioTime',
    'audioNow',
  ]) {
    if (values[key] < 0) {
      throw new TypeError(`${key} must be nonnegative`);
    }
  }
  if (values.candidateBeat1AudioTime <= values.lastTapAudioTime) {
    throw new TypeError('candidateBeat1AudioTime must be greater than lastTapAudioTime');
  }
  const expectedCandidateBeat1AudioTime = values.lastTapAudioTime
    + estimatedBeatDurationSeconds;
  if (!Object.is(values.candidateBeat1AudioTime, expectedCandidateBeat1AudioTime)) {
    throw new TypeError(
      'candidateBeat1AudioTime must equal lastTapAudioTime + 60 / estimatedBpmExact',
    );
  }
  if (values.assetIdentity !== ASSET_IDENTITY
      || values.experimentConfigIdentity !== EXPERIMENT_CONFIG_IDENTITY) {
    throw new TypeError('handoff evidence identities must be the locked authorities');
  }
  if (!genuineOwnershipSnapshots.has(values.ownershipSnapshot)
      || !isRecursivelyFrozen(values.ownershipSnapshot)) {
    throw new TypeError(
      'ownershipSnapshot must be a genuine frozen prediction ownership snapshot',
    );
  }
  return values;
}

function assertHandoffPlanInvariants(plan, ownershipSnapshot) {
  if (!Array.isArray(plan.beatTimes)
      || plan.beatTimes.length !== 8
      || !plan.beatTimes.every(Number.isFinite)
      || plan.beatTimes.some((beatTime, index) => (
        index > 0 && beatTime <= plan.beatTimes[index - 1]
      ))) {
    throw new HandoffPlannerFailure(
      'beat-timeline-invalid',
      'handoff plan must contain eight finite strictly increasing beat times',
    );
  }
  const partition = [
    ...plan.bridgeSourceIds,
    ...plan.adoptedSourceIdsByBeat.flat(),
    ...plan.cancelSourceIds,
  ];
  const expectedIds = ownershipSnapshot.ownedSourceIds;
  if (partition.length !== expectedIds.length
      || new Set(partition).size !== partition.length
      || partition.some((sourceId) => !expectedIds.includes(sourceId))) {
    throw new HandoffPlannerFailure(
      'ownership-partition-invalid',
      'handoff ownership partition must classify every owned source exactly once',
    );
  }
  if (!Number.isFinite(plan.naturalTrackEndAudioTime)
      || !Number.isFinite(plan.minimumRequiredAudioEndTime)
      || plan.naturalTrackEndAudioTime < plan.minimumRequiredAudioEndTime) {
    throw new HandoffPlannerFailure(
      'insufficient-track-tail',
      'handoff track must include the minimum post-crossfade continuation',
    );
  }
}

export function createHandoffPlan(rawInput) {
  const input = validateHandoffInput(rawInput);
  const trackBounds = deriveHandoffTrackBounds({
    handoffBpm: ONE_TRACK_CONFIG.trackBpm,
    targetEntryDownbeatSeconds: ONE_TRACK_CONFIG.targetEntryDownbeatSeconds,
    leadInBeats: ONE_TRACK_CONFIG.leadInBeats,
    crossfadeEndBeat: ONE_TRACK_CONFIG.crossfadeEndBeat,
    curatedDownbeatBeat: ONE_TRACK_CONFIG.curatedDownbeatBeat,
    minimumPostCrossfadeTailSeconds: ONE_TRACK_CONFIG.postCrossfadeTailSeconds,
    decodedDurationSeconds: ASSET_IDENTITY.decodedDurationSeconds,
  });
  const estimatedBeatDurationSeconds = 60 / input.estimatedBpmExact;
  const schedulingSafetySeconds = 0.100;
  const minimumBeat1AudioTime = input.audioNow + schedulingSafetySeconds;
  let handoffBeat1AudioTime = input.candidateBeat1AudioTime;
  let skippedBeatCount = 0;
  while (handoffBeat1AudioTime < minimumBeat1AudioTime) {
    if (skippedBeatCount === 2) {
      throw new HandoffPlannerFailure(
        'catch-up-limit-exceeded',
        'handoff candidate requires more than two catch-up beats',
      );
    }
    handoffBeat1AudioTime += estimatedBeatDurationSeconds;
    skippedBeatCount += 1;
  }
  const { handoffBeatDurationSeconds, trackStartOffsetSeconds } = trackBounds;
  const beatTimes = Array.from(
    { length: 8 },
    (_, index) => handoffBeat1AudioTime + index * handoffBeatDurationSeconds,
  );
  const crossfadeStartAudioTime = handoffBeat1AudioTime
    + (ONE_TRACK_CONFIG.crossfadeStartBeat - 1) * handoffBeatDurationSeconds;
  const curatedDownbeatAudioTime = handoffBeat1AudioTime
    + (ONE_TRACK_CONFIG.curatedDownbeatBeat - 1) * handoffBeatDurationSeconds;
  const crossfadeEndAudioTime = handoffBeat1AudioTime
    + (ONE_TRACK_CONFIG.crossfadeEndBeat - 1) * handoffBeatDurationSeconds;
  const songOnlyStartAudioTime = handoffBeat1AudioTime
    + ONE_TRACK_CONFIG.crossfadeEndBeat * handoffBeatDurationSeconds;
  const minimumRequiredAudioEndTime = crossfadeEndAudioTime
    + ONE_TRACK_CONFIG.postCrossfadeTailSeconds;
  const naturalTrackEndAudioTime = handoffBeat1AudioTime
    + (ASSET_IDENTITY.decodedDurationSeconds - trackStartOffsetSeconds);
  const oneSampleDurationSeconds = 1 / input.outputSampleRate;
  const classifications = classifyOwnedSources(
    input.ownershipSnapshot,
    beatTimes,
    input.audioNow,
    oneSampleDurationSeconds,
  );

  const plan = {
    generationId: input.generationId,
    assetIdentity: input.assetIdentity,
    experimentConfigIdentity: input.experimentConfigIdentity,
    estimatedBpmExact: input.estimatedBpmExact,
    estimatedBeatDurationSeconds,
    handoffBpm: ONE_TRACK_CONFIG.trackBpm,
    trackBpm: ONE_TRACK_CONFIG.trackBpm,
    tempoSnapBpm: ONE_TRACK_CONFIG.trackBpm - input.estimatedBpmExact,
    lastTapAudioTime: input.lastTapAudioTime,
    candidateBeat1AudioTime: input.candidateBeat1AudioTime,
    lockDeadlineAudioTime: input.lockDeadlineAudioTime,
    audioNow: input.audioNow,
    timerLatenessSeconds: input.audioNow - input.lockDeadlineAudioTime,
    outputSampleRate: input.outputSampleRate,
    oneSampleDurationSeconds,
    schedulingSafetySeconds,
    minimumBeat1AudioTime,
    skippedBeatCount,
    handoffBeat1AudioTime,
    handoffBeatDurationSeconds,
    beatTimes,
    trackStartAudioTime: handoffBeat1AudioTime,
    trackStartOffsetSeconds,
    crossfadeStartAudioTime,
    curatedDownbeatAudioTime,
    crossfadeEndAudioTime,
    songOnlyStartAudioTime,
    minimumRequiredAudioEndTime,
    naturalTrackEndAudioTime,
    percussionRecipeId: ONE_TRACK_CONFIG.percussionRecipeId,
    percussionTrimGain: ONE_TRACK_CONFIG.percussionTrimGain,
    trackTrimGain: ONE_TRACK_CONFIG.trackTrimGain,
    masterGain: ONE_TRACK_CONFIG.masterGain,
    crossfadeCurveSampleCount: ONE_TRACK_CONFIG.crossfadeCurveSampleCount,
    crossfadeCurveId: ONE_TRACK_CONFIG.crossfadeCurveId,
    ...classifications,
  };
  assertHandoffPlanInvariants(plan, input.ownershipSnapshot);
  return deepFreeze(plan);
}
