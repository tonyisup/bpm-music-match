import { assertBuildIdentity } from '../build-identity.mjs';
import {
  ASSET_IDENTITY,
  EXPERIMENT_CONFIG_IDENTITY,
  ONE_TRACK_CONFIG,
} from '../config.mjs';
import {
  RUN_TABLE,
  RUN_VALUES,
  advanceRunContext,
  assertRunContext,
  freezeColdContextAtFirstAcceptedTap,
} from './run-context.mjs';
import * as tapEstimator from './tap-estimator.mjs';
import {
  HandoffPlannerFailure,
  createHandoffPlan,
  createPredictionOwnershipSnapshot,
} from './handoff-planner.mjs';
import {
  EFFECT_TYPES,
  createDeclarativeEffect,
} from './effects.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';
const GENUINE_STATES = new WeakSet();
const MAX_IDENTIFIER_LENGTH = 128;
const RUN_CONTEXT_KEYS = Object.freeze([
  'runValue',
  'session',
  'slot',
  'thermalState',
  'assignedClass',
  'recordKind',
  'cancellationPhase',
  'scored',
  'contextFrozenAtFirstAcceptedTap',
]);
const EFFECT_CALLBACK_KEYS = Object.freeze([
  'sessionId',
  'generationId',
  'effectId',
  'effectType',
]);
const EVENT_SCHEMAS = Object.freeze({
  'choose-track': Object.freeze(['type']),
  'selection-cancelled': Object.freeze(['type']),
  'file-selected': Object.freeze(['type', 'selectionId']),
  'load-succeeded': Object.freeze([
    'type',
    ...EFFECT_CALLBACK_KEYS,
    'loadToken',
    'loadedSessionId',
    'assetIdentity',
    'experimentConfigIdentity',
  ]),
  'load-failed': Object.freeze([
    'type',
    ...EFFECT_CALLBACK_KEYS,
    'loadToken',
    'cause',
  ]),
  'cancel-loading': Object.freeze(['type']),
  'application-teardown-settled': Object.freeze([
    'type',
    ...EFFECT_CALLBACK_KEYS,
    'cleanup',
  ]),
  'generation-cleanup-settled': Object.freeze([
    'type',
    ...EFFECT_CALLBACK_KEYS,
    'cleanup',
  ]),
  'generation-cleanup-faulted': Object.freeze([
    'type',
    'sessionId',
    'generationId',
    'sourceId',
    'cause',
  ]),
  'unload-track': Object.freeze(['type']),
  'try-again': Object.freeze(['type']),
  'unexpected-context-closed': Object.freeze(['type']),
  'startup-fatal': Object.freeze(['type', 'cause']),
  'application-fatal': Object.freeze(['type', 'cause']),
  'runtime-interrupted': Object.freeze(['type', 'reason', 'audioNow']),
  'foreground-restored': Object.freeze(['type']),
  'evidence-resolved': Object.freeze([
    'type',
    'terminalRecordReceiptId',
    'verdict',
    'downloaded',
  ]),
  'reset-session': Object.freeze(['type']),
  'end-trial': Object.freeze(['type', 'audioNow']),
  'song-only-boundary': Object.freeze([
    'type',
    'sessionId',
    'generationId',
    'sourceId',
  ]),
  'natural-track-end': Object.freeze([
    'type',
    'sessionId',
    'generationId',
    'sourceId',
    'audioNow',
  ]),
  'smoke-probe-settled': Object.freeze([
    'type',
    ...EFFECT_CALLBACK_KEYS,
    'cleanup',
  ]),
  'effect-succeeded': Object.freeze([
    'type',
    ...EFFECT_CALLBACK_KEYS,
  ]),
  'effect-failed': Object.freeze([
    'type',
    ...EFFECT_CALLBACK_KEYS,
    'cause',
  ]),
  'tap': Object.freeze([
    'type',
    'eventTimestampMs',
    'observedNowMs',
    'mappedTapAudioTime',
    'audioNow',
    'contextState',
    'outputSampleRate',
  ]),
  'tap-timing-invalid': Object.freeze(['type', 'audioNow']),
  'idle-deadline': Object.freeze([
    'type',
    'sessionId',
    'generationId',
    'deadlineTimestampMs',
  ]),
  'lock-deadline': Object.freeze([
    'type',
    'sessionId',
    'generationId',
    'deadlineTimestampMs',
    'lockDeadlineAudioTime',
    'audioNow',
    'outputSampleRate',
  ]),
  'source-ended': Object.freeze([
    'type',
    'sessionId',
    'generationId',
    'sourceId',
  ]),
});

export const LOAD_FAILURE_CAUSES = Object.freeze([
  'track-read-failed',
  'track-identity-failed',
  'track-metadata-invalid',
  'track-decode-failed',
  'track-bounds-invalid',
]);

export const CLEANUP_FAILURE_CAUSES = Object.freeze(['context-close-failed']);
export const GENERATION_CLEANUP_FAILURE_CAUSES = Object.freeze(['source-stop-failed']);
const SCHEDULING_EFFECT_TYPES = Object.freeze([
  'schedule-acknowledgment',
  'schedule-predictions',
  'cancel-predictions',
]);
const EFFECT_FAILURE_CAUSES = Object.freeze({
  'resume-context': 'context-resume-failed',
  'schedule-acknowledgment': 'schedule-failed',
  'schedule-predictions': 'schedule-failed',
  'cancel-predictions': 'schedule-failed',
  'commit-handoff-plan': 'schedule-failed',
});
const RUNTIME_INTERRUPTION_REASONS = Object.freeze(['hidden', 'suspended']);

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return Object.freeze(value);
}

function readExactOrdinaryDataRecord(candidate, keys, label) {
  if (candidate === null
      || typeof candidate !== 'object'
      || Array.isArray(candidate)
      || Object.getPrototypeOf(candidate) !== Object.prototype) {
    throw new TypeError(`${label} must be an exact ordinary data record`);
  }
  const ownKeys = Reflect.ownKeys(candidate);
  if (ownKeys.length !== keys.length
      || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    throw new TypeError(`${label} must be an exact ordinary data record`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  if (keys.some((key) => {
    const descriptor = descriptors[key];
    return descriptor === undefined
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value');
  })) {
    throw new TypeError(`${label} must contain only enumerable data properties`);
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function isBoundedIdentifier(value) {
  return typeof value === 'string'
    && value.length <= MAX_IDENTIFIER_LENGTH
    && /^[a-z][a-z0-9-]*$/.test(value);
}

function readRunContext(candidate) {
  const values = readExactOrdinaryDataRecord(candidate, RUN_CONTEXT_KEYS, 'run context');
  if (!Object.isFrozen(candidate) || !RUN_VALUES.includes(values.runValue)) {
    throw new TypeError('run context must be a frozen value from the closed run table');
  }
  const row = RUN_TABLE[values.runValue];
  const smoke = values.runValue.startsWith('smoke-');
  const expectedThermalStates = smoke ? ['smoke'] : ['cold', 'warmed'];
  if (!expectedThermalStates.includes(values.thermalState)) {
    throw new TypeError('run context thermal state is invalid');
  }
  const assignment = smoke ? null : row[values.thermalState];
  const expected = {
    runValue: values.runValue,
    session: values.runValue,
    slot: smoke ? null : assignment.slot,
    thermalState: smoke ? 'smoke' : values.thermalState,
    assignedClass: smoke ? null : assignment.assignedClass,
    recordKind: smoke ? 'smoke' : 'scored',
    cancellationPhase: smoke ? row.cancellationPhase : null,
    scored: !smoke,
    contextFrozenAtFirstAcceptedTap: values.contextFrozenAtFirstAcceptedTap,
  };
  const validFreezeFlag = typeof values.contextFrozenAtFirstAcceptedTap === 'boolean'
    && (!values.contextFrozenAtFirstAcceptedTap
      || (!smoke && values.thermalState === 'cold'));
  if (!validFreezeFlag
      || RUN_CONTEXT_KEYS.some((key) => !Object.is(values[key], expected[key]))) {
    throw new TypeError('run context values must match the closed run table');
  }
  return candidate;
}

function createState(fields) {
  const state = deepFreeze(fields);
  GENUINE_STATES.add(state);
  return state;
}

function createResult(state, effects = []) {
  return deepFreeze({ state, effects: [...effects] });
}

function readEffectHeader(event) {
  if (!isBoundedIdentifier(event.sessionId)
      || !Number.isSafeInteger(event.generationId)
      || event.generationId < 0
      || !Number.isSafeInteger(event.effectId)
      || event.effectId <= 0
      || typeof event.effectType !== 'string') {
    throw new TypeError('effect callback header is invalid');
  }
}

function readEvent(candidate) {
  if (candidate === null
      || typeof candidate !== 'object'
      || Array.isArray(candidate)
      || Object.getPrototypeOf(candidate) !== Object.prototype) {
    throw new TypeError('event must be an exact ordinary data record');
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const typeDescriptor = descriptors.type;
  if (typeDescriptor === undefined
      || typeDescriptor.enumerable !== true
      || !Object.hasOwn(typeDescriptor, 'value')
      || typeof typeDescriptor.value !== 'string'
      || !Object.hasOwn(EVENT_SCHEMAS, typeDescriptor.value)) {
    throw new TypeError('event type is invalid');
  }
  const event = readExactOrdinaryDataRecord(
    candidate,
    EVENT_SCHEMAS[typeDescriptor.value],
    `${typeDescriptor.value} event`,
  );
  if (event.type === 'file-selected' && !isBoundedIdentifier(event.selectionId)) {
    throw new TypeError('file-selected selectionId must be a bounded opaque identifier');
  }
  if (event.type === 'load-succeeded' || event.type === 'load-failed') {
    readEffectHeader(event);
    if (event.effectType !== 'begin-track-load'
        || !Number.isSafeInteger(event.loadToken)
        || event.loadToken <= 0) {
      throw new TypeError('load callback ownership is invalid');
    }
    if (event.type === 'load-succeeded' && !isBoundedIdentifier(event.loadedSessionId)) {
      throw new TypeError('loadedSessionId must be a bounded opaque identifier');
    }
    if (event.type === 'load-failed' && !LOAD_FAILURE_CAUSES.includes(event.cause)) {
      throw new TypeError('load failure cause is invalid');
    }
  }
  if (event.type === 'effect-succeeded' || event.type === 'effect-failed') {
    readEffectHeader(event);
    if (!EFFECT_TYPES.includes(event.effectType)
        || !Object.hasOwn(EFFECT_FAILURE_CAUSES, event.effectType)) {
      throw new TypeError('effect callback type is invalid');
    }
    if (event.type === 'effect-failed'
        && event.cause !== EFFECT_FAILURE_CAUSES[event.effectType]) {
      throw new TypeError('effect failure cause is invalid');
    }
  }
  if ((event.type === 'startup-fatal' || event.type === 'application-fatal')
      && event.cause !== 'startup-timeout') {
    throw new TypeError('startup fatal cause is invalid');
  }
  if (event.type === 'runtime-interrupted'
      && (!RUNTIME_INTERRUPTION_REASONS.includes(event.reason)
        || !Number.isFinite(event.audioNow)
        || event.audioNow < 0)) {
    throw new TypeError('runtime interruption reason is invalid');
  }
  if (event.type === 'evidence-resolved'
      && (!isBoundedIdentifier(event.terminalRecordReceiptId)
        || !['intentional', 'mechanical', 'not-judged'].includes(event.verdict)
        || event.downloaded !== true)) {
    throw new TypeError('resolved evidence must have a closed verdict and completed download');
  }
  if (event.type === 'end-trial'
      && (!Number.isFinite(event.audioNow) || event.audioNow < 0)) {
    throw new TypeError('end trial clock is invalid');
  }
  if (event.type === 'tap-timing-invalid'
      && (!Number.isFinite(event.audioNow) || event.audioNow < 0)) {
    throw new TypeError('invalid tap timing teardown clock is invalid');
  }
  if (event.type === 'tap') {
    const numericValues = [
      event.eventTimestampMs,
      event.observedNowMs,
      event.mappedTapAudioTime,
      event.audioNow,
      event.outputSampleRate,
    ];
    if (numericValues.some((value) => !Number.isFinite(value))
        || event.mappedTapAudioTime < 0
        || event.audioNow < 0
        || event.outputSampleRate <= 0
        || !Number.isFinite(1 / event.outputSampleRate)
        || !['running', 'suspended'].includes(event.contextState)) {
      throw new TypeError('tap clock values are invalid');
    }
    const expectedMappedTapAudioTime = event.audioNow
      + (event.eventTimestampMs - event.observedNowMs) / 1_000;
    if (!Object.is(event.mappedTapAudioTime, expectedMappedTapAudioTime)) {
      throw new TypeError('mappedTapAudioTime must match the exact clock mapping');
    }
  }
  if (event.type === 'idle-deadline' || event.type === 'lock-deadline') {
    if (!isBoundedIdentifier(event.sessionId)
        || !Number.isSafeInteger(event.generationId)
        || event.generationId <= 0
        || !Number.isFinite(event.deadlineTimestampMs)) {
      throw new TypeError(`${event.type} ownership is invalid`);
    }
    if (event.type === 'lock-deadline'
        && (!Number.isFinite(event.lockDeadlineAudioTime)
          || event.lockDeadlineAudioTime < 0
          || !Number.isFinite(event.audioNow)
          || event.audioNow < event.lockDeadlineAudioTime
          || !Number.isFinite(event.outputSampleRate)
          || event.outputSampleRate <= 0
          || !Number.isFinite(1 / event.outputSampleRate))) {
      throw new TypeError('lock deadline clock values are invalid');
    }
  }
  if (event.type === 'source-ended'
      || event.type === 'song-only-boundary'
      || event.type === 'natural-track-end') {
    if (!isBoundedIdentifier(event.sessionId)
        || !Number.isSafeInteger(event.generationId)
        || event.generationId <= 0
        || !isBoundedIdentifier(event.sourceId)) {
      throw new TypeError(`${event.type} ownership is invalid`);
    }
    if (event.type === 'natural-track-end'
        && (!Number.isFinite(event.audioNow) || event.audioNow < 0)) {
      throw new TypeError('natural track end clock is invalid');
    }
  }
  if (event.type === 'generation-cleanup-faulted'
      && (!isBoundedIdentifier(event.sessionId)
        || !Number.isSafeInteger(event.generationId)
        || event.generationId <= 0
        || !isBoundedIdentifier(event.sourceId)
        || event.cause !== 'source-stop-failed')) {
    throw new TypeError('generation cleanup fault ownership is invalid');
  }
  if (event.type === 'application-teardown-settled'
      || event.type === 'generation-cleanup-settled'
      || event.type === 'smoke-probe-settled') {
    readEffectHeader(event);
    if (event.type === 'application-teardown-settled'
        && event.effectType !== 'application-teardown') {
      throw new TypeError('cleanup settlement effectType is invalid');
    }
    if (event.type === 'generation-cleanup-settled'
        && (event.generationId <= 0 || event.effectType !== 'terminate-generation')) {
      throw new TypeError('cleanup settlement ownership is invalid');
    }
    if (event.type === 'smoke-probe-settled'
        && (event.generationId <= 0 || event.effectType !== 'run-smoke-probe')) {
      throw new TypeError('cleanup settlement effectType is invalid');
    }
    const cleanup = readExactOrdinaryDataRecord(
      event.cleanup,
      ['status', 'cause'],
      'cleanup result',
    );
    const failureCauses = event.type === 'application-teardown-settled'
      ? CLEANUP_FAILURE_CAUSES
      : GENERATION_CLEANUP_FAILURE_CAUSES;
    const validCleanup = (cleanup.status === 'succeeded' && cleanup.cause === null)
      || (cleanup.status === 'failed' && failureCauses.includes(cleanup.cause));
    if (!validCleanup) {
      throw new TypeError('cleanup result is invalid');
    }
    event.cleanup = cleanup;
  }
  return event;
}

function matchesLoad(state, event) {
  const load = state.activeLoad;
  return state.phase === 'loading-track'
    && load !== null
    && event.sessionId === load.sessionId
    && event.generationId === load.generationId
    && event.effectId === load.effectId
    && event.effectType === load.effectType
    && event.loadToken === load.loadToken;
}

function matchesTeardown(state, event) {
  return state.teardown !== null
    && event.sessionId === state.teardown.sessionId
    && event.generationId === state.teardown.generationId
    && event.effectId === state.teardown.effectId
    && event.effectType === state.teardown.effectType;
}

function matchesGenerationTermination(state, event) {
  const termination = state.generationTermination;
  return termination !== null
    && event.sessionId === state.sessionId
    && event.generationId === termination.generationId
    && event.effectId === termination.effectId
    && event.effectType === 'terminate-generation';
}

function makeEffect(state, effectId, effectType, payload, generationId = null) {
  return createDeclarativeEffect({
    sessionId: state.sessionId,
    generationId: generationId ?? state.activeGenerationId ?? 0,
    effectId,
    effectType,
    payload,
  });
}

function effectOwnership(effect) {
  return {
    sessionId: effect.sessionId,
    generationId: effect.generationId,
    effectId: effect.effectId,
    effectType: effect.effectType,
  };
}

function matchesEffectOwnership(ownership, event) {
  return ownership !== null
    && event.sessionId === ownership.sessionId
    && event.generationId === ownership.generationId
    && event.effectId === ownership.effectId
    && event.effectType === ownership.effectType;
}

function matchingPendingSchedulingEffect(state, event) {
  return state.pendingEffects.find((effect) => (
    SCHEDULING_EFFECT_TYPES.includes(effect.effectType)
      && matchesEffectOwnership(effect, event)
  )) ?? null;
}

function sourceId(generationId, sequence) {
  return `generation-${generationId}-source-${sequence}`;
}

function createPredictionGrid({
  generationId,
  firstSequence,
  lastMappedTapAudioTime,
  estimatedBpmExact,
  audioNow,
  maximumNewPredictions,
}) {
  const beatDurationSeconds = 60 / estimatedBpmExact;
  if (!Number.isFinite(beatDurationSeconds) || beatDurationSeconds <= 0) {
    return null;
  }
  const minimumLeadAudioTime = audioNow + 0.100;
  let firstAudioTime = lastMappedTapAudioTime + beatDurationSeconds;
  if (!Number.isFinite(minimumLeadAudioTime)
      || !Number.isFinite(firstAudioTime)
      || firstAudioTime <= lastMappedTapAudioTime) {
    return null;
  }
  let advances = 0;
  while (firstAudioTime < minimumLeadAudioTime) {
    if (advances >= 2) {
      return null;
    }
    const advancedAudioTime = firstAudioTime + beatDurationSeconds;
    if (!Number.isFinite(advancedAudioTime) || advancedAudioTime <= firstAudioTime) {
      return null;
    }
    firstAudioTime = advancedAudioTime;
    advances += 1;
  }
  const predictions = [];
  let scheduledAudioTime = firstAudioTime;
  for (let index = 0; index < maximumNewPredictions; index += 1) {
    if (!Number.isFinite(scheduledAudioTime)) {
      return null;
    }
    predictions.push({
      sourceId: sourceId(generationId, firstSequence + index),
      scheduledAudioTime,
    });
    const nextAudioTime = scheduledAudioTime + beatDurationSeconds;
    if (index + 1 < maximumNewPredictions
        && (!Number.isFinite(nextAudioTime) || nextAudioTime <= scheduledAudioTime)) {
      return null;
    }
    scheduledAudioTime = nextAudioTime;
  }
  return predictions;
}

function createPairedWarmedAutoFailure(state) {
  if (state.runContext.recordKind !== 'scored'
      || state.runContext.thermalState !== 'cold') {
    return null;
  }
  const warmed = RUN_TABLE[state.runContext.runValue].warmed;
  return deepFreeze({
    cause: 'paired-session-unavailable',
    runValue: state.runContext.runValue,
    slot: warmed.slot,
    thermalState: 'warmed',
    assignedClass: warmed.assignedClass,
  });
}

function terminalRecordReceiptId(state) {
  return `terminal-record-${state.sessionId}-generation-${state.activeGenerationId}`;
}

function createTerminalDraft(state, cause) {
  const attempts = state.attempts.map((attempt) => ({ ...attempt }));
  return deepFreeze({
    sessionId: state.sessionId,
    generationId: state.activeGenerationId,
    cause,
    runValue: state.runContext.runValue,
    recordKind: state.runContext.recordKind,
    acceptedTap: true,
    estimatedBpmExact: state.estimatorSnapshot?.estimatedBpmExact ?? null,
    matchDecision: state.matchDecision,
    attempts,
    pairedWarmedAutoFailure: state.pairedWarmedAutoFailure,
  });
}

function beginGenerationTermination(
  state,
  {
    reason,
    audioNow,
    cancelDeadline,
    targetPhase,
    captureTerminal = targetPhase === 'evidence-pending',
    transitionPhase = captureTerminal ? 'terminating-failure' : 'generation-settling',
    interruption = null,
  },
) {
  const terminalDraft = captureTerminal ? createTerminalDraft(state, reason) : null;
  const effects = [];
  let nextEffectId = state.nextEffectId;
  if (terminalDraft !== null) {
    effects.push(makeEffect(state, nextEffectId, 'capture-terminal-draft', {
      terminalDraft,
    }));
    nextEffectId += 1;
  }
  if (cancelDeadline && state.silenceDeadlineTimestampMs !== null) {
    effects.push(makeEffect(state, nextEffectId, 'cancel-deadline', {
      deadlineTimestampMs: state.silenceDeadlineTimestampMs,
    }));
    nextEffectId += 1;
  }
  const terminateEffect = makeEffect(state, nextEffectId, 'terminate-generation', {
    reason,
    audioNow,
  });
  effects.push(terminateEffect);
  nextEffectId += 1;
  return createResult(createState({
    ...state,
    phase: transitionPhase,
    nextEffectId,
    generationTermination: {
      generationId: state.activeGenerationId,
      effectId: terminateEffect.effectId,
      targetPhase,
      cause: reason,
    },
    terminalDraft,
    terminal: captureTerminal
      ? { cause: reason, diagnostics: [] }
      : { cause: null, diagnostics: [] },
    evidence: captureTerminal
      ? {
        status: 'terminal-captured',
        terminalRecordReceiptId: terminalRecordReceiptId(state),
        verdict: null,
        downloaded: false,
      }
      : state.evidence,
    interruption,
    cleanup: { status: 'pending', cause: null },
    pendingEffects: [terminateEffect],
  }), effects);
}

function beginPostTerminalGenerationTermination(state, { reason, audioNow }) {
  const terminateEffect = makeEffect(state, state.nextEffectId, 'terminate-generation', {
    reason,
    audioNow,
  });
  return createResult(createState({
    ...state,
    phase: 'terminating-failure',
    nextEffectId: state.nextEffectId + 1,
    generationTermination: {
      generationId: state.activeGenerationId,
      effectId: terminateEffect.effectId,
      targetPhase: 'evidence-pending',
      cause: reason,
    },
    terminal: {
      cause: state.terminal.cause,
      diagnostics: [...state.terminal.diagnostics, { cause: reason }],
    },
    cleanup: { status: 'pending', cause: null },
    pendingEffects: [terminateEffect],
  }), [terminateEffect]);
}

function predictionIsNotStarted(prediction, audioNow, outputSampleRate) {
  return prediction.scheduledAudioTime > audioNow + 1 / outputSampleRate;
}

function matchingPrediction(predictions, mappedTapAudioTime) {
  return predictions.find((prediction) => (
    mappedTapAudioTime >= prediction.scheduledAudioTime - 0.060
      && mappedTapAudioTime <= prediction.scheduledAudioTime + 0.060
  )) ?? null;
}

function beginApplicationTeardown(
  state,
  {
    reason,
    loadToken,
    loadedSessionId,
    targetPhase,
    terminalCause = null,
    cleanup = { status: 'pending', cause: null },
  },
) {
  const capturesTerminal = targetPhase === 'evidence-pending';
  const pairedWarmedAutoFailure = capturesTerminal && loadedSessionId !== null
    ? createPairedWarmedAutoFailure(state)
    : state.pairedWarmedAutoFailure;
  const terminalAuthority = pairedWarmedAutoFailure === state.pairedWarmedAutoFailure
    ? state
    : { ...state, pairedWarmedAutoFailure };
  const terminalDraft = capturesTerminal
    ? createTerminalDraft(terminalAuthority, terminalCause)
    : state.terminalDraft;
  const effects = [];
  let nextEffectId = state.nextEffectId;
  if (capturesTerminal) {
    effects.push(makeEffect(state, nextEffectId, 'capture-terminal-draft', {
      terminalDraft,
    }));
    nextEffectId += 1;
  }
  const effect = makeEffect(
    state,
    nextEffectId,
    'application-teardown',
    { reason, loadToken, loadedSessionId },
  );
  effects.push(effect);
  return createResult(createState({
    ...state,
    phase: capturesTerminal
      ? 'terminating-failure'
      : (targetPhase === 'error' ? 'error' : 'teardown-in-progress'),
    activeLoad: null,
    terminalDraft,
    pairedWarmedAutoFailure,
    terminal: terminalCause === null
      ? state.terminal
      : { cause: terminalCause, diagnostics: state.terminal.diagnostics },
    evidence: capturesTerminal
      ? {
        status: 'terminal-captured',
        terminalRecordReceiptId: terminalRecordReceiptId(state),
        verdict: null,
        downloaded: false,
      }
      : state.evidence,
    cleanup,
    resourceDisposition: 'teardown-pending',
    pendingEffects: [effect],
    teardown: {
      reason,
      targetPhase,
      sessionId: effect.sessionId,
      generationId: effect.generationId,
      effectId: effect.effectId,
      effectType: effect.effectType,
    },
    recoveryAction: null,
    nextEffectId: nextEffectId + 1,
  }), effects);
}

function beginPostTerminalApplicationTeardown(
  state,
  { reason, cleanup = { status: 'pending', cause: null } },
) {
  const teardownEffect = makeEffect(state, state.nextEffectId, 'application-teardown', {
    reason,
    loadToken: null,
    loadedSessionId: state.loadedSessionId,
  });
  return createResult(createState({
    ...state,
    phase: 'terminating-failure',
    activeLoad: null,
    terminal: {
      cause: state.terminal.cause,
      diagnostics: [...state.terminal.diagnostics, { cause: reason }],
    },
    cleanup,
    resourceDisposition: 'teardown-pending',
    pendingEffects: [teardownEffect],
    teardown: {
      reason,
      targetPhase: 'evidence-pending',
      sessionId: teardownEffect.sessionId,
      generationId: teardownEffect.generationId,
      effectId: teardownEffect.effectId,
      effectType: teardownEffect.effectType,
    },
    nextEffectId: state.nextEffectId + 1,
  }), [teardownEffect]);
}

function resetForSelection(state) {
  return {
    ...state,
    phase: 'selecting-track',
    loadedSessionId: null,
    activeLoad: null,
    terminal: { cause: null, diagnostics: [] },
    estimatorSnapshot: null,
    lastMappedTapAudioTime: null,
    lastAudioNow: null,
    outputSampleRate: null,
    silenceDeadlineTimestampMs: null,
    predictions: [],
    nextSourceSequence: null,
    resumeEffectId: null,
    pendingResume: null,
    retiredResumes: [],
    matchDecision: null,
    handoffPlan: null,
    pendingHandoffCommit: null,
    trackSource: null,
    smokeProbe: null,
    pendingAttempt: null,
    generationTermination: null,
    terminalDraft: null,
    pairedWarmedAutoFailure: null,
    evidence: {
      status: 'none',
      terminalRecordReceiptId: null,
      verdict: null,
      downloaded: false,
    },
    cleanup: { status: 'not-required', cause: null },
    resourceDisposition: 'none',
    teardown: null,
    interruption: null,
    recoveryAction: null,
  };
}

function clearedResolvedProtocolFields(
  state,
  { phase, runContext = state.runContext, loadedSessionId, recoveryAction },
) {
  return {
    ...state,
    phase,
    runContext,
    loadedSessionId,
    activeGenerationId: null,
    acceptedTap: false,
    estimatorSnapshot: null,
    lastMappedTapAudioTime: null,
    lastAudioNow: null,
    outputSampleRate: null,
    silenceDeadlineTimestampMs: null,
    predictions: [],
    nextSourceSequence: null,
    resumeEffectId: null,
    pendingResume: null,
    retiredResumes: loadedSessionId === null ? [] : state.retiredResumes,
    matchDecision: null,
    handoffPlan: null,
    pendingHandoffCommit: null,
    trackSource: null,
    smokeProbe: null,
    pendingAttempt: null,
    attempts: [],
    generationTermination: null,
    terminalDraft: null,
    pairedWarmedAutoFailure: null,
    terminal: { cause: null, diagnostics: [] },
    evidence: {
      status: 'none',
      terminalRecordReceiptId: null,
      verdict: null,
      downloaded: false,
    },
    cleanup: { status: 'not-required', cause: null },
    resourceDisposition: loadedSessionId === null ? 'released' : 'loaded',
    pendingEffects: [],
    teardown: null,
    interruption: null,
    recoveryAction,
  };
}

export function createInitialSessionState(runContext) {
  assertRunContext(runContext);
  const closedRunContext = readRunContext(runContext);
  return createState({
    phase: 'awaiting-track',
    sessionId: closedRunContext.session,
    runContext: closedRunContext,
    loadedSessionId: null,
    activeLoad: null,
    activeGenerationId: null,
    nextGenerationId: 1,
    nextEffectId: 1,
    nextLoadToken: 1,
    acceptedTap: false,
    estimatorSnapshot: null,
    lastMappedTapAudioTime: null,
    lastAudioNow: null,
    outputSampleRate: null,
    silenceDeadlineTimestampMs: null,
    predictions: [],
    nextSourceSequence: null,
    resumeEffectId: null,
    pendingResume: null,
    retiredResumes: [],
    matchDecision: null,
    handoffPlan: null,
    pendingHandoffCommit: null,
    trackSource: null,
    smokeProbe: null,
    pendingAttempt: null,
    attempts: [],
    generationTermination: null,
    terminalDraft: null,
    pairedWarmedAutoFailure: null,
    terminal: { cause: null, diagnostics: [] },
    evidence: {
      status: 'none',
      terminalRecordReceiptId: null,
      verdict: null,
      downloaded: false,
    },
    cleanup: { status: 'not-required', cause: null },
    resourceDisposition: 'none',
    pendingEffects: [],
    teardown: null,
    interruption: null,
    recoveryAction: null,
  });
}

function handleTap(state, event) {
  if (!['ready', 'tracking', 'armed'].includes(state.phase)) {
    return createResult(state);
  }
  const firstTap = state.activeGenerationId === null;
  const priorEstimator = firstTap
    ? tapEstimator.createTapEstimatorSnapshot()
    : state.estimatorSnapshot;
  const admission = tapEstimator.admitTap(
    priorEstimator,
    event.eventTimestampMs,
    event.observedNowMs,
  );
  if (admission.type === 'tap-rejected') {
    return firstTap
      ? createResult(state)
      : beginGenerationTermination(state, {
        reason: 'tap-timestamp-invalid',
        audioNow: event.audioNow,
        cancelDeadline: true,
        targetPhase: 'evidence-pending',
      });
  }

  const generationId = firstTap ? state.nextGenerationId : state.activeGenerationId;
  let runContext = state.runContext;
  if (firstTap
      && runContext.thermalState === 'cold'
      && !runContext.contextFrozenAtFirstAcceptedTap) {
    runContext = freezeColdContextAtFirstAcceptedTap(runContext);
  }

  const matchedPrediction = state.phase === 'armed'
    ? matchingPrediction(state.predictions, event.mappedTapAudioTime)
    : null;
  const retainedPredictions = [];
  const cancelledSourceIds = [];
  for (const prediction of state.predictions) {
    const notStarted = predictionIsNotStarted(
      prediction,
      event.audioNow,
      event.outputSampleRate,
    );
    if (notStarted && prediction !== matchedPrediction) {
      cancelledSourceIds.push(prediction.sourceId);
    } else {
      retainedPredictions.push(prediction);
    }
  }

  let nextSourceSequence = firstTap ? 1 : state.nextSourceSequence;
  const needsAcknowledgment = matchedPrediction === null;
  const acknowledgmentSourceId = needsAcknowledgment
    ? sourceId(generationId, nextSourceSequence)
    : null;
  if (needsAcknowledgment) {
    nextSourceSequence += 1;
  }

  let newPredictions = [];
  if (admission.snapshot.armed) {
    const retainedFutureCount = retainedPredictions.filter((prediction) => (
      predictionIsNotStarted(prediction, event.audioNow, event.outputSampleRate)
    )).length;
    const maximumNewPredictions = Math.max(0, 2 - retainedFutureCount);
    newPredictions = createPredictionGrid({
      generationId,
      firstSequence: nextSourceSequence,
      lastMappedTapAudioTime: event.mappedTapAudioTime,
      estimatedBpmExact: admission.snapshot.estimatedBpmExact,
      audioNow: event.audioNow,
      maximumNewPredictions,
    });
    if (newPredictions === null) {
      const terminationBase = firstTap
        ? createState({
          ...state,
          activeGenerationId: generationId,
          nextGenerationId: generationId + 1,
          lastAudioNow: event.audioNow,
        })
        : state;
      return beginGenerationTermination(terminationBase, {
        reason: 'tap-grid-too-late',
        audioNow: event.audioNow,
        cancelDeadline: !firstTap,
        targetPhase: 'evidence-pending',
      });
    }
    nextSourceSequence += newPredictions.length;
  }

  const effects = [];
  let nextEffectId = state.nextEffectId;
  let resumeEffectId = state.resumeEffectId;
  let pendingResume = state.pendingResume;
  let pendingEffects = state.pendingEffects;
  if (firstTap) {
    const resumeEffect = makeEffect(state, nextEffectId, 'resume-context', {
      loadedSessionId: state.loadedSessionId,
    }, generationId);
    effects.push(resumeEffect);
    pendingEffects = [resumeEffect];
    resumeEffectId = nextEffectId;
    pendingResume = effectOwnership(resumeEffect);
    nextEffectId += 1;
  }
  if (needsAcknowledgment) {
    effects.push(makeEffect(state, nextEffectId, 'schedule-acknowledgment', {
      sourceId: acknowledgmentSourceId,
      mappedTapAudioTime: event.mappedTapAudioTime,
      scheduledAudioTime: event.contextState === 'running'
        ? Math.max(event.mappedTapAudioTime, event.audioNow + 0.005)
        : event.audioNow + 0.020,
    }, generationId));
    nextEffectId += 1;
  }
  if (state.silenceDeadlineTimestampMs !== null) {
    effects.push(makeEffect(state, nextEffectId, 'cancel-deadline', {
      deadlineTimestampMs: state.silenceDeadlineTimestampMs,
    }, generationId));
    nextEffectId += 1;
  }
  effects.push(makeEffect(
    state,
    nextEffectId,
    admission.snapshot.armed ? 'set-lock-deadline' : 'set-idle-deadline',
    { deadlineTimestampMs: admission.snapshot.silenceDeadlineTimestampMs },
    generationId,
  ));
  nextEffectId += 1;
  if (cancelledSourceIds.length > 0) {
    effects.push(makeEffect(state, nextEffectId, 'cancel-predictions', {
      sourceIds: cancelledSourceIds,
      audioNow: event.audioNow,
    }, generationId));
    nextEffectId += 1;
  }
  if (newPredictions.length > 0) {
    effects.push(makeEffect(state, nextEffectId, 'schedule-predictions', {
      predictions: newPredictions,
    }, generationId));
    nextEffectId += 1;
  }
  pendingEffects = [
    ...pendingEffects.filter((effect) => !SCHEDULING_EFFECT_TYPES.includes(effect.effectType)),
    ...effects.filter((effect) => SCHEDULING_EFFECT_TYPES.includes(effect.effectType)),
  ];

  return createResult(createState({
    ...state,
    phase: admission.snapshot.armed ? 'armed' : 'tracking',
    runContext,
    activeGenerationId: generationId,
    nextGenerationId: firstTap ? generationId + 1 : state.nextGenerationId,
    nextEffectId,
    acceptedTap: true,
    estimatorSnapshot: admission.snapshot,
    lastMappedTapAudioTime: event.mappedTapAudioTime,
    lastAudioNow: event.audioNow,
    outputSampleRate: event.outputSampleRate,
    silenceDeadlineTimestampMs: admission.snapshot.silenceDeadlineTimestampMs,
    predictions: [...retainedPredictions, ...newPredictions],
    nextSourceSequence,
    resumeEffectId,
    pendingResume,
    terminal: { cause: null, diagnostics: [] },
    matchDecision: null,
    handoffPlan: null,
    pendingAttempt: null,
    pendingEffects,
  }), effects);
}

function classifyCadence(estimatedBpmExact) {
  if (estimatedBpmExact >= 109.25 && estimatedBpmExact <= 110.75) {
    return 'CENTER';
  }
  if (estimatedBpmExact >= 107 && estimatedBpmExact <= 107.75) {
    return 'LOW_EDGE';
  }
  if (estimatedBpmExact >= 112.25 && estimatedBpmExact <= 113) {
    return 'HIGH_EDGE';
  }
  return null;
}

function terminateLockDecision(state, reason, audioNow, targetPhase, fields) {
  const decisionState = createState({ ...state, ...fields });
  return beginGenerationTermination(decisionState, {
    reason,
    audioNow,
    cancelDeadline: true,
    targetPhase,
  });
}

function handleLockDeadline(state, event) {
  const matches = state.phase === 'armed'
    && event.sessionId === state.sessionId
    && event.generationId === state.activeGenerationId
    && Object.is(event.deadlineTimestampMs, state.silenceDeadlineTimestampMs);
  if (!matches) {
    return createResult(state);
  }
  if (!Object.is(event.outputSampleRate, state.outputSampleRate)) {
    throw new TypeError('lock deadline outputSampleRate must match the active generation');
  }

  const estimatedBpmExact = state.estimatorSnapshot.estimatedBpmExact;
  const actualClass = classifyCadence(estimatedBpmExact);
  const withinApplicationWindow = Math.abs(
    estimatedBpmExact - ONE_TRACK_CONFIG.trackBpm,
  ) <= ONE_TRACK_CONFIG.matchWindowBpm;
  const assignedClass = state.runContext.assignedClass;
  const matchDecision = {
    estimatedBpmExact,
    withinApplicationWindow,
    actualClass,
    assignedClass,
    assignedClassMatched: actualClass !== null && actualClass === assignedClass,
  };

  if (!withinApplicationWindow) {
    const pendingAttempt = {
      outcome: 'cadence-unqualified',
      generationId: state.activeGenerationId,
      estimatedBpmExact,
      actualClass: null,
      assignedClass,
      assignedClassMatched: false,
    };
    if (state.attempts.length === 2) {
      return terminateLockDecision(
        state,
        'cadence-unqualified',
        event.audioNow,
        'evidence-pending',
        {
          matchDecision,
          handoffPlan: null,
          pendingAttempt: null,
          attempts: [...state.attempts, pendingAttempt],
        },
      );
    }
    return terminateLockDecision(state, 'no-match', event.audioNow, 'no-match', {
      terminal: { cause: null, diagnostics: [] },
      matchDecision,
      handoffPlan: null,
      pendingAttempt,
    });
  }

  const ownershipSnapshot = createPredictionOwnershipSnapshot({
    ownedSourceIds: state.predictions.map(({ sourceId: ownedSourceId }) => ownedSourceId),
    predictions: state.predictions,
  });
  const estimatedBeatDurationSeconds = 60 / estimatedBpmExact;
  const candidateBeat1AudioTime = state.lastMappedTapAudioTime
    + estimatedBeatDurationSeconds;
  let plan;
  try {
    plan = createHandoffPlan({
      generationId: `generation-${state.activeGenerationId}`,
      assetIdentity: ASSET_IDENTITY,
      experimentConfigIdentity: EXPERIMENT_CONFIG_IDENTITY,
      estimatedBpmExact,
      lastTapAudioTime: state.lastMappedTapAudioTime,
      candidateBeat1AudioTime,
      lockDeadlineAudioTime: event.lockDeadlineAudioTime,
      audioNow: event.audioNow,
      outputSampleRate: event.outputSampleRate,
      ownershipSnapshot,
    });
  } catch (error) {
    if (!(error instanceof HandoffPlannerFailure)) {
      throw error;
    }
    const cause = error.code === 'catch-up-limit-exceeded'
      ? 'lock-timer-too-late'
      : 'schedule-failed';
    return terminateLockDecision(state, cause, event.audioNow, 'evidence-pending', {
      matchDecision,
      handoffPlan: null,
      pendingAttempt: null,
    });
  }

  const cancelDeadline = makeEffect(state, state.nextEffectId, 'cancel-deadline', {
    deadlineTimestampMs: state.silenceDeadlineTimestampMs,
  });
  const commitHandoff = makeEffect(state, state.nextEffectId + 1, 'commit-handoff-plan', {
    plan,
  });
  return createResult(createState({
    ...state,
    phase: 'handoff',
    nextEffectId: state.nextEffectId + 2,
    silenceDeadlineTimestampMs: null,
    matchDecision,
    handoffPlan: plan,
    pendingHandoffCommit: effectOwnership(commitHandoff),
    pendingAttempt: null,
    terminal: { cause: null, diagnostics: [] },
    pendingEffects: [...state.pendingEffects, commitHandoff],
  }), [cancelDeadline, commitHandoff]);
}

function matchesTrackSource(state, event) {
  return state.trackSource !== null
    && event.sessionId === state.trackSource.sessionId
    && event.generationId === state.trackSource.generationId
    && event.sourceId === state.trackSource.sourceId;
}

function beginTrialStop(state, {
  reason,
  audioNow,
  cancellationTapTimestampMs = null,
}) {
  const smokeCancellation = reason === 'trial-cancelled'
    && state.runContext.recordKind === 'smoke';
  const cancellationState = smokeCancellation
    ? createState({
      ...state,
      smokeProbe: {
        status: 'cancellation-settling',
        cancellationPhase: state.runContext.cancellationPhase,
        cancellationGenerationId: state.activeGenerationId,
        cancellationTapTimestampMs,
        replacementGenerationId: null,
        acknowledgmentEffectId: null,
        probeEffectId: null,
        probeSourceId: null,
        holdMilliseconds: null,
        rampMilliseconds: null,
        stopMilliseconds: null,
        probeCleanup: null,
      },
    })
    : state;
  return beginGenerationTermination(cancellationState, {
    reason,
    audioNow,
    cancelDeadline: false,
    targetPhase: smokeCancellation ? 'smoke-ready' : 'evidence-pending',
    captureTerminal: true,
    transitionPhase: 'cancelling',
  });
}

function beginSmokeProbe(state, event) {
  if (event.eventTimestampMs <= state.smokeProbe.cancellationTapTimestampMs
      || event.eventTimestampMs > event.observedNowMs + 16
      || event.eventTimestampMs < event.observedNowMs - 100) {
    return createResult(state);
  }
  const generationId = state.nextGenerationId;
  const scheduledAudioTime = event.contextState === 'running'
    ? Math.max(event.mappedTapAudioTime, event.audioNow + 0.005)
    : event.audioNow + 0.020;
  const probeSourceId = sourceId(generationId, 1);
  const resumeEffect = makeEffect(state, state.nextEffectId, 'resume-context', {
    loadedSessionId: state.loadedSessionId,
  }, generationId);
  const acknowledgmentEffect = makeEffect(
    state,
    state.nextEffectId + 1,
    'schedule-acknowledgment',
    {
      sourceId: probeSourceId,
      mappedTapAudioTime: event.mappedTapAudioTime,
      scheduledAudioTime,
    },
    generationId,
  );
  const probeEffect = makeEffect(
    state,
    state.nextEffectId + 2,
    'run-smoke-probe',
    {
      loadedSessionId: state.loadedSessionId,
      sourceId: probeSourceId,
      tapTimestampMs: event.eventTimestampMs,
      mappedTapAudioTime: event.mappedTapAudioTime,
      scheduledAudioTime,
      holdMilliseconds: 250,
      rampMilliseconds: 20,
      stopMilliseconds: 25,
    },
    generationId,
  );
  return createResult(createState({
    ...state,
    phase: 'smoke-probing',
    activeGenerationId: generationId,
    nextGenerationId: generationId + 1,
    nextEffectId: state.nextEffectId + 3,
    estimatorSnapshot: null,
    lastMappedTapAudioTime: event.mappedTapAudioTime,
    lastAudioNow: event.audioNow,
    outputSampleRate: event.outputSampleRate,
    silenceDeadlineTimestampMs: null,
    predictions: [],
    nextSourceSequence: 2,
    resumeEffectId: resumeEffect.effectId,
    pendingResume: effectOwnership(resumeEffect),
    pendingHandoffCommit: null,
    trackSource: null,
    smokeProbe: {
      ...state.smokeProbe,
      status: 'probe-pending',
      replacementGenerationId: generationId,
      acknowledgmentEffectId: acknowledgmentEffect.effectId,
      probeEffectId: probeEffect.effectId,
      probeSourceId,
      holdMilliseconds: probeEffect.payload.holdMilliseconds,
      rampMilliseconds: probeEffect.payload.rampMilliseconds,
      stopMilliseconds: probeEffect.payload.stopMilliseconds,
      probeCleanup: null,
    },
    cleanup: { status: 'pending', cause: null },
    pendingEffects: [resumeEffect, acknowledgmentEffect, probeEffect],
  }), [resumeEffect, acknowledgmentEffect, probeEffect]);
}

export function assertSessionState(candidate) {
  if (!GENUINE_STATES.has(candidate)) {
    throw new TypeError('state must be a genuine session state');
  }
  return true;
}

export function reduceSession(state, rawEvent) {
  assertSessionState(state);
  const event = readEvent(rawEvent);
  const activeRuntimePhase = [
    'tracking',
    'armed',
    'handoff',
    'playing',
  ].includes(state.phase) && state.activeGenerationId !== null;
  const callbackActivePhase = activeRuntimePhase || state.phase === 'smoke-probing';

  if (event.type === 'generation-cleanup-faulted') {
    const matches = activeRuntimePhase
      && event.sessionId === state.sessionId
      && event.generationId === state.activeGenerationId
      && state.generationTermination === null
      && state.terminal.cause === null;
    return matches
      ? beginGenerationTermination(state, {
        reason: 'schedule-failed',
        audioNow: state.lastAudioNow,
        cancelDeadline: state.silenceDeadlineTimestampMs !== null,
        targetPhase: 'evidence-pending',
      })
      : createResult(state);
  }

  if (event.type === 'tap-timing-invalid') {
    return activeRuntimePhase
      ? beginGenerationTermination(state, {
        reason: 'tap-timestamp-invalid',
        audioNow: event.audioNow,
        cancelDeadline: state.silenceDeadlineTimestampMs !== null,
        targetPhase: 'evidence-pending',
      })
      : createResult(state);
  }

  if (event.type === 'effect-succeeded') {
    if (matchesEffectOwnership(state.pendingResume, event)) {
      if (callbackActivePhase && state.activeGenerationId === event.generationId) {
        return createResult(createState({
          ...state,
          resumeEffectId: null,
          pendingResume: null,
          pendingEffects: state.pendingEffects.filter(
            (effect) => !matchesEffectOwnership(state.pendingResume, effect),
          ),
        }));
      }
      const reconcileEffect = state.loadedSessionId === null
        ? null
        : makeEffect(
          state,
          state.nextEffectId,
          'reconcile-stale-resume',
          {
            loadedSessionId: state.loadedSessionId,
            staleGenerationId: event.generationId,
            currentGenerationId: null,
          },
          event.generationId,
        );
      return createResult(createState({
        ...state,
        nextEffectId: state.nextEffectId + (reconcileEffect === null ? 0 : 1),
        resumeEffectId: null,
        pendingResume: null,
        pendingEffects: state.pendingEffects.filter(
          (effect) => !matchesEffectOwnership(state.pendingResume, effect),
        ),
      }), reconcileEffect === null ? [] : [reconcileEffect]);
    }
    const schedulingEffect = matchingPendingSchedulingEffect(state, event);
    if (schedulingEffect !== null) {
      return createResult(createState({
        ...state,
        pendingEffects: state.pendingEffects.filter(
          (effect) => effect !== schedulingEffect,
        ),
      }));
    }
    if (activeRuntimePhase && matchesEffectOwnership(state.pendingHandoffCommit, event)) {
      return createResult(createState({
        ...state,
        pendingHandoffCommit: null,
        trackSource: {
          sessionId: state.sessionId,
          generationId: state.activeGenerationId,
          sourceId: `generation-${state.activeGenerationId}-track-source`,
        },
        pendingEffects: state.pendingEffects.filter(
          (effect) => !matchesEffectOwnership(state.pendingHandoffCommit, effect),
        ),
      }));
    }
    const retiredResumeIndex = state.retiredResumes.findIndex(
      (ownership) => matchesEffectOwnership(ownership, event),
    );
    if (retiredResumeIndex !== -1) {
      const shouldReconcile = state.activeGenerationId === null
        && state.loadedSessionId !== null;
      const reconcileEffect = shouldReconcile
        ? makeEffect(
          state,
          state.nextEffectId,
          'reconcile-stale-resume',
          {
            loadedSessionId: state.loadedSessionId,
            staleGenerationId: event.generationId,
            currentGenerationId: null,
          },
          event.generationId,
        )
        : null;
      return createResult(createState({
        ...state,
        nextEffectId: state.nextEffectId + (reconcileEffect === null ? 0 : 1),
        retiredResumes: state.retiredResumes.filter(
          (_, index) => index !== retiredResumeIndex,
        ),
      }), reconcileEffect === null ? [] : [reconcileEffect]);
    }
    return createResult(state);
  }

  if (event.type === 'effect-failed') {
    if (matchesEffectOwnership(state.pendingResume, event)) {
      if (activeRuntimePhase && state.terminal.cause === null) {
        return beginApplicationTeardown(state, {
          reason: 'context-resume-failed',
          loadToken: null,
          loadedSessionId: state.loadedSessionId,
          targetPhase: 'evidence-pending',
          terminalCause: 'context-resume-failed',
        });
      }
      if (callbackActivePhase && state.terminal.cause !== null) {
        return beginPostTerminalApplicationTeardown(state, {
          reason: 'context-resume-failed',
        });
      }
      return createResult(createState({
        ...state,
        resumeEffectId: null,
        pendingResume: null,
        pendingEffects: state.pendingEffects.filter(
          (effect) => !matchesEffectOwnership(state.pendingResume, effect),
        ),
      }));
    }
    const retiredResumeIndex = state.retiredResumes.findIndex(
      (ownership) => matchesEffectOwnership(ownership, event),
    );
    if (retiredResumeIndex !== -1) {
      return createResult(createState({
        ...state,
        retiredResumes: state.retiredResumes.filter(
          (_, index) => index !== retiredResumeIndex,
        ),
      }));
    }
    const schedulingEffect = matchingPendingSchedulingEffect(state, event);
    if (activeRuntimePhase
        && state.terminal.cause === null
        && schedulingEffect !== null) {
      return beginGenerationTermination(state, {
        reason: 'schedule-failed',
        audioNow: state.lastAudioNow,
        cancelDeadline: state.silenceDeadlineTimestampMs !== null,
        targetPhase: 'evidence-pending',
      });
    }
    if (callbackActivePhase
        && state.terminal.cause !== null
        && schedulingEffect !== null) {
      return beginPostTerminalGenerationTermination(state, {
        reason: 'schedule-failed',
        audioNow: state.lastAudioNow,
      });
    }
    if (activeRuntimePhase
        && state.terminal.cause === null
        && matchesEffectOwnership(state.pendingHandoffCommit, event)) {
      return beginGenerationTermination(state, {
        reason: 'schedule-failed',
        audioNow: state.lastAudioNow,
        cancelDeadline: false,
        targetPhase: 'evidence-pending',
      });
    }
    return createResult(state);
  }

  if (event.type === 'runtime-interrupted') {
    return activeRuntimePhase
      ? beginGenerationTermination(state, {
        reason: 'runtime-context-interrupted',
        audioNow: event.audioNow,
        cancelDeadline: state.silenceDeadlineTimestampMs !== null,
        targetPhase: 'interrupted',
        captureTerminal: true,
        transitionPhase: 'interrupted',
        interruption: {
          reason: event.reason,
          foregroundReturned: false,
          cleanupSettled: false,
        },
      })
      : createResult(state);
  }

  if (event.type === 'foreground-restored') {
    if (state.phase !== 'interrupted' || state.interruption === null) {
      return createResult(state);
    }
    if (state.interruption.cleanupSettled) {
      return createResult(createState({
        ...state,
        phase: 'evidence-pending',
        evidence: { ...state.evidence, status: 'pending' },
        interruption: {
          ...state.interruption,
          foregroundReturned: true,
        },
      }));
    }
    return createResult(createState({
      ...state,
      interruption: {
        ...state.interruption,
        foregroundReturned: true,
      },
    }));
  }

  if (event.type === 'evidence-resolved') {
    if (state.phase !== 'evidence-pending'
        || event.terminalRecordReceiptId !== state.evidence.terminalRecordReceiptId) {
      return createResult(state);
    }
    return createResult(createState({
      ...state,
      phase: 'evidence-resolved',
      evidence: {
        status: 'resolved',
        terminalRecordReceiptId: event.terminalRecordReceiptId,
        verdict: event.verdict,
        downloaded: true,
      },
    }));
  }

  if (event.type === 'reset-session') {
    if (state.phase !== 'evidence-resolved') {
      return createResult(state);
    }
    if (state.loadedSessionId !== null
        && state.runContext.recordKind === 'scored'
        && state.runContext.thermalState === 'cold') {
      return createResult(createState(clearedResolvedProtocolFields(state, {
        phase: 'ready',
        runContext: advanceRunContext(state.runContext, {
          evidenceResolved: true,
          downloadGesture: state.evidence.downloaded,
          reset: true,
        }),
        loadedSessionId: state.loadedSessionId,
        recoveryAction: null,
      })));
    }
    if (state.loadedSessionId === null) {
      return createResult(createState(clearedResolvedProtocolFields(state, {
        phase: 'awaiting-track',
        loadedSessionId: null,
        recoveryAction: 'reload',
      })));
    }
    return beginApplicationTeardown(state, {
      reason: 'protocol-reset',
      loadToken: null,
      loadedSessionId: state.loadedSessionId,
      targetPhase: 'awaiting-track',
    });
  }

  if (event.type === 'startup-fatal' || event.type === 'application-fatal') {
    if (!activeRuntimePhase) {
      return createResult(state);
    }
    return beginApplicationTeardown(state, {
      reason: 'startup-timeout',
      loadToken: null,
      loadedSessionId: state.loadedSessionId,
      targetPhase: 'evidence-pending',
      terminalCause: 'startup-timeout',
    });
  }

  if (event.type === 'unexpected-context-closed' && activeRuntimePhase) {
    return beginApplicationTeardown(state, {
      reason: 'runtime-context-closed',
      loadToken: null,
      loadedSessionId: state.loadedSessionId,
      targetPhase: 'evidence-pending',
      terminalCause: 'runtime-context-closed',
    });
  }

  if (event.type === 'song-only-boundary') {
    if (state.phase !== 'handoff' || !matchesTrackSource(state, event)) {
      return createResult(state);
    }
    return createResult(createState({
      ...state,
      phase: 'playing',
    }));
  }

  if (event.type === 'natural-track-end') {
    return state.phase === 'playing' && matchesTrackSource(state, event)
      ? beginTrialStop(state, {
        reason: 'trial-complete',
        audioNow: event.audioNow,
      })
      : createResult(state);
  }

  if (event.type === 'end-trial') {
    return state.phase === 'playing'
      ? beginTrialStop(state, {
        reason: 'trial-complete',
        audioNow: event.audioNow,
      })
      : createResult(state);
  }

  if (event.type === 'tap'
      && (state.phase === 'handoff' || state.phase === 'playing')) {
    return beginTrialStop(state, {
      reason: 'trial-cancelled',
      audioNow: event.audioNow,
      cancellationTapTimestampMs: event.eventTimestampMs,
    });
  }

  if (event.type === 'tap'
      && state.phase === 'ready'
      && state.smokeProbe?.status === 'awaiting-tap') {
    return beginSmokeProbe(state, event);
  }

  if (event.type === 'tap') {
    return handleTap(state, event);
  }

  if (event.type === 'lock-deadline') {
    return handleLockDeadline(state, event);
  }

  if (event.type === 'idle-deadline') {
    const matches = state.phase === 'tracking'
      && event.sessionId === state.sessionId
      && event.generationId === state.activeGenerationId
      && Object.is(event.deadlineTimestampMs, state.silenceDeadlineTimestampMs);
    return matches
      ? beginGenerationTermination(state, {
        reason: 'unstable-silence',
        audioNow: state.lastAudioNow,
        cancelDeadline: false,
        targetPhase: 'ready',
      })
      : createResult(state);
  }

  if (state.phase === 'no-match'
      && state.pendingAttempt !== null
      && event.type === 'try-again') {
    return createResult(createState({
      ...state,
      phase: 'ready',
      attempts: [...state.attempts, state.pendingAttempt],
      pendingAttempt: null,
      matchDecision: null,
      handoffPlan: null,
      terminalDraft: null,
      terminal: { cause: null, diagnostics: [] },
      evidence: {
        status: 'none',
        terminalRecordReceiptId: null,
        verdict: null,
        downloaded: false,
      },
    }));
  }

  if (event.type === 'source-ended') {
    const predictionIndex = state.predictions.findIndex(
      (prediction) => prediction.sourceId === event.sourceId,
    );
    const matches = ['tracking', 'armed', 'handoff', 'playing'].includes(state.phase)
      && event.sessionId === state.sessionId
      && event.generationId === state.activeGenerationId
      && predictionIndex !== -1;
    if (!matches) {
      return createResult(state);
    }
    return createResult(createState({
      ...state,
      predictions: state.predictions.filter((_, index) => index !== predictionIndex),
    }));
  }

  if ((state.phase === 'awaiting-track'
      || (state.phase === 'error' && state.recoveryAction === 'choose-track'))
      && event.type === 'choose-track') {
    const effect = makeEffect(state, state.nextEffectId, 'open-track-picker', {});
    return createResult(createState({
      ...resetForSelection(state),
      nextEffectId: state.nextEffectId + 1,
      pendingEffects: [effect],
    }), [effect]);
  }

  if (state.phase === 'selecting-track' && event.type === 'selection-cancelled') {
    return createResult(createState({
      ...state,
      phase: 'awaiting-track',
      pendingEffects: [],
      resourceDisposition: 'none',
    }));
  }

  if (state.phase === 'selecting-track' && event.type === 'file-selected') {
    const loadToken = state.nextLoadToken;
    const effect = makeEffect(state, state.nextEffectId, 'begin-track-load', {
      selectionId: event.selectionId,
      loadToken,
    });
    return createResult(createState({
      ...state,
      phase: 'loading-track',
      activeLoad: {
        sessionId: effect.sessionId,
        generationId: effect.generationId,
        effectId: effect.effectId,
        effectType: effect.effectType,
        loadToken,
        selectionId: event.selectionId,
      },
      nextEffectId: state.nextEffectId + 1,
      nextLoadToken: loadToken + 1,
      resourceDisposition: 'loading',
      pendingEffects: [effect],
    }), [effect]);
  }

  if (event.type === 'load-succeeded') {
    if (!matchesLoad(state, event)) {
      return createResult(state);
    }
    if (event.assetIdentity !== ASSET_IDENTITY
        || event.experimentConfigIdentity !== EXPERIMENT_CONFIG_IDENTITY) {
      throw new TypeError('load success identities must be the locked authorities');
    }
    return createResult(createState({
      ...state,
      phase: 'ready',
      loadedSessionId: event.loadedSessionId,
      activeLoad: null,
      cleanup: { status: 'not-required', cause: null },
      resourceDisposition: 'loaded',
      pendingEffects: [],
    }));
  }

  if (event.type === 'load-failed') {
    if (!matchesLoad(state, event)) {
      return createResult(state);
    }
    return beginApplicationTeardown(state, {
      reason: 'load-failed',
      loadToken: event.loadToken,
      loadedSessionId: null,
      targetPhase: 'error',
      terminalCause: event.cause,
    });
  }

  if (state.phase === 'loading-track' && event.type === 'cancel-loading') {
    const loadToken = state.activeLoad.loadToken;
    const cancelEffect = makeEffect(
      state,
      state.nextEffectId,
      'cancel-track-load',
      { loadToken },
    );
    const teardownEffect = makeEffect(
      state,
      state.nextEffectId + 1,
      'application-teardown',
      { reason: 'load-cancelled', loadToken, loadedSessionId: null },
    );
    return createResult(createState({
      ...state,
      phase: 'teardown-in-progress',
      activeLoad: null,
      nextEffectId: state.nextEffectId + 2,
      cleanup: { status: 'pending', cause: null },
      resourceDisposition: 'teardown-pending',
      pendingEffects: [teardownEffect],
      teardown: {
        reason: 'load-cancelled',
        targetPhase: 'awaiting-track',
        sessionId: teardownEffect.sessionId,
        generationId: teardownEffect.generationId,
        effectId: teardownEffect.effectId,
        effectType: teardownEffect.effectType,
      },
    }), [cancelEffect, teardownEffect]);
  }

  if ((state.phase === 'ready' || state.phase === 'evidence-resolved')
      && state.loadedSessionId !== null
      && state.smokeProbe === null
      && event.type === 'unload-track') {
    return beginApplicationTeardown(state, {
      reason: 'unload-track',
      loadToken: null,
      loadedSessionId: state.loadedSessionId,
      targetPhase: 'awaiting-track',
    });
  }

  if (state.phase === 'ready'
      && state.smokeProbe === null
      && event.type === 'unexpected-context-closed') {
    return beginApplicationTeardown(state, {
      reason: 'unexpected-context-closed',
      loadToken: null,
      loadedSessionId: state.loadedSessionId,
      targetPhase: 'error',
      terminalCause: 'runtime-context-closed',
    });
  }

  if (event.type === 'smoke-probe-settled') {
    const matches = state.phase === 'smoke-probing'
      && state.smokeProbe !== null
      && event.sessionId === state.sessionId
      && event.generationId === state.smokeProbe.replacementGenerationId
      && event.effectId === state.smokeProbe.probeEffectId
      && event.effectType === 'run-smoke-probe';
    if (!matches) {
      return createResult(state);
    }
    const cleanupFailed = event.cleanup.status === 'failed';
    const retiredResumes = state.pendingResume === null
      ? state.retiredResumes
      : [...state.retiredResumes, state.pendingResume];
    return createResult(createState({
      ...state,
      phase: 'evidence-pending',
      activeGenerationId: null,
      estimatorSnapshot: null,
      lastMappedTapAudioTime: null,
      lastAudioNow: null,
      outputSampleRate: null,
      silenceDeadlineTimestampMs: null,
      predictions: [],
      nextSourceSequence: null,
      resumeEffectId: null,
      pendingResume: null,
      retiredResumes,
      pendingHandoffCommit: null,
      trackSource: null,
      smokeProbe: {
        ...state.smokeProbe,
        status: 'completed',
        probeCleanup: event.cleanup,
      },
      terminal: {
        cause: state.terminal.cause,
        diagnostics: cleanupFailed
          ? [...state.terminal.diagnostics, { cause: event.cleanup.cause }]
          : state.terminal.diagnostics,
      },
      evidence: { ...state.evidence, status: 'pending' },
      cleanup: event.cleanup,
      resourceDisposition: 'loaded',
      pendingEffects: [],
    }));
  }

  if (event.type === 'generation-cleanup-settled') {
    if (!matchesGenerationTermination(state, event)) {
      return createResult(state);
    }
    if (event.cleanup.status === 'failed') {
      const cleanupFailureState = createState({
        ...state,
        generationTermination: null,
        cleanup: event.cleanup,
        terminal: {
          cause: state.terminal.cause,
          diagnostics: [
            ...state.terminal.diagnostics,
            { cause: event.cleanup.cause },
          ],
        },
      });
      if (state.terminal.cause !== null) {
        return beginPostTerminalApplicationTeardown(cleanupFailureState, {
          reason: 'generation-cleanup-failed',
          cleanup: event.cleanup,
        });
      }
      return beginApplicationTeardown(cleanupFailureState, {
        reason: 'generation-cleanup-failed',
        loadToken: null,
        loadedSessionId: state.loadedSessionId,
        targetPhase: 'evidence-pending',
        terminalCause: 'schedule-failed',
        cleanup: event.cleanup,
      });
    }
    const targetPhase = state.generationTermination.targetPhase;
    const interrupted = targetPhase === 'interrupted';
    const smokeReady = targetPhase === 'smoke-ready';
    const evidencePending = targetPhase === 'evidence-pending'
      || (interrupted && state.interruption.foregroundReturned);
    const retainsTerminal = evidencePending || interrupted || smokeReady;
    const cleanupFailed = event.cleanup.status === 'failed';
    const terminal = retainsTerminal
      ? {
        cause: state.terminal.cause,
        diagnostics: cleanupFailed
          ? [...state.terminal.diagnostics, { cause: event.cleanup.cause }]
          : state.terminal.diagnostics,
      }
      : { cause: null, diagnostics: [] };
    const retiredResumes = state.pendingResume === null
      ? state.retiredResumes
      : [...state.retiredResumes, state.pendingResume];
    return createResult(createState({
      ...state,
      phase: evidencePending ? 'evidence-pending' : (smokeReady ? 'ready' : targetPhase),
      activeGenerationId: null,
      estimatorSnapshot: null,
      lastMappedTapAudioTime: null,
      lastAudioNow: null,
      outputSampleRate: null,
      silenceDeadlineTimestampMs: null,
      predictions: [],
      nextSourceSequence: null,
      resumeEffectId: null,
      pendingResume: null,
      retiredResumes,
      matchDecision: targetPhase === 'no-match' ? state.matchDecision : null,
      handoffPlan: null,
      pendingHandoffCommit: null,
      trackSource: null,
      smokeProbe: smokeReady
        ? {
          ...state.smokeProbe,
          status: 'awaiting-tap',
        }
        : state.smokeProbe,
      generationTermination: null,
      terminalDraft: retainsTerminal ? state.terminalDraft : null,
      terminal,
      evidence: evidencePending
        ? { ...state.evidence, status: 'pending' }
        : state.evidence,
      cleanup: event.cleanup,
      resourceDisposition: 'loaded',
      pendingEffects: [],
      interruption: interrupted
        ? {
          ...state.interruption,
          cleanupSettled: true,
        }
        : null,
    }));
  }

  if (event.type === 'application-teardown-settled') {
    if (!matchesTeardown(state, event)) {
      return createResult(state);
    }
    const cleanupFailed = event.cleanup.status === 'failed';
    const targetPhase = state.teardown.targetPhase;
    if (state.teardown.reason === 'protocol-reset' && !cleanupFailed) {
      return createResult(createState(clearedResolvedProtocolFields(state, {
        phase: 'awaiting-track',
        loadedSessionId: null,
        recoveryAction: 'reload',
      })));
    }
    const recoveryAction = cleanupFailed
      ? 'reload'
      : (targetPhase === 'error'
        ? (state.terminal.cause === 'track-metadata-invalid' ? 'reload' : 'choose-track')
        : null);
    const settledPhase = cleanupFailed && targetPhase !== 'evidence-pending'
      ? 'error'
      : targetPhase;
    return createResult(createState({
      ...state,
      phase: settledPhase,
      loadedSessionId: null,
      activeGenerationId: null,
      estimatorSnapshot: null,
      lastMappedTapAudioTime: null,
      lastAudioNow: null,
      outputSampleRate: null,
      silenceDeadlineTimestampMs: null,
      predictions: [],
      nextSourceSequence: null,
      resumeEffectId: null,
      pendingResume: null,
      retiredResumes: [],
      matchDecision: null,
      handoffPlan: null,
      pendingHandoffCommit: null,
      trackSource: null,
      generationTermination: null,
      terminal: cleanupFailed
        ? {
          cause: state.terminal.cause,
          diagnostics: [...state.terminal.diagnostics, { cause: event.cleanup.cause }],
        }
        : state.terminal,
      evidence: targetPhase === 'evidence-pending'
        ? { ...state.evidence, status: 'pending' }
        : state.evidence,
      cleanup: event.cleanup,
      resourceDisposition: cleanupFailed ? 'release-failed' : 'released',
      pendingEffects: [],
      teardown: null,
      interruption: null,
      recoveryAction,
    }));
  }

  return createResult(state);
}
