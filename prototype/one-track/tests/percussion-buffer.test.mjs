import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KICK_SNARE_V1_NOISE_SEED,
  SMOKE_PROBE_POLICY,
  synthesizePercussionBuffer,
} from '../src/audio/percussion-buffer.mjs';

const VALID_SAMPLE_RATES = Object.freeze([8_000, 44_100, 48_000, 96_000]);
const BUFFER_KEYS = Object.freeze([
  'recipeId',
  'sampleRate',
  'channelCount',
  'frameCount',
  'durationMilliseconds',
  'preTrimMonoSamples',
  'layers',
]);

function peakAbsolute(samples) {
  return samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
}

function assertFiniteSamples(samples) {
  assert.ok(samples instanceof Float32Array);
  assert.ok(samples.length > 0);
  assert.equal(samples.every(Number.isFinite), true);
}

function synthesize(sampleRate = 48_000) {
  return synthesizePercussionBuffer({
    recipeId: 'kick-snare-v1',
    sampleRate,
  });
}

test('T6-COMPOSITE-RECIPE creates one bounded finite mono kick-snare-v1 composite before trim', () => {
  for (const sampleRate of VALID_SAMPLE_RATES) {
    const buffer = synthesize(sampleRate);

    assert.deepEqual(Object.keys(buffer), BUFFER_KEYS);
    assert.equal(buffer.recipeId, 'kick-snare-v1');
    assert.equal(buffer.sampleRate, sampleRate);
    assert.equal(buffer.channelCount, 1);
    assert.equal(buffer.durationMilliseconds, 200);
    assert.equal(buffer.frameCount, Math.ceil(sampleRate * 0.200));
    assert.equal(buffer.preTrimMonoSamples.length, buffer.frameCount);
    assert.deepEqual(Object.keys(buffer.layers), ['kickSamples', 'snareSamples']);
    assert.equal(buffer.layers.kickSamples.length, buffer.frameCount);
    assert.equal(buffer.layers.snareSamples.length, buffer.frameCount);

    assertFiniteSamples(buffer.preTrimMonoSamples);
    assertFiniteSamples(buffer.layers.kickSamples);
    assertFiniteSamples(buffer.layers.snareSamples);
    assert.ok(peakAbsolute(buffer.layers.kickSamples) > 0.25);
    assert.ok(peakAbsolute(buffer.layers.kickSamples) <= 0.58);
    assert.ok(peakAbsolute(buffer.layers.snareSamples) > 0.05);
    assert.ok(peakAbsolute(buffer.layers.snareSamples) <= 0.28);
    assert.ok(peakAbsolute(buffer.preTrimMonoSamples) < 1);

    for (let frame = 0; frame < buffer.frameCount; frame += 1) {
      const expectedComposite = Math.fround(
        buffer.layers.kickSamples[frame] + buffer.layers.snareSamples[frame],
      );
      assert.equal(buffer.preTrimMonoSamples[frame], expectedComposite);
    }
  }
});

test('T6-COMPOSITE-RECIPE uses a fixed integer noise seed and no hit role, tap parity, or bar-phase input', () => {
  assert.equal(Number.isSafeInteger(KICK_SNARE_V1_NOISE_SEED), true);
  assert.ok(KICK_SNARE_V1_NOISE_SEED >= 0);
  assert.ok(KICK_SNARE_V1_NOISE_SEED <= 0xffff_ffff);
  assert.equal(synthesizePercussionBuffer.length, 1);
  const baseline = synthesize();

  for (const conceptualUse of [
    'physical-odd',
    'physical-even',
    'bridge',
    'adopted',
    'newly-scheduled',
  ]) {
    const repeated = synthesize();
    assert.deepEqual(
      repeated.preTrimMonoSamples,
      baseline.preTrimMonoSamples,
      `${conceptualUse} must retain the same timbre`,
    );
    assert.deepEqual(repeated.layers.kickSamples, baseline.layers.kickSamples);
    assert.deepEqual(repeated.layers.snareSamples, baseline.layers.snareSamples);
  }

  assert.throws(
    () => synthesizePercussionBuffer(
      { recipeId: 'kick-snare-v1', sampleRate: 48_000 },
      { role: 'bridge', acceptedTapParity: 'odd', barPhase: 1 },
    ),
    /exactly one closed options record/,
  );
  for (const forbiddenKey of ['role', 'acceptedTapParity', 'barPhase']) {
    assert.throws(
      () => synthesizePercussionBuffer({
        recipeId: 'kick-snare-v1',
        sampleRate: 48_000,
        [forbiddenKey]: 1,
      }),
      /only recipeId and sampleRate/,
    );
  }
});

test('T6-COMPOSITE-RECIPE makes both layers exactly zero by 180 ms with a zero DC tail', () => {
  for (const sampleRate of VALID_SAMPLE_RATES) {
    const buffer = synthesize(sampleRate);
    const tailStartFrame = Math.ceil(sampleRate * 0.180);

    assert.ok(tailStartFrame < buffer.frameCount);
    for (const samples of [
      buffer.layers.kickSamples,
      buffer.layers.snareSamples,
      buffer.preTrimMonoSamples,
    ]) {
      assert.equal(samples.slice(tailStartFrame).every((sample) => sample === 0), true);
      assert.equal(samples.at(-1), 0);
    }
  }
});

test('T6-COMPOSITE-RECIPE strictly bounds sample rate and allocation inputs', () => {
  const invalidOptions = [
    undefined,
    null,
    {},
    [],
    { recipeId: 'kick-snare-v1' },
    { sampleRate: 48_000 },
    { recipeId: 'other-recipe', sampleRate: 48_000 },
    { recipeId: 'kick-snare-v1', sampleRate: Number.NaN },
    { recipeId: 'kick-snare-v1', sampleRate: Number.POSITIVE_INFINITY },
    { recipeId: 'kick-snare-v1', sampleRate: 48_000.5 },
    { recipeId: 'kick-snare-v1', sampleRate: 7_999 },
    { recipeId: 'kick-snare-v1', sampleRate: 96_001 },
    Object.assign(Object.create(null), {
      recipeId: 'kick-snare-v1',
      sampleRate: 48_000,
    }),
  ];

  for (const options of invalidOptions) {
    assert.throws(() => synthesizePercussionBuffer(options), TypeError);
  }
  assert.throws(() => synthesizePercussionBuffer(), /exactly one closed options record/);
});

test('T6-SMOKE-PROBE exposes exact cancellation timing as a closed immutable policy', () => {
  assert.deepEqual(Object.keys(SMOKE_PROBE_POLICY), [
    'policyId',
    'holdDurationMilliseconds',
    'cancellationRampDurationMilliseconds',
    'cancellationStopDelayMilliseconds',
  ]);
  assert.deepEqual(SMOKE_PROBE_POLICY, {
    policyId: 'smoke-probe-v1',
    holdDurationMilliseconds: 250,
    cancellationRampDurationMilliseconds: 20,
    cancellationStopDelayMilliseconds: 25,
  });
  assert.equal(Object.isFrozen(SMOKE_PROBE_POLICY), true);
  assert.equal(
    SMOKE_PROBE_POLICY.holdDurationMilliseconds
      + SMOKE_PROBE_POLICY.cancellationRampDurationMilliseconds,
    270,
  );
  assert.equal(
    SMOKE_PROBE_POLICY.holdDurationMilliseconds
      + SMOKE_PROBE_POLICY.cancellationStopDelayMilliseconds,
    275,
  );
  assert.throws(() => {
    SMOKE_PROBE_POLICY.holdDurationMilliseconds = 0;
  }, TypeError);
});
