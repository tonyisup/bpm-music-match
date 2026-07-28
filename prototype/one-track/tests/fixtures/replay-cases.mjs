import {
  ASSET_IDENTITY,
  EXPERIMENT_CONFIG_IDENTITY,
} from '../../src/config.mjs';
import {
  advanceRunContext,
  freezeColdContextAtFirstAcceptedTap,
  parseRunQuery,
} from '../../src/core/run-context.mjs';
import {
  createInitialSessionState,
  reduceSession,
} from '../../src/core/session-reducer.mjs';

function runContext(runValue, thermalState = 'cold') {
  const cold = parseRunQuery(`?run=${runValue}`);
  if (thermalState !== 'warmed') {
    return cold;
  }
  const frozen = freezeColdContextAtFirstAcceptedTap(cold);
  return advanceRunContext(frozen, {
    evidenceResolved: true,
    downloadGesture: true,
    reset: true,
  });
}

function readyState(runValue = 'session-1', thermalState = 'cold') {
  const initial = createInitialSessionState(runContext(runValue, thermalState));
  const selecting = reduceSession(initial, { type: 'choose-track' });
  const loading = reduceSession(selecting.state, {
    type: 'file-selected',
    selectionId: `selection-${runValue}`,
  });
  const effect = loading.effects[0];
  return reduceSession(loading.state, {
    type: 'load-succeeded',
    sessionId: effect.sessionId,
    generationId: effect.generationId,
    effectId: effect.effectId,
    effectType: effect.effectType,
    loadToken: effect.payload.loadToken,
    loadedSessionId: `loaded-${runValue}`,
    assetIdentity: ASSET_IDENTITY,
    experimentConfigIdentity: EXPERIMENT_CONFIG_IDENTITY,
  }).state;
}

class ScenarioBuilder {
  constructor(runValue = 'session-1', thermalState = 'cold') {
    this.initialState = readyState(runValue, thermalState);
    this.state = this.initialState;
    this.events = [];
    this.results = [];
  }

  push(event) {
    this.events.push(event);
    const result = reduceSession(this.state, event);
    this.results.push(result);
    this.state = result.state;
    return result;
  }

  finish(expected) {
    return {
      initialState: this.initialState,
      events: this.events,
      expected,
    };
  }
}

function tapEvent({
  eventTimestampMs,
  observedNowMs = eventTimestampMs,
  audioNow,
  mappedTapAudioTime = audioNow + (eventTimestampMs - observedNowMs) / 1_000,
  outputSampleRate = 48_000,
  contextState = 'running',
}) {
  return {
    type: 'tap',
    eventTimestampMs,
    observedNowMs,
    mappedTapAudioTime,
    audioNow,
    outputSampleRate,
    contextState,
  };
}

function armCadence(builder, bpm, {
  firstTimestampMs = 1_000,
  firstAudioTime = 10,
} = {}) {
  const intervalMs = 60_000 / bpm;
  for (let index = 0; index < 5; index += 1) {
    builder.push(tapEvent({
      eventTimestampMs: firstTimestampMs + index * intervalMs,
      audioNow: firstAudioTime + index * intervalMs / 1_000,
    }));
  }
  return builder.state;
}

function lockEvent(state, overrides = {}) {
  const lastTimestampMs = state.estimatorSnapshot.timestampWindowMs.at(-1);
  const lockDeadlineAudioTime = state.lastMappedTapAudioTime
    + (state.silenceDeadlineTimestampMs - lastTimestampMs) / 1_000;
  return {
    type: 'lock-deadline',
    sessionId: state.sessionId,
    generationId: state.activeGenerationId,
    deadlineTimestampMs: state.silenceDeadlineTimestampMs,
    lockDeadlineAudioTime,
    audioNow: lockDeadlineAudioTime,
    outputSampleRate: state.outputSampleRate,
    ...overrides,
  };
}

function generationSettlement(state, cleanup = { status: 'succeeded', cause: null }) {
  return {
    type: 'generation-cleanup-settled',
    sessionId: state.sessionId,
    generationId: state.generationTermination.generationId,
    effectId: state.generationTermination.effectId,
    effectType: 'terminate-generation',
    cleanup,
  };
}

function teardownSettlement(state, cleanup = { status: 'succeeded', cause: null }) {
  return {
    type: 'application-teardown-settled',
    sessionId: state.teardown.sessionId,
    generationId: state.teardown.generationId,
    effectId: state.teardown.effectId,
    effectType: 'application-teardown',
    cleanup,
  };
}

function effectCallback(type, effect, cause = null) {
  const event = {
    type,
    sessionId: effect.sessionId,
    generationId: effect.generationId,
    effectId: effect.effectId,
    effectType: effect.effectType,
  };
  if (type === 'effect-failed') {
    event.cause = cause;
  }
  return event;
}

function commitHandoff(builder) {
  const commit = builder.state.pendingEffects.find(({ effectType }) => (
    effectType === 'commit-handoff-plan'
  ));
  builder.push(effectCallback('effect-succeeded', commit));
  return builder.state;
}

function enterPlaying(builder) {
  builder.push({
    type: 'song-only-boundary',
    sessionId: builder.state.trackSource.sessionId,
    generationId: builder.state.trackSource.generationId,
    sourceId: builder.state.trackSource.sourceId,
  });
  return builder.state;
}

function noMatch(builder, bpm) {
  armCadence(builder, bpm, {
    firstTimestampMs: 1_000 + builder.state.nextGenerationId * 10_000,
    firstAudioTime: 10 + builder.state.nextGenerationId * 10,
  });
  builder.push(lockEvent(builder.state));
  builder.push(generationSettlement(builder.state));
}

function buildMatch({
  bpm,
  runValue,
  thermalState = 'cold',
  actualClass,
  assignedClassMatched,
}) {
  const builder = new ScenarioBuilder(runValue, thermalState);
  armCadence(builder, bpm);
  builder.push(lockEvent(builder.state));
  return builder.finish({
    finalPhase: 'handoff',
    terminalCause: null,
    actualClass,
    assignedClassMatched,
    requiredEffectTypes: ['commit-handoff-plan'],
  });
}

function buildOutside(bpm) {
  const builder = new ScenarioBuilder();
  armCadence(builder, bpm);
  builder.push(lockEvent(builder.state));
  builder.push(generationSettlement(builder.state));
  return builder.finish({
    finalPhase: 'no-match',
    terminalCause: null,
    actualClass: null,
    attemptCount: 0,
    requiredEffectTypes: ['terminate-generation'],
  });
}

function buildThreeNoMatchAttempts() {
  const builder = new ScenarioBuilder();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    noMatch(builder, 100);
    if (attempt < 3) {
      builder.push({ type: 'try-again' });
    }
  }
  return builder.finish({
    finalPhase: 'evidence-pending',
    terminalCause: 'cadence-unqualified',
    attemptCount: 3,
    activeGenerationId: null,
    requiredEffectTypes: ['capture-terminal-draft', 'terminate-generation'],
  });
}

function buildPairedWarmedAutoFailure(cleanup = { status: 'succeeded', cause: null }) {
  const builder = new ScenarioBuilder();
  const firstTap = builder.push(tapEvent({ eventTimestampMs: 1_000, audioNow: 5 }));
  builder.push(effectCallback(
    'effect-failed',
    firstTap.effects[0],
    'context-resume-failed',
  ));
  builder.push(teardownSettlement(builder.state, cleanup));
  return builder.finish({
    finalPhase: 'evidence-pending',
    terminalCause: 'context-resume-failed',
    activeGenerationId: null,
    pairedWarmedAutoFailure: {
      cause: 'paired-session-unavailable',
      runValue: 'session-1',
      slot: 2,
      thermalState: 'warmed',
      assignedClass: 'LOW_EDGE',
    },
    requiredEffectTypes: ['capture-terminal-draft', 'application-teardown'],
  });
}

function buildJitterOutlierRecovery() {
  const builder = new ScenarioBuilder();
  const intervals = [500, 510, 900, 495, 505, 500, 500];
  let timestamp = 1_000;
  let audioNow = 10;
  builder.push(tapEvent({ eventTimestampMs: timestamp, audioNow }));
  for (const interval of intervals) {
    timestamp += interval;
    audioNow += interval / 1_000;
    builder.push(tapEvent({ eventTimestampMs: timestamp, audioNow }));
  }
  return builder.finish({
    finalPhase: 'armed',
    terminalCause: null,
    activeGenerationId: 1,
    requiredEffectTypes: ['schedule-predictions'],
  });
}

function buildUnstableSilence() {
  const builder = new ScenarioBuilder();
  builder.push(tapEvent({ eventTimestampMs: 1_000, audioNow: 5 }));
  builder.push({
    type: 'idle-deadline',
    sessionId: builder.state.sessionId,
    generationId: builder.state.activeGenerationId,
    deadlineTimestampMs: builder.state.silenceDeadlineTimestampMs,
  });
  builder.push(generationSettlement(builder.state));
  return builder.finish({
    finalPhase: 'ready',
    terminalCause: null,
    activeGenerationId: null,
    requiredEffectTypes: ['terminate-generation'],
  });
}

function buildTapBeforeLock() {
  const builder = new ScenarioBuilder();
  armCadence(builder, 120);
  const staleLock = lockEvent(builder.state);
  builder.push(tapEvent({ eventTimestampMs: 3_500, audioNow: 12.5 }));
  builder.push(staleLock);
  return builder.finish({
    finalPhase: 'armed',
    terminalCause: null,
    activeGenerationId: 1,
  });
}

function buildLockBeforeTap() {
  const builder = new ScenarioBuilder();
  armCadence(builder, 110);
  builder.push(lockEvent(builder.state));
  builder.push(tapEvent({
    eventTimestampMs: builder.state.estimatorSnapshot.timestampWindowMs.at(-1) + 25,
    audioNow: builder.state.lastAudioNow + 0.025,
  }));
  builder.push(generationSettlement(builder.state));
  return builder.finish({
    finalPhase: 'evidence-pending',
    terminalCause: 'trial-cancelled',
    activeGenerationId: null,
    requiredEffectTypes: ['capture-terminal-draft', 'terminate-generation'],
  });
}

function buildArmedDestabilization() {
  const builder = new ScenarioBuilder();
  armCadence(builder, 120);
  builder.push(tapEvent({ eventTimestampMs: 3_600, audioNow: 12.6 }));
  return builder.finish({
    finalPhase: 'tracking',
    terminalCause: null,
    activeGenerationId: 1,
    requiredEffectTypes: ['cancel-predictions'],
  });
}

function buildOwnership(disposition) {
  const edge = disposition === 'cancel';
  const builder = new ScenarioBuilder(edge ? 'session-1' : 'session-1', edge ? 'warmed' : 'cold');
  armCadence(builder, edge ? 107.5 : 110);
  const event = lockEvent(builder.state);
  if (disposition !== 'bridge') {
    event.lockDeadlineAudioTime = builder.state.lastAudioNow;
    event.audioNow = builder.state.lastAudioNow;
  }
  builder.push(event);
  return builder.finish({
    finalPhase: 'handoff',
    terminalCause: null,
    ownershipDisposition: disposition,
    skippedBeatCount: disposition === 'bridge' ? 1 : 0,
    requiredEffectTypes: ['commit-handoff-plan'],
  });
}

function buildCatchUpLimit() {
  const builder = new ScenarioBuilder();
  armCadence(builder, 110);
  const beat = 60 / builder.state.estimatorSnapshot.estimatedBpmExact;
  builder.push(lockEvent(builder.state, {
    audioNow: builder.state.lastMappedTapAudioTime + 4 * beat + 0.100,
  }));
  builder.push(generationSettlement(builder.state));
  return builder.finish({
    finalPhase: 'evidence-pending',
    terminalCause: 'lock-timer-too-late',
    activeGenerationId: null,
    requiredEffectTypes: ['capture-terminal-draft', 'terminate-generation'],
  });
}

function buildSmoke(runValue) {
  const builder = new ScenarioBuilder(runValue);
  armCadence(builder, 110);
  builder.push(lockEvent(builder.state));
  commitHandoff(builder);
  if (runValue === 'smoke-playing') {
    enterPlaying(builder);
  }
  const cancellationTimestampMs = builder.state.estimatorSnapshot.timestampWindowMs.at(-1) + 25;
  builder.push(tapEvent({
    eventTimestampMs: cancellationTimestampMs,
    audioNow: builder.state.lastAudioNow + 0.025,
  }));
  builder.push(generationSettlement(builder.state));
  builder.push(tapEvent({
    eventTimestampMs: cancellationTimestampMs + 1,
    audioNow: builder.state.lastAudioNow === null ? 20 : builder.state.lastAudioNow + 0.001,
  }));
  const probe = builder.state.pendingEffects.find(({ effectType }) => (
    effectType === 'run-smoke-probe'
  ));
  builder.push({
    type: 'smoke-probe-settled',
    sessionId: probe.sessionId,
    generationId: probe.generationId,
    effectId: probe.effectId,
    effectType: probe.effectType,
    cleanup: { status: 'succeeded', cause: null },
  });
  return builder.finish({
    finalPhase: 'evidence-pending',
    terminalCause: 'trial-cancelled',
    activeGenerationId: null,
    smokeStatus: 'completed',
    requiredEffectTypes: ['run-smoke-probe'],
  });
}

function buildVisibilityRace(visibilityWins) {
  const builder = new ScenarioBuilder();
  armCadence(builder, 110);
  if (visibilityWins) {
    builder.push({
      type: 'runtime-interrupted',
      reason: 'hidden',
      audioNow: builder.state.lastAudioNow + 0.010,
    });
    builder.push({ type: 'unexpected-context-closed' });
    builder.push(generationSettlement(builder.state));
    builder.push({ type: 'foreground-restored' });
    return builder.finish({
      finalPhase: 'evidence-pending',
      terminalCause: 'runtime-context-interrupted',
      activeGenerationId: null,
      requiredEffectTypes: ['terminate-generation'],
    });
  }
  builder.push({ type: 'unexpected-context-closed' });
  builder.push({
    type: 'runtime-interrupted',
    reason: 'hidden',
    audioNow: builder.state.lastAudioNow + 0.010,
  });
  builder.push(teardownSettlement(builder.state));
  return builder.finish({
    finalPhase: 'evidence-pending',
    terminalCause: 'runtime-context-closed',
    activeGenerationId: null,
    requiredEffectTypes: ['application-teardown'],
  });
}

function buildResumeFailure(cleanup = { status: 'succeeded', cause: null }) {
  return buildPairedWarmedAutoFailure(cleanup);
}

function buildCompletion(natural) {
  const builder = new ScenarioBuilder();
  armCadence(builder, 110);
  builder.push(lockEvent(builder.state));
  commitHandoff(builder);
  enterPlaying(builder);
  if (natural) {
    builder.push({
      type: 'natural-track-end',
      sessionId: builder.state.trackSource.sessionId,
      generationId: builder.state.trackSource.generationId,
      sourceId: builder.state.trackSource.sourceId,
      audioNow: builder.state.lastAudioNow + 1,
    });
  } else {
    builder.push({ type: 'end-trial', audioNow: builder.state.lastAudioNow + 1 });
  }
  builder.push(generationSettlement(builder.state));
  return builder.finish({
    finalPhase: 'evidence-pending',
    terminalCause: 'trial-complete',
    activeGenerationId: null,
    requiredEffectTypes: ['capture-terminal-draft', 'terminate-generation'],
  });
}

function buildStaleCallbacks() {
  const builder = new ScenarioBuilder();
  const firstTap = builder.push(tapEvent({ eventTimestampMs: 1_000, audioNow: 5 }));
  const resume = firstTap.effects[0];
  builder.push({
    type: 'idle-deadline',
    sessionId: builder.state.sessionId,
    generationId: builder.state.activeGenerationId,
    deadlineTimestampMs: builder.state.silenceDeadlineTimestampMs,
  });
  const staleSettlement = generationSettlement(builder.state);
  builder.push(staleSettlement);
  builder.push(staleSettlement);
  builder.push(effectCallback('effect-succeeded', resume));
  builder.push(effectCallback('effect-succeeded', resume));
  builder.push({
    type: 'source-ended',
    sessionId: builder.state.sessionId,
    generationId: 1,
    sourceId: 'generation-1-source-unknown',
  });
  return builder.finish({
    finalPhase: 'ready',
    terminalCause: null,
    activeGenerationId: null,
    requiredEffectTypes: ['reconcile-stale-resume'],
  });
}

export const REPLAY_CASES = Object.freeze([
  Object.freeze({
    name: 'center-match',
    build: () => buildMatch({
      bpm: 110,
      runValue: 'session-1',
      actualClass: 'CENTER',
      assignedClassMatched: true,
    }),
  }),
  Object.freeze({
    name: 'low-edge-match',
    build: () => buildMatch({
      bpm: 107.5,
      runValue: 'session-1',
      thermalState: 'warmed',
      actualClass: 'LOW_EDGE',
      assignedClassMatched: true,
    }),
  }),
  Object.freeze({
    name: 'high-edge-match',
    build: () => buildMatch({
      bpm: 112.5,
      runValue: 'session-2',
      actualClass: 'HIGH_EDGE',
      assignedClassMatched: true,
    }),
  }),
  Object.freeze({ name: 'just-below-window', build: () => buildOutside(106.9999) }),
  Object.freeze({ name: 'just-above-window', build: () => buildOutside(113.0001) }),
  Object.freeze({
    name: 'wrong-assigned-class',
    build: () => buildMatch({
      bpm: 110,
      runValue: 'session-1',
      thermalState: 'warmed',
      actualClass: 'CENTER',
      assignedClassMatched: false,
    }),
  }),
  Object.freeze({ name: 'three-no-match-attempts', build: buildThreeNoMatchAttempts }),
  Object.freeze({ name: 'paired-warmed-auto-failure', build: buildPairedWarmedAutoFailure }),
  Object.freeze({ name: 'jitter-outlier-recovery', build: buildJitterOutlierRecovery }),
  Object.freeze({ name: 'unstable-silence', build: buildUnstableSilence }),
  Object.freeze({ name: 'tap-before-lock', build: buildTapBeforeLock }),
  Object.freeze({ name: 'lock-before-tap', build: buildLockBeforeTap }),
  Object.freeze({ name: 'armed-destabilization', build: buildArmedDestabilization }),
  Object.freeze({ name: 'bridge-ownership', build: () => buildOwnership('bridge') }),
  Object.freeze({ name: 'adopt-ownership', build: () => buildOwnership('adopt') }),
  Object.freeze({ name: 'cancel-ownership', build: () => buildOwnership('cancel') }),
  Object.freeze({ name: 'catch-up-limit', build: buildCatchUpLimit }),
  Object.freeze({ name: 'smoke-crossfade-complete', build: () => buildSmoke('smoke-crossfade') }),
  Object.freeze({ name: 'smoke-playing-complete', build: () => buildSmoke('smoke-playing') }),
  Object.freeze({
    name: 'visibility-wins-context-race',
    build: () => buildVisibilityRace(true),
  }),
  Object.freeze({
    name: 'context-close-wins-visibility-race',
    build: () => buildVisibilityRace(false),
  }),
  Object.freeze({ name: 'resume-failure', build: buildResumeFailure }),
  Object.freeze({
    name: 'teardown-failure',
    build: () => buildResumeFailure({ status: 'failed', cause: 'context-close-failed' }),
  }),
  Object.freeze({ name: 'natural-end', build: () => buildCompletion(true) }),
  Object.freeze({ name: 'end-trial', build: () => buildCompletion(false) }),
  Object.freeze({ name: 'stale-callbacks', build: buildStaleCallbacks }),
]);
