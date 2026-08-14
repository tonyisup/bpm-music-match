import { assertBuildIdentity } from '../build-identity.mjs';
import {
  ASSET_IDENTITY,
  EXPERIMENT_CONFIG_IDENTITY,
} from '../config.mjs';
import * as loadedSessionAuthority from './loaded-session.mjs';
import * as engineAuthority from '../audio/web-audio-engine.mjs';
import {
  createEvidenceDownload,
  createEvidenceRecorder,
} from '../core/evidence-schema.mjs';
import {
  createInitialSessionState,
  reduceSession,
} from '../core/session-reducer.mjs';
import {
  createDeadlineClockEvent,
  createTapClockEvent,
} from './clock-adapter.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';
const LOAD_FAILURES = Object.freeze([
  'track-read-failed',
  'track-identity-failed',
  'track-metadata-invalid',
  'track-decode-failed',
  'track-bounds-invalid',
]);

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

function validateOptions(options) {
  if (options === null
      || typeof options !== 'object'
      || Array.isArray(options)
      || Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError('coordinator options are invalid');
  }
  const requiredFunctions = [
    'createEngine',
    'openTrackPicker',
    'setTimer',
    'clearTimer',
    'nowMilliseconds',
    'onState',
  ];
  if (options.loader === null
      || typeof options.loader !== 'object'
      || requiredFunctions.some((key) => typeof options[key] !== 'function')) {
    throw new TypeError('coordinator dependencies are invalid');
  }
  return options;
}

function effectCallback(effect, status, failureCause) {
  const event = {
    type: status === 'succeeded' ? 'effect-succeeded' : 'effect-failed',
    sessionId: effect.sessionId,
    generationId: effect.generationId,
    effectId: effect.effectId,
    effectType: effect.effectType,
  };
  if (status !== 'succeeded') event.cause = failureCause;
  return event;
}

function publicCleanup(result) {
  return Object.freeze({ status: result.status, cause: result.cause });
}

export function createSessionCoordinator(rawOptions) {
  const options = validateOptions(rawOptions);
  const {
    runContext,
    loader,
    createEngine,
    openTrackPicker,
    setTimer,
    clearTimer,
    nowMilliseconds,
    onState,
  } = options;
  let state = createInitialSessionState(runContext);
  let capability = null;
  let engine = null;
  const recorder = createEvidenceRecorder({ sessionId: state.sessionId });
  let terminalReceipt = null;
  let finalizedEvidence = null;
  let pendingEvidenceDownload = null;
  let nextSelectionId = 1;
  const selections = new Map();
  const timers = new Map();
  const pendingResumeEffects = new Map();
  const eventQueue = [];
  let draining = false;

  function notify() {
    onState(state);
  }

  function dispatch(event) {
    eventQueue.push(event);
    if (draining) return state;
    draining = true;
    try {
      while (eventQueue.length > 0) {
        const next = eventQueue.shift();
        const result = reduceSession(state, next);
        state = result.state;
        notify();
        for (const effect of result.effects) executeEffect(effect);
      }
    } finally {
      draining = false;
    }
    return state;
  }

  function settleEffect(effect, promise, failureCause) {
    Promise.resolve(promise).then(
      (settlement) => dispatch(effectCallback(
        effect,
        settlement?.status === 'succeeded' ? 'succeeded' : 'failed',
        settlement?.cause ?? failureCause,
      )),
      () => dispatch(effectCallback(effect, 'failed', failureCause)),
    );
  }

  function settleEffectOperation(effect, operation, failureCause) {
    try {
      settleEffect(effect, operation(), failureCause);
    } catch {
      dispatch(effectCallback(effect, 'failed', failureCause));
    }
  }

  function audioClock() {
    if (capability === null) throw new TypeError('loaded audio clock is unavailable');
    return capability.snapshotAudioClock();
  }

  function safeAudioNow() {
    try {
      return audioClock().audioNow;
    } catch {
      return Number.isFinite(state.lastAudioNow) ? state.lastAudioNow : 0;
    }
  }

  function scheduleBoundary(plan, effect) {
    const clock = audioClock();
    const delay = Math.max(0, (plan.songOnlyStartAudioTime - clock.audioNow) * 1_000);
    const key = `song-only:${effect.generationId}`;
    const timer = setTimer(() => {
      timers.delete(key);
      dispatch({
        type: 'song-only-boundary',
        sessionId: effect.sessionId,
        generationId: effect.generationId,
        sourceId: `generation-${effect.generationId}-track-source`,
      });
    }, delay);
    timers.set(key, timer);
  }

  function engineEvent(event) {
    if (event.type === 'generation-cleanup-faulted') {
      dispatch({
        type: event.type,
        sessionId: event.sessionId,
        generationId: event.generationId,
        sourceId: event.sourceId,
        cause: event.cause,
      });
      return;
    }
    if (event.type === 'source-ended') {
      dispatch({
        type: event.type,
        sessionId: event.sessionId,
        generationId: event.generationId,
        sourceId: event.sourceId,
      });
      return;
    }
    if (event.type === 'natural-track-end' && event.intentional === false) {
      dispatch({
        type: event.type,
        sessionId: event.sessionId,
        generationId: event.generationId,
        sourceId: event.sourceId,
        audioNow: safeAudioNow(),
      });
    }
  }

  function beginLoad(effect) {
    const file = selections.get(effect.payload.selectionId);
    selections.delete(effect.payload.selectionId);
    const loadedSessionId = `loaded-${state.sessionId}-${effect.payload.loadToken}`;
    let loadPromise;
    try {
      loadPromise = loader.load({ file, loadedSessionId });
    } catch (error) {
      dispatch({
        type: 'load-failed',
        sessionId: effect.sessionId,
        generationId: effect.generationId,
        effectId: effect.effectId,
        effectType: effect.effectType,
        loadToken: effect.payload.loadToken,
        cause: LOAD_FAILURES.includes(error?.code) ? error.code : 'track-decode-failed',
      });
      return;
    }
    Promise.resolve(loadPromise).then(
      (loadedCapability) => {
        let loadedEngine;
        try {
          loadedEngine = createEngine({
            loadedSessionCapability: loadedCapability,
            sessionId: state.sessionId,
            assertTerminalRecordReceipt: recorder.assertTerminalRecordReceipt,
            onEvent: engineEvent,
          });
        } catch {
          dispatch({
            type: 'load-failed',
            sessionId: effect.sessionId,
            generationId: effect.generationId,
            effectId: effect.effectId,
            effectType: effect.effectType,
            loadToken: effect.payload.loadToken,
            cause: 'track-decode-failed',
          });
          return;
        }
        capability = loadedCapability;
        engine = loadedEngine;
        dispatch({
          type: 'load-succeeded',
          sessionId: effect.sessionId,
          generationId: effect.generationId,
          effectId: effect.effectId,
          effectType: effect.effectType,
          loadToken: effect.payload.loadToken,
          loadedSessionId,
          assetIdentity: ASSET_IDENTITY,
          experimentConfigIdentity: EXPERIMENT_CONFIG_IDENTITY,
        });
      },
      (error) => dispatch({
        type: 'load-failed',
        sessionId: effect.sessionId,
        generationId: effect.generationId,
        effectId: effect.effectId,
        effectType: effect.effectType,
        loadToken: effect.payload.loadToken,
        cause: LOAD_FAILURES.includes(error?.code) ? error.code : 'track-decode-failed',
      }),
    );
  }

  function teardownApplication(effect) {
    const ownedCapability = capability;
    const failedCleanup = Object.freeze({ status: 'failed', cause: 'context-close-failed' });

    function settle(result, operationFailed = false) {
      let cleanup = failedCleanup;
      if (!operationFailed) {
        cleanup = Object.freeze({ status: 'succeeded', cause: null });
        try {
          if (result !== undefined && ownedCapability !== null) {
            loadedSessionAuthority.claimApplicationReleaseResult(result, {
              loadedSessionId: effect.payload.loadedSessionId,
              capability: ownedCapability,
            });
            cleanup = publicCleanup(result);
          }
        } catch {
          cleanup = failedCleanup;
        }
      }
      if (terminalReceipt !== null) {
        try {
          recorder.writeCleanup(terminalReceipt, {
            scope: 'application',
            status: cleanup.status,
            cause: cleanup.cause,
            referencesCleared: cleanup.status === 'succeeded',
            settlementComplete: true,
          });
        } catch {
          cleanup = failedCleanup;
        }
      }
      capability = null;
      engine = null;
      dispatch({
        type: 'application-teardown-settled',
        sessionId: effect.sessionId,
        generationId: effect.generationId,
        effectId: effect.effectId,
        effectType: effect.effectType,
        cleanup,
      });
    }

    let teardownPromise;
    try {
      teardownPromise = loader.teardown(effect.payload.reason);
    } catch {
      settle(undefined, true);
      return;
    }
    Promise.resolve(teardownPromise).then(
      (result) => settle(result),
      () => settle(undefined, true),
    );
  }

  function terminateGeneration(effect, smokeProbe = false) {
    if (engine === null || capability === null) {
      dispatch({
        type: smokeProbe ? 'smoke-probe-settled' : 'generation-cleanup-settled',
        sessionId: effect.sessionId,
        generationId: effect.generationId,
        effectId: effect.effectId,
        effectType: effect.effectType,
        cleanup: { status: 'failed', cause: 'source-stop-failed' },
      });
      return;
    }
    const cleanupReceipt = terminalReceipt ?? recorder.authorizeGenerationCleanup({
      sessionId: effect.sessionId,
      generationId: effect.generationId,
    });
    const ownedEngine = engine;
    const ownedCapability = capability;
    let command;
    try {
      command = engine.terminateGeneration({
        sessionId: effect.sessionId,
        generationId: effect.generationId,
        effectId: effect.effectId,
        terminalRecordReceipt: cleanupReceipt,
        audioNow: smokeProbe ? audioClock().audioNow : effect.payload.audioNow,
      });
    } catch {
      const type = smokeProbe ? 'smoke-probe-settled' : 'generation-cleanup-settled';
      dispatch({
        type,
        sessionId: effect.sessionId,
        generationId: effect.generationId,
        effectId: effect.effectId,
        effectType: effect.effectType,
        cleanup: { status: 'failed', cause: 'source-stop-failed' },
      });
      return;
    }
    Promise.resolve(command.cleanupPromise).then(
      (result) => {
        try {
          engineAuthority.claimGenerationCleanupResult(result, {
            engine: ownedEngine,
            loadedSessionCapability: ownedCapability,
            sessionId: effect.sessionId,
            generationId: effect.generationId,
            terminalRecordReceipt: cleanupReceipt,
          });
          if (!smokeProbe && terminalReceipt !== null) {
            recorder.writeCleanup(terminalReceipt, {
              scope: 'generation',
              status: result.status,
              cause: result.cause,
              referencesCleared: result.sourceReferencesCleared,
              settlementComplete: result.sourceStopSettled,
            });
          }
        } catch {
          dispatch({
            type: smokeProbe ? 'smoke-probe-settled' : 'generation-cleanup-settled',
            sessionId: effect.sessionId,
            generationId: effect.generationId,
            effectId: effect.effectId,
            effectType: effect.effectType,
            cleanup: { status: 'failed', cause: 'source-stop-failed' },
          });
          return;
        }
        dispatch({
          type: smokeProbe ? 'smoke-probe-settled' : 'generation-cleanup-settled',
          sessionId: effect.sessionId,
          generationId: effect.generationId,
          effectId: effect.effectId,
          effectType: effect.effectType,
          cleanup: publicCleanup(result),
        });
      },
      () => dispatch({
        type: smokeProbe ? 'smoke-probe-settled' : 'generation-cleanup-settled',
        sessionId: effect.sessionId,
        generationId: effect.generationId,
        effectId: effect.effectId,
        effectType: effect.effectType,
        cleanup: { status: 'failed', cause: 'source-stop-failed' },
      }),
    );
  }

  function executeEffect(effect) {
    const { payload } = effect;
    if (effect.effectType === 'open-track-picker') {
      try {
        openTrackPicker();
      } catch {
        // The selecting state remains retryable without exposing browser details.
      }
    } else if (effect.effectType === 'begin-track-load') {
      beginLoad(effect);
    } else if (effect.effectType === 'cancel-track-load') {
      try {
        loader.cancel();
      } catch {
        // The following application teardown remains authoritative.
      }
    } else if (effect.effectType === 'application-teardown') {
      teardownApplication(effect);
    } else if (effect.effectType === 'resume-context') {
      pendingResumeEffects.set(effect.generationId, effect);
    } else if (effect.effectType === 'schedule-acknowledgment') {
      const resume = pendingResumeEffects.get(effect.generationId);
      pendingResumeEffects.delete(effect.generationId);
      let command;
      try {
        command = engine.directTap({
          sessionId: effect.sessionId,
          generationId: effect.generationId,
          effectId: effect.effectId,
          sourceId: payload.sourceId,
          scheduledAudioTime: payload.scheduledAudioTime,
        });
      } catch {
        if (resume !== undefined) {
          dispatch(effectCallback(resume, 'failed', 'context-resume-failed'));
        }
        dispatch(effectCallback(effect, 'failed', 'schedule-failed'));
        return;
      }
      if (resume !== undefined) {
        settleEffect(resume, command.settlement, 'context-resume-failed');
      }
      settleEffect(effect, command.settlement, 'schedule-failed');
    } else if (effect.effectType === 'schedule-predictions') {
      settleEffectOperation(effect, () => engine.schedulePredictions({
        sessionId: effect.sessionId,
        generationId: effect.generationId,
        effectId: effect.effectId,
        predictions: payload.predictions.map(({ sourceId, scheduledAudioTime }) => ({
          sourceId,
          scheduledAudioTime,
        })),
      }), 'schedule-failed');
    } else if (effect.effectType === 'cancel-predictions') {
      settleEffectOperation(effect, () => engine.cancelPredictions({
        sessionId: effect.sessionId,
        generationId: effect.generationId,
        effectId: effect.effectId,
        sourceIds: [...payload.sourceIds],
        audioNow: payload.audioNow,
      }), 'schedule-failed');
    } else if (effect.effectType === 'commit-handoff-plan') {
      settleEffectOperation(effect, async () => {
        const result = await engine.commitHandoff({
          sessionId: effect.sessionId,
          generationId: effect.generationId,
          effectId: effect.effectId,
          plan: payload.plan,
        });
        if (result.status === 'succeeded') scheduleBoundary(payload.plan, effect);
        return result;
      }, 'schedule-failed');
    } else if (effect.effectType === 'set-idle-deadline'
        || effect.effectType === 'set-lock-deadline') {
      const key = payload.deadlineTimestampMs;
      try {
        const timer = setTimer(() => {
          timers.delete(key);
          try {
            dispatch(createDeadlineClockEvent(
              effect.effectType === 'set-idle-deadline' ? 'idle-deadline' : 'lock-deadline',
              effect,
              payload.deadlineTimestampMs,
              nowMilliseconds(),
              audioClock(),
            ));
          } catch {
            dispatch({ type: 'tap-timing-invalid', audioNow: safeAudioNow() });
          }
        }, Math.max(0, payload.deadlineTimestampMs - nowMilliseconds()));
        timers.set(key, timer);
      } catch {
        dispatch({ type: 'tap-timing-invalid', audioNow: safeAudioNow() });
      }
    } else if (effect.effectType === 'cancel-deadline') {
      const timer = timers.get(payload.deadlineTimestampMs);
      try {
        if (timer !== undefined) clearTimer(timer);
      } catch {
        // Termination still owns audio cleanup if the browser timer is already invalid.
      }
      timers.delete(payload.deadlineTimestampMs);
    } else if (effect.effectType === 'capture-terminal-draft') {
      terminalReceipt = recorder.captureTerminalDraft(payload.terminalDraft);
      finalizedEvidence = null;
      pendingEvidenceDownload = null;
    } else if (effect.effectType === 'terminate-generation') {
      terminateGeneration(effect);
    } else if (effect.effectType === 'reconcile-stale-resume') {
      try {
        Promise.resolve(capability?.suspend('stale-generation-resume')).catch(() => undefined);
      } catch {
        // Stale resume reconciliation is already outside active ownership.
      }
    } else if (effect.effectType === 'run-smoke-probe') {
      try {
        setTimer(() => terminateGeneration(effect, true),
          payload.holdMilliseconds + payload.rampMilliseconds + payload.stopMilliseconds);
      } catch {
        dispatch({
          type: 'smoke-probe-settled',
          sessionId: effect.sessionId,
          generationId: effect.generationId,
          effectId: effect.effectId,
          effectType: effect.effectType,
          cleanup: { status: 'failed', cause: 'source-stop-failed' },
        });
      }
    }
  }

  function chooseTrack() {
    return dispatch({ type: 'choose-track' });
  }

  function selectFile(file) {
    if (file === null || typeof file !== 'object') {
      return dispatch({ type: 'selection-cancelled' });
    }
    const selectionId = `selection-${nextSelectionId}`;
    nextSelectionId += 1;
    selections.set(selectionId, file);
    return dispatch({ type: 'file-selected', selectionId });
  }

  function tap(eventTimestampMs) {
    try {
      return dispatch(createTapClockEvent(
        eventTimestampMs,
        nowMilliseconds(),
        audioClock(),
      ));
    } catch {
      const now = capability === null ? 0 : audioClock().audioNow;
      return dispatch({ type: 'tap-timing-invalid', audioNow: now });
    }
  }

  function endTrial() {
    return dispatch({ type: 'end-trial', audioNow: safeAudioNow() });
  }

  function finalizeEvidence(assessment) {
    if (terminalReceipt === null) throw new TypeError('terminal evidence is unavailable');
    if (pendingEvidenceDownload !== null) return pendingEvidenceDownload;
    finalizedEvidence = recorder.finalize(terminalReceipt, assessment);
    pendingEvidenceDownload = Object.freeze({
      terminalRecordReceiptId: recorder.terminalRecordReceiptId(terminalReceipt),
      verdict: assessment.recordKind === 'scored' ? assessment.verdict : 'not-judged',
      download: createEvidenceDownload(finalizedEvidence),
    });
    return pendingEvidenceDownload;
  }

  function confirmEvidenceDownloaded(pending) {
    if (finalizedEvidence === null
        || pendingEvidenceDownload === null
        || pending !== pendingEvidenceDownload) {
      throw new TypeError('finalized evidence download is unavailable');
    }
    return dispatch({
      type: 'evidence-resolved',
      terminalRecordReceiptId: pending.terminalRecordReceiptId,
      verdict: pending.verdict,
      downloaded: true,
    });
  }

  function reset() {
    terminalReceipt = null;
    finalizedEvidence = null;
    pendingEvidenceDownload = null;
    return dispatch({ type: 'reset-session' });
  }

  notify();
  return Object.freeze({
    inspect: () => state,
    chooseTrack,
    selectFile,
    cancelSelection: () => dispatch({ type: 'selection-cancelled' }),
    cancelLoading: () => dispatch({ type: 'cancel-loading' }),
    tap,
    tryAgain: () => dispatch({ type: 'try-again' }),
    endTrial,
    interrupt: (reason) => dispatch({
      type: 'runtime-interrupted',
      reason,
      audioNow: safeAudioNow(),
    }),
    foregroundRestored: () => dispatch({ type: 'foreground-restored' }),
    unloadTrack: () => dispatch({ type: 'unload-track' }),
    finalizeEvidence,
    confirmEvidenceDownloaded,
    reset,
  });
}
