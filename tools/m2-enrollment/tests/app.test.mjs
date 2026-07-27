import test from 'node:test';
import assert from 'node:assert/strict';

import { ENROLLMENT_CONFIG } from '../enrollment-config.mjs';
import {
  assembleEnrollmentConfig,
  capturePrivateFileSelection,
  createCancellationUiOutcome,
  createUiOperationGate,
  createEnrollmentWorkflow,
  createReportExport,
} from '../app.mjs';

const CONFIG_KEYS = [
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

const EXACT_CONFIG = {
  schemaVersion: 1,
  assetVersion: 'm2-island-party-v1',
  displayLabel: 'Island Party by NDA',
  allowedExtension: '.mp3',
  allowedMimeType: 'audio/mpeg',
  decodedDurationToleranceSeconds: 0.050,
  configVersion: 'm2-config-v1',
  trackBpm: 110,
  trackBpmVerified: false,
  beatsPerBar: 4,
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
};

function loadedFacts(sha256 = 'ab'.repeat(32), overrides = {}) {
  return {
    extensionMatchesConfigured: true,
    observedMimeTypeMatchesConfigured: true,
    sha256,
    compressedBytes: 4_096,
    decodedDurationSeconds: 6,
    decodedChannelCount: 2,
    decodedSampleRate: 8_000,
    calculatedDecodedPcmBytes: 6 * 8_000 * 2 * 4,
    ...overrides,
  };
}

function unloadedCycle(sha256 = 'ab'.repeat(32), overrides = {}) {
  return {
    sha256,
    unloadCompleted: true,
    contextCloseSettled: true,
    counters: {
      rawBuffers: 0,
      decodedBuffers: 0,
      contexts: 0,
      previewSources: 0,
      sourceRegistries: 0,
    },
    ...overrides,
  };
}

function approveCue(workflow) {
  workflow.acceptCue({
    targetEntryDownbeatSeconds: 2.2,
    cueAnalysis: {
      compliant: true,
      rms: 0.02,
      peak: 0.05,
      framesPerChannel: 400,
      sampleCount: 800,
      windowMilliseconds: 50,
    },
  });
}

function completeCycle(workflow, sha256 = 'ab'.repeat(32)) {
  assert.deepEqual(workflow.acceptLoadedAsset(loadedFacts(sha256)), {
    accepted: true,
    identityReset: false,
  });
  workflow.acceptPreview();
  approveCue(workflow);
  workflow.finishUnload(unloadedCycle(sha256));
}

function instrumentPrivateSelection({ size = 97_071 } = {}) {
  const privateFilename = 'medical-session-july-private.mp3';
  const accesses = [];
  let arrayBufferCalls = 0;
  const file = {
    get size() {
      accesses.push('size');
      return size;
    },
    get name() {
      accesses.push('name');
      return privateFilename;
    },
    get type() {
      accesses.push('type');
      return 'audio/mpeg';
    },
    arrayBuffer() {
      accesses.push('arrayBuffer');
      arrayBufferCalls += 1;
      return Promise.resolve(new ArrayBuffer(0));
    },
  };
  const fileInput = {
    set value(nextValue) {
      assert.equal(nextValue, '');
      accesses.push('clear');
    },
  };
  return {
    accesses,
    file,
    fileInput,
    privateFilename,
    get arrayBufferCalls() {
      return arrayBufferCalls;
    },
  };
}

test('private selection clears the picker before size preflight and other File access', () => {
  const selected = instrumentPrivateSelection();

  const observed = capturePrivateFileSelection(selected.file, selected.fileInput);

  assert.deepEqual(selected.accesses, ['clear', 'size', 'name', 'type']);
  assert.deepEqual(observed, {
    extensionMatchesConfigured: true,
    observedMimeTypeMatchesConfigured: true,
    compressedBytes: 97_071,
  });
  assert.equal(selected.arrayBufferCalls, 0);
  assert.equal(JSON.stringify(observed).includes(selected.privateFilename), false);
});

test('over-limit private selection stops after clear and size without exposing identity', () => {
  const selected = instrumentPrivateSelection({ size: (20 * 1024 * 1024) + 1 });

  let thrown;
  try {
    capturePrivateFileSelection(selected.file, selected.fileInput);
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown instanceof TypeError, true);
  assert.deepEqual(selected.accesses, ['clear', 'size']);
  assert.equal(selected.arrayBufferCalls, 0);
  assert.equal(String(thrown).includes(selected.privateFilename), false);
  assert.equal(thrown.message.includes(selected.privateFilename), false);
  assert.equal(thrown.stack?.includes(selected.privateFilename) ?? false, false);
});

test('UI operation gate rejects stale settlements and finishes only the current owner', () => {
  const requests = createUiOperationGate();
  const firstLoad = requests.begin();

  assert.equal(requests.isCurrent(firstLoad), true);
  requests.invalidate();
  assert.equal(requests.isCurrent(firstLoad), false);

  const replacementLoad = requests.begin();
  assert.equal(requests.isCurrent(replacementLoad), true);
  assert.equal(requests.finish(firstLoad), false);
  assert.equal(requests.finish(replacementLoad), true);
  assert.equal(requests.isCurrent(replacementLoad), false);

  const foregroundLoad = requests.begin();
  requests.invalidate();
  assert.equal(requests.finish(foregroundLoad), false);
  assert.equal(requests.isCurrent(firstLoad), false);
});

test('cancellation UI claims cleared ownership only for successful controller teardown', () => {
  const clean = createCancellationUiOutcome({
    ok: true,
    cycle: {
      unloadCompleted: true,
      contextCloseSettled: true,
      counters: {
        rawBuffers: 0,
        decodedBuffers: 0,
        contexts: 0,
        previewSources: 0,
        sourceRegistries: 0,
      },
    },
  });
  assert.deepEqual(clean, {
    clean: true,
    status: 'Load cancelled. Application-owned references were cleared.',
  });
  assert.equal(Object.isFrozen(clean), true);

  for (const failed of [
    { ok: false, recovery: 'reload', cycle: { unloadCompleted: false } },
    { ok: true, cycle: { unloadCompleted: true, contextCloseSettled: false, counters: {} } },
    {
      ok: true,
      cycle: {
        unloadCompleted: true,
        contextCloseSettled: true,
        counters: {
          rawBuffers: 0,
          decodedBuffers: 0,
          contexts: 1,
          previewSources: 0,
          sourceRegistries: 1,
        },
      },
    },
    null,
    {},
  ]) {
    const outcome = createCancellationUiOutcome(failed);
    assert.deepEqual(outcome, {
      clean: false,
      status: 'Cancellation did not prove clean application teardown. Reload before continuing.',
    });
    assert.equal(Object.isFrozen(outcome), true);
  }
});

test('static enrollment config is the exact frozen approved candidate', () => {
  assert.deepEqual(Object.keys(ENROLLMENT_CONFIG), CONFIG_KEYS);
  assert.deepEqual(ENROLLMENT_CONFIG, EXACT_CONFIG);
  assert.equal(Object.isFrozen(ENROLLMENT_CONFIG), true);
});

test('assembly accepts only the direct static config and explicit false to true BPM confirmation', () => {
  const confirmed = assembleEnrollmentConfig(ENROLLMENT_CONFIG, { trackBpmVerified: true });

  assert.equal(Object.isFrozen(confirmed), true);
  assert.deepEqual(Object.keys(confirmed), CONFIG_KEYS);
  for (const key of CONFIG_KEYS) {
    if (key === 'trackBpmVerified') {
      assert.equal(confirmed[key], true);
    } else {
      assert.strictEqual(confirmed[key], ENROLLMENT_CONFIG[key], key);
    }
  }

  for (const override of [
    {},
    { trackBpmVerified: false },
    { trackBpmVerified: true, trackBpm: 111 },
    { trackBpmVerified: true, name: 'private.mp3' },
    { trackBpmVerified: true, type: 'audio/mpeg' },
    { trackBpmVerified: true, path: '/private/audio.mp3' },
    { trackBpmVerified: true, uri: 'file:///private/audio.mp3' },
    { trackBpmVerified: true, url: 'blob:private' },
    { trackBpmVerified: true, file: { name: 'private.mp3' } },
  ]) {
    assert.throws(() => assembleEnrollmentConfig(ENROLLMENT_CONFIG, override), TypeError);
  }
  assert.throws(
    () => assembleEnrollmentConfig(Object.freeze({ ...ENROLLMENT_CONFIG }), { trackBpmVerified: true }),
    TypeError,
  );
});

test('each cycle requires its own successful preview and cue before clean unload', () => {
  const workflow = createEnrollmentWorkflow();
  assert.deepEqual(workflow.acceptLoadedAsset(loadedFacts()), {
    accepted: true,
    identityReset: false,
  });
  assert.equal(workflow.snapshot().previewConfirmed, false);
  assert.equal(workflow.snapshot().cueConfirmed, false);
  assert.throws(() => approveCue(workflow), /preview/);
  assert.throws(() => workflow.finishUnload(unloadedCycle()), /preview/);

  workflow.acceptPreview();
  assert.equal(workflow.snapshot().previewConfirmed, true);
  assert.throws(() => workflow.finishUnload(unloadedCycle()), /cue/);
  approveCue(workflow);
  workflow.finishUnload(unloadedCycle());
  assert.equal(workflow.snapshot().completedUnloadCycles, 1);
  assert.equal(workflow.snapshot().previewConfirmed, false);
  assert.equal(workflow.snapshot().cueConfirmed, false);

  assert.deepEqual(workflow.acceptLoadedAsset(loadedFacts()), {
    accepted: true,
    identityReset: false,
  });
  assert.throws(() => workflow.finishUnload(unloadedCycle()), /preview/);
  workflow.acceptPreview();
  approveCue(workflow);
  workflow.finishUnload(unloadedCycle());
  assert.equal(workflow.snapshot().completedUnloadCycles, 2);
});

test('report stays unavailable until two matching clean unload cycles and explicit BPM confirmation', () => {
  const workflow = createEnrollmentWorkflow();

  completeCycle(workflow);
  assert.deepEqual(workflow.snapshot(), {
    completedUnloadCycles: 1,
    bpmConfirmed: false,
    previewConfirmed: false,
    cueConfirmed: false,
    loadActive: false,
    reportReady: false,
    identityReset: false,
  });
  assert.equal(workflow.report(), null);

  completeCycle(workflow);
  assert.equal(workflow.snapshot().completedUnloadCycles, 2);
  assert.equal(workflow.snapshot().reportReady, false);
  assert.equal(workflow.report(), null);

  workflow.confirmConfiguredBpm(true);
  const report = workflow.report();
  assert.equal(workflow.snapshot().reportReady, true);
  assert.equal(report.assetIdentity.sha256, 'ab'.repeat(32));
  assert.equal(report.assetIdentity.applicationMemoryContractPassed, true);
  assert.equal(report.assetIdentity.ownedReferencesCleared, true);
  assert.equal(report.assetIdentity.contextsCloseSettled, true);
  assert.equal(report.assetIdentity.browserHeapObserved, false);
  assert.equal(report.experimentConfigIdentity.trackBpm, ENROLLMENT_CONFIG.trackBpm);
  assert.equal(report.experimentConfigIdentity.targetEntryDownbeatSeconds, 2.2);
  assert.equal(Object.hasOwn(report.experimentConfigIdentity, 'trackBpmVerified'), false);
});

test('cycle two SHA mismatch resets enrollment instead of merging identities', () => {
  const workflow = createEnrollmentWorkflow();
  workflow.confirmConfiguredBpm(true);
  completeCycle(workflow, 'ab'.repeat(32));

  assert.deepEqual(workflow.acceptLoadedAsset(loadedFacts('cd'.repeat(32))), {
    accepted: false,
    identityReset: true,
  });
  assert.deepEqual(workflow.snapshot(), {
    completedUnloadCycles: 0,
    bpmConfirmed: false,
    previewConfirmed: false,
    cueConfirmed: false,
    loadActive: false,
    reportReady: false,
    identityReset: true,
  });
  assert.equal(workflow.report(), null);
  assert.throws(() => workflow.finishUnload(unloadedCycle('cd'.repeat(32))), TypeError);
});

test('workflow rejects private strings, extra facts, weak cleanup, and unconfirmed cue data', () => {
  for (const extra of [
    { name: 'private.mp3' },
    { type: 'audio/mpeg' },
    { path: '/private/audio.mp3' },
    { uri: 'file:///private/audio.mp3' },
    { bytes: new Uint8Array([1, 2, 3]) },
  ]) {
    const workflow = createEnrollmentWorkflow();
    assert.throws(() => workflow.acceptLoadedAsset(loadedFacts('ab'.repeat(32), extra)), TypeError);
  }

  const workflow = createEnrollmentWorkflow();
  assert.deepEqual(workflow.acceptLoadedAsset(loadedFacts()), {
    accepted: true,
    identityReset: false,
  });
  workflow.acceptPreview();
  approveCue(workflow);
  assert.throws(() => workflow.finishUnload(unloadedCycle('ab'.repeat(32), {
    counters: {
      rawBuffers: 0,
      decodedBuffers: 1,
      contexts: 0,
      previewSources: 0,
      sourceRegistries: 0,
    },
  })), TypeError);
  assert.throws(() => workflow.acceptCue({
    targetEntryDownbeatSeconds: 2.2,
    cueAnalysis: { compliant: false },
  }), TypeError);
});

test('copy and data URL download export only the closed recursive report schema', () => {
  const workflow = createEnrollmentWorkflow();
  workflow.confirmConfiguredBpm(true);
  completeCycle(workflow);
  completeCycle(workflow);

  const exported = createReportExport(workflow.report());
  const parsed = JSON.parse(exported.json);
  const decodedDownload = decodeURIComponent(exported.dataUrl.split(',', 2)[1]);

  assert.deepEqual(Object.keys(exported), ['json', 'dataUrl', 'downloadName']);
  assert.equal(exported.dataUrl.startsWith('data:application/json;charset=utf-8,'), true);
  assert.equal(exported.downloadName, 'm2-enrollment-report.json');
  assert.equal(decodedDownload, exported.json);
  assert.deepEqual(Object.keys(parsed), ['assetIdentity', 'experimentConfigIdentity']);
  assert.deepEqual(Object.keys(parsed.assetIdentity), [
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
  assert.deepEqual(Object.keys(parsed.experimentConfigIdentity), [
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
  for (const privateNeedle of [
    'private.mp3',
    '/private/',
    'file://',
    'blob:',
    'filename',
    'rawbytes',
    'private_byte_sentinel',
    'samples',
  ]) {
    assert.equal(exported.json.toLowerCase().includes(privateNeedle), false, privateNeedle);
  }
});
