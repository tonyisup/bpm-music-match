import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EQUAL_POWER_CURVE_SAMPLE_COUNT,
  createEqualPowerCurves,
  equalPowerGainsAtProgress,
} from '../src/audio/audio-math.mjs';

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('T6-AUDIO-MATH creates exactly 128 finite monotonic paired equal-power samples', () => {
  const curves = createEqualPowerCurves(128);

  assert.equal(EQUAL_POWER_CURVE_SAMPLE_COUNT, 128);
  assert.equal(Object.getPrototypeOf(curves), Object.prototype);
  assert.deepEqual(Object.keys(curves), ['percussion', 'music']);
  assert.equal(Object.isFrozen(curves), true);

  const { percussion, music } = curves;
  assert.equal(Array.isArray(percussion), true);
  assert.equal(Array.isArray(music), true);
  assert.equal(Object.getPrototypeOf(percussion), Array.prototype);
  assert.equal(Object.getPrototypeOf(music), Array.prototype);
  assert.equal(percussion.length, 128);
  assert.equal(music.length, 128);
  assert.equal(Object.isFrozen(percussion), true);
  assert.equal(Object.isFrozen(music), true);
  assert.deepEqual([percussion[0], music[0]], [1, 0]);
  assert.deepEqual([percussion.at(-1), music.at(-1)], [0, 1]);

  for (let index = 0; index < 128; index += 1) {
    assert.equal(Number.isFinite(percussion[index]), true);
    assert.equal(Number.isFinite(music[index]), true);
    assertClose(percussion[index] ** 2 + music[index] ** 2, 1);
    if (index > 0) {
      assert.ok(percussion[index] < percussion[index - 1]);
      assert.ok(music[index] > music[index - 1]);
    }
  }
});

test('T6-AUDIO-MATH maps normalized quarter progress to the nonzero sin(pi/8) music gain', () => {
  const gains = equalPowerGainsAtProgress(0.25);

  assert.equal(Object.getPrototypeOf(gains), Object.prototype);
  assert.deepEqual(Object.keys(gains), ['percussion', 'music']);
  assert.equal(Object.isFrozen(gains), true);
  assertClose(gains.percussion, Math.cos(Math.PI / 8));
  assertClose(gains.music, Math.sin(Math.PI / 8));
  assert.ok(gains.music > 0);
  assertClose(gains.percussion ** 2 + gains.music ** 2, 1);
});

test('T6-AUDIO-MATH exposes exact endpoint gains for the closed normalized domain', () => {
  assert.deepEqual(equalPowerGainsAtProgress(0), { percussion: 1, music: 0 });
  assert.deepEqual(equalPowerGainsAtProgress(1), { percussion: 0, music: 1 });
});

test('T6-AUDIO-MATH rejects noncanonical curve sizes and progress outside a finite closed domain', () => {
  for (const sampleCount of [
    undefined,
    null,
    0,
    127,
    129,
    128.5,
    '128',
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.throws(
      () => createEqualPowerCurves(sampleCount),
      (error) => error instanceof RangeError
        && error.message === 'sampleCount must be exactly 128',
    );
  }

  for (const progress of [
    undefined,
    null,
    -Number.MIN_VALUE,
    1 + Number.EPSILON,
    '0.25',
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.throws(
      () => equalPowerGainsAtProgress(progress),
      (error) => error instanceof RangeError
        && error.message === 'progress must be a finite number from 0 through 1',
    );
  }
});
