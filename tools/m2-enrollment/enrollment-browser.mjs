import { analyzeCueEnergy } from './enrollment-measurements.mjs';
import { createLoadBoundary } from './enrollment-browser-load.mjs';
import { createPreviewLifecycle } from './enrollment-browser-preview.mjs';
import { createResourceBoundary } from './enrollment-browser-resources.mjs';
import {
  copyTeardownResult,
  EnrollmentBrowserError,
  typedError,
} from './enrollment-browser-shared.mjs';

function cycleFor(resources, resourceOwner, unloadCompleted, contextCloseSettled) {
  return {
    sha256: resourceOwner.sha256,
    unloadCompleted,
    contextCloseSettled,
    counters: resources.snapshotCounters(),
  };
}

export function createEnrollmentBrowserController({
  allowedMimeType,
  digest,
  createAudioContext,
  setTimeoutFn = globalThis.setTimeout.bind(globalThis),
  clearTimeoutFn = globalThis.clearTimeout.bind(globalThis),
} = {}) {
  const resources = createResourceBoundary({
    createAudioContext,
    setTimeoutFn,
    clearTimeoutFn,
  });

  let state = 'awaiting-file';
  let owner = null;
  let activeLoadToken = null;
  const previewLifecycle = createPreviewLifecycle({
    resources,
    getControllerState: () => state,
    setControllerState: (nextState) => {
      state = nextState;
    },
    getOwner: () => owner,
  });

  function beginTeardown(resourceOwner) {
    if (resourceOwner.teardownPromise !== null) return resourceOwner.teardownPromise;

    state = 'tearing-down';
    previewLifecycle.invalidate();
    const closeOutcomePromise = resources.beginTeardown(resourceOwner);
    resourceOwner.teardownPromise = closeOutcomePromise.then((closeOutcome) => {
      if (closeOutcome.kind !== 'closed') {
        const errorCode = closeOutcome.kind === 'timeout'
          ? 'context-close-timeout'
          : 'context-close-failed';
        state = 'reload-required';
        const failed = {
          ok: false,
          errorCode,
          cycle: cycleFor(resources, resourceOwner, false, false),
        };
        resourceOwner.teardownResult = failed;
        return failed;
      }

      if (owner === resourceOwner) owner = null;
      state = 'awaiting-file';
      const succeeded = {
        ok: true,
        cycle: cycleFor(resources, resourceOwner, true, true),
      };
      resourceOwner.teardownResult = succeeded;
      return succeeded;
    });
    return resourceOwner.teardownPromise;
  }

  const loadBoundary = createLoadBoundary({
    allowedMimeType,
    digest,
    resources,
    setTimeoutFn,
    clearTimeoutFn,
    onDeadline(token) {
      if (activeLoadToken === token) beginTeardown(token.owner);
    },
  });

  function beginInvalidatingTeardown(token, code) {
    loadBoundary.invalidate(token, code);
    return beginTeardown(token.owner);
  }

  async function executeLoad(token, file) {
    const resourceOwner = token.owner;
    try {
      const result = await loadBoundary.run(token, file);
      if (token.invalidated) throw typedError(token.invalidationCode);
      activeLoadToken = null;
      state = 'ready';
      return result;
    } catch (error) {
      const publicError = error instanceof EnrollmentBrowserError
        ? error
        : typedError('track-load-failed');
      if (!token.invalidated) {
        loadBoundary.invalidate(token, publicError.code);
        await beginTeardown(resourceOwner);
      }
      throw publicError;
    } finally {
      loadBoundary.clearDeadline(token);
      if (activeLoadToken === token && state !== 'ready') activeLoadToken = null;
    }
  }

  function load(selection) {
    if (state === 'tearing-down') return Promise.reject(typedError('load-teardown-pending'));
    if (state !== 'awaiting-file') return Promise.reject(typedError('load-already-active'));

    let file;
    try {
      file = loadBoundary.captureSelection(selection);
    } catch (error) {
      return Promise.reject(error instanceof EnrollmentBrowserError
        ? error
        : typedError('track-selection-invalid'));
    }

    const resourceOwner = resources.createOwner();
    const token = loadBoundary.createToken(resourceOwner);
    owner = resourceOwner;
    activeLoadToken = token;
    state = 'loading';
    return executeLoad(token, file);
  }

  function cancelLoad() {
    if (activeLoadToken === null || state !== 'loading') {
      return Promise.resolve({ ok: true });
    }
    return beginInvalidatingTeardown(activeLoadToken, 'load-cancelled').then(copyTeardownResult);
  }

  function unloadWithCode(code) {
    if (owner === null) {
      state = state === 'reload-required' ? state : 'awaiting-file';
      return Promise.resolve({
        ok: true,
        cycle: {
          sha256: null,
          unloadCompleted: true,
          contextCloseSettled: true,
          counters: resources.snapshotCounters(),
        },
      });
    }

    const teardown = activeLoadToken === null
      ? beginTeardown(owner)
      : beginInvalidatingTeardown(activeLoadToken, code);
    return teardown.then(copyTeardownResult);
  }

  function unload() {
    return unloadWithCode('load-invalidated');
  }

  function handlePageHide() {
    return unloadWithCode('load-invalidated');
  }

  function handleForegroundLoss() {
    return unloadWithCode('load-invalidated');
  }

  function analyzeCue({ cueTimeSeconds } = {}) {
    if (state !== 'ready' || owner?.decodedBuffer === null || owner?.decoded === null) {
      throw typedError('track-not-ready');
    }
    const sampleRate = owner.decoded.sampleRate;
    const framesPerChannel = Math.round(sampleRate * 0.050);
    const startInChannel = Math.round(cueTimeSeconds * sampleRate);
    if (!Number.isFinite(cueTimeSeconds)
        || !Number.isSafeInteger(startInChannel)
        || startInChannel < 0
        || startInChannel + framesPerChannel > owner.decoded.frameCount) {
      throw typedError('cue-bounds-invalid');
    }

    const channelSamples = [];
    try {
      for (let channelNumber = 0; channelNumber < owner.decoded.channelCount; channelNumber += 1) {
        const scratch = new Float32Array(framesPerChannel);
        owner.decodedBuffer.copyFromChannel(scratch, channelNumber, startInChannel);
        channelSamples.push(scratch);
      }
      const result = analyzeCueEnergy({
        channelSamples,
        sampleRate,
        expectedChannelCount: owner.decoded.channelCount,
      });
      return {
        rms: result.rms,
        peak: result.peak,
        framesPerChannel: result.framesPerChannel,
        sampleCount: result.sampleCount,
        windowMilliseconds: result.windowMilliseconds,
        compliant: result.compliant,
      };
    } catch (error) {
      if (error instanceof EnrollmentBrowserError) throw error;
      throw typedError('cue-analysis-failed');
    }
  }

  function playPreview({ offsetSeconds = 0 } = {}) {
    return previewLifecycle.play({ offsetSeconds });
  }

  function stopPreview() {
    return previewLifecycle.stop();
  }

  function snapshot() {
    const record = resources.activePreviewRecord(owner);
    let preview = null;
    if (record !== null && owner?.context !== null) {
      const currentTime = resources.readCurrentTime(owner, 'snapshot-failed');
      const elapsed = Math.max(0, currentTime - record.startedAtContextTime);
      preview = {
        positionSeconds: Math.min(owner.decoded.durationSeconds, record.offsetSeconds + elapsed),
      };
    }
    return {
      state,
      replacementAllowed: state === 'awaiting-file' && owner === null,
      counters: resources.snapshotCounters(),
      preview,
    };
  }

  return Object.freeze({
    analyzeCue,
    cancelLoad,
    handleForegroundLoss,
    handlePageHide,
    load,
    playPreview,
    snapshot,
    stopPreview,
    unload,
  });
}
