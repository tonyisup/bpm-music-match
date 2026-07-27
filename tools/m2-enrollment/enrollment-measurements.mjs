import { assertEnrollmentBuildCommit } from './enrollment-build.mjs';

assertEnrollmentBuildCommit('__ENROLLMENT_BUILD_COMMIT__');

const MiB = 1024 * 1024;

const MAX_COMPRESSED_BYTES = 20 * MiB;
const MAX_DECODED_PCM_BYTES = 160 * MiB;
const MAX_DURATION_SECONDS = 360;
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 96_000;
const CUE_WINDOW_MILLISECONDS = 50;
const MIN_CUE_RMS = 0.010;
const MIN_CUE_PEAK = 0.050;
const LEAD_IN_BEATS = 4;
const POST_DOWNBEAT_BEATS = 3;
const MINIMUM_POST_CROSSFADE_TAIL_SECONDS = 2;

function compressedResult(compressedBytes, errorCode) {
  return {
    ok: errorCode === null,
    errorCode,
    compressedBytes,
    maxCompressedBytes: MAX_COMPRESSED_BYTES,
  };
}

export function preflightCompressedBytes(compressedBytes) {
  if (!Number.isSafeInteger(compressedBytes) || compressedBytes < 0) {
    return compressedResult(compressedBytes, 'compressed-size-invalid');
  }
  if (compressedBytes > MAX_COMPRESSED_BYTES) {
    return compressedResult(compressedBytes, 'compressed-size-limit-exceeded');
  }
  return compressedResult(compressedBytes, null);
}

function decodedResult(errorCode, calculatedDecodedPcmBytes = null) {
  return {
    ok: errorCode === null,
    errorCode,
    calculatedDecodedPcmBytes,
    maxDecodedPcmBytes: MAX_DECODED_PCM_BYTES,
  };
}

export function validateDecodedBounds({ durationSeconds, channelCount, sampleRate, frameCount }) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_DURATION_SECONDS) {
    return decodedResult('decoded-duration-invalid');
  }
  if (!Number.isInteger(channelCount) || (channelCount !== 1 && channelCount !== 2)) {
    return decodedResult('decoded-channel-count-invalid');
  }
  if (!Number.isInteger(sampleRate) || sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) {
    return decodedResult('decoded-sample-rate-invalid');
  }
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0) {
    return decodedResult('decoded-frame-count-invalid');
  }

  const calculatedDecodedPcmBytes = frameCount * channelCount * 4;
  if (!Number.isSafeInteger(calculatedDecodedPcmBytes)) {
    return decodedResult('decoded-pcm-size-invalid');
  }
  if (calculatedDecodedPcmBytes > MAX_DECODED_PCM_BYTES) {
    return decodedResult('decoded-pcm-limit-exceeded', calculatedDecodedPcmBytes);
  }

  const frameDurationSeconds = frameCount / sampleRate;
  const durationToleranceSeconds = 1 / sampleRate;
  const floatingTolerance = Number.EPSILON
    * Math.max(1, Math.abs(durationSeconds), Math.abs(frameDurationSeconds))
    * 8;
  if (Math.abs(durationSeconds - frameDurationSeconds) > durationToleranceSeconds + floatingTolerance) {
    return decodedResult('decoded-duration-frame-mismatch', calculatedDecodedPcmBytes);
  }
  return decodedResult(null, calculatedDecodedPcmBytes);
}

function timingResult(errorCode, beatDurationSeconds = null) {
  const minimumTargetEntryDownbeatSeconds = beatDurationSeconds === null
    ? null
    : LEAD_IN_BEATS * beatDurationSeconds;
  const minimumDecodedDurationSeconds = beatDurationSeconds === null
    ? null
    : minimumTargetEntryDownbeatSeconds
      + (POST_DOWNBEAT_BEATS * beatDurationSeconds)
      + MINIMUM_POST_CROSSFADE_TAIL_SECONDS;
  return {
    ok: errorCode === null,
    errorCode,
    beatDurationSeconds,
    minimumTargetEntryDownbeatSeconds,
    minimumDecodedDurationSeconds,
  };
}

export function validateTimingBounds({
  trackBpm,
  targetEntryDownbeatSeconds,
  decodedDurationSeconds,
}) {
  if (!Number.isFinite(trackBpm) || trackBpm <= 0) {
    return timingResult('track-bpm-invalid');
  }
  const beatDurationSeconds = 60 / trackBpm;
  const minimumTargetEntryDownbeatSeconds = LEAD_IN_BEATS * beatDurationSeconds;
  const minimumDecodedDurationSecondsFromLeadIn = minimumTargetEntryDownbeatSeconds
    + (POST_DOWNBEAT_BEATS * beatDurationSeconds)
    + MINIMUM_POST_CROSSFADE_TAIL_SECONDS;
  if (!Number.isFinite(beatDurationSeconds)
      || !Number.isFinite(minimumTargetEntryDownbeatSeconds)
      || !Number.isFinite(minimumDecodedDurationSecondsFromLeadIn)) {
    return timingResult('track-bpm-invalid');
  }
  if (!Number.isFinite(targetEntryDownbeatSeconds) || targetEntryDownbeatSeconds < 0) {
    return timingResult('target-downbeat-invalid', beatDurationSeconds);
  }
  if (!Number.isFinite(decodedDurationSeconds) || decodedDurationSeconds <= 0) {
    return timingResult('decoded-duration-invalid', beatDurationSeconds);
  }

  if (targetEntryDownbeatSeconds < minimumTargetEntryDownbeatSeconds) {
    return timingResult('target-downbeat-lead-in-invalid', beatDurationSeconds);
  }

  const minimumDecodedDurationSeconds = targetEntryDownbeatSeconds
    + (POST_DOWNBEAT_BEATS * beatDurationSeconds)
    + MINIMUM_POST_CROSSFADE_TAIL_SECONDS;
  if (!Number.isFinite(minimumDecodedDurationSeconds)) {
    return timingResult('target-downbeat-tail-invalid', beatDurationSeconds);
  }
  if (decodedDurationSeconds < minimumDecodedDurationSeconds) {
    const result = timingResult('target-downbeat-tail-invalid', beatDurationSeconds);
    result.minimumDecodedDurationSeconds = minimumDecodedDurationSeconds;
    return result;
  }

  const result = timingResult(null, beatDurationSeconds);
  result.minimumDecodedDurationSeconds = minimumDecodedDurationSeconds;
  return result;
}

export function analyzeCueEnergy({
  channelSamples,
  sampleRate,
  expectedChannelCount,
} = {}) {
  if (!Number.isInteger(sampleRate) || sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) {
    throw new TypeError('sample rate must be an integer from 8000 through 96000');
  }
  if (!Number.isInteger(expectedChannelCount)
      || (expectedChannelCount !== 1 && expectedChannelCount !== 2)) {
    throw new TypeError('expected channel count must be one or two');
  }
  if (!Array.isArray(channelSamples) || channelSamples.length !== expectedChannelCount) {
    throw new TypeError('channel samples must contain every expected channel');
  }

  const framesPerChannel = Math.round(sampleRate * (CUE_WINDOW_MILLISECONDS / 1000));
  let sampleScale = 0;
  let scaledSumSquares = 0;
  let peak = 0;
  let sampleCount = 0;
  for (const channel of channelSamples) {
    if ((!Array.isArray(channel) && !ArrayBuffer.isView(channel))
        || channel.length !== framesPerChannel) {
      throw new TypeError('channel samples must contain exactly 50 ms of finite samples per channel');
    }
    for (const sample of channel) {
      if (!Number.isFinite(sample)) {
        throw new TypeError('channel samples must contain exactly 50 ms of finite samples per channel');
      }
      const magnitude = Math.abs(sample);
      if (magnitude !== 0) {
        if (sampleScale < magnitude) {
          const scaleRatio = sampleScale / magnitude;
          scaledSumSquares = 1 + (scaledSumSquares * scaleRatio * scaleRatio);
          sampleScale = magnitude;
        } else {
          const scaleRatio = magnitude / sampleScale;
          scaledSumSquares += scaleRatio * scaleRatio;
        }
      }
      peak = Math.max(peak, magnitude);
      sampleCount += 1;
    }
  }

  const normalizedMeanSquare = Math.min(1, scaledSumSquares / sampleCount);
  const rms = sampleScale * Math.sqrt(normalizedMeanSquare);
  if (!Number.isFinite(rms)) {
    throw new TypeError('channel sample RMS must be finite');
  }
  return {
    rms,
    peak,
    framesPerChannel,
    sampleCount,
    windowMilliseconds: CUE_WINDOW_MILLISECONDS,
    compliant: rms >= MIN_CUE_RMS && peak >= MIN_CUE_PEAK,
  };
}

export const MEASUREMENT_LIMITS = Object.freeze({
  maxCompressedBytes: MAX_COMPRESSED_BYTES,
  maxDecodedPcmBytes: MAX_DECODED_PCM_BYTES,
  maxDurationSeconds: MAX_DURATION_SECONDS,
  minSampleRate: MIN_SAMPLE_RATE,
  maxSampleRate: MAX_SAMPLE_RATE,
});
