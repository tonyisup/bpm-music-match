import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSanitizedReport,
  serializeSanitizedReport,
} from '../enrollment-report.mjs';

const MiB = 1024 * 1024;

const ASSET_IDENTITY_KEYS = [
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
];

const EXPERIMENT_CONFIG_IDENTITY_KEYS = [
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
];

const TRUSTED_CONFIG_KEYS = [
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
];

const OBSERVED_ASSET_FACT_KEYS = [
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
];

function reportInput() {
  return {
    trustedConfig: {
      schemaVersion: 1,
      assetVersion: 'asset-v1',
      displayLabel: 'Enrolled reference track',
      allowedExtension: '.mp3',
      allowedMimeType: 'audio/mpeg',
      decodedDurationToleranceSeconds: 0.050,
      configVersion: 'm2-config-v1',
      trackBpm: 120,
      trackBpmVerified: true,
      beatsPerBar: 4,
      leadInBeats: 4,
      minimumPostCrossfadeTailSeconds: 2,
      percussionRecipeId: 'kick-snare-v1',
      percussionTrimGain: 0.25,
      trackTrimGain: 0.50,
      masterGain: 0.7,
      bpmMatchWindow: 3.0,
      intervalOutlierFraction: 0.2,
      stabilityCvLimit: 0.05,
      reconciliationToleranceMs: 60,
      silenceTimeoutFormula: 'clamp-1.5x-median-900-1800-v1',
      crossfadeStartBeat: 4,
      targetDownbeatBeat: 5,
      crossfadeEndBeat: 8,
      crossfadeSampleCount: 128,
      crossfadeCurveId: 'equal-power-sin-cos-v1',
    },
    observedAssetFacts: {
      extensionMatchesConfigured: true,
      observedMimeTypeMatchesConfigured: true,
      sha256: 'a'.repeat(64),
      compressedBytes: 10 * MiB,
      decodedDurationSeconds: 10,
      decodedChannelCount: 2,
      decodedSampleRate: 48_000,
      calculatedDecodedPcmBytes: 10 * 48_000 * 2 * 4,
      applicationMemoryContractPassed: true,
      ownedReferencesCleared: true,
      contextsCloseSettled: true,
      browserHeapObserved: false,
    },
    targetEntryDownbeatSeconds: 2,
  };
}

test('sanitized report assembles exact identities from trusted config, observed facts, and the curated downbeat', () => {
  const input = reportInput();
  const report = createSanitizedReport(input);

  assert.deepEqual(Object.keys(report), ['assetIdentity', 'experimentConfigIdentity']);
  assert.deepEqual(Object.keys(report.assetIdentity), ASSET_IDENTITY_KEYS);
  assert.deepEqual(Object.keys(report.experimentConfigIdentity), EXPERIMENT_CONFIG_IDENTITY_KEYS);
  assert.deepEqual(report.assetIdentity, {
    schemaVersion: input.trustedConfig.schemaVersion,
    assetVersion: input.trustedConfig.assetVersion,
    displayLabel: input.trustedConfig.displayLabel,
    allowedExtension: input.trustedConfig.allowedExtension,
    allowedMimeType: input.trustedConfig.allowedMimeType,
    sha256: input.observedAssetFacts.sha256,
    compressedBytes: input.observedAssetFacts.compressedBytes,
    decodedDurationSeconds: input.observedAssetFacts.decodedDurationSeconds,
    decodedDurationToleranceSeconds: input.trustedConfig.decodedDurationToleranceSeconds,
    decodedChannelCount: input.observedAssetFacts.decodedChannelCount,
    decodedSampleRate: input.observedAssetFacts.decodedSampleRate,
    calculatedDecodedPcmBytes: input.observedAssetFacts.calculatedDecodedPcmBytes,
    applicationMemoryContractPassed: input.observedAssetFacts.applicationMemoryContractPassed,
    ownedReferencesCleared: input.observedAssetFacts.ownedReferencesCleared,
    contextsCloseSettled: input.observedAssetFacts.contextsCloseSettled,
    browserHeapObserved: input.observedAssetFacts.browserHeapObserved,
  });
  assert.deepEqual(report.experimentConfigIdentity, {
    configVersion: input.trustedConfig.configVersion,
    trackBpm: input.trustedConfig.trackBpm,
    beatsPerBar: input.trustedConfig.beatsPerBar,
    targetEntryDownbeatSeconds: input.targetEntryDownbeatSeconds,
    leadInBeats: input.trustedConfig.leadInBeats,
    minimumPostCrossfadeTailSeconds: input.trustedConfig.minimumPostCrossfadeTailSeconds,
    percussionRecipeId: input.trustedConfig.percussionRecipeId,
    percussionTrimGain: input.trustedConfig.percussionTrimGain,
    trackTrimGain: input.trustedConfig.trackTrimGain,
    masterGain: input.trustedConfig.masterGain,
    bpmMatchWindow: input.trustedConfig.bpmMatchWindow,
    intervalOutlierFraction: input.trustedConfig.intervalOutlierFraction,
    stabilityCvLimit: input.trustedConfig.stabilityCvLimit,
    reconciliationToleranceMs: input.trustedConfig.reconciliationToleranceMs,
    silenceTimeoutFormula: input.trustedConfig.silenceTimeoutFormula,
    crossfadeStartBeat: input.trustedConfig.crossfadeStartBeat,
    targetDownbeatBeat: input.trustedConfig.targetDownbeatBeat,
    crossfadeEndBeat: input.trustedConfig.crossfadeEndBeat,
    crossfadeSampleCount: input.trustedConfig.crossfadeSampleCount,
    crossfadeCurveId: input.trustedConfig.crossfadeCurveId,
  });
  assert.equal(Object.hasOwn(report.experimentConfigIdentity, 'trackBpmVerified'), false);
  const parsed = JSON.parse(serializeSanitizedReport(report));
  assert.deepEqual(parsed, report);
});

test('sanitized reports are deeply frozen and cannot gain private fields before serialization', () => {
  const report = createSanitizedReport(reportInput());
  const serializedBefore = serializeSanitizedReport(report);

  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.assetIdentity), true);
  assert.equal(Object.isFrozen(report.experimentConfigIdentity), true);
  assert.throws(() => {
    report.privatePath = '/private/audio.mp3';
  }, TypeError);
  assert.throws(() => {
    report.assetIdentity.filename = 'private.mp3';
  }, TypeError);
  assert.throws(() => {
    report.experimentConfigIdentity.privateUri = 'file:///private/audio.mp3';
  }, TypeError);
  assert.equal(serializeSanitizedReport(report), serializedBefore);
});

test('report serializer reconstructs exact null-prototype exports despite later same-realm prototype pollution', () => {
  const report = createSanitizedReport(reportInput());
  const expected = serializeSanitizedReport(report);
  const originalStringify = JSON.stringify;
  const originalToJsonDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');

  try {
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      value() {
        return Object.assign(Object.create(null), {
          privatePath: '/private/audio.mp3',
          privateContent: 'selected audio bytes',
        });
      },
    });
    assert.match(originalStringify(report), /privatePath/);
    JSON.stringify = () => '{"privatePath":"monkey-patched"}';

    const serialized = serializeSanitizedReport(report);

    assert.equal(serialized, expected);
    const parsed = JSON.parse(serialized);
    assert.deepEqual(Object.keys(parsed), ['assetIdentity', 'experimentConfigIdentity']);
    assert.deepEqual(Object.keys(parsed.assetIdentity), ASSET_IDENTITY_KEYS);
    assert.deepEqual(Object.keys(parsed.experimentConfigIdentity), EXPERIMENT_CONFIG_IDENTITY_KEYS);
    assert.equal(serialized.includes('private'), false);
    assert.equal(serialized.includes('bytes'), false);
  } finally {
    JSON.stringify = originalStringify;
    if (originalToJsonDescriptor === undefined) {
      delete Object.prototype.toJSON;
    } else {
      Object.defineProperty(Object.prototype, 'toJSON', originalToJsonDescriptor);
    }
  }
});

test('report serializer rejects caller-crafted, unfrozen, extra-field, and proxied report shapes', () => {
  const brandedReport = createSanitizedReport(reportInput());
  const serialized = serializeSanitizedReport(brandedReport);
  const callerCrafted = JSON.parse(serialized);
  const callerCraftedWithExtra = JSON.parse(serialized);
  callerCraftedWithExtra.assetIdentity.privatePath = '/private/audio.mp3';
  Object.freeze(callerCraftedWithExtra.assetIdentity);
  Object.freeze(callerCraftedWithExtra.experimentConfigIdentity);
  Object.freeze(callerCraftedWithExtra);
  const callerCraftedFrozen = JSON.parse(serialized);
  Object.freeze(callerCraftedFrozen.assetIdentity);
  Object.freeze(callerCraftedFrozen.experimentConfigIdentity);
  Object.freeze(callerCraftedFrozen);
  const proxiedReport = new Proxy(brandedReport, {});
  const { proxy: revokedReport, revoke } = Proxy.revocable(brandedReport, {});
  revoke();

  for (const report of [
    {},
    callerCrafted,
    callerCraftedWithExtra,
    callerCraftedFrozen,
    proxiedReport,
    revokedReport,
  ]) {
    assert.throws(() => serializeSanitizedReport(report), TypeError);
  }
});

test('sanitized report accepts only the new exact constructor inputs and never caller-assembled identities', () => {
  const validInput = reportInput();
  assert.throws(() => createSanitizedReport(), TypeError);
  assert.throws(() => createSanitizedReport({
    assetIdentity: {},
    experimentConfigIdentity: {},
  }), TypeError);
  for (const key of ['trustedConfig', 'observedAssetFacts', 'targetEntryDownbeatSeconds']) {
    const input = reportInput();
    delete input[key];
    assert.throws(() => createSanitizedReport(input), TypeError, `${key} missing`);
  }
  assert.throws(
    () => createSanitizedReport({ ...validInput, filename: 'private.mp3' }),
    TypeError,
  );
});

test('sanitized report requires every trusted config and observed fact field', () => {
  for (const [inputName, keys] of [
    ['trustedConfig', TRUSTED_CONFIG_KEYS],
    ['observedAssetFacts', OBSERVED_ASSET_FACT_KEYS],
  ]) {
    for (const key of keys) {
      const missingInput = reportInput();
      delete missingInput[inputName][key];
      assert.throws(() => createSanitizedReport(missingInput), TypeError, `${inputName}.${key} missing`);

      const undefinedInput = reportInput();
      undefinedInput[inputName][key] = undefined;
      assert.throws(() => createSanitizedReport(undefinedInput), TypeError, `${inputName}.${key} undefined`);
    }
  }
});

test('sanitized report rejects every contradiction of the fixed trusted policy', () => {
  const contradictoryValuesByKey = {
    schemaVersion: [0, 2],
    allowedExtension: ['.wav', 'mp3'],
    allowedMimeType: ['audio/wav', 'audio/mp3'],
    decodedDurationToleranceSeconds: [0, 0.049, 0.051],
    configVersion: ['config-v1', 'm2-config-v2'],
    trackBpmVerified: [false],
    beatsPerBar: [3, 5],
    leadInBeats: [3, 5],
    minimumPostCrossfadeTailSeconds: [1, 3],
    percussionRecipeId: ['percussion-v1', 'kick-snare-v2'],
    percussionTrimGain: [0.24, 0.26],
    trackTrimGain: [0.49, 0.51],
    masterGain: [0.69, 0.71],
    bpmMatchWindow: [2.9, 3.1],
    intervalOutlierFraction: [0.19, 0.21],
    stabilityCvLimit: [0.04, 0.06],
    reconciliationToleranceMs: [59, 61],
    silenceTimeoutFormula: ['four-beats-plus-tail', 'clamp-v2'],
    crossfadeStartBeat: [3, 5],
    targetDownbeatBeat: [4, 6],
    crossfadeEndBeat: [7, 9],
    crossfadeSampleCount: [127, 129],
    crossfadeCurveId: ['equal-power-v1', 'linear-v1'],
  };

  for (const [key, contradictoryValues] of Object.entries(contradictoryValuesByKey)) {
    for (const contradictoryValue of contradictoryValues) {
      const input = reportInput();
      input.trustedConfig[key] = contradictoryValue;
      assert.throws(() => createSanitizedReport(input), TypeError, `${key}: ${String(contradictoryValue)}`);
    }
  }
});

test('sanitized report limits trusted public strings and rejects filename, path, URI, and control-string shapes', () => {
  for (const [key, invalidValues] of [
    ['assetVersion', ['', 'a'.repeat(81), 'private.mp3', 'private.WAV', 'folder/private', 'folder\\private', 'file:private', 'https://private', 'private\u0000value']],
    ['displayLabel', ['', 'a'.repeat(121), 'private.mp3', 'private.FLAC', 'folder/private', 'folder\\private', 'file:private', 'https://private', 'private\u007fvalue', 'private\u0085value']],
  ]) {
    for (const invalidValue of invalidValues) {
      const input = reportInput();
      input.trustedConfig[key] = invalidValue;
      assert.throws(() => createSanitizedReport(input), TypeError, `${key}: ${JSON.stringify(invalidValue)}`);
    }
  }
});

test('sanitized report validates candidate-curated BPM and every observed fact before copying', () => {
  const invalidValuesByKey = {
    trackBpm: [0, -1],
    extensionMatchesConfigured: [false, 1, 'true'],
    observedMimeTypeMatchesConfigured: [false, 1, 'true'],
    sha256: ['A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(63)}g`],
    compressedBytes: [-1, 1.5, (20 * MiB) + 1],
    decodedDurationSeconds: [0, 360.000_001],
    decodedChannelCount: [0, 1.5, 3],
    decodedSampleRate: [7_999, 8_000.5, 96_001],
    calculatedDecodedPcmBytes: [0, 1.5, (160 * MiB) + 1],
    applicationMemoryContractPassed: [false],
    ownedReferencesCleared: [false],
    contextsCloseSettled: [false],
    browserHeapObserved: [true],
  };

  for (const [key, invalidValues] of Object.entries(invalidValuesByKey)) {
    for (const invalidValue of invalidValues) {
      const input = reportInput();
      const inputObject = key === 'trackBpm' ? input.trustedConfig : input.observedAssetFacts;
      inputObject[key] = invalidValue;
      assert.throws(() => createSanitizedReport(input), TypeError, `${key}: ${String(invalidValue)}`);
    }
  }
});

test('sanitized report requires exact plain scalar-only trusted and observed objects', () => {
  const cyclic = { filename: 'nested-private.mp3' };
  cyclic.self = cyclic;
  const invalidValues = [
    { filename: 'nested-private.mp3', path: '/private', uri: 'file:///private', bytes: [1], samples: [0.1] },
    cyclic,
    1n,
    () => 'private.mp3',
    Symbol('private.mp3'),
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    [1, 2, 3],
    new Uint8Array([1, 2, 3]),
    new Date(0),
    null,
  ];

  for (const [inputName, representativeKeys] of [
    ['trustedConfig', ['assetVersion', 'schemaVersion']],
    ['observedAssetFacts', ['sha256', 'compressedBytes']],
  ]) {
    for (const key of representativeKeys) {
      for (const invalidValue of invalidValues) {
        const input = reportInput();
        input[inputName][key] = invalidValue;
        assert.throws(() => createSanitizedReport(input), TypeError, `${inputName}.${key}`);
      }
    }

    for (const invalidObject of [[], new Uint8Array([1]), new Date(0), null]) {
      const input = reportInput();
      input[inputName] = invalidObject;
      assert.throws(() => createSanitizedReport(input), TypeError, inputName);
    }
  }
});

test('sanitized report rejects all extra fields rather than dropping private or file-derived data', () => {
  for (const [inputName, extras] of [
    ['trustedConfig', {
      filename: 'private.mp3',
      path: '/private/private.mp3',
      uri: 'file:///private/private.mp3',
      privateString: 'private track name',
      nested: { filename: 'private.mp3' },
    }],
    ['observedAssetFacts', {
      filename: 'private.mp3',
      path: '/private/private.mp3',
      uri: 'file:///private/private.mp3',
      bytes: new Uint8Array([1, 2, 3]),
      samples: [0.1],
      observedMimeType: 'audio/mpeg',
      observedExtension: '.mp3',
      privateString: 'private track name',
      nested: { filename: 'private.mp3' },
    }],
  ]) {
    for (const [key, value] of Object.entries(extras)) {
      const input = reportInput();
      input[inputName][key] = value;
      assert.throws(() => createSanitizedReport(input), TypeError, `${inputName}.${key}`);
    }
  }
});

test('sanitized report accepts only direct data properties at every input boundary', () => {
  for (const [inputName, key, getterValue] of [
    [null, 'targetEntryDownbeatSeconds', 2],
    ['trustedConfig', 'assetVersion', 'asset-v1'],
    ['observedAssetFacts', 'sha256', 'a'.repeat(64)],
  ]) {
    const input = reportInput();
    const target = inputName === null ? input : input[inputName];
    Object.defineProperty(target, key, { configurable: true, get: () => getterValue });
    assert.throws(() => createSanitizedReport(input), TypeError, `${inputName ?? 'input'}.${key}`);
  }
});

test('sanitized report requires a direct finite nonnegative curated downbeat and existing timing bounds', () => {
  for (const targetEntryDownbeatSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY, '2', { seconds: 2 }]) {
    const input = reportInput();
    input.targetEntryDownbeatSeconds = targetEntryDownbeatSeconds;
    assert.throws(() => createSanitizedReport(input), TypeError, String(targetEntryDownbeatSeconds));
  }

  const earlyInput = reportInput();
  earlyInput.targetEntryDownbeatSeconds = 1.999_999;
  assert.throws(() => createSanitizedReport(earlyInput), /target-downbeat-lead-in-invalid/);

  const shortInput = reportInput();
  shortInput.observedAssetFacts.decodedDurationSeconds = 5.499_999;
  shortInput.observedAssetFacts.calculatedDecodedPcmBytes = Math.round(5.499_999 * 48_000) * 2 * 4;
  assert.throws(() => createSanitizedReport(shortInput), /target-downbeat-tail-invalid/);
});

test('sanitized report requires exact PCM bytes to be consistent with decoded metadata', () => {
  for (const calculatedDecodedPcmBytes of [
    (10 * 48_000 * 2 * 4) - 1,
    9 * 48_000 * 2 * 4,
  ]) {
    const input = reportInput();
    input.observedAssetFacts.calculatedDecodedPcmBytes = calculatedDecodedPcmBytes;
    assert.throws(() => createSanitizedReport(input), TypeError, String(calculatedDecodedPcmBytes));
  }
});

test('sanitized report uses one sample frame rather than runtime identity tolerance for PCM consistency', () => {
  for (const discrepancySeconds of [2 / 48_000, 0.049]) {
    const input = reportInput();
    input.observedAssetFacts.decodedDurationSeconds += discrepancySeconds;
    assert.throws(
      () => createSanitizedReport(input),
      /calculated PCM bytes and decoded duration are inconsistent/,
      String(discrepancySeconds),
    );
  }

  const acceptedInput = reportInput();
  const floatingNoise = Number.EPSILON * acceptedInput.observedAssetFacts.decodedDurationSeconds * 2;
  acceptedInput.observedAssetFacts.decodedDurationSeconds += (1 / 48_000) + floatingNoise;
  const report = createSanitizedReport(acceptedInput);
  assert.equal(report.assetIdentity.decodedDurationToleranceSeconds, 0.050);
});

test('sanitized reports and nested identities are fresh objects', () => {
  const input = reportInput();
  const first = createSanitizedReport(input);
  const second = createSanitizedReport(input);

  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.assetIdentity, second.assetIdentity);
  assert.notStrictEqual(first.experimentConfigIdentity, second.experimentConfigIdentity);
  assert.notStrictEqual(first.assetIdentity, input.trustedConfig);
  assert.notStrictEqual(first.assetIdentity, input.observedAssetFacts);
  assert.notStrictEqual(first.experimentConfigIdentity, input.trustedConfig);
});
