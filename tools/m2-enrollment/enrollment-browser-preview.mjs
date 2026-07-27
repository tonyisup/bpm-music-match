import { assertEnrollmentBuildCommit } from './enrollment-build.mjs';

assertEnrollmentBuildCommit('__ENROLLMENT_BUILD_COMMIT__');

import {
  createDeferred,
  operationOutcome,
  typedError,
} from './enrollment-browser-shared.mjs';

const PHASE_TRANSITIONS = Object.freeze({
  idle: new Set(['idle', 'resuming', 'replacing', 'stopping', 'invalidated', 'reload-required']),
  resuming: new Set(['idle', 'running', 'stopping', 'invalidated', 'reload-required']),
  replacing: new Set(['idle', 'resuming', 'running', 'stopping', 'invalidated', 'reload-required']),
  stopping: new Set(['idle', 'running', 'invalidated', 'reload-required']),
  running: new Set(['idle', 'invalidated', 'reload-required']),
  invalidated: new Set(['idle', 'invalidated', 'reload-required']),
  'reload-required': new Set(['idle', 'invalidated', 'reload-required']),
});

export function createPreviewLifecycle({
  resources,
  getControllerState,
  setControllerState,
  getOwner,
}) {
  let phase = 'idle';
  let requestSequence = 0;
  let currentRequest = null;

  function setPhase(nextPhase) {
    if (PHASE_TRANSITIONS[phase]?.has(nextPhase) !== true) {
      throw typedError('preview-state-invalid');
    }
    phase = nextPhase;
  }

  function invalidateCurrent(nextPhase = 'invalidated') {
    requestSequence += 1;
    if (currentRequest !== null) currentRequest.invalidation.resolve();
    currentRequest = null;
    setPhase(nextPhase);
  }

  function beginRequest(resourceOwner) {
    invalidateCurrent('idle');
    const request = {
      id: requestSequence,
      owner: resourceOwner,
      invalidation: createDeferred(),
    };
    currentRequest = request;
    return request;
  }

  function isCurrent(request) {
    return currentRequest === request
      && request.id === requestSequence
      && getControllerState() === 'ready'
      && getOwner() === request.owner;
  }

  function requireCurrent(request) {
    if (!isCurrent(request)) throw typedError('preview-invalidated');
  }

  function clearRequest(request) {
    if (currentRequest === request) currentRequest = null;
  }

  function failReload(errorCode) {
    invalidateCurrent('reload-required');
    setControllerState('reload-required');
    throw typedError(errorCode);
  }

  function errorForStopOutcome(outcome) {
    return outcome.kind === 'timeout' ? 'preview-stop-timeout' : 'preview-stop-failed';
  }

  async function settlePlayRequest({ request, resumeOutcomePromise, oldOutcomePromise }) {
    if (oldOutcomePromise === null) {
      const resumeOutcome = await resumeOutcomePromise;
      requireCurrent(request);
      return resumeOutcome;
    }

    const first = await Promise.race([
      resumeOutcomePromise.then((outcome) => ({ source: 'resume', outcome })),
      oldOutcomePromise.then((outcome) => ({ source: 'old', outcome })),
    ]);
    requireCurrent(request);

    if (first.source === 'old' && first.outcome.kind !== 'settled') {
      failReload(errorForStopOutcome(first.outcome));
    }

    if (first.source === 'resume') setPhase('stopping');
    else setPhase('resuming');

    const resumeOutcome = first.source === 'resume'
      ? first.outcome
      : await resumeOutcomePromise;
    requireCurrent(request);

    const oldOutcome = first.source === 'old'
      ? first.outcome
      : await oldOutcomePromise;
    requireCurrent(request);
    if (oldOutcome.kind !== 'settled') failReload(errorForStopOutcome(oldOutcome));
    return resumeOutcome;
  }

  function play({ offsetSeconds = 0 } = {}) {
    const resourceOwner = getOwner();
    if (getControllerState() !== 'ready'
        || resourceOwner?.context === null
        || resourceOwner?.decodedBuffer === null) {
      return Promise.reject(typedError('track-not-ready'));
    }
    if (!Number.isFinite(offsetSeconds)
        || offsetSeconds < 0
        || offsetSeconds >= resourceOwner.decoded.durationSeconds) {
      return Promise.reject(typedError('preview-offset-invalid'));
    }

    const request = beginRequest(resourceOwner);
    let resumeValue;
    try {
      resumeValue = resourceOwner.context.resume();
    } catch {
      resumeValue = Promise.reject();
    }
    const resumeOutcomePromise = Promise.race([
      operationOutcome(resumeValue),
      request.invalidation.promise.then(() => ({ kind: 'invalidated' })),
    ]);

    const oldRecord = resources.activePreviewRecord(resourceOwner);
    const oldStopAccepted = oldRecord === null
      ? true
      : resources.requestSourceStop(resourceOwner, oldRecord);
    if (!oldStopAccepted) {
      clearRequest(request);
      try {
        failReload('preview-stop-failed');
      } catch (error) {
        return Promise.reject(error);
      }
    }
    const oldOutcomePromise = oldRecord === null
      ? null
      : resources.waitForSourceSettlement(oldRecord);
    setPhase(oldRecord === null ? 'resuming' : 'replacing');

    return (async () => {
      const resumeOutcome = await settlePlayRequest({
        request,
        resumeOutcomePromise,
        oldOutcomePromise,
      });
      requireCurrent(request);
      if (resumeOutcome.kind === 'invalidated') throw typedError('preview-invalidated');
      if (resumeOutcome.kind !== 'value') throw typedError('context-resume-failed');

      const startedAtContextTime = resources.readCurrentTime(
        resourceOwner,
        'preview-start-failed',
      );
      const record = resources.createSourceRecord(resourceOwner, {
        offsetSeconds,
        startedAtContextTime,
      });
      resources.startSource(resourceOwner, record);
      clearRequest(request);
      setPhase('running');
      return {
        ok: true,
        positionSeconds: offsetSeconds,
      };
    })();
  }

  function stop() {
    invalidateCurrent('idle');
    const resourceOwner = getOwner();
    const record = resources.activePreviewRecord(resourceOwner);
    if (resourceOwner === null || record === null) return Promise.resolve({ ok: true });
    setPhase('stopping');
    if (!resources.requestSourceStop(resourceOwner, record)) {
      try {
        failReload('preview-stop-failed');
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return resources.waitForSourceSettlement(record).then((outcome) => {
      if (outcome.kind === 'settled') {
        setPhase('idle');
        return { ok: true };
      }
      failReload(errorForStopOutcome(outcome));
    });
  }

  function invalidate() {
    invalidateCurrent('invalidated');
  }

  return Object.freeze({
    invalidate,
    play,
    stop,
  });
}
