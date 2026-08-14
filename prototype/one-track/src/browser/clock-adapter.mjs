import { assertBuildIdentity } from '../build-identity.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

function readClockSnapshot(candidate) {
  if (candidate === null
      || typeof candidate !== 'object'
      || Array.isArray(candidate)
      || Object.getPrototypeOf(candidate) !== Object.prototype) {
    throw new TypeError('audio clock snapshot is invalid');
  }
  const keys = Reflect.ownKeys(candidate);
  const expected = ['audioNow', 'contextState', 'outputSampleRate'];
  if (keys.length !== expected.length
      || keys.some((key) => typeof key !== 'string' || !expected.includes(key))
      || !Number.isFinite(candidate.audioNow)
      || candidate.audioNow < 0
      || !['running', 'suspended'].includes(candidate.contextState)
      || !Number.isFinite(candidate.outputSampleRate)
      || candidate.outputSampleRate <= 0
      || !Number.isFinite(1 / candidate.outputSampleRate)) {
    throw new TypeError('audio clock snapshot is invalid');
  }
  return candidate;
}

export function createTapClockEvent(eventTimestampMs, observedNowMs, candidate) {
  const clock = readClockSnapshot(candidate);
  const mappedTapAudioTime = clock.audioNow
    + (eventTimestampMs - observedNowMs) / 1_000;
  if (!Number.isFinite(eventTimestampMs)
      || !Number.isFinite(observedNowMs)
      || !Number.isFinite(mappedTapAudioTime)
      || mappedTapAudioTime < 0) {
    throw new TypeError('tap clock mapping is invalid');
  }
  return Object.freeze({
    type: 'tap',
    eventTimestampMs,
    observedNowMs,
    mappedTapAudioTime,
    audioNow: clock.audioNow,
    contextState: clock.contextState,
    outputSampleRate: clock.outputSampleRate,
  });
}

export function createDeadlineClockEvent(
  type,
  ownership,
  deadlineTimestampMs,
  observedNowMs,
  candidate,
) {
  const clock = readClockSnapshot(candidate);
  if (!['idle-deadline', 'lock-deadline'].includes(type)
      || ownership === null
      || typeof ownership !== 'object'
      || typeof ownership.sessionId !== 'string'
      || !Number.isSafeInteger(ownership.generationId)
      || ownership.generationId <= 0
      || !Number.isFinite(deadlineTimestampMs)
      || !Number.isFinite(observedNowMs)) {
    throw new TypeError('deadline clock mapping is invalid');
  }
  const common = {
    type,
    sessionId: ownership.sessionId,
    generationId: ownership.generationId,
    deadlineTimestampMs,
  };
  if (type === 'idle-deadline') return Object.freeze(common);
  const lockDeadlineAudioTime = clock.audioNow
    + Math.min(0, (deadlineTimestampMs - observedNowMs) / 1_000);
  if (!Number.isFinite(lockDeadlineAudioTime) || lockDeadlineAudioTime < 0) {
    throw new TypeError('deadline clock mapping is invalid');
  }
  return Object.freeze({
    ...common,
    lockDeadlineAudioTime,
    audioNow: clock.audioNow,
    outputSampleRate: clock.outputSampleRate,
  });
}
