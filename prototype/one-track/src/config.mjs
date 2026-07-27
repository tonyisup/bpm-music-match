import { assertBuildIdentity } from './build-identity.mjs';
import {
  TRACK_METADATA,
  assertClosedTrackMetadata,
} from './track-metadata.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

export const ONE_TRACK_CONFIG_KEYS = Object.freeze([
  'configVersion',
  'trackBpm',
  'beatsPerBar',
  'targetEntryDownbeatSeconds',
  'leadInBeats',
  'postCrossfadeTailSeconds',
  'percussionRecipeId',
  'percussionTrimGain',
  'trackTrimGain',
  'masterGain',
  'matchWindowBpm',
  'intervalOutlierFraction',
  'stabilityCvThreshold',
  'reconciliationToleranceMilliseconds',
  'silenceFormulaId',
  'crossfadeStartBeat',
  'curatedDownbeatBeat',
  'crossfadeEndBeat',
  'crossfadeCurveSampleCount',
  'crossfadeCurveId',
]);

const EXPECTED_CONFIG = {
  configVersion: 'm2-config-v1',
  trackBpm: 110,
  beatsPerBar: 4,
  targetEntryDownbeatSeconds: 17.579,
  leadInBeats: 4,
  postCrossfadeTailSeconds: 2,
  percussionRecipeId: 'kick-snare-v1',
  percussionTrimGain: 0.25,
  trackTrimGain: 0.50,
  masterGain: 0.70,
  matchWindowBpm: 3.0,
  intervalOutlierFraction: 0.20,
  stabilityCvThreshold: 0.05,
  reconciliationToleranceMilliseconds: 60,
  silenceFormulaId: 'clamp-1.5x-median-900-1800-v1',
  crossfadeStartBeat: 4,
  curatedDownbeatBeat: 5,
  crossfadeEndBeat: 8,
  crossfadeCurveSampleCount: 128,
  crossfadeCurveId: 'equal-power-sin-cos-v1',
};

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return Object.freeze(value);
}

function assertClosedKeys(candidate, allowedKeys) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('one-track config must be a record with the closed key set');
  }
  const keys = Object.keys(candidate);
  if (keys.length !== allowedKeys.length || keys.some((key) => !allowedKeys.includes(key))) {
    throw new TypeError('one-track config must use the closed key set');
  }
}

export function assertClosedOneTrackConfig(candidate) {
  assertClosedKeys(candidate, ONE_TRACK_CONFIG_KEYS);
  for (const key of ONE_TRACK_CONFIG_KEYS) {
    if (typeof EXPECTED_CONFIG[key] === 'number' && !Number.isFinite(candidate[key])) {
      throw new TypeError(`${key} must be finite`);
    }
    if (!Object.is(candidate[key], EXPECTED_CONFIG[key])) {
      throw new TypeError(`${key} must equal the locked config value`);
    }
  }
  return true;
}

assertClosedTrackMetadata(TRACK_METADATA);
assertClosedOneTrackConfig(EXPECTED_CONFIG);
export const ONE_TRACK_CONFIG = deepFreeze(EXPECTED_CONFIG);

export const ASSET_IDENTITY_KEYS = Object.freeze([
  'schemaVersion',
  'assetVersion',
  'displayLabel',
  'allowedExtension',
  'allowedMimeType',
  'sha256',
  'compressedBytes',
  'decodedDurationSeconds',
  'decodedDurationToleranceSeconds',
  'decodedChannelCount',
  'decodedSampleRate',
  'calculatedDecodedPcmBytes',
  'applicationMemoryContractPassed',
  'ownedReferencesCleared',
  'contextsCloseSettled',
  'browserHeapObserved',
]);

export const ASSET_IDENTITY = deepFreeze(Object.fromEntries(
  ASSET_IDENTITY_KEYS.map((key) => [key, TRACK_METADATA[key]]),
));

export const EXPERIMENT_CONFIG_IDENTITY_KEYS = Object.freeze([
  'configVersion',
  'trackBpm',
  'beatsPerBar',
  'targetEntryDownbeatSeconds',
  'leadInBeats',
  'minimumPostCrossfadeTailSeconds',
  'percussionRecipeId',
  'percussionTrimGain',
  'trackTrimGain',
  'masterGain',
  'bpmMatchWindow',
  'intervalOutlierFraction',
  'stabilityCvLimit',
  'reconciliationToleranceMs',
  'silenceTimeoutFormula',
  'crossfadeStartBeat',
  'targetDownbeatBeat',
  'crossfadeEndBeat',
  'crossfadeSampleCount',
  'crossfadeCurveId',
]);

export const EXPERIMENT_CONFIG_IDENTITY = deepFreeze({
  configVersion: ONE_TRACK_CONFIG.configVersion,
  trackBpm: ONE_TRACK_CONFIG.trackBpm,
  beatsPerBar: ONE_TRACK_CONFIG.beatsPerBar,
  targetEntryDownbeatSeconds: ONE_TRACK_CONFIG.targetEntryDownbeatSeconds,
  leadInBeats: ONE_TRACK_CONFIG.leadInBeats,
  minimumPostCrossfadeTailSeconds: ONE_TRACK_CONFIG.postCrossfadeTailSeconds,
  percussionRecipeId: ONE_TRACK_CONFIG.percussionRecipeId,
  percussionTrimGain: ONE_TRACK_CONFIG.percussionTrimGain,
  trackTrimGain: ONE_TRACK_CONFIG.trackTrimGain,
  masterGain: ONE_TRACK_CONFIG.masterGain,
  bpmMatchWindow: ONE_TRACK_CONFIG.matchWindowBpm,
  intervalOutlierFraction: ONE_TRACK_CONFIG.intervalOutlierFraction,
  stabilityCvLimit: ONE_TRACK_CONFIG.stabilityCvThreshold,
  reconciliationToleranceMs: ONE_TRACK_CONFIG.reconciliationToleranceMilliseconds,
  silenceTimeoutFormula: ONE_TRACK_CONFIG.silenceFormulaId,
  crossfadeStartBeat: ONE_TRACK_CONFIG.crossfadeStartBeat,
  targetDownbeatBeat: ONE_TRACK_CONFIG.curatedDownbeatBeat,
  crossfadeEndBeat: ONE_TRACK_CONFIG.crossfadeEndBeat,
  crossfadeSampleCount: ONE_TRACK_CONFIG.crossfadeCurveSampleCount,
  crossfadeCurveId: ONE_TRACK_CONFIG.crossfadeCurveId,
});

export const ONE_TRACK_CONTRACT = deepFreeze({
  assetIdentity: ASSET_IDENTITY,
  experimentConfigIdentity: EXPERIMENT_CONFIG_IDENTITY,
});
