import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRACK_METADATA,
  TRACK_METADATA_KEYS,
  assertClosedTrackMetadata,
} from '../src/track-metadata.mjs';
import {
  ASSET_IDENTITY,
  ASSET_IDENTITY_KEYS,
  EXPERIMENT_CONFIG_IDENTITY,
  EXPERIMENT_CONFIG_IDENTITY_KEYS,
  ONE_TRACK_CONFIG,
  ONE_TRACK_CONFIG_KEYS,
  ONE_TRACK_CONTRACT,
  assertClosedOneTrackConfig,
} from '../src/config.mjs';

const METADATA = {
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
};

const CONFIG = {
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

function assertRecursivelyFrozen(value) {
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') {
      assertRecursivelyFrozen(child);
    }
  }
}

test('T1-CONFIG-CLOSED locks the sanitized fixture and experiment identities', () => {
  assert.deepEqual(TRACK_METADATA_KEYS, Object.keys(METADATA));
  assert.deepEqual(Object.keys(TRACK_METADATA), TRACK_METADATA_KEYS);
  assert.deepEqual(TRACK_METADATA, METADATA);
  assert.equal(
    TRACK_METADATA.decodedFrameCount * TRACK_METADATA.decodedChannelCount * 4,
    TRACK_METADATA.calculatedDecodedPcmBytes,
  );

  assert.deepEqual(ONE_TRACK_CONFIG_KEYS, Object.keys(CONFIG));
  assert.deepEqual(Object.keys(ONE_TRACK_CONFIG), ONE_TRACK_CONFIG_KEYS);
  assert.deepEqual(ONE_TRACK_CONFIG, CONFIG);

  assert.deepEqual(ASSET_IDENTITY_KEYS, [
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
  assert.deepEqual(Object.keys(ASSET_IDENTITY), ASSET_IDENTITY_KEYS);
  assert.deepEqual(ASSET_IDENTITY, Object.fromEntries(
    ASSET_IDENTITY_KEYS.map((key) => [key, METADATA[key]]),
  ));

  assert.deepEqual(EXPERIMENT_CONFIG_IDENTITY_KEYS, [
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
  assert.deepEqual(EXPERIMENT_CONFIG_IDENTITY, {
    configVersion: 'm2-config-v1',
    trackBpm: 110,
    beatsPerBar: 4,
    targetEntryDownbeatSeconds: 17.579,
    leadInBeats: 4,
    minimumPostCrossfadeTailSeconds: 2,
    percussionRecipeId: 'kick-snare-v1',
    percussionTrimGain: 0.25,
    trackTrimGain: 0.50,
    masterGain: 0.70,
    bpmMatchWindow: 3.0,
    intervalOutlierFraction: 0.20,
    stabilityCvLimit: 0.05,
    reconciliationToleranceMs: 60,
    silenceTimeoutFormula: 'clamp-1.5x-median-900-1800-v1',
    crossfadeStartBeat: 4,
    targetDownbeatBeat: 5,
    crossfadeEndBeat: 8,
    crossfadeSampleCount: 128,
    crossfadeCurveId: 'equal-power-sin-cos-v1',
  });
  assert.deepEqual(ONE_TRACK_CONTRACT, {
    assetIdentity: ASSET_IDENTITY,
    experimentConfigIdentity: EXPERIMENT_CONFIG_IDENTITY,
  });
  assertRecursivelyFrozen(ONE_TRACK_CONTRACT);

  assert.equal(assertClosedTrackMetadata({ ...METADATA }), true);
  assert.equal(assertClosedOneTrackConfig({ ...CONFIG }), true);
  assert.throws(
    () => assertClosedTrackMetadata({ ...METADATA, selectedFilename: 'private.mp3' }),
    /closed key set/,
  );
  assert.throws(
    () => assertClosedOneTrackConfig({ ...CONFIG, runtimeOverride: true }),
    /closed key set/,
  );
  assert.throws(
    () => assertClosedTrackMetadata({ ...METADATA, decodedDurationSeconds: Number.NaN }),
    /decodedDurationSeconds/,
  );
  assert.throws(
    () => assertClosedOneTrackConfig({ ...CONFIG, trackBpm: Number.POSITIVE_INFINITY }),
    /trackBpm/,
  );

  assert.throws(() => {
    ONE_TRACK_CONFIG.trackBpm = 120;
  }, TypeError);
  assert.equal(ONE_TRACK_CONFIG.trackBpm, 110);
});

test('T1-RUN-CONTEXT derives and advances only the fixed seven-run protocol', async () => {
  let runContext;
  try {
    runContext = await import('../src/core/run-context.mjs');
  } catch {
    assert.fail('run-context parser behavior must exist before file selection');
  }
  assert.equal(typeof runContext.parseRunQuery, 'function');
  assert.equal(typeof runContext.freezeColdContextAtFirstAcceptedTap, 'function');
  assert.equal(typeof runContext.advanceRunContext, 'function');

  const scoredCases = [
    ['session-1', 1, 'CENTER', 2, 'LOW_EDGE'],
    ['session-2', 3, 'HIGH_EDGE', 4, 'CENTER'],
    ['session-3', 5, 'LOW_EDGE', 6, 'HIGH_EDGE'],
    ['session-4', 7, 'CENTER', 8, 'LOW_EDGE'],
    ['session-5', 9, 'HIGH_EDGE', 10, 'CENTER'],
  ];
  for (const [session, coldSlot, coldClass, warmedSlot, warmedClass] of scoredCases) {
    const cold = runContext.parseRunQuery(`?run=${session}`);
    assert.deepEqual(cold, {
      runValue: session,
      session,
      slot: coldSlot,
      thermalState: 'cold',
      assignedClass: coldClass,
      recordKind: 'scored',
      cancellationPhase: null,
      scored: true,
      contextFrozenAtFirstAcceptedTap: false,
    });
    assert.equal(Object.isFrozen(cold), true);
    assert.throws(
      () => runContext.advanceRunContext(cold, {
        evidenceResolved: true,
        downloadGesture: true,
        reset: true,
      }),
      /first accepted tap/,
    );

    const frozen = runContext.freezeColdContextAtFirstAcceptedTap(cold);
    assert.notEqual(frozen, cold);
    assert.equal(cold.contextFrozenAtFirstAcceptedTap, false);
    assert.equal(frozen.contextFrozenAtFirstAcceptedTap, true);
    assert.equal(Object.isFrozen(frozen), true);

    for (const incompleteGate of [
      {},
      { evidenceResolved: true, downloadGesture: true, reset: false },
      { evidenceResolved: true, downloadGesture: false, reset: true },
      { evidenceResolved: false, downloadGesture: true, reset: true },
    ]) {
      assert.throws(
        () => runContext.advanceRunContext(frozen, incompleteGate),
        /resolved cold evidence, explicit download gesture, and Reset/,
      );
    }

    const warmed = runContext.advanceRunContext(frozen, {
      evidenceResolved: true,
      downloadGesture: true,
      reset: true,
    });
    assert.deepEqual(warmed, {
      runValue: session,
      session,
      slot: warmedSlot,
      thermalState: 'warmed',
      assignedClass: warmedClass,
      recordKind: 'scored',
      cancellationPhase: null,
      scored: true,
      contextFrozenAtFirstAcceptedTap: false,
    });
    assert.equal(Object.isFrozen(warmed), true);
    assert.throws(
      () => runContext.advanceRunContext(warmed, {
        evidenceResolved: true,
        downloadGesture: true,
        reset: true,
      }),
      /cold scored context/,
    );
  }

  for (const [runValue, cancellationPhase] of [
    ['smoke-crossfade', 'crossfade'],
    ['smoke-playing', 'playing'],
  ]) {
    const smoke = runContext.parseRunQuery(`?run=${runValue}`);
    assert.deepEqual(smoke, {
      runValue,
      session: runValue,
      slot: null,
      thermalState: 'smoke',
      assignedClass: null,
      recordKind: 'smoke',
      cancellationPhase,
      scored: false,
      contextFrozenAtFirstAcceptedTap: false,
    });
    assert.throws(
      () => runContext.advanceRunContext(smoke, {
        evidenceResolved: true,
        downloadGesture: true,
        reset: true,
      }),
      /cold scored context/,
    );
  }

  for (const invalidQuery of [
    '',
    '?other=session-1',
    '?run=',
    '?run=session-1&run=session-2',
    '?run=session-1&other=value',
    '?run=session_1',
    '?run=session%2D1',
    '?run=session-6',
    '?run=smoke-ready',
  ]) {
    assert.throws(() => runContext.parseRunQuery(invalidQuery), /invalid run query/);
  }
});

test('T1-BUILD-IDENTITY rejects placeholder, malformed, and mixed runtime identities', async () => {
  let identity;
  try {
    identity = await import('../src/build-identity.mjs');
  } catch {
    assert.fail('build identity assertion behavior must exist before file selection');
  }

  const source = await (await import('node:fs/promises')).readFile(
    new URL('../src/build-identity.mjs', import.meta.url),
    'utf8',
  );
  assert.equal(
    source.split('\n').filter((line) => line === "export const BUILD_SHA = '__BUILD_SHA__';").length,
    1,
  );
  assert.equal(identity.BUILD_SHA, '__BUILD_SHA__');

  const deployingSha = '0123456789abcdef0123456789abcdef01234567';
  const otherSha = '89abcdef0123456789abcdef0123456789abcdef';
  assert.equal(
    identity.assertMatchingBuildIdentity(deployingSha, deployingSha),
    deployingSha,
  );
  for (const malformed of [
    '__BUILD_SHA__',
    '',
    '0123456789abcdef0123456789abcdef0123456',
    '0123456789ABCDEF0123456789ABCDEF01234567',
    `${deployingSha}0`,
    null,
  ]) {
    assert.throws(
      () => identity.assertMatchingBuildIdentity(deployingSha, malformed),
      /40-character lowercase commit SHA/,
    );
  }
  assert.throws(
    () => identity.assertMatchingBuildIdentity('__BUILD_SHA__', deployingSha),
    /40-character lowercase commit SHA/,
  );
  assert.throws(
    () => identity.assertMatchingBuildIdentity(deployingSha, otherSha),
    /mixed build identity/,
  );
  assert.throws(
    () => identity.assertBuildIdentity(deployingSha),
    /40-character lowercase commit SHA/,
  );

  for (const relativePath of [
    '../src/track-metadata.mjs',
    '../src/config.mjs',
    '../src/core/run-context.mjs',
  ]) {
    const runtimeModule = await import(relativePath);
    assert.equal(typeof runtimeModule.assertLocalBuildIdentity, 'function');
    assert.throws(
      () => runtimeModule.assertLocalBuildIdentity(),
      /40-character lowercase commit SHA/,
    );
  }
});
