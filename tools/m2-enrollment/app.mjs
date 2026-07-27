import { ENROLLMENT_CONFIG } from './enrollment-config.mjs';
import { createEnrollmentBrowserController } from './enrollment-browser.mjs';
import {
  createApplicationMemoryEvidence,
  evaluateApplicationMemoryContract,
} from './enrollment-lifecycle.mjs';
import { preflightCompressedBytes } from './enrollment-measurements.mjs';
import {
  createSanitizedReport,
  serializeSanitizedReport,
} from './enrollment-report.mjs';

const CONFIG_KEYS = Object.freeze(Object.keys(ENROLLMENT_CONFIG));
const LOADED_FACT_KEYS = Object.freeze([
  'extensionMatchesConfigured',
  'observedMimeTypeMatchesConfigured',
  'sha256',
  'compressedBytes',
  'decodedDurationSeconds',
  'decodedChannelCount',
  'decodedSampleRate',
  'calculatedDecodedPcmBytes',
]);
const CYCLE_KEYS = Object.freeze([
  'sha256',
  'unloadCompleted',
  'contextCloseSettled',
  'counters',
]);
const COUNTER_KEYS = Object.freeze([
  'rawBuffers',
  'decodedBuffers',
  'contexts',
  'previewSources',
  'sourceRegistries',
]);
const CUE_INPUT_KEYS = Object.freeze(['targetEntryDownbeatSeconds', 'cueAnalysis']);
const CUE_ANALYSIS_KEYS = Object.freeze([
  'compliant',
  'rms',
  'peak',
  'framesPerChannel',
  'sampleCount',
  'windowMilliseconds',
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function requireExactPlainDataObject(value, keys, label) {
  if (value === null
      || typeof value !== 'object'
      || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length
      || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    throw new TypeError(`${label} must contain exactly the approved keys`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    if (!Object.hasOwn(descriptors[key], 'value')) {
      throw new TypeError(`${label}.${key} must be a direct data property`);
    }
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function requireFiniteNumber(value, label, { integer = false, minimum = 0 } = {}) {
  if (!Number.isFinite(value)
      || value < minimum
      || (integer && !Number.isSafeInteger(value))) {
    throw new TypeError(`${label} must be a finite approved number`);
  }
}

function snapshotLoadedFacts(value) {
  const facts = requireExactPlainDataObject(value, LOADED_FACT_KEYS, 'loaded asset facts');
  if (facts.extensionMatchesConfigured !== true
      || facts.observedMimeTypeMatchesConfigured !== true
      || typeof facts.sha256 !== 'string'
      || !SHA256_PATTERN.test(facts.sha256)) {
    throw new TypeError('loaded asset identity is invalid');
  }
  requireFiniteNumber(facts.compressedBytes, 'compressedBytes', { integer: true });
  requireFiniteNumber(facts.decodedDurationSeconds, 'decodedDurationSeconds');
  requireFiniteNumber(facts.decodedChannelCount, 'decodedChannelCount', { integer: true });
  requireFiniteNumber(facts.decodedSampleRate, 'decodedSampleRate', { integer: true });
  requireFiniteNumber(facts.calculatedDecodedPcmBytes, 'calculatedDecodedPcmBytes', { integer: true });
  return Object.freeze({ ...facts });
}

function snapshotCleanCycle(value, expectedSha256) {
  const cycle = requireExactPlainDataObject(value, CYCLE_KEYS, 'unload cycle');
  if (cycle.sha256 !== expectedSha256
      || cycle.unloadCompleted !== true
      || cycle.contextCloseSettled !== true) {
    throw new TypeError('unload cycle did not cleanly settle for the loaded identity');
  }
  const counters = requireExactPlainDataObject(cycle.counters, COUNTER_KEYS, 'unload counters');
  for (const key of COUNTER_KEYS) {
    if (counters[key] !== 0) throw new TypeError(`unload counter ${key} must be zero`);
  }
  return Object.freeze({
    sha256: cycle.sha256,
    unloadCompleted: true,
    contextCloseSettled: true,
    counters: Object.freeze({ ...counters }),
  });
}

function snapshotApprovedCue(value) {
  const input = requireExactPlainDataObject(value, CUE_INPUT_KEYS, 'cue input');
  const cue = requireExactPlainDataObject(input.cueAnalysis, CUE_ANALYSIS_KEYS, 'cue analysis');
  requireFiniteNumber(input.targetEntryDownbeatSeconds, 'targetEntryDownbeatSeconds');
  if (cue.compliant !== true) throw new TypeError('cue analysis must be compliant');
  for (const key of CUE_ANALYSIS_KEYS.filter((key) => key !== 'compliant')) {
    requireFiniteNumber(cue[key], `cue analysis ${key}`);
  }
  return input.targetEntryDownbeatSeconds;
}

export function assembleEnrollmentConfig(trustedConfig, override) {
  if (trustedConfig !== ENROLLMENT_CONFIG) {
    throw new TypeError('trustedConfig must be the statically imported enrollment config');
  }
  const confirmed = requireExactPlainDataObject(
    override,
    Object.freeze(['trackBpmVerified']),
    'config override',
  );
  if (ENROLLMENT_CONFIG.trackBpmVerified !== false || confirmed.trackBpmVerified !== true) {
    throw new TypeError('only explicit BPM confirmation is accepted');
  }
  const assembled = Object.fromEntries(CONFIG_KEYS.map((key) => [
    key,
    key === 'trackBpmVerified' ? true : ENROLLMENT_CONFIG[key],
  ]));
  return Object.freeze(assembled);
}

export function createEnrollmentWorkflow() {
  let cycles = [];
  let activeFacts = null;
  let enrolledFacts = null;
  let confirmedConfig = null;
  let targetEntryDownbeatSeconds = null;
  let finalReport = null;
  let identityReset = false;

  function resetForMismatch() {
    cycles = [];
    activeFacts = null;
    enrolledFacts = null;
    confirmedConfig = null;
    targetEntryDownbeatSeconds = null;
    finalReport = null;
    identityReset = true;
  }

  function tryBuildReport() {
    finalReport = null;
    if (cycles.length !== 2
        || confirmedConfig === null
        || targetEntryDownbeatSeconds === null
        || enrolledFacts === null) {
      return;
    }
    const memory = evaluateApplicationMemoryContract(createApplicationMemoryEvidence(cycles));
    if (!memory.applicationMemoryContractPassed) {
      throw new TypeError('application memory contract did not pass');
    }
    finalReport = createSanitizedReport({
      trustedConfig: confirmedConfig,
      observedAssetFacts: {
        ...enrolledFacts,
        applicationMemoryContractPassed: memory.applicationMemoryContractPassed,
        ownedReferencesCleared: memory.ownedReferencesCleared,
        contextsCloseSettled: memory.contextsCloseSettled,
        browserHeapObserved: memory.browserHeapObserved,
      },
      targetEntryDownbeatSeconds,
    });
  }

  function acceptLoadedAsset(value) {
    if (activeFacts !== null || cycles.length >= 2) {
      throw new TypeError('a load is already active or enrollment is complete');
    }
    const facts = snapshotLoadedFacts(value);
    if (cycles.length === 1 && cycles[0].sha256 !== facts.sha256) {
      resetForMismatch();
      return Object.freeze({ accepted: false, identityReset: true });
    }
    activeFacts = facts;
    identityReset = false;
    return Object.freeze({ accepted: true, identityReset: false });
  }

  function acceptCue(value) {
    targetEntryDownbeatSeconds = snapshotApprovedCue(value);
    tryBuildReport();
  }

  function confirmConfiguredBpm(value) {
    if (typeof value !== 'boolean') throw new TypeError('BPM confirmation must be boolean');
    confirmedConfig = value
      ? assembleEnrollmentConfig(ENROLLMENT_CONFIG, { trackBpmVerified: true })
      : null;
    tryBuildReport();
  }

  function finishUnload(value) {
    if (activeFacts === null) throw new TypeError('no accepted load is active');
    const cycle = snapshotCleanCycle(value, activeFacts.sha256);
    if (cycles.length === 0) enrolledFacts = activeFacts;
    cycles = [...cycles, cycle];
    activeFacts = null;
    identityReset = false;
    tryBuildReport();
  }

  function snapshot() {
    return Object.freeze({
      completedUnloadCycles: cycles.length,
      bpmConfirmed: confirmedConfig !== null,
      cueConfirmed: targetEntryDownbeatSeconds !== null,
      loadActive: activeFacts !== null,
      reportReady: finalReport !== null,
      identityReset,
    });
  }

  return Object.freeze({
    acceptCue,
    acceptLoadedAsset,
    confirmConfiguredBpm,
    finishUnload,
    report: () => finalReport,
    snapshot,
  });
}

export function createReportExport(report) {
  const json = serializeSanitizedReport(report);
  return Object.freeze({
    json,
    dataUrl: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`,
    downloadName: 'm2-enrollment-report.json',
  });
}

export function capturePrivateFileSelection(file, fileInput) {
  try {
    fileInput.value = '';
  } catch {
    throw new TypeError('private file input could not be cleared');
  }

  let compressedBytes;
  try {
    compressedBytes = file.size;
  } catch {
    throw new TypeError('private file size could not be inspected');
  }
  if (!preflightCompressedBytes(compressedBytes).ok) {
    throw new TypeError('private file size is outside the approved limit');
  }

  let selectedName;
  let observedMimeTypeMatchesConfigured;
  try {
    selectedName = file.name;
    observedMimeTypeMatchesConfigured = file.type === ENROLLMENT_CONFIG.allowedMimeType;
  } catch {
    throw new TypeError('private file metadata could not be inspected');
  }
  const extensionMatchesConfigured = typeof selectedName === 'string'
    && selectedName.toLowerCase().endsWith(ENROLLMENT_CONFIG.allowedExtension);
  return Object.freeze({
    extensionMatchesConfigured,
    observedMimeTypeMatchesConfigured,
    compressedBytes,
  });
}

export function createUiOperationGate() {
  let currentRequest = null;
  return Object.freeze({
    begin() {
      currentRequest = Object.freeze(Object.create(null));
      return currentRequest;
    },
    invalidate() {
      currentRequest = null;
    },
    isCurrent(request) {
      return request !== null && request === currentRequest;
    },
    finish(request) {
      if (request === null || request !== currentRequest) return false;
      currentRequest = null;
      return true;
    },
  });
}

const APPLICATION_COUNTER_KEYS = Object.freeze([
  'rawBuffers',
  'decodedBuffers',
  'contexts',
  'previewSources',
  'sourceRegistries',
]);

export function isCleanApplicationTeardownResult(result) {
  try {
    return result?.ok === true
      && result.cycle?.unloadCompleted === true
      && result.cycle?.contextCloseSettled === true
      && APPLICATION_COUNTER_KEYS.every((key) => result.cycle.counters?.[key] === 0);
  } catch {
    return false;
  }
}

export function createCancellationUiOutcome(result) {
  const clean = isCleanApplicationTeardownResult(result);
  return Object.freeze({
    clean,
    status: clean
      ? 'Load cancelled. Application-owned references were cleared.'
      : 'Cancellation did not prove clean application teardown. Reload before continuing.',
  });
}

function element(documentValue, id) {
  const value = documentValue.getElementById(id);
  if (value === null) throw new TypeError(`required UI control is missing: ${id}`);
  return value;
}

export function main(documentValue = document) {
  const status = element(documentValue, 'status');
  const controls = {
    file: element(documentValue, 'track-file'),
    cancel: element(documentValue, 'cancel-load'),
    downbeat: element(documentValue, 'downbeat-seconds'),
    play: element(documentValue, 'play-preview'),
    stop: element(documentValue, 'stop-preview'),
    useTime: element(documentValue, 'use-preview-time'),
    analyze: element(documentValue, 'analyze-cue'),
    bpm: element(documentValue, 'confirm-bpm'),
    unload: element(documentValue, 'unload-track'),
    copy: element(documentValue, 'copy-report'),
    download: element(documentValue, 'download-report'),
    report: element(documentValue, 'report-output'),
    cycleCount: element(documentValue, 'cycle-count'),
  };

  if (window.top !== window.self) {
    for (const control of documentValue.querySelectorAll('input, button')) control.disabled = true;
    controls.report.textContent = 'Enrollment is unavailable in a frame.';
    status.textContent = 'Open this utility as a top-level page.';
    return null;
  }

  const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (typeof AudioContextConstructor !== 'function'
      || globalThis.crypto?.subtle?.digest === undefined) {
    for (const control of documentValue.querySelectorAll('input, button')) control.disabled = true;
    status.textContent = 'This browser does not provide the required local audio features.';
    return null;
  }

  const workflow = createEnrollmentWorkflow();
  const controller = createEnrollmentBrowserController({
    allowedMimeType: ENROLLMENT_CONFIG.allowedMimeType,
    digest: globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle),
    createAudioContext: () => new AudioContextConstructor(),
  });
  let loading = false;
  let teardownPending = false;
  let previewPending = false;
  let exportPending = false;
  let loadedReady = false;
  let previewRunning = false;
  let reportExport = null;
  let interactionLocked = false;
  const uiOperations = createUiOperationGate();

  function setStatus(message) {
    status.textContent = message;
  }

  function render() {
    const model = workflow.snapshot();
    const operationPending = teardownPending || previewPending || exportPending;
    reportExport = model.reportReady ? createReportExport(workflow.report()) : null;
    controls.file.disabled = loading || operationPending || loadedReady || model.completedUnloadCycles >= 2;
    controls.cancel.disabled = !loading;
    controls.downbeat.disabled = !loadedReady || operationPending;
    controls.play.disabled = !loadedReady || previewRunning || operationPending;
    controls.stop.disabled = !loadedReady || !previewRunning || operationPending;
    controls.useTime.disabled = !loadedReady || !previewRunning || operationPending;
    controls.analyze.disabled = !loadedReady || operationPending;
    controls.bpm.disabled = operationPending;
    controls.unload.disabled = !loadedReady || !model.cueConfirmed || operationPending;
    controls.copy.disabled = reportExport === null || operationPending;
    controls.download.disabled = reportExport === null || operationPending;
    controls.cycleCount.textContent = `Completed unload cycles: ${model.completedUnloadCycles} of 2`;
    controls.report.textContent = reportExport === null ? 'Report locked.' : reportExport.json;
    if (interactionLocked) {
      for (const control of documentValue.querySelectorAll('input, button')) control.disabled = true;
    }
  }

  controls.file.addEventListener('change', async () => {
    const file = controls.file.files?.[0];
    if (file === undefined) {
      setStatus('No file was selected. Nothing was loaded.');
      return;
    }

    let observed;
    try {
      observed = capturePrivateFileSelection(file, controls.file);
    } catch {
      setStatus('The selected file metadata could not be checked. Stop and report this device behavior.');
      return;
    }
    if (!observed.extensionMatchesConfigured) {
      controls.file.value = '';
      setStatus('The selected file does not use the configured MP3 extension. Enrollment stopped.');
      return;
    }

    const loadRequest = uiOperations.begin();
    loading = true;
    render();
    setStatus('Loading, hashing, and decoding locally.');
    try {
      const loaded = await controller.load({ file, fileInput: controls.file });
      if (!uiOperations.isCurrent(loadRequest)) return;
      const acceptance = workflow.acceptLoadedAsset({
        extensionMatchesConfigured: observed.extensionMatchesConfigured,
        observedMimeTypeMatchesConfigured: observed.observedMimeTypeMatchesConfigured,
        sha256: loaded.sha256,
        compressedBytes: observed.compressedBytes,
        decodedDurationSeconds: loaded.decoded.durationSeconds,
        decodedChannelCount: loaded.decoded.channelCount,
        decodedSampleRate: loaded.decoded.sampleRate,
        calculatedDecodedPcmBytes: loaded.decoded.calculatedDecodedPcmBytes,
      });
      if (!acceptance.accepted) {
        loading = false;
        teardownPending = true;
        render();
        setStatus('The second SHA-256 did not match. Resetting and unloading locally.');
        let mismatchTeardown = null;
        try {
          mismatchTeardown = await controller.unload();
        } catch {
          // The outcome below remains reload-only.
        }
        if (!uiOperations.finish(loadRequest)) return;
        teardownPending = false;
        loadedReady = false;
        previewRunning = false;
        controls.bpm.checked = false;
        const clean = isCleanApplicationTeardownResult(mismatchTeardown);
        interactionLocked = !clean;
        render();
        setStatus(clean
          ? 'The second selection did not match the first SHA-256. Enrollment was reset.'
          : 'The mismatched selection could not be cleanly unloaded. Reload before continuing.');
        return;
      }
      if (!uiOperations.finish(loadRequest)) return;
      loading = false;
      loadedReady = true;
      render();
      setStatus('Track ready. Preview and analyze the target downbeat.');
    } catch {
      if (!uiOperations.finish(loadRequest)) return;
      loading = false;
      teardownPending = false;
      loadedReady = false;
      let replacementAllowed = false;
      try {
        replacementAllowed = controller.snapshot().replacementAllowed === true;
      } catch {
        // A missing safe snapshot is reload-only.
      }
      interactionLocked = !replacementAllowed;
      if (!replacementAllowed) void controller.handleForegroundLoss();
      render();
      if (!replacementAllowed) {
        setStatus('The local load failed and clean teardown was not proven. Reload before continuing.');
      } else if (!observed.observedMimeTypeMatchesConfigured) {
        setStatus('Chrome did not report audio/mpeg. Enrollment stopped. Do not guess the file type.');
      } else {
        setStatus('The local load did not complete. No report data was accepted.');
      }
    }
  });

  controls.cancel.addEventListener('click', async () => {
    if (!loading) return;
    uiOperations.invalidate();
    const cancellationRequest = uiOperations.begin();
    loading = false;
    teardownPending = true;
    render();
    setStatus('Cancelling the local load.');
    let cancellationResult = null;
    try {
      cancellationResult = await controller.cancelLoad();
    } catch {
      // The public status below remains sanitized and reload-only.
    }
    if (!uiOperations.finish(cancellationRequest)) return;
    const outcome = createCancellationUiOutcome(cancellationResult);
    teardownPending = false;
    loadedReady = false;
    previewRunning = false;
    interactionLocked = !outcome.clean;
    render();
    setStatus(outcome.status);
  });

  controls.play.addEventListener('click', async () => {
    const offsetSeconds = Number(controls.downbeat.value);
    const previewRequest = uiOperations.begin();
    previewPending = true;
    render();
    try {
      await controller.playPreview({ offsetSeconds });
      if (!uiOperations.finish(previewRequest)) return;
      previewPending = false;
      previewRunning = true;
      render();
      setStatus('Raw Web Audio preview is playing.');
    } catch {
      if (!uiOperations.finish(previewRequest)) return;
      previewPending = false;
      previewRunning = false;
      render();
      setStatus('Preview could not start. Reload before continuing if controls remain unavailable.');
    }
  });

  controls.stop.addEventListener('click', async () => {
    const stopRequest = uiOperations.begin();
    previewPending = true;
    render();
    try {
      await controller.stopPreview();
      if (!uiOperations.finish(stopRequest)) return;
      previewPending = false;
      previewRunning = false;
      render();
      setStatus('Preview stopped.');
    } catch {
      if (!uiOperations.finish(stopRequest)) return;
      previewPending = false;
      previewRunning = false;
      interactionLocked = true;
      render();
      setStatus('Preview cleanup did not settle. Reload before continuing.');
    }
  });

  controls.useTime.addEventListener('click', () => {
    try {
      const position = controller.snapshot().preview?.positionSeconds;
      if (!Number.isFinite(position)) {
        setStatus('Play the preview before using its current time.');
        return;
      }
      controls.downbeat.value = position.toFixed(3);
      setStatus('Preview time copied to the downbeat field. Analyze the cue to confirm it.');
    } catch {
      setStatus('Preview time could not be read.');
    }
  });

  controls.analyze.addEventListener('click', () => {
    const targetEntryDownbeatSeconds = Number(controls.downbeat.value);
    try {
      const cueAnalysis = controller.analyzeCue({ cueTimeSeconds: targetEntryDownbeatSeconds });
      workflow.acceptCue({ targetEntryDownbeatSeconds, cueAnalysis });
      render();
      setStatus('Cue window passed the fixed local energy check.');
    } catch {
      setStatus('Cue analysis did not pass. Adjust the downbeat and try again.');
    }
  });

  controls.bpm.addEventListener('change', () => {
    workflow.confirmConfiguredBpm(controls.bpm.checked);
    render();
    setStatus(controls.bpm.checked
      ? 'Configured BPM explicitly confirmed.'
      : 'Configured BPM confirmation removed.');
  });

  controls.unload.addEventListener('click', async () => {
    const unloadRequest = uiOperations.begin();
    teardownPending = true;
    render();
    setStatus('Unloading application-owned audio resources.');
    let result = null;
    try {
      result = await controller.unload();
    } catch {
      // The outcome below remains reload-only.
    }
    if (!uiOperations.finish(unloadRequest)) return;
    teardownPending = false;
    loadedReady = false;
    previewRunning = false;
    if (!isCleanApplicationTeardownResult(result)) {
      interactionLocked = true;
      render();
      setStatus('Unload did not prove clean application teardown. Reload before continuing.');
      return;
    }
    try {
      workflow.finishUnload(result.cycle);
    } catch {
      interactionLocked = true;
      render();
      setStatus('Unload evidence was not accepted. Reload before continuing.');
      return;
    }
    render();
    const model = workflow.snapshot();
    if (model.reportReady) {
      setStatus('Two matching clean cycles completed. Sanitized report ready.');
    } else if (model.completedUnloadCycles === 2) {
      setStatus('Two matching clean cycles completed. Confirm the configured BPM to unlock the report.');
    } else {
      setStatus('First clean cycle completed. Select the same local MP3 again.');
    }
  });

  controls.copy.addEventListener('click', async () => {
    if (reportExport === null) return;
    const copyRequest = uiOperations.begin();
    const copyValue = reportExport.json;
    exportPending = true;
    render();
    setStatus('Copying the sanitized report.');
    try {
      await navigator.clipboard.writeText(copyValue);
      if (!uiOperations.finish(copyRequest)) return;
      exportPending = false;
      render();
      setStatus('Sanitized report copied.');
    } catch {
      if (!uiOperations.finish(copyRequest)) return;
      exportPending = false;
      render();
      setStatus('Copy was not permitted. Use Download report instead.');
    }
  });

  controls.download.addEventListener('click', () => {
    if (reportExport === null) return;
    const anchor = documentValue.createElement('a');
    anchor.href = reportExport.dataUrl;
    anchor.download = reportExport.downloadName;
    documentValue.body.append(anchor);
    anchor.click();
    anchor.remove();
    setStatus('Sanitized report download started.');
  });

  const lifecycleUnload = () => {
    if (!loading && !loadedReady && !teardownPending && !previewPending && !exportPending) return;
    uiOperations.invalidate();
    interactionLocked = true;
    loading = false;
    teardownPending = false;
    previewPending = false;
    exportPending = false;
    loadedReady = false;
    previewRunning = false;
    void controller.handleForegroundLoss();
    render();
    setStatus('Foreground access ended. Reload before continuing enrollment.');
  };
  documentValue.addEventListener('visibilitychange', () => {
    if (documentValue.visibilityState === 'hidden') lifecycleUnload();
  });
  window.addEventListener('pagehide', () => {
    uiOperations.invalidate();
    interactionLocked = true;
    loading = false;
    teardownPending = false;
    previewPending = false;
    exportPending = false;
    loadedReady = false;
    previewRunning = false;
    render();
    setStatus('Page exit started. Reload before continuing enrollment.');
    void controller.handlePageHide();
  }, { once: true });

  render();
  return Object.freeze({ controller, workflow });
}

if (typeof document !== 'undefined') main();
