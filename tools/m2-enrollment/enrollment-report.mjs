import {
  MEASUREMENT_LIMITS,
  validateDecodedBounds,
  validateTimingBounds,
} from './enrollment-measurements.mjs';

const {
  maxCompressedBytes: MAX_COMPRESSED_BYTES,
  maxDecodedPcmBytes: MAX_DECODED_PCM_BYTES,
  maxDurationSeconds: MAX_DURATION_SECONDS,
  minSampleRate: MIN_SAMPLE_RATE,
  maxSampleRate: MAX_SAMPLE_RATE,
} = MEASUREMENT_LIMITS;

const ASSET_IDENTITY_KEYS = Object.freeze([
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

const EXPERIMENT_CONFIG_IDENTITY_KEYS = Object.freeze([
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

const REPORT_KEYS = Object.freeze([
  'assetIdentity',
  'experimentConfigIdentity',
]);

const ORIGINAL_JSON_STRINGIFY = JSON.stringify;
const SANITIZED_REPORT_SNAPSHOTS = new WeakMap();

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function requireJsonScalar(value, fieldName) {
  const scalarType = typeof value;
  if (value === null
      || (scalarType !== 'string' && scalarType !== 'boolean' && scalarType !== 'number')
      || (scalarType === 'number' && !Number.isFinite(value))) {
    throw new TypeError(`${fieldName} must be a finite JSON scalar`);
  }
}

function requirePositiveSafeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
}

function requireNonnegativeSafeInteger(value, fieldName, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`${fieldName} must be a nonnegative safe integer no greater than ${maximum}`);
  }
}

function requireFiniteNumber(value, fieldName, { minimum = 0, maximum = Infinity, exclusiveMinimum = false } = {}) {
  const belowMinimum = exclusiveMinimum ? value <= minimum : value < minimum;
  if (!Number.isFinite(value) || belowMinimum || value > maximum) {
    throw new TypeError(`${fieldName} must be a finite number in the approved range`);
  }
}

const TRUSTED_CONFIG_KEYS = Object.freeze([
  'schemaVersion',
  'assetVersion',
  'displayLabel',
  'allowedExtension',
  'allowedMimeType',
  'decodedDurationToleranceSeconds',
  'configVersion',
  'trackBpm',
  'trackBpmVerified',
  'beatsPerBar',
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

const OBSERVED_ASSET_FACT_KEYS = Object.freeze([
  'extensionMatchesConfigured',
  'observedMimeTypeMatchesConfigured',
  'sha256',
  'compressedBytes',
  'decodedDurationSeconds',
  'decodedChannelCount',
  'decodedSampleRate',
  'calculatedDecodedPcmBytes',
  'applicationMemoryContractPassed',
  'ownedReferencesCleared',
  'contextsCloseSettled',
  'browserHeapObserved',
]);

const REPORT_INPUT_KEYS = Object.freeze([
  'trustedConfig',
  'observedAssetFacts',
  'targetEntryDownbeatSeconds',
]);

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
const PATH_SEPARATOR_PATTERN = /[\\/]/;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const AUDIO_FILENAME_SUFFIX_PATTERN = /\.(?:aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|wave|webm|wma)$/i;
const VERSION_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

function requireExactValue(value, fieldName, expected) {
  if (value !== expected) {
    throw new TypeError(`${fieldName} must equal ${JSON.stringify(expected)}`);
  }
}

function requireTrustedPublicString(value, fieldName, maximumLength, versionIdentifier = false) {
  if (typeof value !== 'string'
      || value.length === 0
      || value.trim().length === 0
      || value.length > maximumLength
      || CONTROL_CHARACTER_PATTERN.test(value)
      || PATH_SEPARATOR_PATTERN.test(value)
      || URI_SCHEME_PATTERN.test(value.trim())
      || AUDIO_FILENAME_SUFFIX_PATTERN.test(value.trim())
      || (versionIdentifier && !VERSION_IDENTIFIER_PATTERN.test(value))) {
    throw new TypeError(`${fieldName} must be an approved public string`);
  }
}

const TRUSTED_CONFIG_SCHEMA = Object.freeze({
  schemaVersion(value, fieldName) {
    requireExactValue(value, fieldName, 1);
  },
  assetVersion(value, fieldName) {
    requireTrustedPublicString(value, fieldName, 80, true);
  },
  displayLabel(value, fieldName) {
    requireTrustedPublicString(value, fieldName, 120);
  },
  allowedExtension(value, fieldName) {
    requireExactValue(value, fieldName, '.mp3');
  },
  allowedMimeType(value, fieldName) {
    requireExactValue(value, fieldName, 'audio/mpeg');
  },
  decodedDurationToleranceSeconds(value, fieldName) {
    requireExactValue(value, fieldName, 0.050);
  },
  configVersion(value, fieldName) {
    requireExactValue(value, fieldName, 'm2-config-v1');
  },
  trackBpm(value, fieldName) {
    requireFiniteNumber(value, fieldName, { minimum: 0, exclusiveMinimum: true });
  },
  trackBpmVerified(value, fieldName) {
    requireExactValue(value, fieldName, true);
  },
  beatsPerBar(value, fieldName) {
    requireExactValue(value, fieldName, 4);
  },
  leadInBeats(value, fieldName) {
    requireExactValue(value, fieldName, 4);
  },
  minimumPostCrossfadeTailSeconds(value, fieldName) {
    requireExactValue(value, fieldName, 2);
  },
  percussionRecipeId(value, fieldName) {
    requireExactValue(value, fieldName, 'kick-snare-v1');
  },
  percussionTrimGain(value, fieldName) {
    requireExactValue(value, fieldName, 0.25);
  },
  trackTrimGain(value, fieldName) {
    requireExactValue(value, fieldName, 0.50);
  },
  masterGain(value, fieldName) {
    requireExactValue(value, fieldName, 0.70);
  },
  bpmMatchWindow(value, fieldName) {
    requireExactValue(value, fieldName, 3.0);
  },
  intervalOutlierFraction(value, fieldName) {
    requireExactValue(value, fieldName, 0.20);
  },
  stabilityCvLimit(value, fieldName) {
    requireExactValue(value, fieldName, 0.05);
  },
  reconciliationToleranceMs(value, fieldName) {
    requireExactValue(value, fieldName, 60);
  },
  silenceTimeoutFormula(value, fieldName) {
    requireExactValue(value, fieldName, 'clamp-1.5x-median-900-1800-v1');
  },
  crossfadeStartBeat(value, fieldName) {
    requireExactValue(value, fieldName, 4);
  },
  targetDownbeatBeat(value, fieldName) {
    requireExactValue(value, fieldName, 5);
  },
  crossfadeEndBeat(value, fieldName) {
    requireExactValue(value, fieldName, 8);
  },
  crossfadeSampleCount(value, fieldName) {
    requireExactValue(value, fieldName, 128);
  },
  crossfadeCurveId(value, fieldName) {
    requireExactValue(value, fieldName, 'equal-power-sin-cos-v1');
  },
});

const OBSERVED_ASSET_FACT_SCHEMA = Object.freeze({
  extensionMatchesConfigured(value, fieldName) {
    requireExactValue(value, fieldName, true);
  },
  observedMimeTypeMatchesConfigured(value, fieldName) {
    requireExactValue(value, fieldName, true);
  },
  sha256(value, fieldName) {
    if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
      throw new TypeError(`${fieldName} must be a lowercase 64-hex SHA-256`);
    }
  },
  compressedBytes(value, fieldName) {
    requireNonnegativeSafeInteger(value, fieldName, MAX_COMPRESSED_BYTES);
  },
  decodedDurationSeconds(value, fieldName) {
    requireFiniteNumber(value, fieldName, {
      minimum: 0,
      maximum: MAX_DURATION_SECONDS,
      exclusiveMinimum: true,
    });
  },
  decodedChannelCount(value, fieldName) {
    if (!Number.isInteger(value) || (value !== 1 && value !== 2)) {
      throw new TypeError(`${fieldName} must be one or two`);
    }
  },
  decodedSampleRate(value, fieldName) {
    if (!Number.isInteger(value) || value < MIN_SAMPLE_RATE || value > MAX_SAMPLE_RATE) {
      throw new TypeError(`${fieldName} must be an integer from 8000 through 96000`);
    }
  },
  calculatedDecodedPcmBytes(value, fieldName) {
    requirePositiveSafeInteger(value, fieldName);
    if (value > MAX_DECODED_PCM_BYTES) {
      throw new TypeError(`${fieldName} must not exceed ${MAX_DECODED_PCM_BYTES}`);
    }
  },
  applicationMemoryContractPassed(value, fieldName) {
    if (value !== true) {
      throw new TypeError(`${fieldName} must be true`);
    }
  },
  ownedReferencesCleared(value, fieldName) {
    if (value !== true) {
      throw new TypeError(`${fieldName} must be true`);
    }
  },
  contextsCloseSettled(value, fieldName) {
    if (value !== true) {
      throw new TypeError(`${fieldName} must be true`);
    }
  },
  browserHeapObserved(value, fieldName) {
    if (value !== false) {
      throw new TypeError(`${fieldName} must be false`);
    }
  },
});

function requireExactPlainObject(source, keys, objectName) {
  if (source === null || typeof source !== 'object') {
    throw new TypeError(`${objectName} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(source);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${objectName} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(source);
  if (ownKeys.length !== keys.length
      || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    throw new TypeError(`${objectName} must contain exactly the approved keys`);
  }
}

function validateScalarRecord(source, keys, schema, objectName) {
  requireExactPlainObject(source, keys, objectName);
  const descriptors = Object.getOwnPropertyDescriptors(source);
  return Object.fromEntries(keys.map((key) => {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${objectName}.${key} must be a scalar data property`);
    }
    const fieldName = `${objectName}.${key}`;
    const value = descriptor.value;
    requireJsonScalar(value, fieldName);
    schema[key](value, fieldName);
    return [key, value];
  }));
}

function validateDecodedReportConsistency(observedAssetFacts) {
  const bytesPerFrame = observedAssetFacts.decodedChannelCount * 4;
  if (observedAssetFacts.calculatedDecodedPcmBytes % bytesPerFrame !== 0) {
    throw new TypeError('observedAssetFacts.calculatedDecodedPcmBytes must contain complete decoded frames');
  }

  const framesPerChannel = observedAssetFacts.calculatedDecodedPcmBytes / bytesPerFrame;
  const decodedBounds = validateDecodedBounds({
    durationSeconds: observedAssetFacts.decodedDurationSeconds,
    channelCount: observedAssetFacts.decodedChannelCount,
    sampleRate: observedAssetFacts.decodedSampleRate,
    frameCount: framesPerChannel,
  });
  if (!decodedBounds.ok) {
    throw new TypeError('observedAssetFacts calculated PCM bytes and decoded duration are inconsistent');
  }
}

function validateReportCrossFields(
  trustedConfig,
  observedAssetFacts,
  targetEntryDownbeatSeconds,
) {
  const timing = validateTimingBounds({
    trackBpm: trustedConfig.trackBpm,
    targetEntryDownbeatSeconds,
    decodedDurationSeconds: observedAssetFacts.decodedDurationSeconds,
  });
  if (!timing.ok) {
    throw new TypeError(`report timing contract failed: ${timing.errorCode}`);
  }

  validateDecodedReportConsistency(observedAssetFacts);
}

function requireExactFrozenPlainDataObject(source, keys, objectName) {
  requireExactPlainObject(source, keys, objectName);
  if (Object.getPrototypeOf(source) !== Object.prototype || !Object.isFrozen(source)) {
    throw new TypeError(`${objectName} must be a frozen plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(source);
  for (const key of keys) {
    if (!Object.hasOwn(descriptors[key], 'value')) {
      throw new TypeError(`${objectName}.${key} must be a direct data property`);
    }
  }
  return descriptors;
}

function verifyFrozenSanitizedReportShape(report) {
  const reportDescriptors = requireExactFrozenPlainDataObject(report, REPORT_KEYS, 'report');
  requireExactFrozenPlainDataObject(
    reportDescriptors.assetIdentity.value,
    ASSET_IDENTITY_KEYS,
    'report.assetIdentity',
  );
  requireExactFrozenPlainDataObject(
    reportDescriptors.experimentConfigIdentity.value,
    EXPERIMENT_CONFIG_IDENTITY_KEYS,
    'report.experimentConfigIdentity',
  );
}

function copyNullPrototypeRecord(source, keys) {
  const copy = Object.create(null);
  for (const key of keys) {
    copy[key] = source[key];
  }
  return copy;
}

function createCanonicalReportSnapshot(assetIdentity, experimentConfigIdentity) {
  return Object.freeze(Object.assign(Object.create(null), {
    assetIdentity: Object.freeze(copyNullPrototypeRecord(assetIdentity, ASSET_IDENTITY_KEYS)),
    experimentConfigIdentity: Object.freeze(copyNullPrototypeRecord(
      experimentConfigIdentity,
      EXPERIMENT_CONFIG_IDENTITY_KEYS,
    )),
  }));
}

export function serializeSanitizedReport(report) {
  const snapshot = (report !== null && typeof report === 'object')
    ? SANITIZED_REPORT_SNAPSHOTS.get(report)
    : undefined;
  if (snapshot === undefined) {
    throw new TypeError('report must be created by createSanitizedReport');
  }

  const exportDto = Object.assign(Object.create(null), {
    assetIdentity: copyNullPrototypeRecord(snapshot.assetIdentity, ASSET_IDENTITY_KEYS),
    experimentConfigIdentity: copyNullPrototypeRecord(
      snapshot.experimentConfigIdentity,
      EXPERIMENT_CONFIG_IDENTITY_KEYS,
    ),
  });
  try {
    return ORIGINAL_JSON_STRINGIFY(exportDto);
  } catch (error) {
    throw new TypeError(`report must be JSON serializable: ${error.message}`);
  }
}

export function createSanitizedReport(input) {
  requireExactPlainObject(input, REPORT_INPUT_KEYS, 'report input');
  const inputDescriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of REPORT_INPUT_KEYS) {
    if (!Object.hasOwn(inputDescriptors[key], 'value')) {
      throw new TypeError(`report input.${key} must be a direct data property`);
    }
  }
  const trustedConfigInput = inputDescriptors.trustedConfig.value;
  const observedAssetFactsInput = inputDescriptors.observedAssetFacts.value;
  const targetEntryDownbeatSeconds = inputDescriptors.targetEntryDownbeatSeconds.value;
  const trustedConfig = validateScalarRecord(
    trustedConfigInput,
    TRUSTED_CONFIG_KEYS,
    TRUSTED_CONFIG_SCHEMA,
    'trustedConfig',
  );
  const observedAssetFacts = validateScalarRecord(
    observedAssetFactsInput,
    OBSERVED_ASSET_FACT_KEYS,
    OBSERVED_ASSET_FACT_SCHEMA,
    'observedAssetFacts',
  );
  requireFiniteNumber(
    targetEntryDownbeatSeconds,
    'targetEntryDownbeatSeconds',
  );
  validateReportCrossFields(
    trustedConfig,
    observedAssetFacts,
    targetEntryDownbeatSeconds,
  );

  const sanitizedAssetIdentity = Object.freeze({
    schemaVersion: trustedConfig.schemaVersion,
    assetVersion: trustedConfig.assetVersion,
    displayLabel: trustedConfig.displayLabel,
    allowedExtension: trustedConfig.allowedExtension,
    allowedMimeType: trustedConfig.allowedMimeType,
    sha256: observedAssetFacts.sha256,
    compressedBytes: observedAssetFacts.compressedBytes,
    decodedDurationSeconds: observedAssetFacts.decodedDurationSeconds,
    decodedDurationToleranceSeconds: trustedConfig.decodedDurationToleranceSeconds,
    decodedChannelCount: observedAssetFacts.decodedChannelCount,
    decodedSampleRate: observedAssetFacts.decodedSampleRate,
    calculatedDecodedPcmBytes: observedAssetFacts.calculatedDecodedPcmBytes,
    applicationMemoryContractPassed: observedAssetFacts.applicationMemoryContractPassed,
    ownedReferencesCleared: observedAssetFacts.ownedReferencesCleared,
    contextsCloseSettled: observedAssetFacts.contextsCloseSettled,
    browserHeapObserved: observedAssetFacts.browserHeapObserved,
  });
  const sanitizedExperimentConfigIdentity = Object.freeze({
    configVersion: trustedConfig.configVersion,
    trackBpm: trustedConfig.trackBpm,
    beatsPerBar: trustedConfig.beatsPerBar,
    targetEntryDownbeatSeconds,
    leadInBeats: trustedConfig.leadInBeats,
    minimumPostCrossfadeTailSeconds: trustedConfig.minimumPostCrossfadeTailSeconds,
    percussionRecipeId: trustedConfig.percussionRecipeId,
    percussionTrimGain: trustedConfig.percussionTrimGain,
    trackTrimGain: trustedConfig.trackTrimGain,
    masterGain: trustedConfig.masterGain,
    bpmMatchWindow: trustedConfig.bpmMatchWindow,
    intervalOutlierFraction: trustedConfig.intervalOutlierFraction,
    stabilityCvLimit: trustedConfig.stabilityCvLimit,
    reconciliationToleranceMs: trustedConfig.reconciliationToleranceMs,
    silenceTimeoutFormula: trustedConfig.silenceTimeoutFormula,
    crossfadeStartBeat: trustedConfig.crossfadeStartBeat,
    targetDownbeatBeat: trustedConfig.targetDownbeatBeat,
    crossfadeEndBeat: trustedConfig.crossfadeEndBeat,
    crossfadeSampleCount: trustedConfig.crossfadeSampleCount,
    crossfadeCurveId: trustedConfig.crossfadeCurveId,
  });

  const report = Object.freeze({
    assetIdentity: sanitizedAssetIdentity,
    experimentConfigIdentity: sanitizedExperimentConfigIdentity,
  });
  verifyFrozenSanitizedReportShape(report);
  SANITIZED_REPORT_SNAPSHOTS.set(
    report,
    createCanonicalReportSnapshot(
      sanitizedAssetIdentity,
      sanitizedExperimentConfigIdentity,
    ),
  );
  return report;
}
