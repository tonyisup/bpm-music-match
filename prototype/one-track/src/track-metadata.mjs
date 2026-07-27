import { assertBuildIdentity } from './build-identity.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

export const TRACK_METADATA_KEYS = Object.freeze([
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
  'decodedFrameCount',
  'calculatedDecodedPcmBytes',
  'applicationMemoryContractPassed',
  'ownedReferencesCleared',
  'contextsCloseSettled',
  'browserHeapObserved',
]);

const EXPECTED_TRACK_METADATA = Object.freeze({
  schemaVersion: 1,
  assetVersion: 'm2-island-party-v1',
  displayLabel: 'Island Party by NDA',
  allowedExtension: '.mp3',
  allowedMimeType: 'audio/mpeg',
  sha256: 'faf3d6de8778bb343c3ae92dff9023facffde8288868e5ee017e842205298521',
  compressedBytes: 1952287,
  decodedDurationSeconds: 122.01795833333334,
  decodedDurationToleranceSeconds: 0.050,
  decodedChannelCount: 2,
  decodedSampleRate: 48000,
  decodedFrameCount: 5856862,
  calculatedDecodedPcmBytes: 46854896,
  applicationMemoryContractPassed: true,
  ownedReferencesCleared: true,
  contextsCloseSettled: true,
  browserHeapObserved: false,
});

function assertClosedKeys(candidate, allowedKeys, label) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError(`${label} must be a record with the closed key set`);
  }
  const keys = Object.keys(candidate);
  if (keys.length !== allowedKeys.length || keys.some((key) => !allowedKeys.includes(key))) {
    throw new TypeError(`${label} must use the closed key set`);
  }
}

export function assertClosedTrackMetadata(candidate) {
  assertClosedKeys(candidate, TRACK_METADATA_KEYS, 'track metadata');
  for (const key of TRACK_METADATA_KEYS) {
    if (typeof EXPECTED_TRACK_METADATA[key] === 'number' && !Number.isFinite(candidate[key])) {
      throw new TypeError(`${key} must be finite`);
    }
    if (!Object.is(candidate[key], EXPECTED_TRACK_METADATA[key])) {
      throw new TypeError(`${key} must equal the locked sanitized value`);
    }
  }
  if (candidate.decodedFrameCount * candidate.decodedChannelCount * 4
      !== candidate.calculatedDecodedPcmBytes) {
    throw new TypeError('calculatedDecodedPcmBytes must equal decodedFrameCount × decodedChannelCount × 4');
  }
  return true;
}

assertClosedTrackMetadata(EXPECTED_TRACK_METADATA);
export const TRACK_METADATA = EXPECTED_TRACK_METADATA;
