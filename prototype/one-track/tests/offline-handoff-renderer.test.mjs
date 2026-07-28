import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ASSET_IDENTITY,
  EXPERIMENT_CONFIG_IDENTITY,
} from '../src/config.mjs';
import {
  createHandoffPlan,
  createPredictionOwnershipSnapshot,
} from '../src/core/handoff-planner.mjs';
import { renderSyntheticOfflineHandoff } from '../src/audio/offline-handoff-renderer.mjs';
import {
  createFakeOfflineAudioContextFactory,
} from './fake-offline-audio.mjs';

const SAMPLE_RATE = 48_000;
const ONE_SAMPLE = 1 / SAMPLE_RATE;

function createPlan({ adoptedBeatNumber = null, lastTapAudioTime = 0 } = {}) {
  const estimatedBpmExact = 110;
  const candidateBeat1AudioTime = lastTapAudioTime + 60 / estimatedBpmExact;
  const predictions = adoptedBeatNumber === null ? [] : [{
    sourceId: `adopted-beat-${adoptedBeatNumber}`,
    scheduledAudioTime: candidateBeat1AudioTime
      + (adoptedBeatNumber - 1) * (60 / 110),
  }];
  return createHandoffPlan({
    generationId: 'generation-offline-oracle',
    assetIdentity: ASSET_IDENTITY,
    experimentConfigIdentity: EXPERIMENT_CONFIG_IDENTITY,
    estimatedBpmExact,
    lastTapAudioTime,
    candidateBeat1AudioTime,
    lockDeadlineAudioTime: 0.35,
    audioNow: 0.4,
    outputSampleRate: SAMPLE_RATE,
    ownershipSnapshot: createPredictionOwnershipSnapshot({
      ownedSourceIds: predictions.map(({ sourceId }) => sourceId),
      predictions,
    }),
  });
}

function nearestNonzeroIndex(channel, expectedTime, radius = 1) {
  const expectedIndex = Math.round(expectedTime * SAMPLE_RATE);
  for (let distance = 0; distance <= radius; distance += 1) {
    for (const index of distance === 0
      ? [expectedIndex]
      : [expectedIndex - distance, expectedIndex + distance]) {
      if (index >= 0 && index < channel.length && Math.abs(channel[index]) > 1e-8) {
        return index;
      }
    }
  }
  return -1;
}

function absolutePeak(channel) {
  let peak = 0;
  for (const sample of channel) {
    peak = Math.max(peak, Math.abs(sample));
  }
  return peak;
}

function assertClose(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function renderTime(result, audioTime) {
  return audioTime - result.timeline.renderOriginAudioTime;
}

test('T6-OFFLINE-TIMING renders beats 1-8, fade boundaries, and the beat-5 target transient', async () => {
  const plan = createPlan({ adoptedBeatNumber: 5 });
  const result = await renderSyntheticOfflineHandoff({
    plan,
    offlineAudioContextFactory: createFakeOfflineAudioContextFactory(),
  });
  const mix = result.audioBuffer.getChannelData(0);
  const beatMarkers = result.audioBuffer.getChannelData(1);
  const fadedMusic = result.audioBuffer.getChannelData(2);
  const rawMusic = result.audioBuffer.getChannelData(3);

  assert.equal(result.audioBuffer.sampleRate, SAMPLE_RATE);
  assert.equal(result.audioBuffer.numberOfChannels, 4);
  assert.equal(
    result.timeline.renderOriginAudioTime,
    Math.min(plan.trackStartAudioTime, plan.beatTimes[0]),
  );
  assert.deepEqual(result.timeline.beatTimes, plan.beatTimes);
  assert.equal(result.timeline.crossfadeStartAudioTime, plan.crossfadeStartAudioTime);
  assert.equal(result.timeline.curatedDownbeatAudioTime, plan.curatedDownbeatAudioTime);
  assert.equal(result.timeline.crossfadeEndAudioTime, plan.crossfadeEndAudioTime);

  for (const beatTime of plan.beatTimes) {
    const beatRenderTime = renderTime(result, beatTime);
    const markerIndex = nearestNonzeroIndex(beatMarkers, beatRenderTime);
    assert.notEqual(markerIndex, -1, `missing rendered beat marker at ${beatTime}`);
    assert.ok(Math.abs(markerIndex / SAMPLE_RATE - beatRenderTime) <= ONE_SAMPLE);
  }

  const targetRenderTime = renderTime(result, plan.curatedDownbeatAudioTime);
  const targetIndex = nearestNonzeroIndex(rawMusic, targetRenderTime);
  assert.notEqual(targetIndex, -1, 'missing rendered target transient');
  assert.ok(Math.abs(targetIndex / SAMPLE_RATE - targetRenderTime) <= ONE_SAMPLE);
  const renderedTargetGain = fadedMusic[targetIndex]
    / rawMusic[targetIndex]
    / plan.trackTrimGain;
  assertClose(renderedTargetGain, Math.sin(Math.PI / 8), 2e-4);
  assert.ok(renderedTargetGain > 0);

  const fadeStartIndex = nearestNonzeroIndex(
    rawMusic,
    renderTime(result, plan.crossfadeStartAudioTime),
    8,
  );
  const fadeEndIndex = nearestNonzeroIndex(
    rawMusic,
    renderTime(result, plan.crossfadeEndAudioTime),
    8,
  );
  assert.notEqual(fadeStartIndex, -1);
  assert.notEqual(fadeEndIndex, -1);
  assert.ok(Math.abs(fadedMusic[fadeStartIndex]) <= 2e-4);
  assertClose(
    fadedMusic[fadeEndIndex] / rawMusic[fadeEndIndex],
    plan.trackTrimGain,
    2e-4,
  );

  assert.equal(result.trims.percussion, 0.25);
  assert.equal(result.trims.track, 0.50);
  assert.equal(result.trims.master, 0.70);
  assert.equal(result.peak, absolutePeak(mix));
  assert.ok(result.peak < 0.98, `rendered peak ${result.peak} must remain below 0.98`);
});

test('T6-ALLOCATION normalizes a late absolute audio clock before allocating the oracle', async () => {
  const capturedOptions = [];
  const sentinel = new Error('factory-stop-before-allocation');
  await assert.rejects(
    renderSyntheticOfflineHandoff({
      plan: createPlan({ lastTapAudioTime: 3_600 }),
      offlineAudioContextFactory(options) {
        capturedOptions.push(options);
        throw sentinel;
      },
    }),
    sentinel,
  );

  assert.equal(capturedOptions.length, 1);
  assert.equal(capturedOptions[0].numberOfChannels, 4);
  assert.equal(capturedOptions[0].sampleRate, SAMPLE_RATE);
  assert.ok(capturedOptions[0].length < SAMPLE_RATE * 10);
});

test('T6-ADOPTION renders one identical pulse for an adopted beat and never schedules a duplicate', async () => {
  const adoptedBeatNumber = 5;
  const result = await renderSyntheticOfflineHandoff({
    plan: createPlan({ adoptedBeatNumber }),
    offlineAudioContextFactory: createFakeOfflineAudioContextFactory(),
  });

  assert.equal(result.percussionBeats.length, 8);
  assert.deepEqual(
    result.percussionBeats.map(({ beatNumber, role }) => ({ beatNumber, role })),
    Array.from({ length: 8 }, (_, index) => ({
      beatNumber: index + 1,
      role: index + 1 === adoptedBeatNumber ? 'adopted' : 'scheduled',
    })),
  );
  assert.equal(
    result.percussionBeats.filter(({ beatNumber }) => beatNumber === adoptedBeatNumber).length,
    1,
  );
  assert.deepEqual(
    result.percussionBeats.map(({ amplitude }) => amplitude),
    Array(8).fill(1),
  );
});

test('T6-CANCELLATION holds both envelopes, ramps for 20 ms, stops at 25 ms, and leaves silence', async () => {
  const plan = createPlan();
  const cancellationAudioTime = plan.crossfadeStartAudioTime
    + 0.5 * (plan.crossfadeEndAudioTime - plan.crossfadeStartAudioTime);
  const contexts = [];
  const result = await renderSyntheticOfflineHandoff({
    plan,
    offlineAudioContextFactory: createFakeOfflineAudioContextFactory(contexts),
    cancellationAudioTime,
  });

  assert.equal(contexts.length, 1);
  assert.equal(result.cancellation.audioTime, cancellationAudioTime);
  assert.equal(result.cancellation.rampEndAudioTime, cancellationAudioTime + 0.020);
  assert.equal(result.cancellation.stopAudioTime, cancellationAudioTime + 0.025);
  assertClose(result.cancellation.percussionHeldGain, Math.cos(Math.PI / 4), 2e-4);
  assertClose(result.cancellation.musicHeldGain, Math.sin(Math.PI / 4), 2e-4);

  const automationEvents = contexts[0].createdGains
    .flatMap(({ gain }) => gain.events.map((event) => event.type));
  assert.equal(automationEvents.filter((type) => type === 'hold').length, 2);
  assert.equal(automationEvents.filter((type) => type === 'linear-ramp').length, 2);

  const mix = result.audioBuffer.getChannelData(0);
  const silenceStartIndex = Math.ceil(
    renderTime(result, result.cancellation.stopAudioTime) * SAMPLE_RATE,
  );
  assert.ok(mix.subarray(silenceStartIndex).every((sample) => sample === 0));
  assert.ok(result.endEvents.some((event) => (
    event.sourceType === 'track' && event.endKind === 'intentional'
  )));
  assert.equal(result.endEvents.some((event) => (
    event.sourceType === 'track' && event.endKind === 'natural'
  )), false);
});

test('T6-CANCELLATION clamps the held envelope before the fade to percussion-only', async () => {
  const plan = createPlan();
  const cancellationAudioTime = plan.crossfadeStartAudioTime - 0.100;
  const result = await renderSyntheticOfflineHandoff({
    plan,
    offlineAudioContextFactory: createFakeOfflineAudioContextFactory(),
    cancellationAudioTime,
  });

  assert.equal(result.cancellation.percussionHeldGain, 1);
  assert.equal(result.cancellation.musicHeldGain, 0);
});

test('T6-END-KIND keeps natural source completion distinct from intentional cancellation', async () => {
  const result = await renderSyntheticOfflineHandoff({
    plan: createPlan(),
    offlineAudioContextFactory: createFakeOfflineAudioContextFactory(),
  });

  assert.ok(result.endEvents.some((event) => (
    event.sourceType === 'track' && event.endKind === 'natural'
  )));
  assert.equal(result.endEvents.some((event) => (
    event.sourceType === 'track' && event.endKind === 'intentional'
  )), false);
});

test('T6-INJECTION accepts a factory and rejects anything except a genuine validated immutable plan', async () => {
  const contexts = [];
  const plan = createPlan();
  await renderSyntheticOfflineHandoff({
    plan,
    offlineAudioContextFactory: createFakeOfflineAudioContextFactory(contexts),
  });
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].sampleRate, plan.outputSampleRate);

  await assert.rejects(
    renderSyntheticOfflineHandoff({
      plan: Object.freeze({ ...plan }),
      offlineAudioContextFactory: createFakeOfflineAudioContextFactory(),
    }),
    /genuine handoff plan/,
  );
});

test('T6-PRIVACY oracle source and fixtures embed neither private identity nor audio/file access', async () => {
  const sourceUrls = [
    new URL(import.meta.url),
    new URL('./fake-offline-audio.mjs', import.meta.url),
    new URL('../src/audio/offline-handoff-renderer.mjs', import.meta.url),
  ];
  const forbiddenApiNames = [
    ['File', 'Reader'].join(''),
    ['show', 'Open', 'File', 'Picker'].join(''),
    ['create', 'Object', 'URL'].join(''),
  ];
  for (const sourceUrl of sourceUrls) {
    const source = await readFile(sourceUrl, 'utf8');
    assert.equal(source.includes(ASSET_IDENTITY.sha256), false);
    assert.equal(/\.(?:mp3|wav|m4a|aac|flac)\b/iu.test(source), false);
    assert.ok(forbiddenApiNames.every((name) => !source.includes(name)));
  }
});
