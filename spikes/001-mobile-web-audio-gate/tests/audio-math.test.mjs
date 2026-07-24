import test from 'node:test';
import assert from 'node:assert/strict';

const MODULE_URL = new URL('../audio-math.mjs', import.meta.url);

async function loadMath() {
  return import(MODULE_URL);
}

test('equal-power curves are exact finite monotonic Float32 contracts', async () => {
  const { createEqualPowerCurves } = await loadMath();
  const { music, percussion } = createEqualPowerCurves(128);

  assert.ok(music instanceof Float32Array);
  assert.ok(percussion instanceof Float32Array);
  assert.equal(music.length, 128);
  assert.equal(percussion.length, 128);
  assert.equal(music[0], 0);
  assert.equal(percussion[0], 1);
  assert.equal(music.at(-1), 1);
  assert.ok(Math.abs(percussion.at(-1)) < 1e-6);

  for (let index = 0; index < music.length; index += 1) {
    assert.ok(Number.isFinite(music[index]));
    assert.ok(Number.isFinite(percussion[index]));
    assert.ok(Math.abs((music[index] ** 2 + percussion[index] ** 2) - 1) < 1e-6);
    if (index > 0) {
      assert.ok(music[index] >= music[index - 1]);
      assert.ok(percussion[index] <= percussion[index - 1]);
    }
  }
});

test('equal-power curve creation rejects every noncanonical sample count', async () => {
  const { createEqualPowerCurves } = await loadMath();
  for (const count of [1, 2, 127, 129, 128.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createEqualPowerCurves(count), /128/);
  }
});

test('gate plan schedules one fixed phase-locked 120 BPM handoff', async () => {
  const { createGatePlan } = await loadMath();
  const plan = createGatePlan({ audioNow: 10, assetDurationSeconds: 16 });

  assert.equal(plan.bpm, 120);
  assert.equal(plan.beatDuration, 0.5);
  assert.equal(plan.beatOneTime, 10.1);
  assert.deepEqual(plan.percussionTimes, [10.1, 10.6, 11.1, 11.6, 12.1, 12.6, 13.1, 13.6]);
  assert.equal(plan.trackStartTime, 10.1);
  assert.equal(plan.trackOffset, 0);
  assert.equal(plan.crossfadeStartTime, 12.1);
  assert.equal(plan.crossfadeStartTrackOffset, 2);
  assert.equal(plan.crossfadeEndTime, 14.1);
  assert.equal(plan.naturalEndTime, 26.1);
  assert.equal(plan.postCrossfadeTailSeconds, 12);
});

test('gate plan rejects invalid clocks and assets too short for the tail', async () => {
  const { createGatePlan } = await loadMath();
  for (const audioNow of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createGatePlan({ audioNow, assetDurationSeconds: 16 }), /audioNow/);
  }
  for (const assetDurationSeconds of [0, -1, 5.999, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createGatePlan({ audioNow: 0, assetDurationSeconds }), /assetDurationSeconds/);
  }
});
