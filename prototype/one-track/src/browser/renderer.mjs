import { assertBuildIdentity } from '../build-identity.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

const COPY = Object.freeze({
  'awaiting-track': ['Choose the approved track', 'Everything stays on this device.'],
  'selecting-track': ['Choose your local copy', 'Only the approved track can continue.'],
  'loading-track': ['Checking the track', 'Identity and audio bounds are checked locally.'],
  ready: ['Tap with the beat', 'Four or more steady taps usually works best.'],
  tracking: ['Keep tapping', 'Stay with the pulse while the estimate settles.'],
  armed: ['Cadence found', 'Pause and let the transition begin.'],
  handoff: ['Blending into the track', 'The transition is now committed.'],
  playing: ['Track playing', 'Tap once to stop early, or let the trial finish.'],
  cancelling: ['Stopping cleanly', 'Settling every scheduled sound.'],
  'generation-settling': ['Resetting the attempt', 'Preparing another clean tap window.'],
  'terminating-failure': ['Closing the trial', 'Capturing sanitized evidence first.'],
  'teardown-in-progress': ['Releasing audio', 'Waiting for the browser audio context to close.'],
  'evidence-pending': ['Review this trial', 'Save a privacy-safe evidence record to continue.'],
  'evidence-resolved': ['Evidence saved', 'Reset when you are ready for the next run.'],
  'no-match': ['No reliable match yet', 'Try again with a steadier pulse.'],
  interrupted: ['Audio was interrupted', 'Return to the page to finish the evidence record.'],
  'smoke-probing': ['Checking cancellation', 'Verifying the next tap starts cleanly.'],
  error: ['The track could not be prepared', 'Choose the approved local track again.'],
});

export function createViewModel(state) {
  const [title, detail] = COPY[state.phase] ?? ['Session unavailable', 'Reload this page.'];
  const estimate = state.estimatorSnapshot?.estimatedBpmExact;
  return Object.freeze({
    title,
    detail,
    runLabel: state.runContext.recordKind === 'smoke'
      ? `Smoke check · ${state.runContext.cancellationPhase}`
      : `Session ${state.runContext.session.slice(-1)} · Slot ${state.runContext.slot} · ${state.runContext.assignedClass}`,
    estimateLabel: Number.isFinite(estimate) ? `${estimate.toFixed(1)} BPM` : '— BPM',
    chooseVisible: ['awaiting-track', 'selecting-track', 'error'].includes(state.phase),
    cancelVisible: state.phase === 'loading-track',
    tapVisible: ['ready', 'tracking', 'armed', 'handoff', 'playing'].includes(state.phase),
    tapEnabled: ['ready', 'tracking', 'armed', 'handoff', 'playing'].includes(state.phase),
    tryAgainVisible: state.phase === 'no-match',
    endVisible: state.phase === 'playing',
    unloadVisible: ['ready', 'evidence-resolved'].includes(state.phase)
      && state.loadedSessionId !== null,
    evidenceVisible: state.phase === 'evidence-pending',
    resetVisible: state.phase === 'evidence-resolved',
    scoredEvidenceVisible: state.runContext.recordKind === 'scored',
    smokeEvidenceVisible: state.runContext.recordKind === 'smoke',
    busy: ['loading-track', 'cancelling', 'generation-settling',
      'terminating-failure', 'teardown-in-progress', 'smoke-probing'].includes(state.phase),
    diagnosticsVisible: ['evidence-pending', 'evidence-resolved'].includes(state.phase),
  });
}

function element(root, id) {
  const value = root.getElementById(id);
  if (value === null) throw new TypeError(`missing required interface element: ${id}`);
  return value;
}

export function createRenderer(root) {
  const elements = Object.freeze({
    run: element(root, 'run-label'),
    title: element(root, 'state-title'),
    detail: element(root, 'state-detail'),
    estimate: element(root, 'estimate'),
    choose: element(root, 'choose-track'),
    cancel: element(root, 'cancel-loading'),
    tap: element(root, 'tap'),
    tryAgain: element(root, 'try-again'),
    end: element(root, 'end-trial'),
    unload: element(root, 'unload-track'),
    evidence: element(root, 'evidence-form'),
    scored: element(root, 'scored-assessment'),
    smoke: element(root, 'smoke-assessment'),
    reset: element(root, 'reset-session'),
    busy: element(root, 'busy-indicator'),
    diagnostics: element(root, 'diagnostics'),
  });

  return Object.freeze({
    render(state) {
      const view = createViewModel(state);
      elements.run.textContent = view.runLabel;
      elements.title.textContent = view.title;
      elements.detail.textContent = view.detail;
      elements.estimate.textContent = view.estimateLabel;
      elements.choose.hidden = !view.chooseVisible;
      elements.cancel.hidden = !view.cancelVisible;
      elements.tap.hidden = !view.tapVisible;
      elements.tap.disabled = !view.tapEnabled;
      elements.tryAgain.hidden = !view.tryAgainVisible;
      elements.end.hidden = !view.endVisible;
      elements.unload.hidden = !view.unloadVisible;
      elements.evidence.hidden = !view.evidenceVisible;
      elements.scored.hidden = !view.scoredEvidenceVisible;
      elements.smoke.hidden = !view.smokeEvidenceVisible;
      elements.reset.hidden = !view.resetVisible;
      elements.busy.hidden = !view.busy;
      elements.diagnostics.hidden = !view.diagnosticsVisible;
      return view;
    },
  });
}
