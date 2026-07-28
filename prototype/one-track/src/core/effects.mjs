import { assertBuildIdentity } from '../build-identity.mjs';
import { assertHandoffPlan } from './handoff-planner.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_STRING_LENGTH = 512;
const MAX_ARRAY_LENGTH = 64;
const MAX_RECORD_KEYS = 64;
const MAX_DEPTH = 8;

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

export const EFFECT_TYPES = Object.freeze([
  'open-track-picker',
  'begin-track-load',
  'cancel-track-load',
  'application-teardown',
  'resume-context',
  'schedule-acknowledgment',
  'set-idle-deadline',
  'set-lock-deadline',
  'cancel-deadline',
  'schedule-predictions',
  'cancel-predictions',
  'capture-terminal-draft',
  'terminate-generation',
  'commit-handoff-plan',
  'reconcile-stale-resume',
  'run-smoke-probe',
]);

const EFFECT_KEYS = Object.freeze([
  'sessionId',
  'generationId',
  'effectId',
  'effectType',
  'payload',
]);

const PAYLOAD_KEYS = Object.freeze({
  'open-track-picker': Object.freeze([]),
  'begin-track-load': Object.freeze(['selectionId', 'loadToken']),
  'cancel-track-load': Object.freeze(['loadToken']),
  'application-teardown': Object.freeze(['reason', 'loadToken', 'loadedSessionId']),
  'resume-context': Object.freeze(['loadedSessionId']),
  'schedule-acknowledgment': Object.freeze([
    'sourceId',
    'mappedTapAudioTime',
    'scheduledAudioTime',
  ]),
  'set-idle-deadline': Object.freeze(['deadlineTimestampMs']),
  'set-lock-deadline': Object.freeze(['deadlineTimestampMs']),
  'cancel-deadline': Object.freeze(['deadlineTimestampMs']),
  'schedule-predictions': Object.freeze(['predictions']),
  'cancel-predictions': Object.freeze(['sourceIds', 'audioNow']),
  'capture-terminal-draft': Object.freeze(['terminalDraft']),
  'terminate-generation': Object.freeze(['reason', 'audioNow']),
  'commit-handoff-plan': Object.freeze(['plan']),
  'reconcile-stale-resume': Object.freeze([
    'loadedSessionId',
    'staleGenerationId',
    'currentGenerationId',
  ]),
  'run-smoke-probe': Object.freeze([
    'loadedSessionId',
    'sourceId',
    'tapTimestampMs',
    'mappedTapAudioTime',
    'scheduledAudioTime',
    'holdMilliseconds',
    'rampMilliseconds',
    'stopMilliseconds',
  ]),
});

const TEARDOWN_REASONS = Object.freeze([
  'load-cancelled',
  'load-failed',
  'unload-track',
  'unexpected-context-closed',
  'context-resume-failed',
  'generation-cleanup-failed',
  'runtime-context-closed',
  'startup-timeout',
  'protocol-reset',
]);

const GENERATION_TERMINATION_REASONS = Object.freeze([
  'tap-timestamp-invalid',
  'unstable-silence',
  'tap-grid-too-late',
  'no-match',
  'lock-timer-too-late',
  'schedule-failed',
  'cadence-unqualified',
  'runtime-context-interrupted',
  'trial-cancelled',
  'trial-complete',
]);

const TERMINAL_DRAFT_KEYS = Object.freeze([
  'sessionId',
  'generationId',
  'cause',
  'runValue',
  'recordKind',
  'acceptedTap',
  'estimatedBpmExact',
  'matchDecision',
  'attempts',
  'pairedWarmedAutoFailure',
]);
const PAIRED_WARMED_AUTO_FAILURE_KEYS = Object.freeze([
  'cause',
  'runValue',
  'slot',
  'thermalState',
  'assignedClass',
]);
const MATCH_DECISION_KEYS = Object.freeze([
  'estimatedBpmExact',
  'withinApplicationWindow',
  'actualClass',
  'assignedClass',
  'assignedClassMatched',
]);
const ATTEMPT_KEYS = Object.freeze([
  'outcome',
  'generationId',
  'estimatedBpmExact',
  'actualClass',
  'assignedClass',
  'assignedClassMatched',
]);
const TERMINAL_DRAFT_CAUSES = Object.freeze([
  'tap-timestamp-invalid',
  'tap-grid-too-late',
  'lock-timer-too-late',
  'schedule-failed',
  'cadence-unqualified',
  'context-resume-failed',
  'runtime-context-interrupted',
  'runtime-context-closed',
  'startup-timeout',
  'trial-cancelled',
  'trial-complete',
]);
const CADENCE_CLASSES = Object.freeze(['CENTER', 'LOW_EDGE', 'HIGH_EDGE']);

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

function isFiniteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function readDenseArray(candidate, label, maximumLength = MAX_ARRAY_LENGTH) {
  if (!Array.isArray(candidate)
      || Object.getPrototypeOf(candidate) !== Array.prototype
      || candidate.length > maximumLength) {
    throw new TypeError(`${label} must be a bounded dense ordinary array`);
  }
  const expectedKeys = [
    ...Array.from({ length: candidate.length }, (_, index) => String(index)),
    'length',
  ];
  const ownKeys = Reflect.ownKeys(candidate);
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  if (ownKeys.length !== expectedKeys.length
      || ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
      || expectedKeys.slice(0, -1).some((key) => {
        const descriptor = descriptors[key];
        return descriptor === undefined
          || descriptor.enumerable !== true
          || !Object.hasOwn(descriptor, 'value');
      })) {
    throw new TypeError(`${label} must be a bounded dense ordinary array`);
  }
  return expectedKeys.slice(0, -1).map((key) => descriptors[key].value);
}

function validateSourceIds(candidate) {
  const sourceIds = readDenseArray(candidate, 'cancel-predictions sourceIds');
  if (sourceIds.length === 0
      || sourceIds.some((sourceId) => !isBoundedIdentifier(sourceId))
      || new Set(sourceIds).size !== sourceIds.length) {
    throw new TypeError('cancel-predictions sourceIds are invalid');
  }
}

function validatePredictions(candidate) {
  const predictions = readDenseArray(candidate, 'schedule-predictions predictions', 2);
  if (predictions.length === 0) {
    throw new TypeError('schedule-predictions requires one or two predictions');
  }
  const sourceIds = new Set();
  const scheduledTimes = new Set();
  for (const predictionCandidate of predictions) {
    const prediction = readExactOrdinaryDataRecord(
      predictionCandidate,
      ['sourceId', 'scheduledAudioTime'],
      'prediction',
    );
    if (!isBoundedIdentifier(prediction.sourceId)
        || !isFiniteNonnegative(prediction.scheduledAudioTime)
        || sourceIds.has(prediction.sourceId)
        || scheduledTimes.has(prediction.scheduledAudioTime)) {
      throw new TypeError('schedule-predictions prediction is invalid');
    }
    sourceIds.add(prediction.sourceId);
    scheduledTimes.add(prediction.scheduledAudioTime);
  }
}

function copyPureData(value, ancestors = new Set(), depth = 0) {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('effect payload numbers must be finite');
    }
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) {
      throw new TypeError('effect payload strings must be bounded');
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError('effect payload must contain only pure declarative data');
  }
  if (depth >= MAX_DEPTH || ancestors.has(value)) {
    throw new TypeError('effect payload must be bounded and acyclic');
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_ARRAY_LENGTH) {
      throw new TypeError('effect payload arrays must be bounded dense ordinary arrays');
    }
    const expectedKeys = [
      ...Array.from({ length: value.length }, (_, index) => String(index)),
      'length',
    ];
    const ownKeys = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (ownKeys.length !== expectedKeys.length
        || ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
        || expectedKeys.slice(0, -1).some((key) => {
          const descriptor = descriptors[key];
          return descriptor === undefined
            || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value');
        })) {
      throw new TypeError('effect payload arrays must be bounded dense ordinary arrays');
    }
    return Object.freeze(expectedKeys.slice(0, -1).map(
      (key) => copyPureData(descriptors[key].value, nextAncestors, depth + 1),
    ));
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('effect payload records must have the ordinary object prototype');
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > MAX_RECORD_KEYS
      || ownKeys.some((key) => typeof key !== 'string' || key.length === 0 || key.length > 64)) {
    throw new TypeError('effect payload records must have bounded string keys');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (ownKeys.some((key) => {
    const descriptor = descriptors[key];
    return descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value');
  })) {
    throw new TypeError('effect payload records must contain only enumerable data properties');
  }
  return Object.freeze(Object.fromEntries(ownKeys.map((key) => [
    key,
    copyPureData(descriptors[key].value, nextAncestors, depth + 1),
  ])));
}

function isRecursivelyFrozenPureData(value, seen = new Set()) {
  if (value === null
      || typeof value === 'boolean'
      || typeof value === 'string'
      || (typeof value === 'number' && Number.isFinite(value))) {
    return true;
  }
  if (typeof value !== 'object' || seen.has(value) || !Object.isFrozen(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype) {
    return false;
  }
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const valid = Reflect.ownKeys(value).every((key) => {
    const descriptor = descriptors[key];
    return typeof key === 'string'
      && (key === 'length' || descriptor.enumerable === true)
      && Object.hasOwn(descriptor, 'value')
      && (key === 'length' || isRecursivelyFrozenPureData(descriptor.value, seen));
  });
  seen.delete(value);
  return valid;
}

function validateTerminalDraft(candidate) {
  const values = readExactOrdinaryDataRecord(
    candidate,
    TERMINAL_DRAFT_KEYS,
    'terminal draft',
  );
  copyPureData(candidate);
  if (!isRecursivelyFrozenPureData(candidate)
      || !isBoundedIdentifier(values.sessionId)
      || !Number.isSafeInteger(values.generationId)
      || values.generationId <= 0
      || !TERMINAL_DRAFT_CAUSES.includes(values.cause)
      || !isBoundedIdentifier(values.runValue)
      || !['scored', 'smoke'].includes(values.recordKind)
      || values.acceptedTap !== true
      || (values.estimatedBpmExact !== null
        && !Number.isFinite(values.estimatedBpmExact))) {
    throw new TypeError('capture-terminal-draft terminalDraft is invalid');
  }

  if (values.matchDecision !== null) {
    const decision = readExactOrdinaryDataRecord(
      values.matchDecision,
      MATCH_DECISION_KEYS,
      'terminal draft matchDecision',
    );
    if (!isRecursivelyFrozenPureData(values.matchDecision)
        || !Number.isFinite(decision.estimatedBpmExact)
        || typeof decision.withinApplicationWindow !== 'boolean'
        || (decision.actualClass !== null && !CADENCE_CLASSES.includes(decision.actualClass))
        || (decision.assignedClass !== null && !CADENCE_CLASSES.includes(decision.assignedClass))
        || typeof decision.assignedClassMatched !== 'boolean') {
      throw new TypeError('capture-terminal-draft matchDecision is invalid');
    }
  }

  const attempts = readDenseArray(values.attempts, 'terminal draft attempts', 3);
  if (!Object.isFrozen(values.attempts)) {
    throw new TypeError('capture-terminal-draft attempts must be frozen');
  }
  for (const attemptCandidate of attempts) {
    const attempt = readExactOrdinaryDataRecord(
      attemptCandidate,
      ATTEMPT_KEYS,
      'terminal draft attempt',
    );
    if (!isRecursivelyFrozenPureData(attemptCandidate)
        || attempt.outcome !== 'cadence-unqualified'
        || !Number.isSafeInteger(attempt.generationId)
        || attempt.generationId <= 0
        || !Number.isFinite(attempt.estimatedBpmExact)
        || attempt.actualClass !== null
        || (attempt.assignedClass !== null && !CADENCE_CLASSES.includes(attempt.assignedClass))
        || attempt.assignedClassMatched !== false) {
      throw new TypeError('capture-terminal-draft attempt is invalid');
    }
  }
  if (values.pairedWarmedAutoFailure !== null) {
    const paired = readExactOrdinaryDataRecord(
      values.pairedWarmedAutoFailure,
      PAIRED_WARMED_AUTO_FAILURE_KEYS,
      'paired warmed auto-failure',
    );
    if (!isRecursivelyFrozenPureData(values.pairedWarmedAutoFailure)
        || paired.cause !== 'paired-session-unavailable'
        || !isBoundedIdentifier(paired.runValue)
        || !Number.isSafeInteger(paired.slot)
        || paired.slot <= 0
        || paired.thermalState !== 'warmed'
        || !CADENCE_CLASSES.includes(paired.assignedClass)) {
      throw new TypeError('capture-terminal-draft paired warmed auto-failure is invalid');
    }
  }
  return candidate;
}

function validatePayload(effectType, candidate, effectGenerationId) {
  const keys = PAYLOAD_KEYS[effectType];
  const values = readExactOrdinaryDataRecord(candidate, keys, `${effectType} payload`);
  if (effectType === 'begin-track-load') {
    if (!isBoundedIdentifier(values.selectionId)
        || !Number.isSafeInteger(values.loadToken)
        || values.loadToken <= 0) {
      throw new TypeError('begin-track-load payload identifiers are invalid');
    }
  } else if (effectType === 'cancel-track-load') {
    if (!Number.isSafeInteger(values.loadToken) || values.loadToken <= 0) {
      throw new TypeError('cancel-track-load loadToken is invalid');
    }
  } else if (effectType === 'application-teardown') {
    if (!TEARDOWN_REASONS.includes(values.reason)
        || (values.loadToken !== null
          && (!Number.isSafeInteger(values.loadToken) || values.loadToken <= 0))
        || (values.loadedSessionId !== null && !isBoundedIdentifier(values.loadedSessionId))) {
      throw new TypeError('application-teardown payload is invalid');
    }
  } else if (effectType === 'resume-context') {
    if (!isBoundedIdentifier(values.loadedSessionId)) {
      throw new TypeError('resume-context loadedSessionId is invalid');
    }
  } else if (effectType === 'schedule-acknowledgment') {
    if (!isBoundedIdentifier(values.sourceId)
        || !isFiniteNonnegative(values.mappedTapAudioTime)
        || !isFiniteNonnegative(values.scheduledAudioTime)) {
      throw new TypeError('schedule-acknowledgment payload is invalid');
    }
  } else if (effectType === 'set-idle-deadline'
      || effectType === 'set-lock-deadline'
      || effectType === 'cancel-deadline') {
    if (!Number.isFinite(values.deadlineTimestampMs)) {
      throw new TypeError(`${effectType} deadlineTimestampMs is invalid`);
    }
  } else if (effectType === 'schedule-predictions') {
    validatePredictions(values.predictions);
  } else if (effectType === 'cancel-predictions') {
    validateSourceIds(values.sourceIds);
    if (!isFiniteNonnegative(values.audioNow)) {
      throw new TypeError('cancel-predictions audioNow is invalid');
    }
  } else if (effectType === 'capture-terminal-draft') {
    return Object.freeze({ terminalDraft: validateTerminalDraft(values.terminalDraft) });
  } else if (effectType === 'terminate-generation') {
    if (!GENERATION_TERMINATION_REASONS.includes(values.reason)
        || !isFiniteNonnegative(values.audioNow)) {
      throw new TypeError('terminate-generation payload is invalid');
    }
  } else if (effectType === 'commit-handoff-plan') {
    assertHandoffPlan(values.plan);
    if (values.plan.generationId !== `generation-${effectGenerationId}`) {
      throw new TypeError('commit-handoff-plan generation ownership is invalid');
    }
    return Object.freeze({ plan: values.plan });
  } else if (effectType === 'reconcile-stale-resume') {
    if (!isBoundedIdentifier(values.loadedSessionId)
        || !Number.isSafeInteger(values.staleGenerationId)
        || values.staleGenerationId <= 0
        || (values.currentGenerationId !== null
          && (!Number.isSafeInteger(values.currentGenerationId)
            || values.currentGenerationId <= 0))) {
      throw new TypeError('reconcile-stale-resume payload is invalid');
    }
  } else if (effectType === 'run-smoke-probe') {
    if (!isBoundedIdentifier(values.loadedSessionId)
        || !isBoundedIdentifier(values.sourceId)
        || !Number.isFinite(values.tapTimestampMs)
        || !isFiniteNonnegative(values.mappedTapAudioTime)
        || !isFiniteNonnegative(values.scheduledAudioTime)
        || values.holdMilliseconds !== 250
        || values.rampMilliseconds !== 20
        || values.stopMilliseconds !== 25) {
      throw new TypeError('run-smoke-probe payload is invalid');
    }
  }
  return copyPureData(values);
}

function readEffect(candidate, requireFrozen) {
  const values = readExactOrdinaryDataRecord(candidate, EFFECT_KEYS, 'effect');
  if (!isBoundedIdentifier(values.sessionId)
      || !Number.isSafeInteger(values.generationId)
      || values.generationId < 0
      || !Number.isSafeInteger(values.effectId)
      || values.effectId <= 0
      || !EFFECT_TYPES.includes(values.effectType)) {
    throw new TypeError('effect header is invalid');
  }
  const payload = validatePayload(values.effectType, values.payload, values.generationId);
  if (requireFrozen && !isRecursivelyFrozenPureData(candidate)) {
    throw new TypeError('effect must be recursively frozen');
  }
  return { ...values, payload };
}

export function createDeclarativeEffect(input) {
  const values = readEffect(input, false);
  return Object.freeze({
    sessionId: values.sessionId,
    generationId: values.generationId,
    effectId: values.effectId,
    effectType: values.effectType,
    payload: values.payload,
  });
}

export function assertDeclarativeEffect(candidate) {
  readEffect(candidate, true);
  return true;
}
