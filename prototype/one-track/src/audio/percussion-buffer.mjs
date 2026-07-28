import { assertBuildIdentity } from '../build-identity.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';
const RECIPE_ID = 'kick-snare-v1';
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 96_000;
const BUFFER_DURATION_SECONDS = 0.200;
const KICK_DURATION_SECONDS = 0.120;
const SNARE_DURATION_SECONDS = 0.180;
const KICK_PEAK_GAIN = 0.56;
const SNARE_PEAK_GAIN = 0.26;

export const KICK_SNARE_V1_NOISE_SEED = 0x6d2b_79f5;

export const SMOKE_PROBE_POLICY = Object.freeze({
  policyId: 'smoke-probe-v1',
  holdDurationMilliseconds: 250,
  cancellationRampDurationMilliseconds: 20,
  cancellationStopDelayMilliseconds: 25,
});

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

function assertClosedOptions(options, argumentCount) {
  if (argumentCount !== 1
      || options === null
      || typeof options !== 'object'
      || Array.isArray(options)
      || Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError('percussion synthesis requires exactly one closed options record');
  }

  const keys = Reflect.ownKeys(options);
  if (keys.length !== 2
      || keys.some((key) => key !== 'recipeId' && key !== 'sampleRate')) {
    throw new TypeError('percussion options may contain only recipeId and sampleRate');
  }

  const descriptors = Object.getOwnPropertyDescriptors(options);
  for (const key of ['recipeId', 'sampleRate']) {
    const descriptor = descriptors[key];
    if (descriptor === undefined
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('percussion options require own enumerable data properties');
    }
  }

  if (descriptors.recipeId.value !== RECIPE_ID) {
    throw new TypeError(`recipeId must equal ${RECIPE_ID}`);
  }
  const sampleRate = descriptors.sampleRate.value;
  if (!Number.isSafeInteger(sampleRate)
      || sampleRate < MIN_SAMPLE_RATE
      || sampleRate > MAX_SAMPLE_RATE) {
    throw new TypeError(
      `sampleRate must be an integer from ${MIN_SAMPLE_RATE} through ${MAX_SAMPLE_RATE}`,
    );
  }
  return sampleRate;
}

function createXorShift32(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return (state / 0x1_0000_0000) * 2 - 1;
  };
}

function kickSample(timeSeconds) {
  if (timeSeconds >= KICK_DURATION_SECONDS) {
    return 0;
  }
  const normalizedTime = timeSeconds / KICK_DURATION_SECONDS;
  const envelope = (1 - normalizedTime) ** 3;
  const phaseCycles = (150 * timeSeconds)
    - ((50 / KICK_DURATION_SECONDS) * timeSeconds ** 2);
  return KICK_PEAK_GAIN * envelope * Math.sin(2 * Math.PI * phaseCycles);
}

export function synthesizePercussionBuffer(options) {
  const sampleRate = assertClosedOptions(options, arguments.length);
  const frameCount = Math.ceil(sampleRate * BUFFER_DURATION_SECONDS);
  const kickSamples = new Float32Array(frameCount);
  const snareSamples = new Float32Array(frameCount);
  const preTrimMonoSamples = new Float32Array(frameCount);
  const nextNoise = createXorShift32(KICK_SNARE_V1_NOISE_SEED);
  let previousNoise = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const timeSeconds = frame / sampleRate;
    const kick = kickSample(timeSeconds);
    let snare = 0;
    const noise = nextNoise();

    if (timeSeconds < SNARE_DURATION_SECONDS) {
      const attack = Math.min(timeSeconds / 0.002, 1);
      const decay = (1 - (timeSeconds / SNARE_DURATION_SECONDS)) ** 3;
      const highPassNoise = (noise - previousNoise) * 0.5;
      snare = SNARE_PEAK_GAIN * attack * decay * highPassNoise;
    }
    previousNoise = noise;

    kickSamples[frame] = kick;
    snareSamples[frame] = snare;
    preTrimMonoSamples[frame] = Math.fround(
      kickSamples[frame] + snareSamples[frame],
    );
  }

  return Object.freeze({
    recipeId: RECIPE_ID,
    sampleRate,
    channelCount: 1,
    frameCount,
    durationMilliseconds: BUFFER_DURATION_SECONDS * 1_000,
    preTrimMonoSamples,
    layers: Object.freeze({
      kickSamples,
      snareSamples,
    }),
  });
}
