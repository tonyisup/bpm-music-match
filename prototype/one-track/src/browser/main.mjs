import {
  BUILD_SHA,
  assertBuildIdentity,
  assertMatchingBuildIdentity,
} from '../build-identity.mjs';
import * as configModule from '../config.mjs';
import * as runContextModule from '../core/run-context.mjs';
import * as loaderModule from './local-track-loader.mjs';
import * as loadedSessionModule from './loaded-session.mjs';
import * as clockModule from './clock-adapter.mjs';
import * as coordinatorModule from './coordinator.mjs';
import * as rendererModule from './renderer.mjs';
import * as engineModule from '../audio/web-audio-engine.mjs';
import * as evidenceModule from '../core/evidence-schema.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

function createDeadline(kind, milliseconds) {
  let handle;
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  handle = setTimeout(resolve, milliseconds);
  return Object.freeze({
    kind,
    promise,
    cancel() { clearTimeout(handle); },
  });
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function createBrowserTrackLoader() {
  return loaderModule.createLocalTrackLoader({
    readFile(selectedTrack) { return selectedTrack.arrayBuffer(); },
    sha256,
    createAudioContext() { return new AudioContext(); },
    createDeadline,
  });
}

function field(form, name) {
  return form.elements.namedItem(name);
}

export function readAssessment(form, recordKind) {
  if (recordKind === 'smoke') {
    return {
      recordKind,
      oldGenerationStoppedCleanly: field(form, 'oldGenerationStoppedCleanly').checked,
      noDelayedTail: field(form, 'noDelayedTail').checked,
      noDoubledAcknowledgment: field(form, 'noDoubledAcknowledgment').checked,
      noStaleRestart: field(form, 'noStaleRestart').checked,
      nextTapAcknowledged: field(form, 'nextTapAcknowledged').checked,
    };
  }
  return {
    recordKind,
    verdict: field(form, 'verdict').value,
    missingBeat: field(form, 'missingBeat').checked,
    doubledBeat: field(form, 'doubledBeat').checked,
    click: field(form, 'click').checked,
    gap: field(form, 'gap').checked,
    audibleClipping: field(form, 'audibleClipping').checked,
    staleAudio: field(form, 'staleAudio').checked,
    ownershipLeak: field(form, 'ownershipLeak').checked,
    teardownFailure: field(form, 'teardownFailure').checked,
  };
}

function assertBuildGraph(root) {
  const modules = [
    configModule,
    runContextModule,
    loaderModule,
    loadedSessionModule,
    clockModule,
    coordinatorModule,
    rendererModule,
    engineModule,
    evidenceModule,
  ];
  assertLocalBuildIdentity();
  for (const moduleAuthority of modules) moduleAuthority.assertLocalBuildIdentity();
  const htmlBuild = root.querySelector('meta[name="one-track-build"]')?.content;
  assertMatchingBuildIdentity(BUILD_SHA, htmlBuild);
}

function renderStartupFailure(root) {
  root.getElementById('state-title').textContent = 'This build cannot start';
  root.getElementById('state-detail').textContent = 'Use a valid run link from a fully staged build.';
  root.getElementById('estimate').textContent = '— BPM';
  root.getElementById('run-label').textContent = 'Unavailable';
}

export function main(root = document, search = location.search) {
  let runContext;
  try {
    assertBuildGraph(root);
    runContext = runContextModule.parseRunQuery(search);
  } catch {
    renderStartupFailure(root);
    return null;
  }

  const input = root.getElementById('track-input');
  const form = root.getElementById('evidence-form');
  const renderer = rendererModule.createRenderer(root);
  const loader = createBrowserTrackLoader();
  let coordinator;
  coordinator = coordinatorModule.createSessionCoordinator({
    runContext,
    loader,
    createEngine(engineOptions) {
      return engineModule.createWebAudioEngine({
        ...engineOptions,
        createCleanupDeadline: createDeadline,
        failureInjector() {},
      });
    },
    openTrackPicker() { input.click(); },
    setTimer(callback, milliseconds) { return setTimeout(callback, milliseconds); },
    clearTimer(handle) { clearTimeout(handle); },
    nowMilliseconds() { return performance.now(); },
    onState(nextState) { renderer.render(nextState); },
  });

  root.getElementById('choose-track').addEventListener('click', () => coordinator.chooseTrack());
  input.addEventListener('change', () => {
    const selectedTrack = input.files?.item(0) ?? null;
    input.value = '';
    coordinator.selectFile(selectedTrack);
  });
  root.getElementById('cancel-loading').addEventListener('click', () => coordinator.cancelLoading());
  root.getElementById('tap').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    coordinator.tap(event.timeStamp);
  });
  root.getElementById('try-again').addEventListener('click', () => coordinator.tryAgain());
  root.getElementById('end-trial').addEventListener('click', () => coordinator.endTrial());
  root.getElementById('unload-track').addEventListener('click', () => coordinator.unloadTrack());
  root.getElementById('reset-session').addEventListener('click', () => coordinator.reset());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const recordKind = coordinator.inspect().runContext.recordKind;
    const pending = coordinator.finalizeEvidence(readAssessment(form, recordKind));
    const link = root.createElement('a');
    link.download = pending.download.filename;
    link.href = pending.download.href;
    link.click();
    link.remove();
    coordinator.confirmEvidenceDownloaded(pending);
  });

  root.addEventListener('visibilitychange', () => {
    const phase = coordinator.inspect().phase;
    const active = ['tracking', 'armed', 'handoff', 'playing'].includes(phase);
    if (root.visibilityState === 'hidden' && active) coordinator.interrupt('hidden');
    if (root.visibilityState === 'visible') coordinator.foregroundRestored();
  });
  root.defaultView?.addEventListener('beforeunload', (event) => {
    if (coordinator.inspect().phase !== 'evidence-pending') return;
    event.preventDefault();
    event.returnValue = '';
  });
  return coordinator;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => main(), { once: true });
  } else {
    main();
  }
}
