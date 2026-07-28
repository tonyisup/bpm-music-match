import { assertBuildIdentity } from '../build-identity.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';

export const EQUAL_POWER_CURVE_SAMPLE_COUNT = 128;

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

function assertNormalizedProgress(progress) {
  if (typeof progress !== 'number'
      || !Number.isFinite(progress)
      || progress < 0
      || progress > 1) {
    throw new RangeError('progress must be a finite number from 0 through 1');
  }
}

export function equalPowerGainsAtProgress(progress) {
  assertNormalizedProgress(progress);

  if (progress === 0) {
    return Object.freeze({ percussion: 1, music: 0 });
  }
  if (progress === 1) {
    return Object.freeze({ percussion: 0, music: 1 });
  }

  const angle = progress * Math.PI / 2;
  return Object.freeze({
    percussion: Math.cos(angle),
    music: Math.sin(angle),
  });
}

export function createEqualPowerCurves(sampleCount) {
  if (sampleCount !== EQUAL_POWER_CURVE_SAMPLE_COUNT) {
    throw new RangeError('sampleCount must be exactly 128');
  }

  const percussion = [];
  const music = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const progress = index / (sampleCount - 1);
    const gains = equalPowerGainsAtProgress(progress);
    percussion.push(gains.percussion);
    music.push(gains.music);
  }

  return Object.freeze({
    percussion: Object.freeze(percussion),
    music: Object.freeze(music),
  });
}
