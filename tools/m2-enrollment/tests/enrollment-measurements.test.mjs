import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeCueEnergy,
  preflightCompressedBytes,
  validateDecodedBounds,
  validateTimingBounds,
} from '../enrollment-measurements.mjs';
import { cueInput, validDecoded, validTiming } from './test-fixtures.mjs';

const MiB = 1024 * 1024;

test('compressed-byte preflight accepts the inclusive 20 MiB limit without byte content', () => {
  const result = preflightCompressedBytes(20 * MiB);

  assert.deepEqual(result, {
    ok: true,
    errorCode: null,
    compressedBytes: 20 * MiB,
    maxCompressedBytes: 20 * MiB,
  });
  assert.equal(Object.hasOwn(result, 'bytes'), false);
});

test('compressed-byte preflight rejects sizes above 20 MiB and invalid metadata', () => {
  assert.equal(preflightCompressedBytes((20 * MiB) + 1).errorCode, 'compressed-size-limit-exceeded');
  for (const compressedBytes of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(preflightCompressedBytes(compressedBytes).errorCode, 'compressed-size-invalid');
  }
});

test('decoded bounds accept the inclusive exact frame-based PCM limit', () => {
  const frameCount = (160 * MiB) / (2 * 4);
  const result = validateDecodedBounds(validDecoded({
    durationSeconds: frameCount / 96_000,
    channelCount: 2,
    sampleRate: 96_000,
    frameCount,
  }));

  assert.deepEqual(result, {
    ok: true,
    errorCode: null,
    calculatedDecodedPcmBytes: 160 * MiB,
    maxDecodedPcmBytes: 160 * MiB,
  });
});

test('decoded bounds require duration greater than zero and at most 360 seconds', () => {
  for (const durationSeconds of [0, -1, 360.000_001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(validateDecodedBounds(validDecoded({ durationSeconds })).errorCode, 'decoded-duration-invalid');
  }
  assert.equal(validateDecodedBounds(validDecoded({ durationSeconds: 360, sampleRate: 8_000, channelCount: 1 })).ok, true);
});

test('decoded bounds require one or two integer channels', () => {
  for (const channelCount of [0, 1.5, 3, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(validateDecodedBounds(validDecoded({ channelCount })).errorCode, 'decoded-channel-count-invalid');
  }
  assert.equal(validateDecodedBounds(validDecoded({ channelCount: 1 })).ok, true);
  assert.equal(validateDecodedBounds(validDecoded({ channelCount: 2 })).ok, true);
});

test('decoded bounds require an integer sample rate from 8 through 96 kHz', () => {
  for (const sampleRate of [7_999, 8_000.5, 96_001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(validateDecodedBounds(validDecoded({ sampleRate })).errorCode, 'decoded-sample-rate-invalid');
  }
  assert.equal(validateDecodedBounds(validDecoded({ sampleRate: 8_000 })).ok, true);
  assert.equal(validateDecodedBounds(validDecoded({ sampleRate: 96_000, durationSeconds: 100 })).ok, true);
});

test('decoded bounds reject exact PCM above 160 MiB even when the duration estimate would pass', () => {
  const frameCount = ((160 * MiB) / (2 * 4)) + 1;
  const durationSeconds = 200;
  const durationBasedEstimate = durationSeconds * 96_000 * 2 * 4;
  assert.equal(durationBasedEstimate < 160 * MiB, true);

  const result = validateDecodedBounds(validDecoded({
    durationSeconds,
    sampleRate: 96_000,
    frameCount,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'decoded-pcm-limit-exceeded');
  assert.equal(result.calculatedDecodedPcmBytes, frameCount * 2 * 4);
});

test('decoded bounds require a positive safe-integer frame count', () => {
  for (const frameCount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = validateDecodedBounds(validDecoded({ frameCount }));
    assert.equal(result.errorCode, 'decoded-frame-count-invalid', String(frameCount));
    assert.equal(result.calculatedDecodedPcmBytes, null, String(frameCount));
  }
});

test('decoded bounds require the exact PCM byte calculation to be a safe integer', () => {
  const result = validateDecodedBounds(validDecoded({ frameCount: Number.MAX_SAFE_INTEGER }));

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'decoded-pcm-size-invalid');
  assert.equal(result.calculatedDecodedPcmBytes, null);
});

test('decoded bounds reject a duration estimate more than one sample frame from frame count', () => {
  const frameCount = 8_640_000;
  const result = validateDecodedBounds(validDecoded({
    durationSeconds: (frameCount / 48_000) + (2 / 48_000),
    frameCount,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'decoded-duration-frame-mismatch');
  assert.equal(result.calculatedDecodedPcmBytes, frameCount * 2 * 4);
});

test('decoded bounds allow one sample frame of duration tolerance plus tiny floating noise', () => {
  const frameCount = 8_640_000;
  const frameDurationSeconds = frameCount / 48_000;
  const floatingNoise = Number.EPSILON * frameDurationSeconds * 2;
  const result = validateDecodedBounds(validDecoded({
    durationSeconds: frameDurationSeconds + (1 / 48_000) + floatingNoise,
    frameCount,
  }));

  assert.equal(result.ok, true);
  assert.equal(result.calculatedDecodedPcmBytes, frameCount * 2 * 4);
});

test('timing bounds require four complete lead-in beats before the target downbeat', () => {
  assert.equal(validateTimingBounds(validTiming({ targetEntryDownbeatSeconds: 2 })).ok, true);
  assert.equal(
    validateTimingBounds(validTiming({ targetEntryDownbeatSeconds: 2 - 1e-12 })).errorCode,
    'target-downbeat-lead-in-invalid',
  );
});

test('timing bounds require three beat durations and two seconds after the target downbeat', () => {
  assert.equal(validateTimingBounds(validTiming({ decodedDurationSeconds: 5.5 })).ok, true);
  assert.equal(
    validateTimingBounds(validTiming({ decodedDurationSeconds: 5.5 - 1e-12 })).errorCode,
    'target-downbeat-tail-invalid',
  );
});

test('timing bounds reject non-finite or non-positive BPM and invalid times', () => {
  for (const trackBpm of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(validateTimingBounds(validTiming({ trackBpm })).errorCode, 'track-bpm-invalid');
  }
  assert.equal(validateTimingBounds(validTiming({ targetEntryDownbeatSeconds: Number.NaN })).errorCode, 'target-downbeat-invalid');
  assert.equal(validateTimingBounds(validTiming({ decodedDurationSeconds: Number.POSITIVE_INFINITY })).errorCode, 'decoded-duration-invalid');
});

test('timing bounds reject finite BPM values whose derived timing values overflow', () => {
  const result = validateTimingBounds(validTiming({ trackBpm: Number.MIN_VALUE }));

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'track-bpm-invalid');
  for (const value of Object.values(result)) {
    assert.equal(typeof value !== 'number' || Number.isFinite(value), true);
  }
  assert.notEqual(JSON.stringify(result), undefined);
  assert.equal(JSON.stringify(result).includes('null'), true);
});

test('cue energy combines every decoded channel sample from exactly 50 ms for RMS and peak', () => {
  const channelA = [...Array(16).fill(0.05), ...Array(384).fill(0)];
  const channelB = [...Array(16).fill(-0.05), ...Array(384).fill(0)];
  const result = analyzeCueEnergy(cueInput([channelA, channelB]));

  assert.ok(Math.abs(result.rms - 0.01) < 1e-12);
  assert.equal(result.peak, 0.05);
  assert.equal(result.framesPerChannel, 400);
  assert.equal(result.sampleCount, 800);
  assert.equal(result.windowMilliseconds, 50);
  assert.equal(result.compliant, true);
  assert.equal(Object.hasOwn(result, 'samples'), false);
});

test('cue energy independently enforces the inclusive RMS and peak thresholds', () => {
  const rmsTooLow = analyzeCueEnergy(cueInput([[0.05, ...Array(399).fill(0)]]));
  assert.equal(rmsTooLow.rms < 0.010, true);
  assert.equal(rmsTooLow.peak >= 0.050, true);
  assert.equal(rmsTooLow.compliant, false);

  const peakTooLow = analyzeCueEnergy(cueInput([Array(400).fill(0.010)]));
  assert.ok(Math.abs(peakTooLow.rms - 0.010) < 1e-12);
  assert.equal(peakTooLow.peak < 0.050, true);
  assert.equal(peakTooLow.compliant, false);
});

test('cue energy requires exactly the expected 50 ms frame count in every decoded channel', () => {
  const validChannel = Array(400).fill(0);
  for (const input of [
    cueInput([[0]]),
    cueInput([validChannel, validChannel.slice(0, 399)], { expectedChannelCount: 2 }),
    cueInput([validChannel], { expectedChannelCount: 2 }),
    cueInput([validChannel, validChannel], { expectedChannelCount: 1 }),
    cueInput([]),
  ]) {
    assert.throws(() => analyzeCueEnergy(input), TypeError);
  }
});

test('cue energy rejects invalid sample-rate and expected-channel controls', () => {
  const validChannel = Array(400).fill(0);
  for (const sampleRate of [7_999, 8_000.5, 96_001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => analyzeCueEnergy(cueInput([validChannel], { sampleRate })),
      /sample rate/,
      String(sampleRate),
    );
  }
  for (const expectedChannelCount of [0, 1.5, 3, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => analyzeCueEnergy(cueInput([validChannel], { expectedChannelCount })),
      /channel count/,
      String(expectedChannelCount),
    );
  }
});

test('cue energy rejects invalid channel containers and non-finite samples', () => {
  for (const channelSamples of [
    [null],
    [{}],
    [[0, Number.NaN, ...Array(398).fill(0)]],
    [[Number.POSITIVE_INFINITY, ...Array(399).fill(0)]],
  ]) {
    assert.throws(() => analyzeCueEnergy(cueInput(channelSamples)), /channel samples/);
  }
});

test('cue energy keeps RMS finite for maximum finite samples', () => {
  const result = analyzeCueEnergy(cueInput([Array(400).fill(Number.MAX_VALUE)]));

  assert.equal(result.rms, Number.MAX_VALUE);
  assert.equal(result.peak, Number.MAX_VALUE);
  for (const value of Object.values(result)) {
    assert.equal(typeof value !== 'number' || Number.isFinite(value), true);
  }
  assert.equal(JSON.parse(JSON.stringify(result)).rms, Number.MAX_VALUE);
});
