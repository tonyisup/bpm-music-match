export const AUDIO_MATH_BUILD_COMMIT = '__BUILD_COMMIT__';

const CANONICAL_CURVE_SAMPLES = 128;
const BPM = 120;
const BEAT_DURATION = 60 / BPM;
const START_LEAD_SECONDS = 0.1;
const PERCUSSION_BEATS = 8;
const CROSSFADE_START_BEAT_INDEX = 4;
const CROSSFADE_END_BEAT_INDEX = 8;
const MINIMUM_TAIL_SECONDS = 2;

function requireFinite(name, value) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
}

export function createEqualPowerCurves(sampleCount = CANONICAL_CURVE_SAMPLES) {
  if (!Number.isInteger(sampleCount) || sampleCount !== CANONICAL_CURVE_SAMPLES) {
    throw new RangeError(`equal-power curves require exactly ${CANONICAL_CURVE_SAMPLES} samples`);
  }

  const music = new Float32Array(sampleCount);
  const percussion = new Float32Array(sampleCount);
  const lastIndex = sampleCount - 1;
  for (let index = 0; index < sampleCount; index += 1) {
    const angle = (index / lastIndex) * (Math.PI / 2);
    music[index] = Math.sin(angle);
    percussion[index] = Math.cos(angle);
  }
  music[0] = 0;
  music[lastIndex] = 1;
  percussion[0] = 1;
  percussion[lastIndex] = 0;
  return { music, percussion };
}

export function createGatePlan({ audioNow, assetDurationSeconds }) {
  requireFinite('audioNow', audioNow);
  requireFinite('assetDurationSeconds', assetDurationSeconds);
  if (audioNow < 0) {
    throw new RangeError('audioNow must be non-negative');
  }

  const crossfadeEndTrackOffset = CROSSFADE_END_BEAT_INDEX * BEAT_DURATION;
  if (assetDurationSeconds < crossfadeEndTrackOffset + MINIMUM_TAIL_SECONDS) {
    throw new RangeError('assetDurationSeconds must cover crossfade completion plus a two-second tail');
  }

  const beatOneTime = audioNow + START_LEAD_SECONDS;
  const percussionTimes = Array.from(
    { length: PERCUSSION_BEATS },
    (_, index) => beatOneTime + (index * BEAT_DURATION),
  );
  const crossfadeStartTrackOffset = CROSSFADE_START_BEAT_INDEX * BEAT_DURATION;
  const crossfadeStartTime = beatOneTime + crossfadeStartTrackOffset;
  const crossfadeEndTime = beatOneTime + crossfadeEndTrackOffset;

  return {
    bpm: BPM,
    beatDuration: BEAT_DURATION,
    beatOneTime,
    percussionTimes,
    trackStartTime: beatOneTime,
    trackOffset: 0,
    crossfadeStartTime,
    crossfadeStartTrackOffset,
    crossfadeEndTime,
    naturalEndTime: beatOneTime + assetDurationSeconds,
    postCrossfadeTailSeconds: assetDurationSeconds - crossfadeEndTrackOffset,
  };
}
