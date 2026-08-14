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

function assertClosedRecord(candidate, allowedKeys, label) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError(`${label} must be a record with the closed key set`);
  }
  const prototype = Object.getPrototypeOf(candidate);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must use the closed key set on an ordinary record`);
  }
  const keys = Reflect.ownKeys(candidate);
  if (keys.length !== allowedKeys.length
      || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))) {
    throw new TypeError(`${label} must use the closed key set`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  if (allowedKeys.some((key) => {
    const descriptor = descriptors[key];
    return descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value');
  })) {
    throw new TypeError(`${label} must use own enumerable data properties`);
  }
  return descriptors;
}

export function assertClosedTrackMetadata(candidate) {
  const descriptors = assertClosedRecord(candidate, TRACK_METADATA_KEYS, 'track metadata');
  for (const key of TRACK_METADATA_KEYS) {
    const value = descriptors[key].value;
    if (typeof EXPECTED_TRACK_METADATA[key] === 'number' && !Number.isFinite(value)) {
      throw new TypeError(`${key} must be finite`);
    }
    if (!Object.is(value, EXPECTED_TRACK_METADATA[key])) {
      throw new TypeError(`${key} must equal the locked sanitized value`);
    }
  }
  if (descriptors.decodedFrameCount.value * descriptors.decodedChannelCount.value * 4
      !== descriptors.calculatedDecodedPcmBytes.value) {
    throw new TypeError('calculatedDecodedPcmBytes must equal decodedFrameCount × decodedChannelCount × 4');
  }
  return true;
}

assertClosedTrackMetadata(EXPECTED_TRACK_METADATA);
export const TRACK_METADATA = EXPECTED_TRACK_METADATA;
