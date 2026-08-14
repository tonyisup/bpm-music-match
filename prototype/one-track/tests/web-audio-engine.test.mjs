import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createLocalTrackLoader } from '../src/browser/local-track-loader.mjs';
import {
  ASSET_IDENTITY,
  EXPERIMENT_CONFIG_IDENTITY,
} from '../src/config.mjs';
import {
  createHandoffPlan,
  createPredictionOwnershipSnapshot,
} from '../src/core/handoff-planner.mjs';
import {
  assertGenerationCleanupResult,
  claimGenerationCleanupResult,
  createWebAudioEngine,
} from '../src/audio/web-audio-engine.mjs';
import {
  createFakeAudioHarness,
  createReceiptAuthority,
  deferred,
} from './fake-audio.mjs';

const SESSION_ID = 'session-1';
const GENERATION_ID = 1;
const SAMPLE_RATE = 48_000;

async function createFixture(options = {}) {
  const audio = createFakeAudioHarness(options.audio);
  const loader = createLocalTrackLoader(audio.dependencies);
  const capability = await loader.load({
    file: audio.file,
    loadedSessionId: 'loaded-session-1',
  });
  const receipts = createReceiptAuthority();
  const injectedSteps = [];
  const engine = createWebAudioEngine({
    loadedSessionCapability: capability,
    sessionId: SESSION_ID,
    assertTerminalRecordReceipt: receipts.assert,
    createCleanupDeadline: audio.dependencies.createDeadline,
    failureInjector(step) {
      injectedSteps.push(step);
      audio.recordOwnershipCheckpoint(step);
      options.failStep?.(step);
    },
    onEvent: options.onEvent ?? (() => undefined),
  });
  return { audio, loader, capability, receipts, engine, injectedSteps };
}

function createPlan(predictions = [], overrides = {}) {
  const estimatedBpmExact = 110;
  const lastTapAudioTime = 10;
  const candidateBeat1AudioTime = lastTapAudioTime + 60 / estimatedBpmExact;
  return createHandoffPlan({
    generationId: `generation-${GENERATION_ID}`,
    assetIdentity: ASSET_IDENTITY,
    experimentConfigIdentity: EXPERIMENT_CONFIG_IDENTITY,
    estimatedBpmExact,
    lastTapAudioTime,
    candidateBeat1AudioTime,
    lockDeadlineAudioTime: 10.2,
    audioNow: 10.3,
    outputSampleRate: SAMPLE_RATE,
    ownershipSnapshot: createPredictionOwnershipSnapshot({
      ownedSourceIds: predictions.map(({ sourceId }) => sourceId),
      predictions,
    }),
    ...overrides,
  });
}

function handoffRequest(plan) {
  return Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 30,
    plan,
  });
}

async function activateGeneration(fixture) {
  const tap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 1,
    sourceId: 'ack-1',
    scheduledAudioTime: 10.02,
  }));
  assert.equal((await tap.settlement).status, 'succeeded');
}

async function schedulePredictionSet(fixture, predictions, effectId = 2) {
  for (let index = 0; index < predictions.length; index += 2) {
    const settlement = await fixture.engine.schedulePredictions(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: effectId + index / 2,
      predictions: Object.freeze(predictions.slice(index, index + 2).map(Object.freeze)),
    }));
    assert.deepEqual(settlement, { status: 'succeeded', cause: null });
  }
}

function assertSourceReferencesClearedOnce(source) {
  assert.equal(source.disconnectCalls, 1);
  assert.equal(source.onendedClearCalls, 1);
  assert.equal(source.bufferClearCalls, 1);
  assert.equal(source.disconnected, true);
  assert.equal(source.onended, null);
  assert.equal(source.buffer, null);
}

test('T8-RESUME-DEADLINE schedules direct taps before the first await, reuses one keyed resume, and rolls back rejection', async () => {
  const pendingFixture = await createFixture({ audio: { resumeMode: 'deferred' } });
  const first = pendingFixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 1,
    sourceId: 'ack-1',
    scheduledAudioTime: 10.02,
  }));
  const second = pendingFixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 2,
    sourceId: 'ack-2',
    scheduledAudioTime: 10.20,
  }));

  const runtimeEvents = pendingFixture.audio.events.slice(
    pendingFixture.audio.events.findIndex(({ type }) => type === 'resume'),
  );
  assert.equal(runtimeEvents[0].type, 'resume');
  assert.equal(runtimeEvents.filter(({ type }) => type === 'resume').length, 1);
  assert.equal(runtimeEvents.filter(({ type }) => type === 'start').length, 2);
  assert.equal(first.reusedPendingResume, false);
  assert.equal(second.reusedPendingResume, true);
  assert.equal(first.resumeKey, `${SESSION_ID}:${GENERATION_ID}:1`);
  assert.equal(second.resumeKey, first.resumeKey);
  assert.equal(first.settlement, second.settlement);

  pendingFixture.audio.resumeDeferred.resolve();
  assert.deepEqual(await first.settlement, { status: 'succeeded', cause: null });
  assert.equal(pendingFixture.engine.inspect().pendingResumeKey, null);

  let pendingStartCount = 0;
  const failedReuse = await createFixture({
    audio: { resumeMode: 'deferred' },
    failStep(step) {
      if (step === 'source:start' && ++pendingStartCount === 2) {
        throw new Error('PRIVATE_SECOND_SCHEDULE_FAILURE');
      }
    },
  });
  const failedFirst = failedReuse.engine.directTap(Object.freeze({
    sessionId: SESSION_ID, generationId: GENERATION_ID, effectId: 1,
    sourceId: 'ack-first', scheduledAudioTime: 10.02,
  }));
  const failedSecond = failedReuse.engine.directTap(Object.freeze({
    sessionId: SESSION_ID, generationId: GENERATION_ID, effectId: 2,
    sourceId: 'ack-second', scheduledAudioTime: 10.20,
  }));
  assert.equal(failedFirst.settlement, failedSecond.settlement);
  failedReuse.audio.resumeDeferred.resolve();
  assert.deepEqual(await failedFirst.settlement, { status: 'failed', cause: 'schedule-failed' });
  assert.equal(failedReuse.engine.inspect().generationId, null);
  assert.ok(failedReuse.audio.context.sources.every(({ disconnected }) => disconnected));

  let predictionStartCount = 0;
  const failedPredictionReuse = await createFixture({
    audio: { resumeMode: 'deferred' },
    failStep(step) {
      if (step === 'source:start' && ++predictionStartCount === 3) {
        throw new Error('PRIVATE_PENDING_PREDICTION_FAILURE');
      }
    },
  });
  const predictionTap = failedPredictionReuse.engine.directTap(Object.freeze({
    sessionId: SESSION_ID, generationId: GENERATION_ID, effectId: 1,
    sourceId: 'ack-before-predictions', scheduledAudioTime: 10.02,
  }));
  const predictionSettlement = failedPredictionReuse.engine.schedulePredictions(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 2,
    predictions: Object.freeze([
      Object.freeze({ sourceId: 'pending-prediction-1', scheduledAudioTime: 10.4 }),
      Object.freeze({ sourceId: 'pending-prediction-2', scheduledAudioTime: 10.6 }),
    ]),
  }));
  failedPredictionReuse.audio.resumeDeferred.resolve();
  assert.deepEqual(await predictionTap.settlement, { status: 'failed', cause: 'schedule-failed' });
  assert.deepEqual(await predictionSettlement, { status: 'failed', cause: 'schedule-failed' });
  assert.equal(failedPredictionReuse.engine.inspect().generationId, null);
  assert.ok(failedPredictionReuse.audio.context.sources.every(({ disconnected }) => disconnected));

  const rejectedFixture = await createFixture({ audio: { resumeMode: 'reject' } });
  const rejected = rejectedFixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 1,
    sourceId: 'ack-rejected',
    scheduledAudioTime: 10.02,
  }));
  assert.deepEqual(await rejected.settlement, {
    status: 'failed',
    cause: 'context-resume-failed',
  });
  assert.equal(rejectedFixture.engine.inspect().generationId, null);
  assert.equal(rejectedFixture.engine.inspect().graphCreated, false);
  assert.ok(rejectedFixture.audio.context.sources.every(({ disconnected }) => disconnected));
  assert.equal(
    rejectedFixture.audio.events.filter(({ type }) => type === 'suspend').length,
    1,
    'ordinary resume rejection must reconcile its released borrow with exactly one suspend',
  );
});

test('T8-SCHEDULE owns one graph and an exact prediction registry with the one-sample not-started rule', async () => {
  const fixture = await createFixture();
  const tap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 1,
    sourceId: 'ack-1',
    scheduledAudioTime: 10.02,
  }));
  assert.equal((await tap.settlement).status, 'succeeded');
  const oneSample = 1 / SAMPLE_RATE;
  const scheduled = fixture.engine.schedulePredictions(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 2,
    predictions: Object.freeze([
      Object.freeze({ sourceId: 'prediction-due', scheduledAudioTime: 10 + oneSample }),
      Object.freeze({ sourceId: 'prediction-future', scheduledAudioTime: 10 + 2 * oneSample }),
    ]),
  }));
  assert.deepEqual(await scheduled, { status: 'succeeded', cause: null });

  const snapshot = fixture.engine.inspect();
  assert.equal(snapshot.graphCreated, true);
  assert.deepEqual(snapshot.predictions.map((prediction) => Object.keys(prediction)), [
    ['sourceId', 'scheduledAudioTime', 'generationId', 'role', 'startCommitted',
      'intentionallyStopping', 'ended', 'disconnected'],
    ['sourceId', 'scheduledAudioTime', 'generationId', 'role', 'startCommitted',
      'intentionallyStopping', 'ended', 'disconnected'],
  ]);
  assert.ok(snapshot.predictions.every((prediction) => (
    prediction.generationId === GENERATION_ID
      && prediction.role === 'prediction'
      && prediction.startCommitted
      && !prediction.intentionallyStopping
      && !prediction.ended
      && !prediction.disconnected
  )));
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'allocate-gain').length, 5);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'resume').length, 1);

  const cancelled = fixture.engine.cancelPredictions(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 3,
    sourceIds: Object.freeze(['prediction-due', 'prediction-future']),
    audioNow: 10,
  }));
  assert.deepEqual(await cancelled, {
    status: 'succeeded',
    cause: null,
    cancelledSourceIds: ['prediction-future'],
  });
  const afterCancel = fixture.engine.inspect().predictions;
  assert.equal(afterCancel.find(({ sourceId }) => sourceId === 'prediction-due').intentionallyStopping, false);
  assert.equal(afterCancel.find(({ sourceId }) => sourceId === 'prediction-future').intentionallyStopping, true);
});

test('T8-ADOPTION commits one transaction, preserves bridge/adopted sources, and rolls back every owned source on failure', async () => {
  const template = createPlan();
  const predictions = [
    { sourceId: 'bridge', scheduledAudioTime: template.beatTimes[0] - 0.05 },
    { sourceId: 'adopted-beat-3', scheduledAudioTime: template.beatTimes[2] },
    { sourceId: 'cancel-me', scheduledAudioTime: template.beatTimes[1] + 0.05 },
  ];
  const plan = createPlan(predictions);
  const emittedEvents = [];
  const fixture = await createFixture({ onEvent(event) { emittedEvents.push(event); } });
  await activateGeneration(fixture);
  await schedulePredictionSet(fixture, predictions);
  const settlement = await fixture.engine.commitHandoff(handoffRequest(plan));
  assert.deepEqual(settlement, { status: 'succeeded', cause: null });

  const predictionState = fixture.engine.inspect().predictions;
  assert.equal(predictionState.find(({ sourceId }) => sourceId === 'bridge').intentionallyStopping, false);
  assert.equal(predictionState.find(({ sourceId }) => sourceId === 'adopted-beat-3').intentionallyStopping, false);
  assert.equal(predictionState.find(({ sourceId }) => sourceId === 'cancel-me').intentionallyStopping, true);
  const handoffStarts = fixture.audio.context.sources.filter(({ startRecord }) => (
    startRecord !== null && startRecord.when >= plan.handoffBeat1AudioTime
  ));
  const percussionStartsAtBeat3 = handoffStarts.filter(({ startRecord, buffer }) => (
    buffer?.numberOfChannels === 1 && startRecord.when === plan.beatTimes[2]
  ));
  assert.equal(percussionStartsAtBeat3.length, 1);
  assert.equal(fixture.engine.inspect().track.scheduledAudioTime, plan.trackStartAudioTime);
  const trackNode = fixture.audio.context.sources.find(({ startRecord }) => (
    startRecord?.offset === plan.trackStartOffsetSeconds
  ));
  assert.deepEqual(trackNode.startRecord, {
    when: plan.trackStartAudioTime,
    offset: plan.trackStartOffsetSeconds,
    duration: plan.naturalTrackEndAudioTime - plan.trackStartAudioTime,
  });
  const curves = fixture.audio.context.gains.flatMap(({ gain }) => (
    gain.events.filter(({ type }) => type === 'curve')
  ));
  assert.equal(curves.length, 2);
  assert.ok(curves.every(({ values }) => values.length === 128));
  fixture.audio.advanceTo(plan.songOnlyStartAudioTime);
  assert.deepEqual(fixture.engine.inspect().predictions, []);
  assert.notEqual(fixture.engine.inspect().track, null);
  fixture.audio.advanceTo(plan.naturalTrackEndAudioTime);
  assert.equal(fixture.engine.inspect().track, null);
  assert.ok(emittedEvents.some((event) => (
    event.type === 'natural-track-end' && event.intentional === false
  )));

  const failed = await createFixture({
    failStep(step) {
      if (step === 'handoff:track-start') throw new Error('PRIVATE_INJECTED_FAILURE');
    },
  });
  await activateGeneration(failed);
  await schedulePredictionSet(failed, predictions);
  assert.deepEqual(await failed.engine.commitHandoff(handoffRequest(plan)), {
    status: 'failed', cause: 'schedule-failed',
  });
  assert.equal(failed.engine.inspect().generationId, null);
  assert.equal(failed.engine.inspect().graphCreated, false);
  assert.ok(failed.audio.context.sources.every(({ disconnected }) => disconnected));
});

test('T8-ROLLBACK clears every owned node when injected creation, connection, automation, start, or registry steps fail', async () => {
  const directSteps = [
    'graph:allocate-percussion-trim', 'graph:allocate-percussion-crossfade',
    'graph:allocate-track-trim', 'graph:allocate-track-crossfade', 'graph:allocate-master',
    'graph:connect-percussion-trim', 'graph:connect-percussion-crossfade',
    'graph:connect-track-trim', 'graph:connect-track-crossfade', 'graph:connect-master',
    'graph:automate-percussion-trim', 'graph:automate-percussion-crossfade',
    'graph:automate-track-trim', 'graph:automate-track-crossfade', 'graph:automate-master',
    'source:allocate', 'source:allocate-percussion-buffer', 'source:connect',
    'source:start', 'source:registry',
  ];
  for (const failAt of directSteps) {
    const fixture = await createFixture({
      failStep(step) { if (step === failAt) throw new Error('PRIVATE_FAILURE'); },
    });
    const tap = fixture.engine.directTap(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 1,
      sourceId: 'ack-1',
      scheduledAudioTime: 10.02,
    }));
    assert.deepEqual(await tap.settlement, { status: 'failed', cause: 'schedule-failed' }, failAt);
    assert.equal(fixture.engine.inspect().generationId, null, failAt);
    assert.ok(fixture.audio.context.sources.every(({ disconnected }) => disconnected), failAt);
    assert.ok(fixture.audio.context.sources.every((source) => (
      source.startRecord === null || source.stopTime !== null
    )), failAt);
    assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected), failAt);
  }

  const handoffSteps = [
    'handoff:automate-percussion', 'handoff:automate-track', 'handoff:cancel-source',
    'handoff:beat-registry', 'handoff:track-allocate', 'handoff:track-connect',
    'handoff:track-start', 'handoff:track-registry',
  ];
  const template = createPlan();
  const predictions = [{ sourceId: 'cancel-me', scheduledAudioTime: template.beatTimes[1] + 0.05 }];
  const plan = createPlan(predictions);
  for (const failAt of handoffSteps) {
    let armed = false;
    const fixture = await createFixture({
      failStep(step) { if (armed && step === failAt) throw new Error('PRIVATE_FAILURE'); },
    });
    await activateGeneration(fixture);
    await schedulePredictionSet(fixture, predictions);
    armed = true;
    assert.deepEqual(await fixture.engine.commitHandoff(handoffRequest(plan)), {
      status: 'failed', cause: 'schedule-failed',
    }, failAt);
    assert.equal(fixture.engine.inspect().generationId, null, failAt);
    assert.ok(fixture.audio.context.sources.every(({ disconnected }) => disconnected), failAt);
    assert.ok(fixture.audio.context.sources.every((source) => (
      source.startRecord === null || source.stopTime !== null
    )), failAt);
    assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected), failAt);
  }
});

test('T8-TX-RESOURCE-ALLOCATION-REENTRANT-TERMINATION', async () => {
  let fixture = null;
  let receipt = null;
  let cleanupPromise = null;
  let reentered = false;

  fixture = await createFixture({
    failStep(step) {
      if (reentered || step !== 'graph:allocate-percussion-trim') return;
      reentered = true;
      cleanupPromise = fixture.engine.terminateGeneration(Object.freeze({
        sessionId: SESSION_ID,
        generationId: GENERATION_ID,
        effectId: 2,
        terminalRecordReceipt: receipt,
        audioNow: 10,
      }));
    },
  });
  receipt = fixture.receipts.mint();

  const tap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 1,
    sourceId: 'reentrant-allocation-ack',
    scheduledAudioTime: 10.02,
  }));

  assert.equal(reentered, true, 'the first percussion-trim allocation must synchronously reenter termination');
  assert.notEqual(cleanupPromise, null, 'synchronous reentry must capture the generation cleanup promise');
  assert.equal(typeof cleanupPromise?.then, 'function', 'termination reentry must return a cleanup promise');

  const [tapSettlement, cleanupResult] = await Promise.all([
    tap.settlement,
    cleanupPromise,
  ]);
  assert.deepEqual(tapSettlement, {
    status: 'failed',
    cause: 'schedule-failed',
  }, 'the stale tap continuation must settle as a sanitized scheduling failure');
  assert.equal(cleanupResult.status, 'succeeded', 'termination legitimately owned the then-empty transaction');
  assert.equal(cleanupResult.cause, null, 'successful empty-transaction cleanup must not invent a failure cause');
  assert.equal(fixture.engine.inspect().allocationFrozen, false, 'successful cleanup must unfreeze allocation');
  assert.equal(fixture.engine.inspect().generationId, null, 'successful cleanup must clear generation ownership');

  const { gains, sources } = fixture.audio.context;
  const gainAllocationCount = fixture.audio.events.filter(({ type }) => type === 'allocate-gain').length;
  const sourceStartCount = fixture.audio.events.filter(({ type }) => type === 'start').length;
  assert.ok(
    gains.length >= 1,
    `the reentry hook requires at least one allocated gain; observed ${gains.length} gains across ${gainAllocationCount} allocation operations`,
  );
  assert.equal(
    gainAllocationCount,
    gains.length,
    `fake gain allocation accounting must stay exact; observed ${gainAllocationCount} operations for ${gains.length} gains`,
  );
  for (const [index, gain] of gains.entries()) {
    assert.equal(
      gain.disconnected,
      true,
      `allocated gain ${index + 1}/${gains.length} must be disconnected after reentrant termination; disconnectCalls=${gain.disconnectCalls}`,
    );
    assert.equal(
      gain.disconnectCalls,
      1,
      `allocated gain ${index + 1}/${gains.length} must be disconnected exactly once; observed ${gain.disconnectCalls} calls`,
    );
  }
  assert.equal(
    sources.length,
    0,
    `no source may be allocated after the terminal cleanup snapshot; observed ${sources.length} sources`,
  );
  assert.equal(
    sourceStartCount,
    0,
    `no source may start after the terminal cleanup snapshot; observed ${sourceStartCount} start operations`,
  );
});

test('T8-ROLLBACK-CAPABILITY-ORDER retains the lower borrow through committed source and graph cleanup', async () => {
  const emittedEvents = [];
  const cleanupBorrowChecks = [];
  let fixture = null;
  let observeCleanup = false;
  let sourceRegistryCount = 0;
  fixture = await createFixture({
    audio: {
      stopEndedMode: 'sync',
      onDisconnect(node) {
        if (!observeCleanup) return;
        cleanupBorrowChecks.push(Object.freeze({
          kind: node.kind,
          settlement: fixture.capability.borrowForGeneration(
            GENERATION_ID + 1,
            () => undefined,
          ).then(
            () => Object.freeze({ status: 'succeeded', cause: null }),
            (error) => Object.freeze({ status: 'failed', cause: error.message }),
          ),
        }));
      },
    },
    failStep(step) {
      if (step === 'source:registry' && ++sourceRegistryCount === 2) {
        throw new Error('PRIVATE_LATER_SOURCE_REGISTRY_FAILURE');
      }
    },
    onEvent(event) { emittedEvents.push(event); },
  });
  await activateGeneration(fixture);
  const committedSource = fixture.audio.context.sources[0];
  observeCleanup = true;

  assert.deepEqual(await fixture.engine.schedulePredictions(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 39,
    predictions: Object.freeze([
      Object.freeze({ sourceId: 'rollback-later-source', scheduledAudioTime: 10.8 }),
    ]),
  })), { status: 'failed', cause: 'schedule-failed' });
  const failedSource = fixture.audio.context.sources[1];

  assert.deepEqual(cleanupBorrowChecks.map(({ kind }) => kind), [
    'source', 'source', 'gain', 'gain', 'gain', 'gain', 'gain',
  ]);
  for (const { settlement } of cleanupBorrowChecks) {
    assert.deepEqual(await settlement, {
      status: 'failed',
      cause: 'parallel-generation-borrow',
    });
  }
  assert.deepEqual(emittedEvents, []);
  for (const source of [committedSource, failedSource]) {
    assert.equal(source.stopCalls, 1);
    assert.equal(source.ended, true);
    assertSourceReferencesClearedOnce(source);
  }
  assert.equal(fixture.engine.inspect().generationId, null);
  assert.equal(fixture.engine.inspect().graphCreated, false);
  await fixture.capability.borrowForGeneration(GENERATION_ID + 1, () => undefined);
});

test('T8-TX-ROLLBACK-REENTRANT-ADMISSION', async () => {
  async function runRollbackScenario({ hookKind, reentrantEffectId }) {
    const emittedEvents = [];
    const hookSignal = deferred();
    let fixture = null;
    let rollbackHookArmed = false;
    let hookEntered = false;
    let hookFireCount = 0;
    let failureInjected = false;
    let failureInjectionCount = 0;
    let sourceRegistryStepCount = 0;
    let failureSourceWasCommitted = false;
    let failureGraphWasOwned = false;
    let originalSource = null;
    let sameEngineAdmission = null;
    let sameEngineAdmissionError = null;
    let lowerBorrowSettlementPromise = null;
    let capturedCallbackDispatch = null;
    let capturedCallbackError = null;
    let capturedCallbackCountAtHook = null;
    let eventsBeforeCapturedCallback = null;
    let eventsAfterCapturedCallback = null;
    let inspectAfterCapturedCallback = null;

    function enterRollbackHook(source) {
      if (!rollbackHookArmed || hookEntered) return;
      hookEntered = true;
      hookFireCount += 1;
      originalSource = source;

      try {
        sameEngineAdmission = fixture.engine.directTap(Object.freeze({
          sessionId: SESSION_ID,
          generationId: GENERATION_ID,
          effectId: reentrantEffectId,
          sourceId: `rollback-reentrant-${hookKind}`,
          scheduledAudioTime: 10.4,
        }));
      } catch (error) {
        sameEngineAdmissionError = error;
      }

      try {
        lowerBorrowSettlementPromise = fixture.capability.borrowForGeneration(
          GENERATION_ID + 1,
          () => undefined,
        ).then(
          () => Object.freeze({ status: 'succeeded', cause: null }),
          (error) => Object.freeze({ status: 'failed', cause: error.message }),
        );
      } catch (error) {
        lowerBorrowSettlementPromise = Promise.resolve(Object.freeze({
          status: 'failed',
          cause: error.message,
        }));
      }

      capturedCallbackCountAtHook = source.endedCallbackHistory.length;
      eventsBeforeCapturedCallback = emittedEvents.length;
      try {
        capturedCallbackDispatch = source.fireCapturedEndedCallback();
      } catch (error) {
        capturedCallbackError = error;
      }
      eventsAfterCapturedCallback = emittedEvents.length;
      inspectAfterCapturedCallback = fixture.engine.inspect();
      hookSignal.resolve();
    }

    fixture = await createFixture({
      audio: {
        onStop(source) {
          if (hookKind === 'source-stop') enterRollbackHook(source);
        },
        onDisconnect(node) {
          if (hookKind !== 'graph-disconnect' || node.kind !== 'gain') return;
          enterRollbackHook(fixture.audio.context.sources[0]);
        },
      },
      failStep(step) {
        if (step !== 'source:registry') return;
        sourceRegistryStepCount += 1;
        if (failureInjected) return;
        failureInjected = true;
        failureInjectionCount += 1;
        failureSourceWasCommitted = fixture.audio.context.sources.length === 1
          && fixture.audio.context.sources[0].startRecord !== null;
        failureGraphWasOwned = fixture.engine.inspect().graphCreated
          && fixture.audio.context.gains.length === 5;
        rollbackHookArmed = true;
        throw new Error(`PRIVATE_${hookKind.toUpperCase()}_ROLLBACK_FAILURE`);
      },
      onEvent(event) { emittedEvents.push(event); },
    });

    const tap = fixture.engine.directTap(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: reentrantEffectId - 10,
      sourceId: `rollback-original-${hookKind}`,
      scheduledAudioTime: 10.02,
    }));
    await hookSignal.promise;

    const [
      originalTapSettlement,
      reentrantTapSettlement,
      lowerBorrowSettlement,
    ] = await Promise.all([
      tap.settlement,
      sameEngineAdmission === null ? Promise.resolve(null) : sameEngineAdmission.settlement,
      lowerBorrowSettlementPromise,
    ]);
    const postRollbackLowerBorrowSettlement = await fixture.capability.borrowForGeneration(
      GENERATION_ID + 1,
      () => undefined,
    ).then(
      () => Object.freeze({ status: 'succeeded', cause: null }),
      (error) => Object.freeze({ status: 'failed', cause: error.message }),
    );

    const operationCounts = Object.freeze({
      gainAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-gain').length,
      sourceAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-source').length,
      sourceStarts: fixture.audio.events.filter(({ type }) => type === 'start').length,
      sourceStops: fixture.audio.events.filter(({ type }) => type === 'stop').length,
      sourceDisconnects: fixture.audio.events.filter((event) => (
        event.type === 'disconnect' && event.kind === 'source'
      )).length,
      gainDisconnects: fixture.audio.events.filter((event) => (
        event.type === 'disconnect' && event.kind === 'gain'
      )).length,
    });

    return {
      hookKind,
      fixture,
      hookFireCount,
      failureInjectionCount,
      sourceRegistryStepCount,
      failureSourceWasCommitted,
      failureGraphWasOwned,
      originalSource,
      originalTapSettlement,
      sameEngineAdmission,
      sameEngineAdmissionError,
      reentrantTapSettlement,
      lowerBorrowSettlement,
      postRollbackLowerBorrowSettlement,
      capturedCallbackDispatch,
      capturedCallbackError,
      capturedCallbackCountAtHook,
      eventsBeforeCapturedCallback,
      eventsAfterCapturedCallback,
      inspectAfterCapturedCallback,
      emittedEvents,
      operationCounts,
      finalInspect: fixture.engine.inspect(),
    };
  }

  const scenarios = [];
  scenarios.push(await runRollbackScenario({
    hookKind: 'source-stop',
    reentrantEffectId: 90,
  }));
  scenarios.push(await runRollbackScenario({
    hookKind: 'graph-disconnect',
    reentrantEffectId: 91,
  }));

  for (const scenario of scenarios) {
    const label = scenario.hookKind;
    const synchronousAdmissionOutcome = scenario.sameEngineAdmissionError?.message
      ?? `same-engine admission returned; source-count=${scenario.fixture.audio.context.sources.length}`;
    assert.match(
      synchronousAdmissionOutcome,
      /allocation is frozen/,
      `${label}: same-engine direct admission must throw synchronously while rollback cleanup owns the transaction`,
    );
    assert.equal(
      scenario.sameEngineAdmission,
      null,
      `${label}: frozen rollback admission must return no admission object`,
    );
    assert.deepEqual(
      scenario.originalTapSettlement,
      { status: 'failed', cause: 'schedule-failed' },
      `${label}: the original failed tap must expose only the sanitized settlement`,
    );
    assert.equal(scenario.hookFireCount, 1, `${label}: the selected rollback hook must fire once`);
    assert.equal(
      scenario.failureInjectionCount,
      1,
      `${label}: the committed source registry failure must be injected exactly once`,
    );
    assert.equal(
      scenario.sourceRegistryStepCount,
      1,
      `${label}: no reentrant source may reach the registry hook`,
    );
    assert.equal(
      scenario.failureSourceWasCommitted,
      true,
      `${label}: rollback must begin from one source committed through start`,
    );
    assert.equal(
      scenario.failureGraphWasOwned,
      true,
      `${label}: rollback must begin after the complete five-gain graph is owned`,
    );
    assert.equal(
      scenario.reentrantTapSettlement,
      null,
      `${label}: rejected synchronous admission must expose no settlement promise`,
    );
    assert.deepEqual(
      scenario.lowerBorrowSettlement,
      { status: 'failed', cause: 'parallel-generation-borrow' },
      `${label}: the lower capability must remain borrowed throughout rollback side effects`,
    );
    assert.equal(
      scenario.capturedCallbackCountAtHook,
      1,
      `${label}: the original source must expose exactly one captured ended callback`,
    );
    assert.equal(
      scenario.capturedCallbackDispatch,
      true,
      `${label}: deterministic stale callback dispatch must reach the captured callback`,
    );
    assert.equal(
      scenario.capturedCallbackError,
      null,
      `${label}: captured callback dispatch must not throw from rollback cleanup`,
    );
    assert.equal(
      scenario.eventsBeforeCapturedCallback,
      0,
      `${label}: rollback must not emit an event before stale callback dispatch`,
    );
    assert.equal(
      scenario.eventsAfterCapturedCallback,
      0,
      `${label}: revoked callback authority must emit no event`,
    );
    assert.equal(
      scenario.inspectAfterCapturedCallback.generationId,
      null,
      `${label}: captured callback dispatch cannot restore generation lifecycle authority`,
    );
    assert.equal(
      scenario.inspectAfterCapturedCallback.allocationFrozen,
      true,
      `${label}: rollback ownership must remain frozen after captured callback dispatch`,
    );
    assert.deepEqual(
      scenario.inspectAfterCapturedCallback.predictions,
      [],
      `${label}: captured callback dispatch cannot restore prediction registry authority`,
    );
    assert.equal(
      scenario.inspectAfterCapturedCallback.track,
      null,
      `${label}: captured callback dispatch cannot restore track registry authority`,
    );

    assert.equal(
      scenario.fixture.audio.context.sources.length,
      1,
      `${label}: rollback must not leak a reentrantly admitted source`,
    );
    assert.equal(
      scenario.originalSource,
      scenario.fixture.audio.context.sources[0],
      `${label}: the only source must be the original rollback source`,
    );
    assert.deepEqual(scenario.operationCounts, {
      gainAllocations: 5,
      sourceAllocations: 1,
      sourceStarts: 1,
      sourceStops: 1,
      sourceDisconnects: 1,
      gainDisconnects: 5,
    }, `${label}: native allocation/start/stop/disconnect operation counts must be exact`);
    assert.equal(scenario.originalSource.stopCalls, 1, `${label}: source stop must occur once`);
    assert.equal(
      scenario.originalSource.disconnectCalls,
      1,
      `${label}: source disconnect must occur once`,
    );
    assert.equal(
      scenario.originalSource.onendedClearCalls,
      1,
      `${label}: source onended authority must clear once`,
    );
    assert.equal(
      scenario.originalSource.bufferClearCalls,
      1,
      `${label}: source buffer authority must clear once`,
    );
    assert.equal(scenario.originalSource.onended, null, `${label}: source onended must be null`);
    assert.equal(scenario.originalSource.buffer, null, `${label}: source buffer must be null`);
    assert.equal(
      scenario.originalSource.connections.length,
      0,
      `${label}: source must retain no graph references`,
    );
    assert.deepEqual(
      scenario.fixture.audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
      [1, 1, 1, 1, 1],
      `${label}: all five graph gains must disconnect exactly once`,
    );

    assert.equal(scenario.finalInspect.generationId, null, `${label}: rollback must clear generation`);
    assert.equal(scenario.finalInspect.graphCreated, false, `${label}: rollback must clear graph`);
    assert.equal(
      scenario.finalInspect.allocationFrozen,
      false,
      `${label}: completed rollback must release allocation freeze`,
    );
    assert.deepEqual(scenario.finalInspect.predictions, [], `${label}: rollback must clear predictions`);
    assert.equal(scenario.finalInspect.track, null, `${label}: rollback must clear track`);
    assert.deepEqual(scenario.emittedEvents, [], `${label}: rollback and stale callback emit no events`);
    assert.deepEqual(
      scenario.postRollbackLowerBorrowSettlement,
      { status: 'succeeded', cause: null },
      `${label}: generation+1 lower borrow must release only after rollback cleanup completes`,
    );
  }
});

test('T8-STALE-SOURCE-IDENTITY cannot delete or strand a same-ID replacement source', async () => {
  const emittedEvents = [];
  let failRegistry = false;
  const fixture = await createFixture({
    audio: { resumeMode: 'deferred', suspendMode: 'deferred' },
    failStep(step) {
      if (failRegistry && step === 'source:registry') {
        throw new Error('PRIVATE_SOURCE_REGISTRY_FAILURE');
      }
    },
    onEvent(event) { emittedEvents.push(event); },
  });
  const firstTap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 40,
    sourceId: 'first-attempt-ack',
    scheduledAudioTime: 10.02,
  }));
  failRegistry = true;
  const firstPrediction = fixture.engine.schedulePredictions(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 41,
    predictions: Object.freeze([
      Object.freeze({ sourceId: 'same-source-id', scheduledAudioTime: 11 }),
    ]),
  }));
  const staleSource = fixture.audio.context.sources.at(-1);
  assert.equal(staleSource.endedCallbackHistory.length, 1);

  fixture.audio.resumeDeferred.resolve();
  await fixture.audio.suspendStarted.promise;
  fixture.audio.suspendDeferred.resolve();
  assert.deepEqual(await firstTap.settlement, { status: 'failed', cause: 'schedule-failed' });
  assert.deepEqual(await firstPrediction, { status: 'failed', cause: 'schedule-failed' });
  assert.equal(staleSource.stopCalls, 1);
  assert.equal(staleSource.disconnected, true);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assert.equal(fixture.audio.context.state, 'suspended');

  failRegistry = false;
  const retryTap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 42,
    sourceId: 'retry-ack',
    scheduledAudioTime: 10.6,
  }));
  const retryPrediction = fixture.engine.schedulePredictions(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 43,
    predictions: Object.freeze([
      Object.freeze({ sourceId: 'same-source-id', scheduledAudioTime: 11 }),
    ]),
  }));
  assert.deepEqual(await retryTap.settlement, { status: 'succeeded', cause: null });
  assert.deepEqual(await retryPrediction, { status: 'succeeded', cause: null });
  const replacementSource = fixture.audio.context.sources.at(-1);
  assert.notEqual(replacementSource, staleSource);

  assert.equal(staleSource.fireCapturedEndedCallback(), true);
  assertSourceReferencesClearedOnce(staleSource);
  assert.equal(
    fixture.engine.inspect().predictions.some(({ sourceId }) => sourceId === 'same-source-id'),
    true,
  );
  assert.equal(emittedEvents.length, 0);

  const originalMapGet = Map.prototype.get;
  Map.prototype.get = function exactRecordMismatch(candidate) {
    if (candidate === 'same-source-id') return staleSource;
    return Reflect.apply(originalMapGet, this, [candidate]);
  };
  try {
    assert.equal(replacementSource.fireCurrentEndedCallback(), true);
  } finally {
    Map.prototype.get = originalMapGet;
  }
  assert.equal(
    fixture.engine.inspect().predictions.some(({ sourceId }) => sourceId === 'same-source-id'),
    true,
  );
  assert.equal(emittedEvents.length, 0);
  assertSourceReferencesClearedOnce(replacementSource);

  const receipt = fixture.receipts.mint();
  const cleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 44,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  fixture.audio.advanceTo(10.525);
  assert.equal((await cleanup).status, 'succeeded');
  assert.equal(replacementSource.stopCalls, 0);
  assertSourceReferencesClearedOnce(replacementSource);
});

test('T8-STALE-TRACK-IDENTITY cannot clear or report a same-ID replacement track', async () => {
  const predictions = [{ sourceId: 'track-plan-prediction', scheduledAudioTime: 10.8 }];
  const plan = createPlan(predictions);
  const emittedEvents = [];
  let failTrackRegistry = false;
  const fixture = await createFixture({
    audio: { resumeMode: 'deferred', suspendMode: 'deferred' },
    failStep(step) {
      if (failTrackRegistry && step === 'handoff:track-registry') {
        throw new Error('PRIVATE_TRACK_REGISTRY_FAILURE');
      }
    },
    onEvent(event) { emittedEvents.push(event); },
  });
  const firstTap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 50,
    sourceId: 'first-track-attempt-ack',
    scheduledAudioTime: 10.02,
  }));
  const firstPredictions = fixture.engine.schedulePredictions(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 51,
    predictions: Object.freeze(predictions.map(Object.freeze)),
  }));
  failTrackRegistry = true;
  const firstHandoff = fixture.engine.commitHandoff(handoffRequest(plan));
  const staleTrack = fixture.audio.context.sources.find(({ startRecord }) => (
    startRecord?.offset === plan.trackStartOffsetSeconds
  ));
  assert.equal(staleTrack.endedCallbackHistory.length, 1);

  fixture.audio.resumeDeferred.resolve();
  await fixture.audio.suspendStarted.promise;
  fixture.audio.suspendDeferred.resolve();
  assert.deepEqual(await firstTap.settlement, { status: 'failed', cause: 'schedule-failed' });
  assert.deepEqual(await firstPredictions, { status: 'failed', cause: 'schedule-failed' });
  assert.deepEqual(await firstHandoff, { status: 'failed', cause: 'schedule-failed' });
  assert.equal(staleTrack.stopCalls, 1);
  assert.equal(staleTrack.disconnected, true);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assert.equal(fixture.audio.context.state, 'suspended');

  failTrackRegistry = false;
  const retryTap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 52,
    sourceId: 'retry-track-ack',
    scheduledAudioTime: 10.04,
  }));
  const retryPredictions = fixture.engine.schedulePredictions(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 53,
    predictions: Object.freeze(predictions.map(Object.freeze)),
  }));
  assert.deepEqual(await retryTap.settlement, { status: 'succeeded', cause: null });
  assert.deepEqual(await retryPredictions, { status: 'succeeded', cause: null });
  assert.deepEqual(await fixture.engine.commitHandoff(handoffRequest(plan)), {
    status: 'succeeded', cause: null,
  });
  const replacementTrack = fixture.audio.context.sources.at(-1);
  assert.notEqual(replacementTrack, staleTrack);
  const eventsBeforeStaleCallback = emittedEvents.length;

  assert.equal(staleTrack.fireCapturedEndedCallback(), true);
  assertSourceReferencesClearedOnce(staleTrack);
  assert.equal(fixture.engine.inspect().track?.sourceId, `generation-${GENERATION_ID}-track-source`);
  assert.equal(emittedEvents.length, eventsBeforeStaleCallback);

  const receipt = fixture.receipts.mint();
  const cleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 54,
    terminalRecordReceipt: receipt,
    audioNow: plan.audioNow,
  }));
  fixture.audio.advanceTo(plan.audioNow + 0.025);
  assert.equal((await cleanup).status, 'succeeded');
  assert.equal(replacementTrack.stopCalls, 1);
  assertSourceReferencesClearedOnce(replacementTrack);
});

test('T8-CALLBACK-REVOCATION suppresses reentrant end events during rollback and terminal stop', async () => {
  const rollbackEvents = [];
  const rollback = await createFixture({
    audio: { stopEndedMode: 'sync' },
    failStep(step) {
      if (step === 'source:registry') throw new Error('PRIVATE_ROLLBACK_FAILURE');
    },
    onEvent(event) { rollbackEvents.push(event); },
  });
  const failedTap = rollback.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 60,
    sourceId: 'rollback-source',
    scheduledAudioTime: 10.02,
  }));
  assert.deepEqual(await failedTap.settlement, { status: 'failed', cause: 'schedule-failed' });
  const rollbackSource = rollback.audio.context.sources[0];
  assert.equal(rollbackSource.stopCalls, 1);
  assert.equal(rollbackSource.ended, true);
  assertSourceReferencesClearedOnce(rollbackSource);
  assert.deepEqual(rollbackEvents, []);

  const terminalEvents = [];
  const terminal = await createFixture({
    audio: { stopEndedMode: 'sync' },
    onEvent(event) { terminalEvents.push(event); },
  });
  await activateGeneration(terminal);
  const terminalSource = terminal.audio.context.sources[0];
  const receipt = terminal.receipts.mint();
  const result = await terminal.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 61,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  assert.deepEqual(result, {
    scope: 'generation',
    status: 'succeeded',
    cause: null,
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  assert.equal(terminalSource.stopCalls, 1);
  assert.equal(terminalSource.ended, true);
  assertSourceReferencesClearedOnce(terminalSource);
  assert.deepEqual(terminalEvents, []);
});

test('T8-TERMINAL refuses forged receipts, freezes allocation, bounds source settlement, and mints exactly-once provenance', async () => {
  const fixture = await createFixture();
  await activateGeneration(fixture);
  await assert.rejects(
    fixture.capability.borrowForGeneration(GENERATION_ID, () => undefined),
    /parallel-generation-borrow/,
  );
  const before = fixture.engine.inspect();
  const forged = Object.freeze(Object.create(null));
  assert.throws(() => fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 9,
    terminalRecordReceipt: forged,
    audioNow: 10.5,
  })), /genuine terminal record receipt/);
  assert.deepEqual(fixture.engine.inspect(), before);

  const receipt = fixture.receipts.mint();
  const pending = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 10,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  assert.equal(fixture.engine.inspect().allocationFrozen, true);
  assert.throws(() => fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 11,
    sourceId: 'late',
    scheduledAudioTime: 11,
  })), /allocation is frozen/);
  fixture.audio.advanceTo(10.525);
  const result = await pending;
  assert.equal(fixture.engine.inspect().allocationFrozen, false);
  const nextGeneration = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID + 1,
    effectId: 11,
    sourceId: 'next-generation',
    scheduledAudioTime: 10.7,
  }));
  await assert.rejects(
    fixture.capability.borrowForGeneration(GENERATION_ID + 1, () => undefined),
    /parallel-generation-borrow/,
  );
  assert.deepEqual(await nextGeneration.settlement, { status: 'succeeded', cause: null });
  const nextReceipt = fixture.receipts.mint();
  const nextCleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID + 1,
    effectId: 12,
    terminalRecordReceipt: nextReceipt,
    audioNow: 10.8,
  }));
  fixture.audio.advanceTo(10.8 + 0.025);
  const nextResult = await nextCleanup;
  assert.deepEqual(nextResult, {
    scope: 'generation',
    status: 'succeeded',
    cause: null,
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  assert.equal(assertGenerationCleanupResult(nextResult, Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID + 1,
    terminalRecordReceipt: nextReceipt,
  })), true);
  const ownership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receipt,
  });
  assert.equal(assertGenerationCleanupResult(result, ownership), true);
  assert.deepEqual(result, {
    scope: 'generation',
    status: 'succeeded',
    cause: null,
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  assert.equal(claimGenerationCleanupResult(result, ownership), true);
  assert.throws(() => claimGenerationCleanupResult(result, ownership), /already claimed/);
  for (const candidate of [{ ...result }, Object.freeze({ ...result }), new Proxy(result, {})]) {
    assert.throws(() => assertGenerationCleanupResult(candidate, ownership), /genuine generation cleanup result/);
  }

  const timed = await createFixture();
  await activateGeneration(timed);
  const timedReceipt = timed.receipts.mint();
  const timedPending = timed.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 12,
    terminalRecordReceipt: timedReceipt,
    audioNow: 10.5,
  }));
  const cleanupDeadline = timed.audio.deadlines.find(({ kind }) => kind === 'generation-cleanup');
  assert.equal(cleanupDeadline.milliseconds, 100);
  await assert.rejects(
    timed.capability.borrowForGeneration(GENERATION_ID + 1, () => undefined),
    /parallel-generation-borrow/,
  );
  cleanupDeadline.fire();
  const timedResult = await timedPending;
  await assert.rejects(
    timed.capability.borrowForGeneration(GENERATION_ID + 1, () => undefined),
    /parallel-generation-borrow/,
  );
  assert.deepEqual(timedResult, {
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: false,
  });
  timed.audio.advanceTo(11);
  assert.equal(timedResult.status, 'failed');
  assert.equal(timedResult.sourceStopSettled, false);

  const automationFailure = await createFixture();
  await activateGeneration(automationFailure);
  automationFailure.audio.context.gains[1].gain.cancelScheduledValues = () => {
    throw new Error('PRIVATE_AUTOMATION_FAILURE');
  };
  const automationReceipt = automationFailure.receipts.mint();
  const automationResult = await automationFailure.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 16,
    terminalRecordReceipt: automationReceipt,
    audioNow: 10.5,
  }));
  assert.equal(automationResult.status, 'failed');
  assert.equal(automationResult.cause, 'source-stop-failed');
  assert.equal(automationFailure.audio.context.sources[0].stopCalls, 1);
  assert.equal(automationFailure.audio.context.sources[0].stopTime, 10.525);

  const alreadyStopped = await createFixture();
  await activateGeneration(alreadyStopped);
  await schedulePredictionSet(alreadyStopped, [
    { sourceId: 'already-stopped', scheduledAudioTime: 11 },
  ]);
  const stoppedRecord = alreadyStopped.audio.context.sources.at(-1);
  await alreadyStopped.engine.cancelPredictions(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 15,
    sourceIds: Object.freeze(['already-stopped']),
    audioNow: 10.1,
  }));
  assert.equal(stoppedRecord.stopCalls, 1);
  const stoppedReceipt = alreadyStopped.receipts.mint();
  const stoppedCleanup = alreadyStopped.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 17,
    terminalRecordReceipt: stoppedReceipt,
    audioNow: 10.2,
  }));
  alreadyStopped.audio.advanceTo(10.225);
  await stoppedCleanup;
  assert.equal(stoppedRecord.stopCalls, 1);

  const neverResumed = await createFixture({
    audio: { resumeMode: 'deferred', suspendMode: 'deferred' },
  });
  neverResumed.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 18,
    sourceId: 'never-resumed-source',
    scheduledAudioTime: 10.02,
  }));
  const neverReceipt = neverResumed.receipts.mint();
  const neverCleanupPromise = neverResumed.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 19,
    terminalRecordReceipt: neverReceipt,
    audioNow: 10.5,
  }));
  neverResumed.audio.advanceTo(10.525);
  neverResumed.audio.deadlines.find(({ kind }) => kind === 'generation-cleanup').fire();
  const neverCleanupResult = await neverCleanupPromise;
  assert.deepEqual(neverCleanupResult, {
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  await assert.rejects(
    neverResumed.capability.borrowForGeneration(GENERATION_ID + 1, () => undefined),
    /parallel-generation-borrow/,
  );
  neverResumed.audio.resumeDeferred.resolve();
  await neverResumed.audio.suspendStarted.promise;
  neverResumed.audio.suspendDeferred.resolve();
});

test('T8-STALE-RESUME-RECONCILIATION owns one suspend transaction before cleanup success or reuse', async () => {
  const stale = await createFixture({
    audio: { resumeMode: 'deferred', suspendMode: 'deferred' },
  });
  const staleTap = stale.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 20,
    sourceId: 'stale-resume-source',
    scheduledAudioTime: 10.02,
  }));
  const staleReceipt = stale.receipts.mint();
  const staleCleanup = stale.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 21,
    terminalRecordReceipt: staleReceipt,
    audioNow: 10.5,
  }));
  stale.audio.advanceTo(10.525);
  stale.audio.resumeDeferred.resolve();
  await stale.audio.suspendStarted.promise;
  assert.equal(stale.engine.inspect().allocationFrozen, true);
  assert.equal(stale.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  stale.audio.suspendDeferred.resolve();
  assert.deepEqual(await staleTap.settlement, { status: 'failed', cause: 'schedule-failed' });
  assert.deepEqual(await staleCleanup, {
    scope: 'generation',
    status: 'succeeded',
    cause: null,
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  assert.equal(stale.engine.inspect().allocationFrozen, false);
  assert.equal(stale.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assert.equal(stale.audio.context.state, 'suspended');

  const staleNext = stale.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID + 1,
    effectId: 22,
    sourceId: 'after-stale-resume',
    scheduledAudioTime: 10.7,
  }));
  assert.deepEqual(await staleNext.settlement, { status: 'succeeded', cause: null });
  const staleNextReceipt = stale.receipts.mint();
  const staleNextCleanup = stale.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID + 1,
    effectId: 23,
    terminalRecordReceipt: staleNextReceipt,
    audioNow: 10.8,
  }));
  stale.audio.advanceTo(10.8 + 0.025);
  assert.equal((await staleNextCleanup).status, 'succeeded');

  const immediateSuspend = await createFixture({
    audio: { resumeMode: 'deferred', suspendMode: 'resolve' },
  });
  const immediateTap = immediateSuspend.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 24,
    sourceId: 'immediate-suspend-source',
    scheduledAudioTime: 10.02,
  }));
  const immediateReceipt = immediateSuspend.receipts.mint();
  const immediateCleanup = immediateSuspend.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 25,
    terminalRecordReceipt: immediateReceipt,
    audioNow: 10.5,
  }));
  immediateSuspend.audio.advanceTo(10.525);
  immediateSuspend.audio.resumeDeferred.resolve();
  assert.deepEqual(await immediateTap.settlement, { status: 'failed', cause: 'schedule-failed' });
  assert.equal((await immediateCleanup).status, 'succeeded');
  assert.equal(immediateSuspend.audio.events.filter(({ type }) => type === 'suspend').length, 1);

  const rejectedSuspend = await createFixture({
    audio: { resumeMode: 'deferred', suspendMode: 'reject' },
  });
  const rejectedTap = rejectedSuspend.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 26,
    sourceId: 'rejected-suspend-source',
    scheduledAudioTime: 10.02,
  }));
  const rejectedReceipt = rejectedSuspend.receipts.mint();
  const rejectedCleanup = rejectedSuspend.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 27,
    terminalRecordReceipt: rejectedReceipt,
    audioNow: 10.5,
  }));
  rejectedSuspend.audio.advanceTo(10.525);
  rejectedSuspend.audio.resumeDeferred.resolve();
  await rejectedSuspend.audio.suspendStarted.promise;
  assert.deepEqual(await rejectedTap.settlement, { status: 'failed', cause: 'schedule-failed' });
  assert.deepEqual(await rejectedCleanup, {
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  assert.equal(rejectedSuspend.engine.inspect().allocationFrozen, true);
  assert.equal(rejectedSuspend.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assert.throws(() => rejectedSuspend.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID + 1,
    effectId: 28,
    sourceId: 'blocked-after-suspend-rejection',
    scheduledAudioTime: 10.7,
  })), /allocation is frozen/);

  const timedSuspend = await createFixture({
    audio: { resumeMode: 'deferred', suspendMode: 'deferred' },
  });
  const timedSuspendTap = timedSuspend.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 29,
    sourceId: 'timed-suspend-source',
    scheduledAudioTime: 10.02,
  }));
  const timedSuspendReceipt = timedSuspend.receipts.mint();
  const timedSuspendCleanup = timedSuspend.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 30,
    terminalRecordReceipt: timedSuspendReceipt,
    audioNow: 10.5,
  }));
  timedSuspend.audio.advanceTo(10.525);
  timedSuspend.audio.resumeDeferred.resolve();
  await timedSuspend.audio.suspendStarted.promise;
  timedSuspend.audio.deadlines.find(({ kind }) => kind === 'generation-cleanup').fire();
  const timedSuspendResult = await timedSuspendCleanup;
  assert.deepEqual(timedSuspendResult, {
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  assert.equal(timedSuspend.engine.inspect().allocationFrozen, true);
  assert.equal(timedSuspend.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  timedSuspend.audio.suspendDeferred.resolve();
  assert.deepEqual(await timedSuspendTap.settlement, { status: 'failed', cause: 'schedule-failed' });
  assert.equal(timedSuspendResult.status, 'failed');
  assert.equal(timedSuspend.engine.inspect().allocationFrozen, true);
});

test('T8-TX-LATE-RESUME-REJECT-AFTER-DEADLINE', async () => {
  function operationCounts(fixture) {
    return Object.freeze({
      sourceObjects: fixture.audio.context.sources.length,
      gainObjects: fixture.audio.context.gains.length,
      sourceAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-source').length,
      gainAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-gain').length,
      sourceStarts: fixture.audio.events.filter(({ type }) => type === 'start').length,
      sourceStops: fixture.audio.events.filter(({ type }) => type === 'stop').length,
      sourceDisconnects: fixture.audio.events.filter((event) => (
        event.type === 'disconnect' && event.kind === 'source'
      )).length,
      gainDisconnects: fixture.audio.events.filter((event) => (
        event.type === 'disconnect' && event.kind === 'gain'
      )).length,
      resumes: fixture.audio.events.filter(({ type }) => type === 'resume').length,
      suspends: fixture.audio.events.filter(({ type }) => type === 'suspend').length,
    });
  }

  function sourceReferenceCounts(fixture) {
    return Object.freeze({
      sourceObjects: fixture.audio.context.sources.length,
      bufferReferences: fixture.audio.context.sources.filter(({ buffer }) => buffer !== null).length,
      endedCallbackReferences: fixture.audio.context.sources.filter(({ onended }) => (
        typeof onended === 'function'
      )).length,
      outboundConnections: fixture.audio.context.sources.reduce(
        (total, { connections }) => total + connections.length,
        0,
      ),
    });
  }

  function assertSameEngineGenerationTwoBlocked(fixture, effectId, stage) {
    const operationsBefore = operationCounts(fixture);
    const referencesBefore = sourceReferenceCounts(fixture);
    assert.throws(() => fixture.engine.directTap(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID + 1,
      effectId,
      sourceId: `blocked-generation-two-${effectId}`,
      scheduledAudioTime: 10.7,
    })), /allocation is frozen/, `${stage}: same-engine generation 2 must throw synchronously`);
    assert.deepEqual(
      operationCounts(fixture),
      operationsBefore,
      `${stage}: rejected same-engine admission must cause zero native operations`,
    );
    assert.deepEqual(
      sourceReferenceCounts(fixture),
      referencesBefore,
      `${stage}: rejected same-engine admission must retain zero source references`,
    );
  }

  function assertSecondEngineBlocked(fixture, stage) {
    const options = Object.freeze({
      loadedSessionCapability: fixture.capability,
      sessionId: SESSION_ID,
      assertTerminalRecordReceipt: fixture.receipts.assert,
      createCleanupDeadline: fixture.audio.dependencies.createDeadline,
      failureInjector() {},
      onEvent() {},
    });
    const operationsBefore = operationCounts(fixture);
    const referencesBefore = sourceReferenceCounts(fixture);
    assert.throws(
      () => createWebAudioEngine(options),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.match(error.message, /already bound/);
        return true;
      },
      `${stage}: the genuine capability must remain permanently bound to its first engine`,
    );
    assert.deepEqual(
      operationCounts(fixture),
      operationsBefore,
      `${stage}: rejected replacement-engine construction must cause zero native operations`,
    );
    assert.deepEqual(
      sourceReferenceCounts(fixture),
      referencesBefore,
      `${stage}: rejected replacement-engine construction must retain zero source references`,
    );
  }

  const fixture = await createFixture({
    audio: { resumeMode: 'deferred', suspendMode: 'deferred' },
  });
  const tap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 100,
    sourceId: 'late-resume-rejection-source',
    scheduledAudioTime: 10.02,
  }));
  const originalSource = fixture.audio.context.sources[0];
  assert.notEqual(originalSource, undefined);

  const receipt = fixture.receipts.mint();
  const cleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 101,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  fixture.audio.advanceTo(10.525);
  const cleanupDeadlines = fixture.audio.deadlines.filter(({ kind }) => (
    kind === 'generation-cleanup'
  ));
  assert.equal(cleanupDeadlines.length, 1);
  const [cleanupDeadline] = cleanupDeadlines;
  assert.equal(cleanupDeadline.milliseconds, 100);
  assert.equal(cleanupDeadline.cancelled, false);
  cleanupDeadline.fire();

  const cleanupResult = await cleanup;
  const expectedCleanupResult = Object.freeze({
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  assert.deepEqual(cleanupResult, expectedCleanupResult);
  const cleanupOwnership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receipt,
  });
  assert.equal(assertGenerationCleanupResult(cleanupResult, cleanupOwnership), true);
  assert.deepEqual(fixture.engine.inspect(), {
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  assert.equal(fixture.audio.resumeDeferred.promise instanceof Promise, true);
  assert.equal(originalSource.stopCalls, 1);
  assert.equal(originalSource.stopTime, 10.525);
  assert.equal(originalSource.ended, true);
  assertSourceReferencesClearedOnce(originalSource);
  assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected));
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.deepEqual(sourceReferenceCounts(fixture), {
    sourceObjects: 1,
    bufferReferences: 0,
    endedCallbackReferences: 0,
    outboundConnections: 0,
  });
  assert.deepEqual(operationCounts(fixture), {
    sourceObjects: 1,
    gainObjects: 5,
    sourceAllocations: 1,
    gainAllocations: 5,
    sourceStarts: 1,
    sourceStops: 1,
    sourceDisconnects: 1,
    gainDisconnects: 5,
    resumes: 1,
    suspends: 0,
  });

  assertSameEngineGenerationTwoBlocked(fixture, 102, 'before late resume rejection');
  assertSecondEngineBlocked(fixture, 'before late resume rejection');

  const terminalFailedOperations = operationCounts(fixture);
  const terminalFailedReferences = sourceReferenceCounts(fixture);
  let tapSettlementObserved = false;
  const observedTapSettlement = tap.settlement.then((result) => {
    tapSettlementObserved = true;
    return result;
  });
  fixture.audio.resumeDeferred.reject(
    new Error('PRIVATE_LATE_RESUME_REJECTION_AFTER_TERMINAL_DEADLINE'),
  );
  await fixture.audio.suspendStarted.promise;
  assert.equal(
    tapSettlementObserved,
    false,
    'terminal-failed startup settlement must join its owned pending suspend reconciliation',
  );

  assert.equal(fixture.engine.inspect().allocationFrozen, true);
  assert.equal(fixture.engine.inspect().generationId, null);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assert.equal(operationCounts(fixture).sourceAllocations, terminalFailedOperations.sourceAllocations);
  assert.equal(operationCounts(fixture).gainAllocations, terminalFailedOperations.gainAllocations);
  assert.equal(operationCounts(fixture).sourceStarts, terminalFailedOperations.sourceStarts);
  assert.deepEqual(sourceReferenceCounts(fixture), terminalFailedReferences);
  assertSameEngineGenerationTwoBlocked(fixture, 103, 'while stale-generation suspend is pending');

  fixture.audio.suspendDeferred.resolve();
  assert.deepEqual(await observedTapSettlement, {
    status: 'failed',
    cause: 'context-resume-failed',
  });
  const cleanupResultAfterLateRejection = await cleanup;
  assert.equal(cleanupResultAfterLateRejection, cleanupResult);
  assert.deepEqual(cleanupResultAfterLateRejection, expectedCleanupResult);
  assert.equal(
    assertGenerationCleanupResult(cleanupResultAfterLateRejection, cleanupOwnership),
    true,
  );
  assert.equal(fixture.engine.inspect().allocationFrozen, true);
  assert.equal(fixture.engine.inspect().generationId, null);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assert.deepEqual(sourceReferenceCounts(fixture), terminalFailedReferences);
  assertSameEngineGenerationTwoBlocked(fixture, 104, 'after stale-generation suspend settlement');
  assertSecondEngineBlocked(fixture, 'after stale-generation suspend settlement');
});

test('T8-TX-RESUME-REJECT-STILL-SUSPENDS', async () => {
  const fixture = await createFixture({
    audio: { resumeMode: 'deferred', suspendMode: 'resolve' },
  });
  const countOperations = (type, kind = undefined) => fixture.audio.events.filter((event) => (
    event.type === type && (kind === undefined || event.kind === kind)
  )).length;

  const tap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 105,
    sourceId: 'resume-rejection-before-deadline-source',
    scheduledAudioTime: 10.02,
  }));
  const originalSource = fixture.audio.context.sources[0];
  assert.notEqual(originalSource, undefined);

  const receipt = fixture.receipts.mint();
  const cleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 106,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  const normalizedCleanup = cleanup.then(
    (result) => Object.freeze({ kind: 'result', result }),
    (error) => Object.freeze({
      kind: 'rejected',
      cause: error?.code ?? error?.message,
    }),
  );
  fixture.audio.advanceTo(10.525);

  const cleanupDeadlines = fixture.audio.deadlines.filter(({ kind }) => (
    kind === 'generation-cleanup'
  ));
  assert.equal(cleanupDeadlines.length, 1);
  const [cleanupDeadline] = cleanupDeadlines;
  assert.equal(cleanupDeadline.milliseconds, 100);
  assert.equal(cleanupDeadline.cancelled, false);

  fixture.audio.resumeDeferred.reject(
    new Error('PRIVATE_RESUME_REJECTION_BEFORE_GENERATION_CLEANUP_DEADLINE'),
  );
  const tapResult = await tap.settlement;
  const cleanupOutcome = await normalizedCleanup;

  assert.equal(
    countOperations('suspend'),
    1,
    'rejected generation borrow must still trigger one best-effort stale-generation suspend after borrow settlement',
  );

  await fixture.audio.suspendStarted.promise;
  assert.equal(fixture.audio.context.state, 'suspended');
  assert.equal(countOperations('suspend'), 1);
  assert.deepEqual(tapResult, {
    status: 'failed',
    cause: 'context-resume-failed',
  });

  const expectedCleanupResult = Object.freeze({
    scope: 'generation',
    status: 'succeeded',
    cause: null,
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  assert.deepEqual(cleanupOutcome, {
    kind: 'result',
    result: expectedCleanupResult,
  });
  const cleanupOwnership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receipt,
  });
  assert.equal(
    assertGenerationCleanupResult(cleanupOutcome.result, cleanupOwnership),
    true,
  );
  assert.equal(cleanupDeadline.cancelled, true);

  assert.equal(originalSource.stopCalls, 1);
  assert.equal(originalSource.stopTime, 10.525);
  assert.equal(originalSource.ended, true);
  assertSourceReferencesClearedOnce(originalSource);
  assert.equal(countOperations('start'), 1);
  assert.equal(countOperations('stop'), 1);
  assert.equal(countOperations('disconnect', 'source'), 1);
  assert.equal(countOperations('disconnect', 'gain'), 5);
  assert.equal(fixture.audio.context.gains.length, 5);
  assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected));
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.equal(fixture.audio.context.sources.length, 1);
  assert.ok(fixture.audio.context.sources.every(({ buffer }) => buffer === null));
  assert.ok(fixture.audio.context.sources.every(({ onended }) => onended === null));
  assert.ok(fixture.audio.context.sources.every(({ connections }) => connections.length === 0));
  assert.deepEqual(fixture.engine.inspect(), {
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: false,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });

  assert.equal(await tap.settlement, tapResult);
  assert.equal(await normalizedCleanup, cleanupOutcome);
  assert.deepEqual(fixture.engine.inspect(), {
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: false,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  assert.equal(
    countOperations('suspend'),
    1,
    'cached stale-generation reconciliation must not duplicate native suspend',
  );
});

test('T8-TX-TERMINAL-FAILURE-CAUSE-CLOSED', async () => {
  const fixture = await createFixture();
  await activateGeneration(fixture);
  const originalSource = fixture.audio.context.sources[0];
  assert.notEqual(originalSource, undefined);

  const receipt = fixture.receipts.mint();
  const cleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 107,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));

  const cleanupDeadlines = fixture.audio.deadlines.filter(({ kind }) => (
    kind === 'generation-cleanup'
  ));
  assert.equal(cleanupDeadlines.length, 1);
  const [cleanupDeadline] = cleanupDeadlines;
  assert.equal(cleanupDeadline.milliseconds, 100);
  assert.equal(cleanupDeadline.cancelled, false);
  assert.equal(originalSource.ended, false, 'the source must remain pending until the deadline');
  cleanupDeadline.fire();

  const cleanupResult = await cleanup;
  const expectedCleanupResult = Object.freeze({
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: false,
  });
  assert.equal(Object.isFrozen(cleanupResult), true);
  assert.deepEqual(cleanupResult, expectedCleanupResult);
  assert.deepEqual(Reflect.ownKeys(cleanupResult), [
    'scope',
    'status',
    'cause',
    'sourceReferencesCleared',
    'sourceStopSettled',
  ]);
  assert.doesNotMatch(JSON.stringify(cleanupResult), /timeout/i);

  const cleanupOwnership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receipt,
  });
  assert.equal(assertGenerationCleanupResult(cleanupResult, cleanupOwnership), true);

  assert.equal(originalSource.stopCalls, 1);
  assert.equal(originalSource.stopTime, 10.525);
  assertSourceReferencesClearedOnce(originalSource);
  assert.equal(originalSource.connections.length, 0);
  assert.equal(fixture.audio.context.gains.length, 5);
  assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected));
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));

  const inspection = fixture.engine.inspect();
  assert.equal(inspection.generationId, null);
  assert.equal(inspection.allocationFrozen, true);

  const allocationCounts = () => Object.freeze({
    sources: fixture.audio.events.filter(({ type }) => type === 'allocate-source').length,
    gains: fixture.audio.events.filter(({ type }) => type === 'allocate-gain').length,
    starts: fixture.audio.events.filter(({ type }) => type === 'start').length,
  });
  const allocationsBeforeBlockedTap = allocationCounts();
  assert.throws(() => fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID + 1,
    effectId: 108,
    sourceId: 'blocked-after-terminal-source-failure',
    scheduledAudioTime: 10.7,
  })), /allocation is frozen/);
  assert.deepEqual(allocationCounts(), allocationsBeforeBlockedTap);
});

test('T8-TX-DUPLICATE-PENDING-SAME-RECEIPT', async () => {
  let fixture = null;
  let originalSource = null;
  let receipt = null;
  let reentrantStopSource = null;
  let reentrantCleanup = null;
  let reentrantError = null;
  let reentrantAdmissionSnapshot = null;
  const reentrantAdmissionErrors = [];
  let reentrantStopHookCalls = 0;
  fixture = await createFixture({
    audio: {
      stopEndedMode: 'none',
      onStop(source) {
        if (source !== originalSource || reentrantStopHookCalls !== 0) return;
        reentrantStopHookCalls += 1;
        reentrantStopSource = source;
        try {
          reentrantCleanup = fixture.engine.terminateGeneration(Object.freeze({
            sessionId: SESSION_ID,
            generationId: GENERATION_ID,
            effectId: 110,
            terminalRecordReceipt: receipt,
            audioNow: 10.501,
          }));
        } catch (error) {
          reentrantError = error;
        }
        const beforeAdmission = Object.freeze({
          sources: fixture.audio.context.sources.length,
          gains: fixture.audio.context.gains.length,
          events: fixture.audio.events.length,
        });
        for (const [generationId, effectId] of [
          [GENERATION_ID, 1101],
          [GENERATION_ID + 1, 1102],
        ]) {
          try {
            fixture.engine.directTap(Object.freeze({
              sessionId: SESSION_ID,
              generationId,
              effectId,
              sourceId: `terminal-stop-reentrant-${generationId}`,
              scheduledAudioTime: 10.9,
            }));
          } catch (error) {
            reentrantAdmissionErrors.push(error);
          }
        }
        reentrantAdmissionSnapshot = Object.freeze({
          before: beforeAdmission,
          after: Object.freeze({
            sources: fixture.audio.context.sources.length,
            gains: fixture.audio.context.gains.length,
            events: fixture.audio.events.length,
          }),
        });
      },
    },
  });
  await activateGeneration(fixture);
  originalSource = fixture.audio.context.sources[0];
  assert.notEqual(originalSource, undefined);
  assert.equal(originalSource.ended, false);

  const operationCounts = () => Object.freeze({
    sourceObjects: fixture.audio.context.sources.length,
    gainObjects: fixture.audio.context.gains.length,
    sourceAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-source').length,
    gainAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-gain').length,
    sourceStarts: fixture.audio.events.filter(({ type }) => type === 'start').length,
    sourceStops: fixture.audio.events.filter(({ type }) => type === 'stop').length,
    sourceDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'source'
    )).length,
    gainDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'gain'
    )).length,
    resumes: fixture.audio.events.filter(({ type }) => type === 'resume').length,
    suspends: fixture.audio.events.filter(({ type }) => type === 'suspend').length,
    deadlines: fixture.audio.deadlines.length,
    gainAutomationOperations: fixture.audio.context.gains.reduce(
      (total, { gain }) => total + gain.events.length,
      0,
    ),
  });
  const referenceSnapshot = () => Object.freeze({
    sourceObjects: Object.freeze([...fixture.audio.context.sources]),
    gainObjects: Object.freeze([...fixture.audio.context.gains]),
    sourceBuffers: Object.freeze(fixture.audio.context.sources.map(({ buffer }) => buffer)),
    sourceEndedCallbacks: Object.freeze(
      fixture.audio.context.sources.map(({ onended }) => onended),
    ),
    sourceConnections: Object.freeze(fixture.audio.context.sources.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    gainConnections: Object.freeze(fixture.audio.context.gains.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    sourceBufferClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ bufferClearCalls }) => bufferClearCalls),
    ),
    sourceEndedClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ onendedClearCalls }) => onendedClearCalls),
    ),
  });

  const deadlinesBeforeFirst = fixture.audio.deadlines.length;
  receipt = fixture.receipts.mint();
  const first = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 109,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));

  assert.equal(reentrantStopHookCalls, 1);
  assert.equal(reentrantStopSource, originalSource);
  assert.equal(reentrantError, null);
  assert.equal(reentrantCleanup, first);
  assert.equal(reentrantAdmissionErrors.length, 2);
  assert.ok(reentrantAdmissionErrors.every((error) => /allocation is frozen/.test(error.message)));
  assert.deepEqual(reentrantAdmissionSnapshot.after, reentrantAdmissionSnapshot.before);

  const pendingInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  assert.deepEqual(fixture.engine.inspect(), pendingInspection);
  assert.equal(originalSource.stopCalls, 1);
  assert.equal(originalSource.stopTime, 10.525);
  assert.equal(originalSource.ended, false);
  assert.equal(originalSource.disconnectCalls, 0);
  const cleanupDeadlines = fixture.audio.deadlines.filter(({ kind }) => (
    kind === 'generation-cleanup'
  ));
  assert.equal(cleanupDeadlines.length, 1);
  assert.equal(fixture.audio.deadlines.length, deadlinesBeforeFirst + 1);
  const [cleanupDeadline] = cleanupDeadlines;
  assert.equal(cleanupDeadline.milliseconds, 100);
  assert.equal(cleanupDeadline.cancelled, false);

  const operationsAfterFirst = operationCounts();
  const referencesAfterFirst = referenceSnapshot();
  const duplicate = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 111,
    terminalRecordReceipt: receipt,
    audioNow: 10.51,
  }));

  assert.equal(duplicate, first);
  assert.deepEqual(operationCounts(), operationsAfterFirst);
  assert.deepEqual(referenceSnapshot(), referencesAfterFirst);
  assert.deepEqual(fixture.engine.inspect(), pendingInspection);
  assert.equal(originalSource.stopCalls, 1);
  assert.equal(originalSource.disconnectCalls, 0);
  assert.equal(cleanupDeadline.cancelled, false);

  fixture.audio.advanceTo(10.525);
  const firstResult = await first;
  const duplicateResult = await duplicate;
  assert.equal(duplicateResult, firstResult);

  const expectedCleanupResult = Object.freeze({
    scope: 'generation',
    status: 'succeeded',
    cause: null,
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  assert.equal(Object.isFrozen(firstResult), true);
  assert.deepEqual(firstResult, expectedCleanupResult);
  assert.deepEqual(Reflect.ownKeys(firstResult), [
    'scope',
    'status',
    'cause',
    'sourceReferencesCleared',
    'sourceStopSettled',
  ]);
  const originalOwnership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receipt,
  });
  assert.equal(assertGenerationCleanupResult(firstResult, originalOwnership), true);

  assert.equal(fixture.audio.deadlines.length, deadlinesBeforeFirst + 1);
  assert.equal(cleanupDeadline.cancelled, true);
  assert.equal(originalSource.stopCalls, 1);
  assert.equal(originalSource.stopTime, 10.525);
  assert.equal(originalSource.ended, true);
  assertSourceReferencesClearedOnce(originalSource);
  assert.equal(fixture.audio.context.sources.length, 1);
  assert.equal(fixture.audio.context.gains.length, 5);
  assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected));
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.deepEqual(operationCounts(), {
    sourceObjects: 1,
    gainObjects: 5,
    sourceAllocations: 1,
    gainAllocations: 5,
    sourceStarts: 1,
    sourceStops: 1,
    sourceDisconnects: 1,
    gainDisconnects: 5,
    resumes: 1,
    suspends: 0,
    deadlines: deadlinesBeforeFirst + 1,
    gainAutomationOperations: operationsAfterFirst.gainAutomationOperations,
  });
  assert.deepEqual(fixture.engine.inspect(), {
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: false,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
});

test('T8-TX-DUPLICATE-COMPLETED-SAME-RECEIPT', async () => {
  const fixture = await createFixture({ audio: { stopEndedMode: 'none' } });
  await activateGeneration(fixture);
  const originalSource = fixture.audio.context.sources[0];
  assert.notEqual(originalSource, undefined);
  assert.equal(originalSource.ended, false);

  const nativeOperationAndDeadlineCounts = () => Object.freeze({
    events: fixture.audio.events.length,
    sourceObjects: fixture.audio.context.sources.length,
    gainObjects: fixture.audio.context.gains.length,
    sourceAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-source').length,
    gainAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-gain').length,
    sourceStarts: fixture.audio.events.filter(({ type }) => type === 'start').length,
    sourceStops: fixture.audio.events.filter(({ type }) => type === 'stop').length,
    sourceDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'source'
    )).length,
    gainDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'gain'
    )).length,
    resumes: fixture.audio.events.filter(({ type }) => type === 'resume').length,
    suspends: fixture.audio.events.filter(({ type }) => type === 'suspend').length,
    deadlines: fixture.audio.deadlines.length,
    sourceStopCalls: fixture.audio.context.sources.reduce(
      (total, { stopCalls }) => total + stopCalls,
      0,
    ),
    sourceDisconnectCalls: fixture.audio.context.sources.reduce(
      (total, { disconnectCalls }) => total + disconnectCalls,
      0,
    ),
    gainDisconnectCalls: fixture.audio.context.gains.reduce(
      (total, { disconnectCalls }) => total + disconnectCalls,
      0,
    ),
    gainAutomationOperations: fixture.audio.context.gains.reduce(
      (total, { gain }) => total + gain.events.length,
      0,
    ),
  });
  const referenceSnapshot = () => Object.freeze({
    sourceObjects: Object.freeze([...fixture.audio.context.sources]),
    gainObjects: Object.freeze([...fixture.audio.context.gains]),
    sourceBuffers: Object.freeze(fixture.audio.context.sources.map(({ buffer }) => buffer)),
    sourceEndedCallbacks: Object.freeze(
      fixture.audio.context.sources.map(({ onended }) => onended),
    ),
    sourceConnections: Object.freeze(fixture.audio.context.sources.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    gainConnections: Object.freeze(fixture.audio.context.gains.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    sourceBufferClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ bufferClearCalls }) => bufferClearCalls),
    ),
    sourceEndedClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ onendedClearCalls }) => onendedClearCalls),
    ),
  });

  const deadlinesBeforeCleanup = fixture.audio.deadlines.length;
  const receipt = fixture.receipts.mint();
  const cleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 111,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  const cleanupDeadlines = fixture.audio.deadlines.filter(({ kind }) => (
    kind === 'generation-cleanup'
  ));
  assert.equal(cleanupDeadlines.length, 1);
  const [cleanupDeadline] = cleanupDeadlines;
  assert.equal(cleanupDeadline.milliseconds, 100);
  assert.equal(cleanupDeadline.cancelled, false);

  fixture.audio.advanceTo(10.525);
  const originalResult = await cleanup;
  const expectedCleanupResult = Object.freeze({
    scope: 'generation',
    status: 'succeeded',
    cause: null,
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  assert.equal(Object.isFrozen(originalResult), true);
  assert.deepEqual(originalResult, expectedCleanupResult);
  const originalOwnership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receipt,
  });
  assert.equal(assertGenerationCleanupResult(originalResult, originalOwnership), true);

  const completedInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: false,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  assert.deepEqual(fixture.engine.inspect(), completedInspection);
  assert.equal(fixture.audio.deadlines.length, deadlinesBeforeCleanup + 1);
  assert.equal(cleanupDeadline.cancelled, true);
  assert.equal(originalSource.stopCalls, 1);
  assert.equal(originalSource.stopTime, 10.525);
  assert.equal(originalSource.ended, true);
  assertSourceReferencesClearedOnce(originalSource);
  assert.equal(fixture.audio.context.sources.length, 1);
  assert.equal(fixture.audio.context.gains.length, 5);
  assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected));
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));

  const operationsAfterCompletion = nativeOperationAndDeadlineCounts();
  const referencesAfterCompletion = referenceSnapshot();
  const duplicateOutcome = (() => {
    try {
      return Object.freeze({
        status: 'returned',
        promise: fixture.engine.terminateGeneration(Object.freeze({
          sessionId: SESSION_ID,
          generationId: GENERATION_ID,
          effectId: 112,
          terminalRecordReceipt: receipt,
          audioNow: 10.75,
        })),
        errorMessage: null,
      });
    } catch (error) {
      return Object.freeze({
        status: 'threw',
        promise: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  assert.deepEqual(
    { status: duplicateOutcome.status, errorMessage: duplicateOutcome.errorMessage },
    { status: 'returned', errorMessage: null },
    'completed same-receipt replay must return the original cleanup promise without throwing',
  );
  const duplicate = duplicateOutcome.promise;
  assert.equal(duplicate, cleanup);
  const duplicateResult = await duplicate;
  assert.equal(duplicateResult, originalResult);
  assert.equal(assertGenerationCleanupResult(duplicateResult, originalOwnership), true);

  assert.deepEqual(nativeOperationAndDeadlineCounts(), operationsAfterCompletion);
  assert.deepEqual(referenceSnapshot(), referencesAfterCompletion);
  assert.deepEqual(fixture.engine.inspect(), completedInspection);
  assert.equal(fixture.engine.inspect().allocationFrozen, false);
  assert.equal(originalSource.stopCalls, 1);
  assertSourceReferencesClearedOnce(originalSource);
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.equal(cleanupDeadline.cancelled, true);
});

test('T8-TX-DUPLICATE-CONFLICTING-RECEIPT', async () => {
  const fixture = await createFixture({ audio: { stopEndedMode: 'none' } });
  await activateGeneration(fixture);
  const originalSource = fixture.audio.context.sources[0];
  assert.notEqual(originalSource, undefined);
  assert.equal(originalSource.ended, false);

  const nativeOperationSnapshot = () => Object.freeze({
    events: fixture.audio.events.length,
    sourceObjects: fixture.audio.context.sources.length,
    gainObjects: fixture.audio.context.gains.length,
    sourceAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-source').length,
    gainAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-gain').length,
    sourceStarts: fixture.audio.events.filter(({ type }) => type === 'start').length,
    sourceStops: fixture.audio.events.filter(({ type }) => type === 'stop').length,
    sourceDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'source'
    )).length,
    gainDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'gain'
    )).length,
    resumes: fixture.audio.events.filter(({ type }) => type === 'resume').length,
    suspends: fixture.audio.events.filter(({ type }) => type === 'suspend').length,
    sourceStopCalls: fixture.audio.context.sources.reduce(
      (total, { stopCalls }) => total + stopCalls,
      0,
    ),
    sourceDisconnectCalls: fixture.audio.context.sources.reduce(
      (total, { disconnectCalls }) => total + disconnectCalls,
      0,
    ),
    gainDisconnectCalls: fixture.audio.context.gains.reduce(
      (total, { disconnectCalls }) => total + disconnectCalls,
      0,
    ),
    gainAutomationOperations: fixture.audio.context.gains.reduce(
      (total, { gain }) => total + gain.events.length,
      0,
    ),
  });
  const referenceSnapshot = () => Object.freeze({
    sourceObjects: Object.freeze([...fixture.audio.context.sources]),
    gainObjects: Object.freeze([...fixture.audio.context.gains]),
    sourceBuffers: Object.freeze(fixture.audio.context.sources.map(({ buffer }) => buffer)),
    sourceEndedCallbacks: Object.freeze(
      fixture.audio.context.sources.map(({ onended }) => onended),
    ),
    sourceConnections: Object.freeze(fixture.audio.context.sources.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    gainConnections: Object.freeze(fixture.audio.context.gains.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    sourceStopTimes: Object.freeze(
      fixture.audio.context.sources.map(({ stopTime }) => stopTime),
    ),
    sourceEndedStates: Object.freeze(
      fixture.audio.context.sources.map(({ ended }) => ended),
    ),
    sourceBufferClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ bufferClearCalls }) => bufferClearCalls),
    ),
    sourceEndedClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ onendedClearCalls }) => onendedClearCalls),
    ),
    sourceDisconnectCalls: Object.freeze(
      fixture.audio.context.sources.map(({ disconnectCalls }) => disconnectCalls),
    ),
    gainDisconnectCalls: Object.freeze(
      fixture.audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
    ),
    gainAutomation: Object.freeze(fixture.audio.context.gains.map(({ gain }) => (
      Object.freeze([...gain.events])
    ))),
  });
  const deadlineSnapshot = () => Object.freeze(fixture.audio.deadlines.map((deadline) => (
    Object.freeze({
      deadline,
      kind: deadline.kind,
      milliseconds: deadline.milliseconds,
      promise: deadline.promise,
      cancelled: deadline.cancelled,
    })
  )));

  const receiptA = fixture.receipts.mint();
  const receiptB = fixture.receipts.mint();
  assert.notEqual(receiptA, receiptB);
  const deadlinesBeforeCleanup = fixture.audio.deadlines.length;
  const originalCleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 113,
    terminalRecordReceipt: receiptA,
    audioNow: 10.5,
  }));

  const pendingInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  assert.deepEqual(fixture.engine.inspect(), pendingInspection);
  const cleanupDeadlines = fixture.audio.deadlines.filter(({ kind }) => (
    kind === 'generation-cleanup'
  ));
  assert.equal(cleanupDeadlines.length, 1);
  const [cleanupDeadline] = cleanupDeadlines;
  assert.equal(fixture.audio.deadlines.length, deadlinesBeforeCleanup + 1);
  assert.equal(cleanupDeadline.milliseconds, 100);
  assert.equal(cleanupDeadline.cancelled, false);
  assert.equal(originalSource.stopCalls, 1);
  assert.equal(originalSource.stopTime, 10.525);
  assert.equal(originalSource.disconnectCalls, 0);

  const pendingOperations = nativeOperationSnapshot();
  const pendingReferences = referenceSnapshot();
  const pendingDeadlines = deadlineSnapshot();
  assert.throws(() => fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 114,
    terminalRecordReceipt: receiptB,
    audioNow: 10.51,
  })), /another generation termination owns the engine/);
  assert.deepEqual(nativeOperationSnapshot(), pendingOperations);
  assert.deepEqual(referenceSnapshot(), pendingReferences);
  assert.deepEqual(deadlineSnapshot(), pendingDeadlines);
  assert.deepEqual(fixture.engine.inspect(), pendingInspection);
  assert.equal(originalSource.stopTime, 10.525);

  const pendingSameReceipt = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 115,
    terminalRecordReceipt: receiptA,
    audioNow: 10.52,
  }));
  assert.equal(pendingSameReceipt, originalCleanup);
  assert.deepEqual(nativeOperationSnapshot(), pendingOperations);
  assert.deepEqual(referenceSnapshot(), pendingReferences);
  assert.deepEqual(deadlineSnapshot(), pendingDeadlines);
  assert.deepEqual(fixture.engine.inspect(), pendingInspection);

  fixture.audio.advanceTo(10.525);
  const originalResult = await originalCleanup;
  const pendingSameReceiptResult = await pendingSameReceipt;
  assert.equal(pendingSameReceiptResult, originalResult);
  assert.equal(Object.isFrozen(originalResult), true);
  assert.deepEqual(originalResult, {
    scope: 'generation',
    status: 'succeeded',
    cause: null,
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  const originalOwnership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receiptA,
  });
  assert.equal(assertGenerationCleanupResult(originalResult, originalOwnership), true);

  const completedInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: false,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  assert.deepEqual(fixture.engine.inspect(), completedInspection);
  assert.equal(cleanupDeadline.cancelled, true);
  assert.equal(originalSource.stopCalls, 1);
  assert.equal(originalSource.stopTime, 10.525);
  assert.equal(originalSource.ended, true);
  assertSourceReferencesClearedOnce(originalSource);
  assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected));
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));

  const completedOperations = nativeOperationSnapshot();
  const completedReferences = referenceSnapshot();
  const completedDeadlines = deadlineSnapshot();
  assert.throws(() => fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 116,
    terminalRecordReceipt: receiptB,
    audioNow: 10.75,
  })), /another generation termination owns the engine/);
  assert.deepEqual(nativeOperationSnapshot(), completedOperations);
  assert.deepEqual(referenceSnapshot(), completedReferences);
  assert.deepEqual(deadlineSnapshot(), completedDeadlines);
  assert.deepEqual(fixture.engine.inspect(), completedInspection);
  assert.equal(originalSource.stopTime, 10.525);

  const completedSameReceipt = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 117,
    terminalRecordReceipt: receiptA,
    audioNow: 10.8,
  }));
  assert.equal(completedSameReceipt, originalCleanup);
  const completedSameReceiptResult = await completedSameReceipt;
  assert.equal(completedSameReceiptResult, originalResult);
  assert.equal(assertGenerationCleanupResult(completedSameReceiptResult, originalOwnership), true);
  assert.deepEqual(nativeOperationSnapshot(), completedOperations);
  assert.deepEqual(referenceSnapshot(), completedReferences);
  assert.deepEqual(deadlineSnapshot(), completedDeadlines);
  assert.deepEqual(fixture.engine.inspect(), completedInspection);
  assert.equal(fixture.engine.inspect().generationId, null);
  assert.equal(fixture.engine.inspect().allocationFrozen, false);
  assert.equal(fixture.audio.deadlines.length, deadlinesBeforeCleanup + 1);
  assert.equal(cleanupDeadline.cancelled, true);
  assert.equal(originalSource.stopCalls, 1);
  assertSourceReferencesClearedOnce(originalSource);
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
});

test('T8-TX-COMPLETED-REPLAY-WITH-NEXT-GENERATION', async () => {
  const nextGenerationId = GENERATION_ID + 1;
  const fixture = await createFixture({ audio: { stopEndedMode: 'none' } });
  const expectedCleanupResult = Object.freeze({
    scope: 'generation',
    status: 'succeeded',
    cause: null,
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  const idleInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: false,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  const nativeOperationSnapshot = (targetFixture = fixture) => Object.freeze({
    events: targetFixture.audio.events.length,
    sourceObjects: targetFixture.audio.context.sources.length,
    gainObjects: targetFixture.audio.context.gains.length,
    sourceAllocations: targetFixture.audio.events.filter(({ type }) => type === 'allocate-source').length,
    gainAllocations: targetFixture.audio.events.filter(({ type }) => type === 'allocate-gain').length,
    sourceStarts: targetFixture.audio.events.filter(({ type }) => type === 'start').length,
    sourceStops: targetFixture.audio.events.filter(({ type }) => type === 'stop').length,
    sourceDisconnects: targetFixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'source'
    )).length,
    gainDisconnects: targetFixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'gain'
    )).length,
    resumes: targetFixture.audio.events.filter(({ type }) => type === 'resume').length,
    suspends: targetFixture.audio.events.filter(({ type }) => type === 'suspend').length,
    deadlines: targetFixture.audio.deadlines.length,
    sourceStopCalls: targetFixture.audio.context.sources.reduce(
      (total, { stopCalls }) => total + stopCalls,
      0,
    ),
    sourceDisconnectCalls: targetFixture.audio.context.sources.reduce(
      (total, { disconnectCalls }) => total + disconnectCalls,
      0,
    ),
    gainDisconnectCalls: targetFixture.audio.context.gains.reduce(
      (total, { disconnectCalls }) => total + disconnectCalls,
      0,
    ),
    gainAutomationOperations: targetFixture.audio.context.gains.reduce(
      (total, { gain }) => total + gain.events.length,
      0,
    ),
  });
  const referenceSnapshot = (targetFixture = fixture) => Object.freeze({
    sourceObjects: Object.freeze([...targetFixture.audio.context.sources]),
    gainObjects: Object.freeze([...targetFixture.audio.context.gains]),
    sourceBuffers: Object.freeze(targetFixture.audio.context.sources.map(({ buffer }) => buffer)),
    sourceEndedCallbacks: Object.freeze(
      targetFixture.audio.context.sources.map(({ onended }) => onended),
    ),
    sourceConnections: Object.freeze(targetFixture.audio.context.sources.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    gainConnections: Object.freeze(targetFixture.audio.context.gains.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    sourceStopTimes: Object.freeze(
      targetFixture.audio.context.sources.map(({ stopTime }) => stopTime),
    ),
    sourceEndedStates: Object.freeze(
      targetFixture.audio.context.sources.map(({ ended }) => ended),
    ),
    sourceBufferClearCalls: Object.freeze(
      targetFixture.audio.context.sources.map(({ bufferClearCalls }) => bufferClearCalls),
    ),
    sourceEndedClearCalls: Object.freeze(
      targetFixture.audio.context.sources.map(({ onendedClearCalls }) => onendedClearCalls),
    ),
    sourceDisconnectCalls: Object.freeze(
      targetFixture.audio.context.sources.map(({ disconnectCalls }) => disconnectCalls),
    ),
    gainDisconnectCalls: Object.freeze(
      targetFixture.audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
    ),
    gainAutomation: Object.freeze(targetFixture.audio.context.gains.map(({ gain }) => (
      Object.freeze([...gain.events])
    ))),
    deadlines: Object.freeze(targetFixture.audio.deadlines.map((deadline) => Object.freeze({
      deadline,
      kind: deadline.kind,
      milliseconds: deadline.milliseconds,
      promise: deadline.promise,
      cancelled: deadline.cancelled,
    }))),
  });

  const deadlinesBeforeGenerationOneCleanup = fixture.audio.deadlines.length;
  await activateGeneration(fixture);
  const generationOneSource = fixture.audio.context.sources[0];
  assert.notEqual(generationOneSource, undefined);
  const receiptOne = fixture.receipts.mint();
  const generationOneCleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 118,
    terminalRecordReceipt: receiptOne,
    audioNow: 10.5,
  }));
  assert.equal(generationOneSource.stopCalls, 1);
  assert.equal(generationOneSource.stopTime, 10.525);
  fixture.audio.advanceTo(generationOneSource.stopTime);
  const generationOneResult = await generationOneCleanup;
  assert.equal(Object.isFrozen(generationOneResult), true);
  assert.deepEqual(generationOneResult, expectedCleanupResult);
  const generationOneOwnership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receiptOne,
  });
  assert.equal(
    assertGenerationCleanupResult(generationOneResult, generationOneOwnership),
    true,
  );
  assertSourceReferencesClearedOnce(generationOneSource);
  assert.deepEqual(fixture.engine.inspect(), idleInspection);

  const generationTwoTap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    effectId: 119,
    sourceId: 'generation-2-ack',
    scheduledAudioTime: 10.75,
  }));
  assert.deepEqual(await generationTwoTap.settlement, { status: 'succeeded', cause: null });
  const generationTwoSource = fixture.audio.context.sources[1];
  assert.notEqual(generationTwoSource, undefined);
  assert.notEqual(generationTwoSource, generationOneSource);
  assert.equal(generationTwoSource.ended, false);
  assert.equal(generationTwoSource.disconnected, false);
  const generationTwoActiveInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    allocationFrozen: false,
    pendingResumeKey: null,
    graphCreated: true,
    predictions: [],
    track: null,
  });
  assert.deepEqual(fixture.engine.inspect(), generationTwoActiveInspection);

  const operationsBeforeGenerationOneReplay = nativeOperationSnapshot();
  const referencesBeforeGenerationOneReplay = referenceSnapshot();
  const inspectionBeforeGenerationOneReplay = fixture.engine.inspect();
  const generationOneReplay = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 120,
    terminalRecordReceipt: receiptOne,
    audioNow: 10.91,
  }));
  assert.equal(generationOneReplay, generationOneCleanup);
  const generationOneReplayResult = await generationOneReplay;
  assert.equal(generationOneReplayResult, generationOneResult);
  assert.equal(
    assertGenerationCleanupResult(generationOneReplayResult, generationOneOwnership),
    true,
  );
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforeGenerationOneReplay);
  assert.deepEqual(referenceSnapshot(), referencesBeforeGenerationOneReplay);
  assert.deepEqual(fixture.engine.inspect(), inspectionBeforeGenerationOneReplay);
  assert.deepEqual(fixture.engine.inspect(), generationTwoActiveInspection);

  const generationTwoUsability = await fixture.engine.cancelPredictions(Object.freeze({
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    effectId: 121,
    sourceIds: Object.freeze([]),
    audioNow: 10.92,
  }));
  assert.deepEqual(generationTwoUsability, {
    status: 'succeeded',
    cause: null,
    cancelledSourceIds: [],
  });
  assert.deepEqual(fixture.engine.inspect(), generationTwoActiveInspection);
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforeGenerationOneReplay);
  assert.deepEqual(referenceSnapshot(), referencesBeforeGenerationOneReplay);

  const receiptTwo = fixture.receipts.mint();
  assert.notEqual(receiptTwo, receiptOne);
  const generationTwoCleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    effectId: 122,
    terminalRecordReceipt: receiptTwo,
    audioNow: 11,
  }));
  const operationsWhileGenerationTwoPending = nativeOperationSnapshot();
  const referencesWhileGenerationTwoPending = referenceSnapshot();
  const inspectionWhileGenerationTwoPending = fixture.engine.inspect();

  assert.throws(
    () => fixture.engine.terminateGeneration(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 123,
      terminalRecordReceipt: receiptOne,
      audioNow: 11.001,
    })),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.equal(error.message, 'another generation termination owns the engine');
      return true;
    },
  );
  assert.deepEqual(nativeOperationSnapshot(), operationsWhileGenerationTwoPending);
  assert.deepEqual(referenceSnapshot(), referencesWhileGenerationTwoPending);
  assert.deepEqual(fixture.engine.inspect(), inspectionWhileGenerationTwoPending);

  const generationTwoPendingDuplicate = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    effectId: 124,
    terminalRecordReceipt: receiptTwo,
    audioNow: 11.002,
  }));
  assert.equal(generationTwoPendingDuplicate, generationTwoCleanup);
  assert.deepEqual(nativeOperationSnapshot(), operationsWhileGenerationTwoPending);
  assert.deepEqual(referenceSnapshot(), referencesWhileGenerationTwoPending);
  assert.deepEqual(fixture.engine.inspect(), inspectionWhileGenerationTwoPending);

  assert.notEqual(generationTwoCleanup, generationOneCleanup);
  assert.equal(generationTwoSource.stopCalls, 1);
  assert.equal(generationTwoSource.stopTime, 11.025);
  fixture.audio.advanceTo(generationTwoSource.stopTime);
  const generationTwoResult = await generationTwoCleanup;
  assert.equal(await generationTwoPendingDuplicate, generationTwoResult);
  assert.notEqual(generationTwoResult, generationOneResult);
  assert.equal(Object.isFrozen(generationTwoResult), true);
  assert.deepEqual(generationTwoResult, expectedCleanupResult);
  const generationTwoOwnership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    terminalRecordReceipt: receiptTwo,
  });
  assert.equal(
    assertGenerationCleanupResult(generationTwoResult, generationTwoOwnership),
    true,
  );
  assertSourceReferencesClearedOnce(generationTwoSource);
  assert.deepEqual(fixture.engine.inspect(), idleInspection);

  const operationsAfterGenerationTwoCompletion = nativeOperationSnapshot();
  const referencesAfterGenerationTwoCompletion = referenceSnapshot();
  const generationTwoReplay = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    effectId: 125,
    terminalRecordReceipt: receiptTwo,
    audioNow: 11.2,
  }));
  assert.equal(generationTwoReplay, generationTwoCleanup);
  const generationTwoReplayResult = await generationTwoReplay;
  assert.equal(generationTwoReplayResult, generationTwoResult);
  assert.equal(
    assertGenerationCleanupResult(generationTwoReplayResult, generationTwoOwnership),
    true,
  );
  assert.deepEqual(nativeOperationSnapshot(), operationsAfterGenerationTwoCompletion);
  assert.deepEqual(referenceSnapshot(), referencesAfterGenerationTwoCompletion);
  assert.deepEqual(fixture.engine.inspect(), idleInspection);

  assert.throws(
    () => fixture.engine.terminateGeneration(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 126,
      terminalRecordReceipt: receiptOne,
      audioNow: 11.3,
    })),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.equal(error.message, 'generation is not active');
      return true;
    },
  );
  assert.deepEqual(nativeOperationSnapshot(), operationsAfterGenerationTwoCompletion);
  assert.deepEqual(referenceSnapshot(), referencesAfterGenerationTwoCompletion);
  assert.deepEqual(fixture.engine.inspect(), idleInspection);

  assert.equal(fixture.audio.context.sources.length, 2);
  assert.equal(fixture.audio.context.gains.length, 10);
  assertSourceReferencesClearedOnce(generationOneSource);
  assertSourceReferencesClearedOnce(generationTwoSource);
  assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected));
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  const generationCleanupDeadlines = fixture.audio.deadlines.filter(({ kind }) => (
    kind === 'generation-cleanup'
  ));
  assert.equal(fixture.audio.deadlines.length, deadlinesBeforeGenerationOneCleanup + 2);
  assert.equal(generationCleanupDeadlines.length, 2);
  assert.ok(generationCleanupDeadlines.every(({ cancelled }) => cancelled));
  assert.deepEqual(nativeOperationSnapshot(), {
    events: fixture.audio.events.length,
    sourceObjects: 2,
    gainObjects: 10,
    sourceAllocations: 2,
    gainAllocations: 10,
    sourceStarts: 2,
    sourceStops: 2,
    sourceDisconnects: 2,
    gainDisconnects: 10,
    resumes: 2,
    suspends: 0,
    deadlines: deadlinesBeforeGenerationOneCleanup + 2,
    sourceStopCalls: 2,
    sourceDisconnectCalls: 2,
    gainDisconnectCalls: 10,
    gainAutomationOperations: fixture.audio.context.gains.reduce(
      (total, { gain }) => total + gain.events.length,
      0,
    ),
  });

  const failedFixture = await createFixture({ audio: { stopEndedMode: 'none' } });
  await activateGeneration(failedFixture);
  const failedGenerationOneSource = failedFixture.audio.context.sources[0];
  assert.notEqual(failedGenerationOneSource, undefined);
  const failedReceiptOne = failedFixture.receipts.mint();
  const failedGenerationOneCleanup = failedFixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 127,
    terminalRecordReceipt: failedReceiptOne,
    audioNow: 10.5,
  }));
  assert.equal(failedGenerationOneSource.stopCalls, 1);
  assert.equal(failedGenerationOneSource.stopTime, 10.525);
  failedFixture.audio.advanceTo(failedGenerationOneSource.stopTime);
  const failedGenerationOneResult = await failedGenerationOneCleanup;
  assert.equal(Object.isFrozen(failedGenerationOneResult), true);
  assert.deepEqual(failedGenerationOneResult, expectedCleanupResult);
  const failedGenerationOneOwnership = Object.freeze({
    engine: failedFixture.engine,
    loadedSessionCapability: failedFixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: failedReceiptOne,
  });
  assert.equal(
    assertGenerationCleanupResult(failedGenerationOneResult, failedGenerationOneOwnership),
    true,
  );
  assertSourceReferencesClearedOnce(failedGenerationOneSource);
  assert.deepEqual(failedFixture.engine.inspect(), idleInspection);

  const failedGenerationTwoTap = failedFixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    effectId: 128,
    sourceId: 'generation-2-terminal-failed',
    scheduledAudioTime: 10.75,
  }));
  assert.deepEqual(
    await failedGenerationTwoTap.settlement,
    { status: 'succeeded', cause: null },
  );
  const failedGenerationTwoSource = failedFixture.audio.context.sources[1];
  assert.notEqual(failedGenerationTwoSource, undefined);
  const failedReceiptTwo = failedFixture.receipts.mint();
  assert.notEqual(failedReceiptTwo, failedReceiptOne);
  const deadlinesBeforeFailedGenerationTwoCleanup = failedFixture.audio.deadlines.length;
  const failedGenerationTwoCleanup = failedFixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    effectId: 129,
    terminalRecordReceipt: failedReceiptTwo,
    audioNow: 11,
  }));
  assert.notEqual(failedGenerationTwoCleanup, failedGenerationOneCleanup);
  assert.equal(failedGenerationTwoSource.stopCalls, 1);
  assert.equal(failedGenerationTwoSource.stopTime, 11.025);
  assert.equal(failedGenerationTwoSource.ended, false);
  const failedGenerationTwoDeadlines = failedFixture.audio.deadlines
    .slice(deadlinesBeforeFailedGenerationTwoCleanup)
    .filter(({ kind }) => kind === 'generation-cleanup');
  assert.equal(failedGenerationTwoDeadlines.length, 1);
  const [failedGenerationTwoDeadline] = failedGenerationTwoDeadlines;
  assert.equal(failedGenerationTwoDeadline.milliseconds, 100);
  assert.equal(failedGenerationTwoDeadline.cancelled, false);
  failedGenerationTwoDeadline.fire();

  const failedGenerationTwoResult = await failedGenerationTwoCleanup;
  const expectedFailedCleanupResult = Object.freeze({
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: false,
  });
  assert.equal(Object.isFrozen(failedGenerationTwoResult), true);
  assert.deepEqual(failedGenerationTwoResult, expectedFailedCleanupResult);
  assert.equal(failedGenerationTwoDeadline.cancelled, true);
  assertSourceReferencesClearedOnce(failedGenerationTwoSource);
  const failedGenerationTwoOwnership = Object.freeze({
    engine: failedFixture.engine,
    loadedSessionCapability: failedFixture.capability,
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    terminalRecordReceipt: failedReceiptTwo,
  });
  assert.equal(
    assertGenerationCleanupResult(failedGenerationTwoResult, failedGenerationTwoOwnership),
    true,
  );
  const terminalFailedInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  assert.deepEqual(failedFixture.engine.inspect(), terminalFailedInspection);

  const operationsBeforeFailedOldReplay = nativeOperationSnapshot(failedFixture);
  const referencesBeforeFailedOldReplay = referenceSnapshot(failedFixture);
  const inspectionBeforeFailedOldReplay = failedFixture.engine.inspect();
  assert.throws(
    () => failedFixture.engine.terminateGeneration(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 130,
      terminalRecordReceipt: failedReceiptOne,
      audioNow: 11.2,
    })),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.equal(error.message, 'another generation termination owns the engine');
      return true;
    },
  );
  assert.deepEqual(nativeOperationSnapshot(failedFixture), operationsBeforeFailedOldReplay);
  assert.deepEqual(referenceSnapshot(failedFixture), referencesBeforeFailedOldReplay);
  assert.deepEqual(failedFixture.engine.inspect(), inspectionBeforeFailedOldReplay);
  assert.deepEqual(failedFixture.engine.inspect(), terminalFailedInspection);

  const failedGenerationTwoDuplicate = failedFixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    effectId: 131,
    terminalRecordReceipt: failedReceiptTwo,
    audioNow: 11.3,
  }));
  assert.equal(failedGenerationTwoDuplicate, failedGenerationTwoCleanup);
  const failedGenerationTwoDuplicateResult = await failedGenerationTwoDuplicate;
  assert.equal(failedGenerationTwoDuplicateResult, failedGenerationTwoResult);
  assert.deepEqual(nativeOperationSnapshot(failedFixture), operationsBeforeFailedOldReplay);
  assert.deepEqual(referenceSnapshot(failedFixture), referencesBeforeFailedOldReplay);
  assert.deepEqual(failedFixture.engine.inspect(), inspectionBeforeFailedOldReplay);
  assert.deepEqual(failedFixture.engine.inspect(), terminalFailedInspection);
});

test('T8-PLAN-VALIDATION rejects forged, copied, proxied, or mutable plans before mutation', async () => {
  const fixture = await createFixture();
  const plan = createPlan();
  const eventsBefore = fixture.audio.events.length;
  const candidates = [
    { ...plan },
    Object.freeze({ ...plan }),
    new Proxy(plan, {}),
    Object.freeze({ plan }),
  ];

  for (const candidate of candidates) {
    assert.throws(
      () => fixture.engine.commitHandoff(handoffRequest(candidate)),
      /genuine handoff plan/,
    );
  }
  assert.equal(fixture.audio.events.length, eventsBefore);
  assert.throws(
    () => fixture.engine.commitHandoff(handoffRequest(plan)),
    /generation is not active/,
  );
  assert.deepEqual(fixture.engine.inspect(), {
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: false,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
});

test('T8-REQUEST-SNAPSHOT-AUTHORITY', async () => {
  function statefulAccessorRequest(values, accessorKey, forgedValue, onAccessor) {
    const request = {};
    let reads = 0;
    for (const [key, value] of Object.entries(values)) {
      if (key !== accessorKey) {
        Object.defineProperty(request, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });
        continue;
      }
      Object.defineProperty(request, key, {
        configurable: true,
        enumerable: true,
        get() {
          reads += 1;
          onAccessor();
          return reads === 1 ? value : forgedValue;
        },
      });
    }
    return Object.freeze({ request, reads: () => reads });
  }

  function mutationSnapshot(fixture, callbackCount) {
    return Object.freeze({
      events: fixture.audio.events.length,
      sources: fixture.audio.context.sources.length,
      gains: fixture.audio.context.gains.length,
      deadlines: fixture.audio.deadlines.length,
      inspection: fixture.engine.inspect(),
      callbackCount,
    });
  }

  async function captureCommand(command) {
    try {
      const value = command();
      if (value?.settlement instanceof Promise) await value.settlement;
      else if (value instanceof Promise) await value;
      return Object.freeze({ error: null, value });
    } catch (error) {
      return Object.freeze({ error, value: null });
    }
  }

  async function assertAccessorRejected({
    fixture,
    values,
    accessorKey,
    forgedValue,
    command,
    label,
  }) {
    let callbackCount = 0;
    const accessor = statefulAccessorRequest(
      values,
      accessorKey,
      forgedValue,
      () => {
        callbackCount += 1;
        fixture.engine.inspect();
      },
    );
    const before = mutationSnapshot(fixture, callbackCount);
    const outcome = await captureCommand(() => command(accessor.request));
    assert.equal(accessor.reads(), 0, `${label}: request accessors must never run`);
    assert.equal(callbackCount, 0, `${label}: accessor callbacks cannot reenter the engine`);
    assert.equal(outcome.error instanceof TypeError, true, `${label}: accessor request must throw`);
    assert.deepEqual(
      mutationSnapshot(fixture, callbackCount),
      before,
      `${label}: rejection must precede lifecycle, native, receipt, and replay mutation`,
    );
  }

  const direct = await createFixture({ audio: { stopEndedMode: 'sync' } });
  await assertAccessorRejected({
    fixture: direct,
    values: {
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 500,
      sourceId: 'snapshot-direct-source',
      scheduledAudioTime: 10.02,
    },
    accessorKey: 'sourceId',
    forgedValue: 'forged-direct-source',
    command: (request) => direct.engine.directTap(request),
    label: 'direct tap',
  });

  const predictions = await createFixture({ audio: { stopEndedMode: 'sync' } });
  await activateGeneration(predictions);
  await assertAccessorRejected({
    fixture: predictions,
    values: {
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 501,
      predictions: Object.freeze([
        Object.freeze({ sourceId: 'snapshot-prediction', scheduledAudioTime: 10.8 }),
      ]),
    },
    accessorKey: 'predictions',
    forgedValue: Object.freeze([]),
    command: (request) => predictions.engine.schedulePredictions(request),
    label: 'prediction schedule',
  });

  const customMapPredictions = [
    Object.freeze({ sourceId: 'ignored-prediction', scheduledAudioTime: 10.7 }),
  ];
  let customMapCalls = 0;
  let forgedPredictionReads = 0;
  Object.defineProperty(customMapPredictions, 'map', {
    value() {
      customMapCalls += 1;
      return [{
        get sourceId() {
          forgedPredictionReads += 1;
          return 'custom-map-forged';
        },
        scheduledAudioTime: 10.8,
      }];
    },
  });
  const customMapBefore = mutationSnapshot(predictions, 0);
  const customMapOutcome = await captureCommand(() => predictions.engine.schedulePredictions({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 502,
    predictions: customMapPredictions,
  }));

  const cancellation = await createFixture({ audio: { stopEndedMode: 'sync' } });
  await activateGeneration(cancellation);
  await schedulePredictionSet(cancellation, [
    { sourceId: 'snapshot-cancel-source', scheduledAudioTime: 10.8 },
  ], 502);
  await assertAccessorRejected({
    fixture: cancellation,
    values: {
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 503,
      sourceIds: Object.freeze(['snapshot-cancel-source']),
      audioNow: 10,
    },
    accessorKey: 'sourceIds',
    forgedValue: Object.freeze([]),
    command: (request) => cancellation.engine.cancelPredictions(request),
    label: 'prediction cancellation',
  });

  const accessorSourceIds = [];
  let sourceIdReads = 0;
  Object.defineProperty(accessorSourceIds, 0, {
    configurable: true,
    enumerable: true,
    get() {
      sourceIdReads += 1;
      return 'snapshot-cancel-source';
    },
  });
  const accessorSourceIdsBefore = mutationSnapshot(cancellation, 0);
  const accessorSourceIdsOutcome = await captureCommand(
    () => cancellation.engine.cancelPredictions({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 504,
      sourceIds: accessorSourceIds,
      audioNow: 10,
    }),
  );
  assert.deepEqual(
    { customMapCalls, forgedPredictionReads, sourceIdReads },
    { customMapCalls: 0, forgedPredictionReads: 0, sourceIdReads: 0 },
    'nested prediction-array methods, record getters, and cancellation accessors must never execute',
  );
  assert.equal(customMapOutcome.error instanceof TypeError, true);
  assert.deepEqual(
    mutationSnapshot(predictions, 0),
    customMapBefore,
    'custom prediction-array rejection must precede native and lifecycle mutation',
  );
  assert.equal(accessorSourceIdsOutcome.error instanceof TypeError, true);
  assert.deepEqual(
    mutationSnapshot(cancellation, 0),
    accessorSourceIdsBefore,
    'accessor source-ID rejection must precede cancellation and audio-clock mutation',
  );

  const reentrant = await createFixture({ audio: { stopEndedMode: 'none' } });
  await activateGeneration(reentrant);
  await schedulePredictionSet(reentrant, [
    { sourceId: 'snapshot-reentrant-source', scheduledAudioTime: 10.8 },
  ], 505);
  const reentrantSource = reentrant.audio.context.sources.at(-1);
  let trapCalls = 0;
  let innerError = null;
  let innerResult = null;
  const reentrantSourceIds = new Proxy(['snapshot-reentrant-source'], {
    ownKeys(target) {
      trapCalls += 1;
      try {
        innerResult = reentrant.engine.cancelPredictions({
          sessionId: SESSION_ID,
          generationId: GENERATION_ID,
          effectId: 506,
          sourceIds: ['snapshot-reentrant-source'],
          audioNow: 10,
        });
      } catch (error) {
        innerError = error;
      }
      return Reflect.ownKeys(target);
    },
  });
  const reentrantBefore = mutationSnapshot(reentrant, 0);
  const reentrantStopCallsBefore = reentrantSource.stopCalls;
  const outerOutcome = await captureCommand(() => reentrant.engine.cancelPredictions({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 507,
    sourceIds: reentrantSourceIds,
    audioNow: 10,
  }));
  if (innerResult instanceof Promise) innerResult = await innerResult;
  assert.equal(trapCalls, 1, 'nested array reflection must execute the deterministic proxy trap');
  assert.equal(innerError instanceof TypeError, true, 'reentrant inner command must reject synchronously');
  assert.equal(innerError?.message, 'prediction cancellation request is invalid');
  assert.equal(innerResult, null, 'reentrant inner command cannot return a mutation result');
  assert.equal(outerOutcome.error instanceof TypeError, true, 'reentered outer capture must reject');
  assert.equal(outerOutcome.error?.message, 'prediction cancellation request is invalid');
  assert.equal(reentrantSource.stopCalls, reentrantStopCallsBefore);
  assert.deepEqual(
    mutationSnapshot(reentrant, 0),
    reentrantBefore,
    'caught same-engine reentrancy must not mutate lifecycle or native audio state',
  );

  const handoff = await createFixture({ audio: { stopEndedMode: 'sync' } });
  await activateGeneration(handoff);
  const genuinePlan = createPlan();
  await assertAccessorRejected({
    fixture: handoff,
    values: {
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 504,
      plan: genuinePlan,
    },
    accessorKey: 'plan',
    forgedValue: Object.freeze({ forged: true }),
    command: (request) => handoff.engine.commitHandoff(request),
    label: 'handoff plan',
  });

  const terminal = await createFixture({ audio: { stopEndedMode: 'sync' } });
  await activateGeneration(terminal);
  const genuineReceipt = terminal.receipts.mint();
  await assertAccessorRejected({
    fixture: terminal,
    values: {
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 505,
      terminalRecordReceipt: genuineReceipt,
      audioNow: 10.5,
    },
    accessorKey: 'terminalRecordReceipt',
    forgedValue: Object.freeze(Object.create(null)),
    command: (request) => terminal.engine.terminateGeneration(request),
    label: 'terminal receipt',
  });

  const positive = await createFixture({ audio: { stopEndedMode: 'sync' } });
  const positiveTap = positive.engine.directTap({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 506,
    sourceId: 'data-property-tap',
    scheduledAudioTime: 10.02,
  });
  assert.deepEqual(await positiveTap.settlement, { status: 'succeeded', cause: null });
  const positivePredictions = [
    { sourceId: 'data-property-prediction', scheduledAudioTime: 10.8 },
  ];
  assert.deepEqual(await positive.engine.schedulePredictions({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 507,
    predictions: positivePredictions,
  }), { status: 'succeeded', cause: null });
  assert.deepEqual(await positive.engine.cancelPredictions({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 508,
    sourceIds: ['data-property-missing-prediction'],
    audioNow: 10,
  }), {
    status: 'succeeded',
    cause: null,
    cancelledSourceIds: [],
  });
  const positivePlan = createPlan(positivePredictions);
  assert.deepEqual(await positive.engine.commitHandoff({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 509,
    plan: positivePlan,
  }), { status: 'succeeded', cause: null });
  const positiveReceipt = positive.receipts.mint();
  const positiveCleanup = positive.engine.terminateGeneration({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 510,
    terminalRecordReceipt: positiveReceipt,
    audioNow: positivePlan.audioNow,
  });
  assert.equal((await positiveCleanup).status, 'succeeded');
  const replayBefore = mutationSnapshot(positive, 0);
  const replay = positive.engine.terminateGeneration({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 511,
    terminalRecordReceipt: positiveReceipt,
    audioNow: positivePlan.audioNow,
  });
  assert.equal(replay, positiveCleanup);
  assert.deepEqual(mutationSnapshot(positive, 0), replayBefore);

  const replayAccessor = statefulAccessorRequest({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 512,
    terminalRecordReceipt: positiveReceipt,
    audioNow: positivePlan.audioNow,
  }, 'terminalRecordReceipt', Object.freeze(Object.create(null)), () => positive.engine.inspect());
  const replayAccessorBefore = mutationSnapshot(positive, 0);
  const replayOutcome = await captureCommand(
    () => positive.engine.terminateGeneration(replayAccessor.request),
  );
  assert.equal(replayAccessor.reads(), 0, 'completed replay cannot read an accessor receipt');
  assert.equal(replayOutcome.error instanceof TypeError, true);
  assert.deepEqual(mutationSnapshot(positive, 0), replayAccessorBefore);
});

test('T8-TX-CAPABILITY-ENGINE-BINDING', async () => {
  function engineOptionsFor(fixture, overrides = {}) {
    return {
      loadedSessionCapability: fixture.capability,
      sessionId: SESSION_ID,
      assertTerminalRecordReceipt: fixture.receipts.assert,
      createCleanupDeadline: fixture.audio.dependencies.createDeadline,
      failureInjector() {},
      onEvent() {},
      ...overrides,
    };
  }

  function nativeOperationCounts(fixture) {
    return Object.freeze({
      events: fixture.audio.events.length,
      sources: fixture.audio.context.sources.length,
      gains: fixture.audio.context.gains.length,
      deadlines: fixture.audio.deadlines.length,
    });
  }

  function assertCapabilityRemainsBound(options) {
    assert.throws(
      () => createWebAudioEngine(options),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.match(error.message, /already bound/);
        return true;
      },
    );
  }

  const owner = await createFixture({ audio: { stopEndedMode: 'sync' } });
  let duplicateFailureInjections = 0;
  let duplicateEvents = 0;
  const duplicateOptions = engineOptionsFor(owner, {
    failureInjector() { duplicateFailureInjections += 1; },
    onEvent() { duplicateEvents += 1; },
  });
  const ownerBeforeDuplicate = owner.engine.inspect();
  const nativeBeforeDuplicate = nativeOperationCounts(owner);

  assertCapabilityRemainsBound(duplicateOptions);
  assert.deepEqual(owner.engine.inspect(), ownerBeforeDuplicate);
  assert.deepEqual(nativeOperationCounts(owner), nativeBeforeDuplicate);
  assert.equal(duplicateFailureInjections, 0);
  assert.equal(duplicateEvents, 0);

  await activateGeneration(owner);
  const successReceipt = owner.receipts.mint();
  const successResult = await owner.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 80,
    terminalRecordReceipt: successReceipt,
    audioNow: 10.5,
  }));
  assert.deepEqual(successResult, {
    scope: 'generation',
    status: 'succeeded',
    cause: null,
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  assertCapabilityRemainsBound(duplicateOptions);

  const cleanupFailure = await createFixture({ audio: { stopEndedMode: 'sync' } });
  await activateGeneration(cleanupFailure);
  cleanupFailure.audio.context.gains[1].gain.cancelScheduledValues = () => {
    throw new Error('PRIVATE_CAPABILITY_BINDING_CLEANUP_FAILURE');
  };
  const failureReceipt = cleanupFailure.receipts.mint();
  const failureResult = await cleanupFailure.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 81,
    terminalRecordReceipt: failureReceipt,
    audioNow: 10.5,
  }));
  assert.deepEqual(failureResult, {
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: false,
  });
  assertCapabilityRemainsBound(engineOptionsFor(cleanupFailure));

  const suspendSettlement = await createFixture({
    audio: { resumeMode: 'deferred', suspendMode: 'deferred', stopEndedMode: 'sync' },
  });
  const pendingTap = suspendSettlement.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 82,
    sourceId: 'binding-suspend-source',
    scheduledAudioTime: 10.02,
  }));
  const suspendReceipt = suspendSettlement.receipts.mint();
  const pendingCleanup = suspendSettlement.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 83,
    terminalRecordReceipt: suspendReceipt,
    audioNow: 10.5,
  }));
  suspendSettlement.audio.resumeDeferred.resolve();
  await suspendSettlement.audio.suspendStarted.promise;
  await assert.rejects(
    suspendSettlement.capability.borrowForGeneration(GENERATION_ID + 1, () => undefined),
    /parallel-generation-borrow/,
  );
  suspendSettlement.audio.suspendDeferred.resolve();
  assert.deepEqual(await pendingTap.settlement, { status: 'failed', cause: 'schedule-failed' });
  assert.equal((await pendingCleanup).status, 'succeeded');
  assert.equal(suspendSettlement.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  await suspendSettlement.capability.borrowForGeneration(
    GENERATION_ID + 1,
    () => undefined,
  );
  assertCapabilityRemainsBound(engineOptionsFor(suspendSettlement));

  const distinct = await createFixture();
  assert.notEqual(distinct.capability, owner.capability);
  assert.notEqual(distinct.engine, owner.engine);
  assert.equal(distinct.engine.inspect().sessionId, SESSION_ID);

  const validationAudio = createFakeAudioHarness();
  const validationLoader = createLocalTrackLoader(validationAudio.dependencies);
  const validationCapability = await validationLoader.load({
    file: validationAudio.file,
    loadedSessionId: 'loaded-session-validation-order',
  });
  const validationReceipts = createReceiptAuthority();
  const validationFixture = {
    audio: validationAudio,
    capability: validationCapability,
    receipts: validationReceipts,
  };
  const validOptions = engineOptionsFor(validationFixture);
  const validationNativeBefore = nativeOperationCounts(validationFixture);
  assert.throws(
    () => createWebAudioEngine({ ...validOptions, onEvent: null }),
    /Web Audio engine dependencies are invalid/,
  );
  assert.deepEqual(nativeOperationCounts(validationFixture), validationNativeBefore);
  const validationEngine = createWebAudioEngine(validOptions);
  assert.equal(validationEngine.inspect().sessionId, SESSION_ID);
  assert.throws(
    () => createWebAudioEngine({ ...validOptions, onEvent: null }),
    /Web Audio engine dependencies are invalid/,
  );
  assertCapabilityRemainsBound(validOptions);

  const forgedCapability = Object.freeze({ ...owner.capability });
  const proxiedCapability = new Proxy(owner.capability, {});
  const forgedNativeBefore = nativeOperationCounts(owner);
  for (const candidate of [forgedCapability, proxiedCapability]) {
    assert.throws(
      () => createWebAudioEngine(engineOptionsFor(owner, {
        loadedSessionCapability: candidate,
      })),
      /loaded session capability must be genuine/,
    );
  }
  assert.deepEqual(nativeOperationCounts(owner), forgedNativeBefore);
});

test('T8-TX-MATRIX-RESUME-OK-SUSPEND-OK', async () => {
  const nextGenerationId = GENERATION_ID + 1;
  const emittedEvents = [];
  const fixture = await createFixture({
    audio: {
      resumeMode: 'deferred',
      suspendMode: 'deferred',
      stopEndedMode: 'none',
    },
    onEvent(event) { emittedEvents.push(event); },
  });

  const expectedCleanupResult = Object.freeze({
    scope: 'generation',
    status: 'succeeded',
    cause: null,
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  const cleanupResultKeys = Object.freeze([
    'scope',
    'status',
    'cause',
    'sourceReferencesCleared',
    'sourceStopSettled',
  ]);
  const idleInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: false,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  const nativeOperationSnapshot = () => Object.freeze({
    events: fixture.audio.events.length,
    sourceObjects: fixture.audio.context.sources.length,
    gainObjects: fixture.audio.context.gains.length,
    deadlines: fixture.audio.deadlines.length,
    sourceAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-source').length,
    gainAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-gain').length,
    sourceStarts: fixture.audio.events.filter(({ type }) => type === 'start').length,
    sourceStops: fixture.audio.events.filter(({ type }) => type === 'stop').length,
    sourceDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'source'
    )).length,
    gainDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'gain'
    )).length,
    resumes: fixture.audio.events.filter(({ type }) => type === 'resume').length,
    suspends: fixture.audio.events.filter(({ type }) => type === 'suspend').length,
    sourceStopCalls: fixture.audio.context.sources.reduce(
      (total, { stopCalls }) => total + stopCalls,
      0,
    ),
    sourceDisconnectCalls: fixture.audio.context.sources.reduce(
      (total, { disconnectCalls }) => total + disconnectCalls,
      0,
    ),
    gainDisconnectCalls: fixture.audio.context.gains.reduce(
      (total, { disconnectCalls }) => total + disconnectCalls,
      0,
    ),
    sourceBufferClearCalls: fixture.audio.context.sources.reduce(
      (total, { bufferClearCalls }) => total + bufferClearCalls,
      0,
    ),
    sourceEndedClearCalls: fixture.audio.context.sources.reduce(
      (total, { onendedClearCalls }) => total + onendedClearCalls,
      0,
    ),
    gainAutomationOperations: fixture.audio.context.gains.reduce(
      (total, { gain }) => total + gain.events.length,
      0,
    ),
  });
  const referenceSnapshot = () => Object.freeze({
    sourceObjects: Object.freeze([...fixture.audio.context.sources]),
    gainObjects: Object.freeze([...fixture.audio.context.gains]),
    sourceBuffers: Object.freeze(fixture.audio.context.sources.map(({ buffer }) => buffer)),
    sourceEndedCallbacks: Object.freeze(
      fixture.audio.context.sources.map(({ onended }) => onended),
    ),
    sourceConnections: Object.freeze(fixture.audio.context.sources.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    gainConnections: Object.freeze(fixture.audio.context.gains.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    sourceStopTimes: Object.freeze(
      fixture.audio.context.sources.map(({ stopTime }) => stopTime),
    ),
    sourceEndedStates: Object.freeze(
      fixture.audio.context.sources.map(({ ended }) => ended),
    ),
    sourceBufferClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ bufferClearCalls }) => bufferClearCalls),
    ),
    sourceEndedClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ onendedClearCalls }) => onendedClearCalls),
    ),
    sourceDisconnectCalls: Object.freeze(
      fixture.audio.context.sources.map(({ disconnectCalls }) => disconnectCalls),
    ),
    gainDisconnectCalls: Object.freeze(
      fixture.audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
    ),
  });

  let replacementEngineFailureInjections = 0;
  let replacementEngineEvents = 0;
  const replacementEngineOptions = Object.freeze({
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    assertTerminalRecordReceipt: fixture.receipts.assert,
    createCleanupDeadline: fixture.audio.dependencies.createDeadline,
    failureInjector() { replacementEngineFailureInjections += 1; },
    onEvent() { replacementEngineEvents += 1; },
  });
  function assertReplacementEngineBlocked(stage) {
    const operationsBefore = nativeOperationSnapshot();
    const referencesBefore = referenceSnapshot();
    const inspectionBefore = fixture.engine.inspect();
    assert.throws(
      () => createWebAudioEngine(replacementEngineOptions),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message, 'loaded session capability is already bound to an engine');
        return true;
      },
      `${stage}: the exact capability must remain permanently owned by its first engine`,
    );
    assert.deepEqual(nativeOperationSnapshot(), operationsBefore);
    assert.deepEqual(referenceSnapshot(), referencesBefore);
    assert.deepEqual(fixture.engine.inspect(), inspectionBefore);
    assert.equal(replacementEngineFailureInjections, 0);
    assert.equal(replacementEngineEvents, 0);
  }
  async function assertLowerBorrowBlocked(generationId, stage) {
    const operationsBefore = nativeOperationSnapshot();
    const referencesBefore = referenceSnapshot();
    const inspectionBefore = fixture.engine.inspect();
    let callbackCalls = 0;
    await assert.rejects(
      fixture.capability.borrowForGeneration(generationId, () => {
        callbackCalls += 1;
      }),
      (error) => {
        assert.equal(error?.code, 'parallel-generation-borrow');
        assert.equal(error?.message, 'parallel-generation-borrow');
        return true;
      },
      `${stage}: lower capability exclusion must reject a parallel generation borrow`,
    );
    assert.equal(callbackCalls, 0);
    assert.deepEqual(nativeOperationSnapshot(), operationsBefore);
    assert.deepEqual(referenceSnapshot(), referencesBefore);
    assert.deepEqual(fixture.engine.inspect(), inspectionBefore);
  }
  function assertFrozenTapBlocked(generationId, effectId, stage) {
    const operationsBefore = nativeOperationSnapshot();
    const referencesBefore = referenceSnapshot();
    const inspectionBefore = fixture.engine.inspect();
    assert.throws(
      () => fixture.engine.directTap(Object.freeze({
        sessionId: SESSION_ID,
        generationId,
        effectId,
        sourceId: `matrix-blocked-${generationId}-${effectId}`,
        scheduledAudioTime: 10.7,
      })),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message, 'generation allocation is frozen');
        return true;
      },
      `${stage}: public engine admission must be synchronously frozen`,
    );
    assert.deepEqual(nativeOperationSnapshot(), operationsBefore);
    assert.deepEqual(referenceSnapshot(), referencesBefore);
    assert.deepEqual(fixture.engine.inspect(), inspectionBefore);
  }

  const deadlinesBeforeGenerationOneCleanup = fixture.audio.deadlines.length;
  const generationOneTap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 200,
    sourceId: 'matrix-shared-source-id',
    scheduledAudioTime: 10.02,
  }));
  const generationOneSource = fixture.audio.context.sources[0];
  assert.notEqual(generationOneSource, undefined);
  const generationOneBufferReference = generationOneSource.buffer;
  const generationOneEndedCallback = generationOneSource.onended;
  const generationOneConnectionReferences = Object.freeze([...generationOneSource.connections]);
  assert.notEqual(generationOneBufferReference, null);
  assert.equal(typeof generationOneEndedCallback, 'function');
  assert.equal(generationOneSource.endedCallbackHistory.at(-1), generationOneEndedCallback);
  assert.equal(generationOneConnectionReferences.length, 1);
  assert.equal(generationOneTap.reusedPendingResume, false);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'resume').length, 1);

  const receiptOne = fixture.receipts.mint();
  const generationOneCleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 201,
    terminalRecordReceipt: receiptOne,
    audioNow: 10.5,
  }));
  const generationOnePendingInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  assert.deepEqual(fixture.engine.inspect(), generationOnePendingInspection);
  assert.equal(generationOneSource.stopCalls, 1);
  assert.equal(generationOneSource.stopTime, 10.525);
  assert.equal(generationOneSource.ended, false);
  assert.equal(generationOneSource.buffer, generationOneBufferReference);
  assert.equal(generationOneSource.onended, generationOneEndedCallback);
  assert.deepEqual(generationOneSource.connections, generationOneConnectionReferences);
  assert.equal(generationOneSource.disconnectCalls, 0);

  const generationOneCleanupDeadlines = fixture.audio.deadlines
    .slice(deadlinesBeforeGenerationOneCleanup)
    .filter(({ kind }) => kind === 'generation-cleanup');
  assert.equal(generationOneCleanupDeadlines.length, 1);
  const [generationOneCleanupDeadline] = generationOneCleanupDeadlines;
  assert.equal(generationOneCleanupDeadline.milliseconds, 100);
  assert.equal(generationOneCleanupDeadline.cancelled, false);

  await assertLowerBorrowBlocked(
    nextGenerationId,
    'generation 1 source settlement pending',
  );
  assertFrozenTapBlocked(
    GENERATION_ID,
    202,
    'generation 1 source settlement pending / same generation',
  );
  assertFrozenTapBlocked(
    nextGenerationId,
    203,
    'generation 1 source settlement pending / next generation',
  );
  assertReplacementEngineBlocked('generation 1 source settlement pending');

  const operationsBeforePendingReplay = nativeOperationSnapshot();
  const referencesBeforePendingReplay = referenceSnapshot();
  const inspectionBeforePendingReplay = fixture.engine.inspect();
  const generationOnePendingReplay = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 204,
    terminalRecordReceipt: receiptOne,
    audioNow: 10.51,
  }));
  assert.equal(generationOnePendingReplay, generationOneCleanup);
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforePendingReplay);
  assert.deepEqual(referenceSnapshot(), referencesBeforePendingReplay);
  assert.deepEqual(fixture.engine.inspect(), inspectionBeforePendingReplay);
  assert.equal(generationOneSource.stopCalls, 1);
  assert.equal(generationOneCleanupDeadline.cancelled, false);

  fixture.audio.advanceTo(generationOneSource.stopTime);
  assert.equal(generationOneSource.ended, true);
  assertSourceReferencesClearedOnce(generationOneSource);
  assert.equal(generationOneSource.connections.length, 0);

  fixture.audio.resumeDeferred.resolve();
  await fixture.audio.suspendStarted.promise;
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assert.equal(generationOneCleanupDeadline.cancelled, false);
  assert.deepEqual(fixture.engine.inspect(), generationOnePendingInspection);
  await assertLowerBorrowBlocked(
    nextGenerationId,
    'generation 1 stale-resume suspend pending',
  );
  assertFrozenTapBlocked(
    nextGenerationId,
    205,
    'generation 1 stale-resume suspend pending',
  );
  assertReplacementEngineBlocked('generation 1 stale-resume suspend pending');

  fixture.audio.suspendDeferred.resolve();
  const [generationOneTapSettlement, generationOneResult] = await Promise.all([
    generationOneTap.settlement,
    generationOneCleanup,
  ]);
  assert.deepEqual(generationOneTapSettlement, { status: 'failed', cause: 'schedule-failed' });
  assert.equal(await generationOnePendingReplay, generationOneResult);
  assert.equal(Object.isFrozen(generationOneResult), true);
  assert.deepEqual(Reflect.ownKeys(generationOneResult), cleanupResultKeys);
  assert.deepEqual(generationOneResult, expectedCleanupResult);
  assert.equal(generationOneCleanupDeadline.cancelled, true);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assert.equal(fixture.audio.context.state, 'suspended');
  assertSourceReferencesClearedOnce(generationOneSource);
  assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected));
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.deepEqual(fixture.engine.inspect(), idleInspection);

  const generationOneOwnership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receiptOne,
  });
  assert.equal(assertGenerationCleanupResult(generationOneResult, generationOneOwnership), true);
  for (const candidate of [
    { ...generationOneResult },
    Object.freeze({ ...generationOneResult }),
    new Proxy(generationOneResult, {}),
  ]) {
    assert.throws(
      () => assertGenerationCleanupResult(candidate, generationOneOwnership),
      /genuine generation cleanup result/,
    );
  }
  assert.equal(claimGenerationCleanupResult(generationOneResult, generationOneOwnership), true);
  assert.throws(
    () => claimGenerationCleanupResult(generationOneResult, generationOneOwnership),
    /generation cleanup result already claimed/,
  );

  const operationsBeforeCompletedReplay = nativeOperationSnapshot();
  const referencesBeforeCompletedReplay = referenceSnapshot();
  const inspectionBeforeCompletedReplay = fixture.engine.inspect();
  const generationOneCompletedReplay = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 206,
    terminalRecordReceipt: receiptOne,
    audioNow: 10.7,
  }));
  assert.equal(generationOneCompletedReplay, generationOneCleanup);
  const generationOneCompletedReplayResult = await generationOneCompletedReplay;
  assert.equal(generationOneCompletedReplayResult, generationOneResult);
  assert.equal(
    assertGenerationCleanupResult(generationOneCompletedReplayResult, generationOneOwnership),
    true,
  );
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforeCompletedReplay);
  assert.deepEqual(referenceSnapshot(), referencesBeforeCompletedReplay);
  assert.deepEqual(fixture.engine.inspect(), inspectionBeforeCompletedReplay);
  assert.deepEqual(fixture.engine.inspect(), idleInspection);
  assert.equal(generationOneSource.stopCalls, 1);
  assertSourceReferencesClearedOnce(generationOneSource);
  assert.equal(generationOneCleanupDeadline.cancelled, true);

  const conflictingReceiptOne = fixture.receipts.mint();
  const operationsBeforeConflict = nativeOperationSnapshot();
  const referencesBeforeConflict = referenceSnapshot();
  assert.throws(() => fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 2061,
    terminalRecordReceipt: conflictingReceiptOne,
    audioNow: 10.71,
  })), /another generation termination owns the engine/);
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforeConflict);
  assert.deepEqual(referenceSnapshot(), referencesBeforeConflict);
  assert.deepEqual(fixture.engine.inspect(), idleInspection);

  const generationTwoTap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    effectId: 207,
    sourceId: 'matrix-shared-source-id',
    scheduledAudioTime: 10.75,
  }));
  assert.deepEqual(await generationTwoTap.settlement, { status: 'succeeded', cause: null });
  const generationTwoSource = fixture.audio.context.sources[1];
  assert.notEqual(generationTwoSource, undefined);
  assert.notEqual(generationTwoSource, generationOneSource);
  assert.equal(generationTwoSource.ended, false);
  assert.equal(generationTwoSource.disconnected, false);
  const generationTwoActiveInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    allocationFrozen: false,
    pendingResumeKey: null,
    graphCreated: true,
    predictions: [],
    track: null,
  });
  assert.deepEqual(fixture.engine.inspect(), generationTwoActiveInspection);
  assert.equal(fixture.audio.context.state, 'running');
  await assertLowerBorrowBlocked(
    nextGenerationId + 1,
    'generation 2 active',
  );
  assertReplacementEngineBlocked('generation 2 active');

  const operationsBeforeLateGenerationOneCallback = nativeOperationSnapshot();
  const referencesBeforeLateGenerationOneCallback = referenceSnapshot();
  const eventsBeforeLateGenerationOneCallback = emittedEvents.length;
  assert.doesNotThrow(() => generationOneEndedCallback());
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforeLateGenerationOneCallback);
  assert.deepEqual(referenceSnapshot(), referencesBeforeLateGenerationOneCallback);
  assert.deepEqual(fixture.engine.inspect(), generationTwoActiveInspection);
  assert.equal(emittedEvents.length, eventsBeforeLateGenerationOneCallback);
  assert.equal(generationTwoSource.ended, false);
  assert.equal(generationTwoSource.disconnected, false);
  assert.equal(generationOneSource.buffer, null);
  assert.equal(generationOneSource.onended, null);
  assert.equal(generationOneSource.connections.length, 0);
  assertSourceReferencesClearedOnce(generationOneSource);

  const receiptTwo = fixture.receipts.mint();
  assert.notEqual(receiptTwo, receiptOne);
  const deadlinesBeforeGenerationTwoCleanup = fixture.audio.deadlines.length;
  const generationTwoCleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    effectId: 208,
    terminalRecordReceipt: receiptTwo,
    audioNow: 11,
  }));
  assert.equal(generationTwoSource.stopCalls, 1);
  assert.equal(generationTwoSource.stopTime, 11.025);
  assert.equal(generationTwoSource.ended, false);
  const generationTwoCleanupDeadlines = fixture.audio.deadlines
    .slice(deadlinesBeforeGenerationTwoCleanup)
    .filter(({ kind }) => kind === 'generation-cleanup');
  assert.equal(generationTwoCleanupDeadlines.length, 1);
  const [generationTwoCleanupDeadline] = generationTwoCleanupDeadlines;
  assert.equal(generationTwoCleanupDeadline.milliseconds, 100);
  assert.equal(generationTwoCleanupDeadline.cancelled, false);

  fixture.audio.advanceTo(generationTwoSource.stopTime);
  const generationTwoResult = await generationTwoCleanup;
  assert.equal(Object.isFrozen(generationTwoResult), true);
  assert.deepEqual(Reflect.ownKeys(generationTwoResult), cleanupResultKeys);
  assert.deepEqual(generationTwoResult, expectedCleanupResult);
  assert.equal(generationTwoCleanupDeadline.cancelled, true);
  assertSourceReferencesClearedOnce(generationTwoSource);
  assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected));
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.deepEqual(fixture.engine.inspect(), idleInspection);

  const generationTwoOwnership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    terminalRecordReceipt: receiptTwo,
  });
  assert.equal(assertGenerationCleanupResult(generationTwoResult, generationTwoOwnership), true);
  assert.throws(
    () => assertGenerationCleanupResult(generationOneResult, generationTwoOwnership),
    /genuine generation cleanup result/,
  );

  const operationsBeforeGenerationTwoReplay = nativeOperationSnapshot();
  const referencesBeforeGenerationTwoReplay = referenceSnapshot();
  const inspectionBeforeGenerationTwoReplay = fixture.engine.inspect();
  const generationTwoCompletedReplay = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: nextGenerationId,
    effectId: 209,
    terminalRecordReceipt: receiptTwo,
    audioNow: 11.2,
  }));
  assert.equal(generationTwoCompletedReplay, generationTwoCleanup);
  const generationTwoCompletedReplayResult = await generationTwoCompletedReplay;
  assert.equal(generationTwoCompletedReplayResult, generationTwoResult);
  assert.equal(
    assertGenerationCleanupResult(generationTwoCompletedReplayResult, generationTwoOwnership),
    true,
  );
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforeGenerationTwoReplay);
  assert.deepEqual(referenceSnapshot(), referencesBeforeGenerationTwoReplay);
  assert.deepEqual(fixture.engine.inspect(), inspectionBeforeGenerationTwoReplay);
  assert.deepEqual(fixture.engine.inspect(), idleInspection);
  assert.equal(generationTwoSource.stopCalls, 1);
  assertSourceReferencesClearedOnce(generationTwoSource);
  assertReplacementEngineBlocked('generation 2 completed');

  const generationCleanupDeadlines = fixture.audio.deadlines.filter(({ kind }) => (
    kind === 'generation-cleanup'
  ));
  assert.equal(fixture.audio.deadlines.length, deadlinesBeforeGenerationOneCleanup + 2);
  assert.equal(generationCleanupDeadlines.length, 2);
  assert.ok(generationCleanupDeadlines.every(({ cancelled }) => cancelled));

  const finalOperations = nativeOperationSnapshot();
  assert.deepEqual({
    sourceObjects: finalOperations.sourceObjects,
    gainObjects: finalOperations.gainObjects,
    deadlines: finalOperations.deadlines,
    sourceAllocations: finalOperations.sourceAllocations,
    gainAllocations: finalOperations.gainAllocations,
    sourceStarts: finalOperations.sourceStarts,
    sourceStops: finalOperations.sourceStops,
    sourceDisconnects: finalOperations.sourceDisconnects,
    gainDisconnects: finalOperations.gainDisconnects,
    resumes: finalOperations.resumes,
    suspends: finalOperations.suspends,
    sourceStopCalls: finalOperations.sourceStopCalls,
    sourceDisconnectCalls: finalOperations.sourceDisconnectCalls,
    gainDisconnectCalls: finalOperations.gainDisconnectCalls,
    sourceBufferClearCalls: finalOperations.sourceBufferClearCalls,
    sourceEndedClearCalls: finalOperations.sourceEndedClearCalls,
  }, {
    sourceObjects: 2,
    gainObjects: 10,
    deadlines: deadlinesBeforeGenerationOneCleanup + 2,
    sourceAllocations: 2,
    gainAllocations: 10,
    sourceStarts: 2,
    sourceStops: 2,
    sourceDisconnects: 2,
    gainDisconnects: 10,
    resumes: 2,
    suspends: 1,
    sourceStopCalls: 2,
    sourceDisconnectCalls: 2,
    gainDisconnectCalls: 10,
    sourceBufferClearCalls: 2,
    sourceEndedClearCalls: 2,
  });
  assert.deepEqual(emittedEvents, []);
  const publicResultsAndEvents = Object.freeze({
    generationOneTapSettlement,
    generationOneResult,
    generationOneCompletedReplayResult,
    generationTwoTapSettlement: await generationTwoTap.settlement,
    generationTwoResult,
    generationTwoCompletedReplayResult,
    emittedEvents,
  });
  assert.doesNotMatch(JSON.stringify(publicResultsAndEvents), /private/i);
  assert.doesNotMatch(JSON.stringify(publicResultsAndEvents), /cleanup-timeout|timeout/i);
});

test('T8-TX-MATRIX-SUSPEND-REJECT', async () => {
  const nextGenerationId = GENERATION_ID + 1;
  const emittedEvents = [];
  const fixture = await createFixture({
    audio: {
      resumeMode: 'resolve',
      suspendMode: 'reject',
      stopEndedMode: 'none',
    },
    onEvent(event) { emittedEvents.push(event); },
  });

  const expectedFailedInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  const expectedCleanupResult = Object.freeze({
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  const expectedCleanupResultKeys = Object.freeze([
    'scope',
    'status',
    'cause',
    'sourceReferencesCleared',
    'sourceStopSettled',
  ]);
  const nativeOperationSnapshot = () => Object.freeze({
    eventCount: fixture.audio.events.length,
    deadlineCount: fixture.audio.deadlines.length,
    sourceObjects: fixture.audio.context.sources.length,
    gainObjects: fixture.audio.context.gains.length,
    sourceAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-source').length,
    gainAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-gain').length,
    bufferAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-buffer').length,
    sourceStarts: fixture.audio.events.filter(({ type }) => type === 'start').length,
    sourceStops: fixture.audio.events.filter(({ type }) => type === 'stop').length,
    sourceDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'source'
    )).length,
    gainDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'gain'
    )).length,
    resumes: fixture.audio.events.filter(({ type }) => type === 'resume').length,
    suspends: fixture.audio.events.filter(({ type }) => type === 'suspend').length,
    sourceStopCalls: fixture.audio.context.sources.reduce(
      (total, { stopCalls }) => total + stopCalls,
      0,
    ),
    sourceDisconnectCalls: fixture.audio.context.sources.reduce(
      (total, { disconnectCalls }) => total + disconnectCalls,
      0,
    ),
    sourceBufferClearCalls: fixture.audio.context.sources.reduce(
      (total, { bufferClearCalls }) => total + bufferClearCalls,
      0,
    ),
    sourceEndedClearCalls: fixture.audio.context.sources.reduce(
      (total, { onendedClearCalls }) => total + onendedClearCalls,
      0,
    ),
    gainDisconnectCalls: fixture.audio.context.gains.reduce(
      (total, { disconnectCalls }) => total + disconnectCalls,
      0,
    ),
  });
  const referenceSnapshot = () => Object.freeze({
    sourceObjects: Object.freeze([...fixture.audio.context.sources]),
    gainObjects: Object.freeze([...fixture.audio.context.gains]),
    sourceBuffers: Object.freeze(fixture.audio.context.sources.map(({ buffer }) => buffer)),
    sourceEndedCallbacks: Object.freeze(
      fixture.audio.context.sources.map(({ onended }) => onended),
    ),
    sourceConnections: Object.freeze(fixture.audio.context.sources.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    gainConnections: Object.freeze(fixture.audio.context.gains.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    sourceStopTimes: Object.freeze(
      fixture.audio.context.sources.map(({ stopTime }) => stopTime),
    ),
    sourceEndedStates: Object.freeze(
      fixture.audio.context.sources.map(({ ended }) => ended),
    ),
    sourceDisconnectCalls: Object.freeze(
      fixture.audio.context.sources.map(({ disconnectCalls }) => disconnectCalls),
    ),
    sourceBufferClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ bufferClearCalls }) => bufferClearCalls),
    ),
    sourceEndedClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ onendedClearCalls }) => onendedClearCalls),
    ),
    gainDisconnectCalls: Object.freeze(
      fixture.audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
    ),
  });

  let replacementEngineFailureInjections = 0;
  let replacementEngineEvents = 0;
  const replacementEngineOptions = Object.freeze({
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    assertTerminalRecordReceipt: fixture.receipts.assert,
    createCleanupDeadline: fixture.audio.dependencies.createDeadline,
    failureInjector() { replacementEngineFailureInjections += 1; },
    onEvent() { replacementEngineEvents += 1; },
  });
  function assertReplacementEngineBlocked(stage) {
    const operationsBefore = nativeOperationSnapshot();
    const referencesBefore = referenceSnapshot();
    const inspectionBefore = fixture.engine.inspect();
    assert.throws(
      () => createWebAudioEngine(replacementEngineOptions),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message, 'loaded session capability is already bound to an engine');
        return true;
      },
      `${stage}: the loaded-session capability must remain bound to the original engine`,
    );
    assert.deepEqual(nativeOperationSnapshot(), operationsBefore);
    assert.deepEqual(referenceSnapshot(), referencesBefore);
    assert.deepEqual(fixture.engine.inspect(), inspectionBefore);
    assert.equal(replacementEngineFailureInjections, 0);
    assert.equal(replacementEngineEvents, 0);
  }
  function assertFrozenTapBlocked(generationId, effectId, stage) {
    const operationsBefore = nativeOperationSnapshot();
    const referencesBefore = referenceSnapshot();
    const inspectionBefore = fixture.engine.inspect();
    assert.throws(
      () => fixture.engine.directTap(Object.freeze({
        sessionId: SESSION_ID,
        generationId,
        effectId,
        sourceId: `suspend-reject-blocked-${generationId}-${effectId}`,
        scheduledAudioTime: 10.7,
      })),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message, 'generation allocation is frozen');
        return true;
      },
      `${stage}: public tap admission must remain synchronously frozen`,
    );
    assert.deepEqual(nativeOperationSnapshot(), operationsBefore);
    assert.deepEqual(referenceSnapshot(), referencesBefore);
    assert.deepEqual(fixture.engine.inspect(), inspectionBefore);
  }
  async function assertLowerBorrowBlocked(generationId, stage) {
    const operationsBefore = nativeOperationSnapshot();
    const referencesBefore = referenceSnapshot();
    const inspectionBefore = fixture.engine.inspect();
    let callbackCalls = 0;
    await assert.rejects(
      fixture.capability.borrowForGeneration(generationId, () => {
        callbackCalls += 1;
      }),
      (error) => {
        assert.equal(error?.code, 'parallel-generation-borrow');
        assert.equal(error?.message, 'parallel-generation-borrow');
        return true;
      },
      `${stage}: lower capability exclusion must reject the next generation`,
    );
    assert.equal(callbackCalls, 0);
    assert.deepEqual(nativeOperationSnapshot(), operationsBefore);
    assert.deepEqual(referenceSnapshot(), referencesBefore);
    assert.deepEqual(fixture.engine.inspect(), inspectionBefore);
  }

  const tap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 220,
    sourceId: 'matrix-suspend-reject-source',
    scheduledAudioTime: 10.02,
  }));
  const source = fixture.audio.context.sources[0];
  assert.notEqual(source, undefined);
  const capturedEndedCallback = source.onended;
  const bufferReference = source.buffer;
  const sourceConnectionReferences = Object.freeze([...source.connections]);
  assert.equal(typeof capturedEndedCallback, 'function');
  assert.notEqual(bufferReference, null);
  assert.equal(sourceConnectionReferences.length, 1);
  assert.equal(fixture.audio.context.state, 'running');
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'resume').length, 1);

  const receipt = fixture.receipts.mint();
  const cleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 221,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  assert.equal(source.stopCalls, 1);
  assert.equal(source.stopTime, 10.525);
  assert.equal(source.ended, false);
  assert.equal(source.buffer, bufferReference);
  assert.equal(source.onended, capturedEndedCallback);
  assert.deepEqual(source.connections, sourceConnectionReferences);
  assert.equal(source.disconnectCalls, 0);
  assert.deepEqual(fixture.engine.inspect(), expectedFailedInspection);

  const cleanupDeadlines = fixture.audio.deadlines.filter(({ kind }) => (
    kind === 'generation-cleanup'
  ));
  assert.equal(cleanupDeadlines.length, 1);
  const [cleanupDeadline] = cleanupDeadlines;
  assert.equal(cleanupDeadline.milliseconds, 100);
  assert.equal(cleanupDeadline.cancelled, false);
  let cleanupDeadlineFireCalls = 0;
  const originalCleanupDeadlineFire = cleanupDeadline.fire;
  cleanupDeadline.fire = () => {
    cleanupDeadlineFireCalls += 1;
    return Reflect.apply(originalCleanupDeadlineFire, cleanupDeadline, []);
  };

  await assertLowerBorrowBlocked(
    nextGenerationId,
    'before source-stop settlement',
  );
  assertFrozenTapBlocked(
    GENERATION_ID,
    222,
    'before source-stop settlement / current generation',
  );
  assertFrozenTapBlocked(
    nextGenerationId,
    223,
    'before source-stop settlement / next generation',
  );
  assertReplacementEngineBlocked('before source-stop settlement');

  const operationsBeforePendingReplay = nativeOperationSnapshot();
  const referencesBeforePendingReplay = referenceSnapshot();
  const inspectionBeforePendingReplay = fixture.engine.inspect();
  const pendingReplay = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 224,
    terminalRecordReceipt: receipt,
    audioNow: 10.51,
  }));
  assert.equal(pendingReplay, cleanup);
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforePendingReplay);
  assert.deepEqual(referenceSnapshot(), referencesBeforePendingReplay);
  assert.deepEqual(fixture.engine.inspect(), inspectionBeforePendingReplay);
  assert.equal(source.stopCalls, 1);
  assert.equal(cleanupDeadline.cancelled, false);
  assert.equal(cleanupDeadlineFireCalls, 0);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 0);

  fixture.audio.advanceTo(source.stopTime);
  assert.equal(source.ended, true);
  assertSourceReferencesClearedOnce(source);
  assert.equal(source.connections.length, 0);

  const [tapSettlement, cleanupResult, pendingReplayResult] = await Promise.all([
    tap.settlement,
    cleanup,
    pendingReplay,
  ]);
  assert.deepEqual(tapSettlement, { status: 'failed', cause: 'schedule-failed' });
  assert.equal(pendingReplayResult, cleanupResult);
  assert.equal(Object.isFrozen(cleanupResult), true);
  assert.deepEqual(Reflect.ownKeys(cleanupResult), expectedCleanupResultKeys);
  assert.deepEqual(cleanupResult, expectedCleanupResult);
  assert.deepEqual(fixture.engine.inspect(), expectedFailedInspection);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assert.equal(fixture.audio.context.state, 'running');
  assert.equal(cleanupDeadlineFireCalls, 0);
  assert.equal(cleanupDeadline.cancelled, true);

  assertSourceReferencesClearedOnce(source);
  assert.equal(source.buffer, null);
  assert.equal(source.onended, null);
  assert.equal(source.connections.length, 0);
  assert.equal(source.stopCalls, 1);
  assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected));
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.ok(fixture.audio.context.gains.every(({ connections }) => connections.length === 0));
  assert.deepEqual(emittedEvents, []);

  const ownership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receipt,
  });
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  for (const candidate of [
    { ...cleanupResult },
    Object.freeze({ ...cleanupResult }),
    new Proxy(cleanupResult, {}),
  ]) {
    assert.throws(
      () => assertGenerationCleanupResult(candidate, ownership),
      /genuine generation cleanup result/,
    );
  }
  assert.equal(claimGenerationCleanupResult(cleanupResult, ownership), true);
  assert.throws(
    () => claimGenerationCleanupResult(cleanupResult, ownership),
    /generation cleanup result already claimed/,
  );

  const operationsBeforeFailedReplay = nativeOperationSnapshot();
  const referencesBeforeFailedReplay = referenceSnapshot();
  const inspectionBeforeFailedReplay = fixture.engine.inspect();
  const failedReplay = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 225,
    terminalRecordReceipt: receipt,
    audioNow: 10.7,
  }));
  assert.equal(failedReplay, cleanup);
  const failedReplayResult = await failedReplay;
  assert.equal(failedReplayResult, cleanupResult);
  assert.equal(assertGenerationCleanupResult(failedReplayResult, ownership), true);
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforeFailedReplay);
  assert.deepEqual(referenceSnapshot(), referencesBeforeFailedReplay);
  assert.deepEqual(fixture.engine.inspect(), inspectionBeforeFailedReplay);

  const conflictingReceipt = fixture.receipts.mint();
  const operationsBeforeConflict = nativeOperationSnapshot();
  const referencesBeforeConflict = referenceSnapshot();
  const inspectionBeforeConflict = fixture.engine.inspect();
  assert.throws(
    () => fixture.engine.terminateGeneration(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 226,
      terminalRecordReceipt: conflictingReceipt,
      audioNow: 10.8,
    })),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.equal(error.message, 'another generation termination owns the engine');
      return true;
    },
  );
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforeConflict);
  assert.deepEqual(referenceSnapshot(), referencesBeforeConflict);
  assert.deepEqual(fixture.engine.inspect(), inspectionBeforeConflict);

  const operationsBeforeLateCallback = nativeOperationSnapshot();
  const referencesBeforeLateCallback = referenceSnapshot();
  const inspectionBeforeLateCallback = fixture.engine.inspect();
  const eventsBeforeLateCallback = emittedEvents.length;
  assert.doesNotThrow(() => capturedEndedCallback());
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforeLateCallback);
  assert.deepEqual(referenceSnapshot(), referencesBeforeLateCallback);
  assert.deepEqual(fixture.engine.inspect(), inspectionBeforeLateCallback);
  assert.equal(emittedEvents.length, eventsBeforeLateCallback);
  assertSourceReferencesClearedOnce(source);

  let lowerBorrowCallbackCalls = 0;
  await fixture.capability.borrowForGeneration(nextGenerationId, () => {
    lowerBorrowCallbackCalls += 1;
  });
  assert.equal(lowerBorrowCallbackCalls, 1);
  assert.deepEqual(fixture.engine.inspect(), expectedFailedInspection);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'resume').length, 2);
  assertFrozenTapBlocked(
    GENERATION_ID,
    227,
    'after lower exclusion settles / failed generation',
  );
  assertFrozenTapBlocked(
    nextGenerationId,
    228,
    'after lower exclusion settles / next generation',
  );
  assertReplacementEngineBlocked('after lower exclusion settles');
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assertSourceReferencesClearedOnce(source);
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));

  const finalOperations = nativeOperationSnapshot();
  assert.deepEqual({
    sourceObjects: finalOperations.sourceObjects,
    gainObjects: finalOperations.gainObjects,
    sourceAllocations: finalOperations.sourceAllocations,
    gainAllocations: finalOperations.gainAllocations,
    bufferAllocations: finalOperations.bufferAllocations,
    sourceStarts: finalOperations.sourceStarts,
    sourceStops: finalOperations.sourceStops,
    sourceDisconnects: finalOperations.sourceDisconnects,
    gainDisconnects: finalOperations.gainDisconnects,
    resumes: finalOperations.resumes,
    suspends: finalOperations.suspends,
    sourceStopCalls: finalOperations.sourceStopCalls,
    sourceDisconnectCalls: finalOperations.sourceDisconnectCalls,
    sourceBufferClearCalls: finalOperations.sourceBufferClearCalls,
    sourceEndedClearCalls: finalOperations.sourceEndedClearCalls,
    gainDisconnectCalls: finalOperations.gainDisconnectCalls,
  }, {
    sourceObjects: 1,
    gainObjects: 5,
    sourceAllocations: 1,
    gainAllocations: 5,
    bufferAllocations: 1,
    sourceStarts: 1,
    sourceStops: 1,
    sourceDisconnects: 1,
    gainDisconnects: 5,
    resumes: 2,
    suspends: 1,
    sourceStopCalls: 1,
    sourceDisconnectCalls: 1,
    sourceBufferClearCalls: 1,
    sourceEndedClearCalls: 1,
    gainDisconnectCalls: 5,
  });

  const publicEvidence = Object.freeze({
    tapSettlement,
    cleanupResult,
    pendingReplayResult,
    failedReplayResult,
    inspection: fixture.engine.inspect(),
    emittedEvents,
  });
  const serializedPublicEvidence = JSON.stringify(publicEvidence);
  assert.doesNotMatch(serializedPublicEvidence, /private/i);
  assert.doesNotMatch(
    serializedPublicEvidence,
    /stale-generation-resume|context-suspend-failed|cleanup-timeout/i,
  );
});

test('T8-TX-MATRIX-SUSPEND-TIMEOUT-LATE-RESOLVE', async () => {
  const nextGenerationId = GENERATION_ID + 1;
  const emittedEvents = [];
  const cleanupLifecycle = [];
  let cleanupDeadlineCancelCalls = 0;
  const audio = createFakeAudioHarness({
    resumeMode: 'resolve',
    suspendMode: 'deferred',
    stopEndedMode: 'none',
  });
  const loader = createLocalTrackLoader(audio.dependencies);
  const capability = await loader.load({
    file: audio.file,
    loadedSessionId: 'loaded-session-matrix-suspend-timeout',
  });
  const receipts = createReceiptAuthority();
  const engine = createWebAudioEngine({
    loadedSessionCapability: capability,
    sessionId: SESSION_ID,
    assertTerminalRecordReceipt: receipts.assert,
    createCleanupDeadline(kind, milliseconds) {
      const deadline = audio.dependencies.createDeadline(kind, milliseconds);
      const originalCancel = deadline.cancel;
      deadline.cancel = () => {
        cleanupDeadlineCancelCalls += 1;
        cleanupLifecycle.push('cleanup-deadline-cancelled');
        return Reflect.apply(originalCancel, deadline, []);
      };
      return deadline;
    },
    failureInjector() {},
    onEvent(event) { emittedEvents.push(event); },
  });
  const fixture = Object.freeze({ audio, loader, capability, receipts, engine });

  const expectedFailedInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  const expectedCleanupResult = Object.freeze({
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  const expectedCleanupResultKeys = Object.freeze([
    'scope',
    'status',
    'cause',
    'sourceReferencesCleared',
    'sourceStopSettled',
  ]);
  const nativeOperationSnapshot = () => Object.freeze({
    eventCount: fixture.audio.events.length,
    deadlineCount: fixture.audio.deadlines.length,
    sourceObjects: fixture.audio.context.sources.length,
    gainObjects: fixture.audio.context.gains.length,
    sourceAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-source').length,
    gainAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-gain').length,
    bufferAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-buffer').length,
    sourceStarts: fixture.audio.events.filter(({ type }) => type === 'start').length,
    sourceStops: fixture.audio.events.filter(({ type }) => type === 'stop').length,
    sourceDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'source'
    )).length,
    gainDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'gain'
    )).length,
    resumes: fixture.audio.events.filter(({ type }) => type === 'resume').length,
    suspends: fixture.audio.events.filter(({ type }) => type === 'suspend').length,
    sourceStopCalls: fixture.audio.context.sources.reduce(
      (total, { stopCalls }) => total + stopCalls,
      0,
    ),
    sourceDisconnectCalls: fixture.audio.context.sources.reduce(
      (total, { disconnectCalls }) => total + disconnectCalls,
      0,
    ),
    sourceBufferClearCalls: fixture.audio.context.sources.reduce(
      (total, { bufferClearCalls }) => total + bufferClearCalls,
      0,
    ),
    sourceEndedClearCalls: fixture.audio.context.sources.reduce(
      (total, { onendedClearCalls }) => total + onendedClearCalls,
      0,
    ),
    gainDisconnectCalls: fixture.audio.context.gains.reduce(
      (total, { disconnectCalls }) => total + disconnectCalls,
      0,
    ),
  });
  const referenceSnapshot = () => Object.freeze({
    sourceObjects: Object.freeze([...fixture.audio.context.sources]),
    gainObjects: Object.freeze([...fixture.audio.context.gains]),
    sourceBuffers: Object.freeze(fixture.audio.context.sources.map(({ buffer }) => buffer)),
    sourceEndedCallbacks: Object.freeze(
      fixture.audio.context.sources.map(({ onended }) => onended),
    ),
    sourceConnections: Object.freeze(fixture.audio.context.sources.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    gainConnections: Object.freeze(fixture.audio.context.gains.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    sourceStopTimes: Object.freeze(
      fixture.audio.context.sources.map(({ stopTime }) => stopTime),
    ),
    sourceEndedStates: Object.freeze(
      fixture.audio.context.sources.map(({ ended }) => ended),
    ),
    sourceStopCalls: Object.freeze(
      fixture.audio.context.sources.map(({ stopCalls }) => stopCalls),
    ),
    sourceDisconnectCalls: Object.freeze(
      fixture.audio.context.sources.map(({ disconnectCalls }) => disconnectCalls),
    ),
    sourceBufferClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ bufferClearCalls }) => bufferClearCalls),
    ),
    sourceEndedClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ onendedClearCalls }) => onendedClearCalls),
    ),
    gainDisconnectCalls: Object.freeze(
      fixture.audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
    ),
  });

  let replacementEngineFailureInjections = 0;
  let replacementEngineEvents = 0;
  const replacementEngineOptions = Object.freeze({
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    assertTerminalRecordReceipt: fixture.receipts.assert,
    createCleanupDeadline: fixture.audio.dependencies.createDeadline,
    failureInjector() { replacementEngineFailureInjections += 1; },
    onEvent() { replacementEngineEvents += 1; },
  });
  function assertReplacementEngineBlocked(stage) {
    const operationsBefore = nativeOperationSnapshot();
    const referencesBefore = referenceSnapshot();
    const inspectionBefore = fixture.engine.inspect();
    assert.throws(
      () => createWebAudioEngine(replacementEngineOptions),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message, 'loaded session capability is already bound to an engine');
        return true;
      },
      `${stage}: the loaded-session capability must remain bound to its original engine`,
    );
    assert.deepEqual(nativeOperationSnapshot(), operationsBefore);
    assert.deepEqual(referenceSnapshot(), referencesBefore);
    assert.deepEqual(fixture.engine.inspect(), inspectionBefore);
    assert.equal(replacementEngineFailureInjections, 0);
    assert.equal(replacementEngineEvents, 0);
  }
  function assertFrozenTapBlocked(generationId, effectId, stage) {
    const operationsBefore = nativeOperationSnapshot();
    const referencesBefore = referenceSnapshot();
    const inspectionBefore = fixture.engine.inspect();
    assert.throws(
      () => fixture.engine.directTap(Object.freeze({
        sessionId: SESSION_ID,
        generationId,
        effectId,
        sourceId: `suspend-timeout-blocked-${generationId}-${effectId}`,
        scheduledAudioTime: 10.7,
      })),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message, 'generation allocation is frozen');
        return true;
      },
      `${stage}: public engine admission must remain synchronously frozen`,
    );
    assert.deepEqual(nativeOperationSnapshot(), operationsBefore);
    assert.deepEqual(referenceSnapshot(), referencesBefore);
    assert.deepEqual(fixture.engine.inspect(), inspectionBefore);
  }
  async function assertLowerBorrowBlocked(generationId, stage) {
    const operationsBefore = nativeOperationSnapshot();
    const referencesBefore = referenceSnapshot();
    const inspectionBefore = fixture.engine.inspect();
    let callbackCalls = 0;
    await assert.rejects(
      fixture.capability.borrowForGeneration(generationId, () => {
        callbackCalls += 1;
      }),
      (error) => {
        assert.equal(error?.code, 'parallel-generation-borrow');
        assert.equal(error?.message, 'parallel-generation-borrow');
        return true;
      },
      `${stage}: lower capability exclusion must reject a parallel generation borrow`,
    );
    assert.equal(callbackCalls, 0);
    assert.deepEqual(nativeOperationSnapshot(), operationsBefore);
    assert.deepEqual(referenceSnapshot(), referencesBefore);
    assert.deepEqual(fixture.engine.inspect(), inspectionBefore);
  }

  const deadlinesBeforeCleanup = fixture.audio.deadlines.length;
  const tap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 240,
    sourceId: 'matrix-suspend-timeout-source',
    scheduledAudioTime: 10.02,
  }));
  const source = fixture.audio.context.sources[0];
  assert.notEqual(source, undefined);
  const capturedEndedCallback = source.onended;
  const bufferReference = source.buffer;
  const sourceConnectionReferences = Object.freeze([...source.connections]);
  assert.equal(typeof capturedEndedCallback, 'function');
  assert.notEqual(bufferReference, null);
  assert.equal(sourceConnectionReferences.length, 1);
  assert.equal(fixture.audio.context.state, 'running');
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'resume').length, 1);

  const receipt = fixture.receipts.mint();
  const cleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 241,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  const observedCleanup = cleanup.then((result) => {
    cleanupLifecycle.push('cleanup-finalizer-observed');
    return result;
  });
  const tapLifecycle = [];
  const observedTap = tap.settlement.then((result) => {
    tapLifecycle.push('tap-settlement-observed');
    return result;
  });
  assert.deepEqual(fixture.engine.inspect(), expectedFailedInspection);
  assert.equal(source.stopCalls, 1);
  assert.equal(source.stopTime, 10.525);
  assert.equal(source.ended, false);
  assert.equal(source.buffer, bufferReference);
  assert.equal(source.onended, capturedEndedCallback);
  assert.deepEqual(source.connections, sourceConnectionReferences);
  assert.equal(source.disconnectCalls, 0);

  const cleanupDeadlines = fixture.audio.deadlines
    .slice(deadlinesBeforeCleanup)
    .filter(({ kind }) => kind === 'generation-cleanup');
  assert.equal(cleanupDeadlines.length, 1);
  const [cleanupDeadline] = cleanupDeadlines;
  assert.equal(cleanupDeadline.milliseconds, 100);
  assert.equal(cleanupDeadline.cancelled, false);
  let cleanupDeadlineFireCalls = 0;
  const originalCleanupDeadlineFire = cleanupDeadline.fire;
  cleanupDeadline.fire = () => {
    cleanupDeadlineFireCalls += 1;
    cleanupLifecycle.push('cleanup-deadline-fired');
    return Reflect.apply(originalCleanupDeadlineFire, cleanupDeadline, []);
  };

  const operationsBeforePendingReplay = nativeOperationSnapshot();
  const referencesBeforePendingReplay = referenceSnapshot();
  const inspectionBeforePendingReplay = fixture.engine.inspect();
  const pendingReplay = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 242,
    terminalRecordReceipt: receipt,
    audioNow: 10.51,
  }));
  assert.equal(pendingReplay, cleanup);
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforePendingReplay);
  assert.deepEqual(referenceSnapshot(), referencesBeforePendingReplay);
  assert.deepEqual(fixture.engine.inspect(), inspectionBeforePendingReplay);

  await assertLowerBorrowBlocked(nextGenerationId, 'before source-stop settlement');
  assertFrozenTapBlocked(
    GENERATION_ID,
    243,
    'before source-stop settlement / current generation',
  );
  assertFrozenTapBlocked(
    nextGenerationId,
    244,
    'before source-stop settlement / next generation',
  );
  assertReplacementEngineBlocked('before source-stop settlement');
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 0);
  assert.equal(cleanupDeadlineFireCalls, 0);
  assert.equal(cleanupDeadlineCancelCalls, 0);
  assert.deepEqual(cleanupLifecycle, []);

  fixture.audio.advanceTo(source.stopTime);
  assert.equal(source.ended, true);
  assertSourceReferencesClearedOnce(source);
  assert.equal(source.connections.length, 0);
  await fixture.audio.suspendStarted.promise;
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assert.equal(fixture.audio.context.state, 'running');
  assert.equal(cleanupDeadline.cancelled, false);
  assert.equal(cleanupDeadlineFireCalls, 0);
  assert.equal(cleanupDeadlineCancelCalls, 0);
  assert.deepEqual(cleanupLifecycle, [], 'the cleanup observer must remain pending with native suspend');
  assert.deepEqual(fixture.engine.inspect(), expectedFailedInspection);

  await assertLowerBorrowBlocked(nextGenerationId, 'native suspend pending');
  assertFrozenTapBlocked(GENERATION_ID, 245, 'native suspend pending / current generation');
  assertFrozenTapBlocked(nextGenerationId, 246, 'native suspend pending / next generation');
  assertReplacementEngineBlocked('native suspend pending');

  cleanupDeadline.fire();
  const [cleanupResult, pendingReplayResult, observedCleanupResult] = await Promise.all([
    cleanup,
    pendingReplay,
    observedCleanup,
  ]);
  assert.deepEqual(tapLifecycle, [], 'the stale tap settlement must still await native suspend');
  assert.equal(pendingReplayResult, cleanupResult);
  assert.equal(observedCleanupResult, cleanupResult);
  assert.equal(Object.isFrozen(cleanupResult), true);
  assert.deepEqual(Reflect.ownKeys(cleanupResult), expectedCleanupResultKeys);
  assert.deepEqual(cleanupResult, expectedCleanupResult);
  assert.deepEqual(cleanupLifecycle, [
    'cleanup-deadline-fired',
    'cleanup-deadline-cancelled',
    'cleanup-finalizer-observed',
  ]);
  assert.equal(cleanupDeadlineFireCalls, 1);
  assert.equal(cleanupDeadlineCancelCalls, 1);
  assert.equal(cleanupDeadline.cancelled, true);
  assert.deepEqual(fixture.engine.inspect(), expectedFailedInspection);
  assert.equal(fixture.audio.context.state, 'running');
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assertSourceReferencesClearedOnce(source);
  assert.equal(source.buffer, null);
  assert.equal(source.onended, null);
  assert.equal(source.connections.length, 0);
  assert.equal(source.stopCalls, 1);
  assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected));
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.ok(fixture.audio.context.gains.every(({ connections }) => connections.length === 0));
  assert.deepEqual(emittedEvents, []);

  const ownership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receipt,
  });
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  for (const candidate of [
    { ...cleanupResult },
    Object.freeze({ ...cleanupResult }),
    new Proxy(cleanupResult, {}),
  ]) {
    assert.throws(
      () => assertGenerationCleanupResult(candidate, ownership),
      /genuine generation cleanup result/,
    );
  }
  assert.equal(claimGenerationCleanupResult(cleanupResult, ownership), true);
  assert.throws(
    () => claimGenerationCleanupResult(cleanupResult, ownership),
    /generation cleanup result already claimed/,
  );

  const operationsBeforeFailedReplay = nativeOperationSnapshot();
  const referencesBeforeFailedReplay = referenceSnapshot();
  const inspectionBeforeFailedReplay = fixture.engine.inspect();
  const failedReplay = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 247,
    terminalRecordReceipt: receipt,
    audioNow: 10.7,
  }));
  assert.equal(failedReplay, cleanup);
  const failedReplayResult = await failedReplay;
  assert.equal(failedReplayResult, cleanupResult);
  assert.equal(assertGenerationCleanupResult(failedReplayResult, ownership), true);
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforeFailedReplay);
  assert.deepEqual(referenceSnapshot(), referencesBeforeFailedReplay);
  assert.deepEqual(fixture.engine.inspect(), inspectionBeforeFailedReplay);

  const conflictingReceipt = fixture.receipts.mint();
  const operationsBeforeConflict = nativeOperationSnapshot();
  const referencesBeforeConflict = referenceSnapshot();
  const inspectionBeforeConflict = fixture.engine.inspect();
  assert.throws(
    () => fixture.engine.terminateGeneration(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 248,
      terminalRecordReceipt: conflictingReceipt,
      audioNow: 10.8,
    })),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.equal(error.message, 'another generation termination owns the engine');
      return true;
    },
  );
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforeConflict);
  assert.deepEqual(referenceSnapshot(), referencesBeforeConflict);
  assert.deepEqual(fixture.engine.inspect(), inspectionBeforeConflict);

  const frozenResultIdentity = cleanupResult;
  const frozenResultValue = JSON.stringify(cleanupResult);
  const frozenOwnership = Object.freeze({ ...ownership });
  const operationsBeforeLateResolve = nativeOperationSnapshot();
  const referencesBeforeLateResolve = referenceSnapshot();
  const inspectionBeforeLateResolve = fixture.engine.inspect();
  const audioEventsBeforeLateResolve = Object.freeze([...fixture.audio.events]);
  const emittedEventsBeforeLateResolve = Object.freeze([...emittedEvents]);
  const lateSuspendJoin = fixture.capability.suspend('matrix-late-resolve-join');
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  fixture.audio.suspendDeferred.resolve();
  assert.equal(await lateSuspendJoin, true);
  assert.equal(fixture.audio.context.state, 'suspended');
  const tapSettlement = await observedTap;
  assert.deepEqual(tapSettlement, { status: 'failed', cause: 'schedule-failed' });
  assert.deepEqual(tapLifecycle, ['tap-settlement-observed']);

  assert.equal(cleanupResult, frozenResultIdentity);
  assert.equal(JSON.stringify(cleanupResult), frozenResultValue);
  assert.deepEqual(ownership, frozenOwnership);
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  assert.throws(
    () => claimGenerationCleanupResult(cleanupResult, ownership),
    /generation cleanup result already claimed/,
  );
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforeLateResolve);
  assert.deepEqual(referenceSnapshot(), referencesBeforeLateResolve);
  assert.deepEqual(fixture.engine.inspect(), inspectionBeforeLateResolve);
  assert.deepEqual(fixture.audio.events, audioEventsBeforeLateResolve);
  assert.deepEqual(emittedEvents, emittedEventsBeforeLateResolve);
  assert.deepEqual(cleanupLifecycle, [
    'cleanup-deadline-fired',
    'cleanup-deadline-cancelled',
    'cleanup-finalizer-observed',
  ]);
  assert.equal(cleanupDeadlineFireCalls, 1);
  assert.equal(cleanupDeadlineCancelCalls, 1);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assertSourceReferencesClearedOnce(source);
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));

  const operationsBeforeLateCallback = nativeOperationSnapshot();
  const referencesBeforeLateCallback = referenceSnapshot();
  const inspectionBeforeLateCallback = fixture.engine.inspect();
  const eventsBeforeLateCallback = emittedEvents.length;
  assert.doesNotThrow(() => capturedEndedCallback());
  assert.deepEqual(nativeOperationSnapshot(), operationsBeforeLateCallback);
  assert.deepEqual(referenceSnapshot(), referencesBeforeLateCallback);
  assert.deepEqual(fixture.engine.inspect(), inspectionBeforeLateCallback);
  assert.equal(emittedEvents.length, eventsBeforeLateCallback);

  assertFrozenTapBlocked(GENERATION_ID, 249, 'after late suspend resolution / failed generation');
  assertFrozenTapBlocked(nextGenerationId, 250, 'after late suspend resolution / next generation');
  assertReplacementEngineBlocked('after late suspend resolution');

  let lowerBorrowCallbackCalls = 0;
  await fixture.capability.borrowForGeneration(nextGenerationId, () => {
    lowerBorrowCallbackCalls += 1;
  });
  assert.equal(lowerBorrowCallbackCalls, 1);
  assert.equal(fixture.audio.context.state, 'running');
  assert.deepEqual(fixture.engine.inspect(), expectedFailedInspection);
  assert.equal(cleanupResult, frozenResultIdentity);
  assert.equal(JSON.stringify(cleanupResult), frozenResultValue);
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  assert.equal(cleanupDeadlineFireCalls, 1);
  assert.equal(cleanupDeadlineCancelCalls, 1);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assertSourceReferencesClearedOnce(source);
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assertFrozenTapBlocked(nextGenerationId, 251, 'after lower capability borrow becomes available');
  assertReplacementEngineBlocked('after lower capability borrow becomes available');

  const finalOperations = nativeOperationSnapshot();
  assert.deepEqual({
    sourceObjects: finalOperations.sourceObjects,
    gainObjects: finalOperations.gainObjects,
    deadlineCount: finalOperations.deadlineCount,
    sourceAllocations: finalOperations.sourceAllocations,
    gainAllocations: finalOperations.gainAllocations,
    bufferAllocations: finalOperations.bufferAllocations,
    sourceStarts: finalOperations.sourceStarts,
    sourceStops: finalOperations.sourceStops,
    sourceDisconnects: finalOperations.sourceDisconnects,
    gainDisconnects: finalOperations.gainDisconnects,
    resumes: finalOperations.resumes,
    suspends: finalOperations.suspends,
    sourceStopCalls: finalOperations.sourceStopCalls,
    sourceDisconnectCalls: finalOperations.sourceDisconnectCalls,
    sourceBufferClearCalls: finalOperations.sourceBufferClearCalls,
    sourceEndedClearCalls: finalOperations.sourceEndedClearCalls,
    gainDisconnectCalls: finalOperations.gainDisconnectCalls,
  }, {
    sourceObjects: 1,
    gainObjects: 5,
    deadlineCount: deadlinesBeforeCleanup + 1,
    sourceAllocations: 1,
    gainAllocations: 5,
    bufferAllocations: 1,
    sourceStarts: 1,
    sourceStops: 1,
    sourceDisconnects: 1,
    gainDisconnects: 5,
    resumes: 2,
    suspends: 1,
    sourceStopCalls: 1,
    sourceDisconnectCalls: 1,
    sourceBufferClearCalls: 1,
    sourceEndedClearCalls: 1,
    gainDisconnectCalls: 5,
  });

  const publicEvidence = Object.freeze({
    tapSettlement,
    cleanupResult,
    pendingReplayResult,
    observedCleanupResult,
    failedReplayResult,
    inspection: fixture.engine.inspect(),
    emittedEvents,
  });
  const serializedPublicEvidence = JSON.stringify(publicEvidence);
  assert.doesNotMatch(serializedPublicEvidence, /private/i);
  assert.doesNotMatch(
    serializedPublicEvidence,
    /stale-generation-resume|context-suspend-failed|cleanup-timeout/i,
  );
});

test('T8-TX-MATRIX-RESUME-PENDING-DEADLINE-RESOLVE', async () => {
  const nextGenerationId = GENERATION_ID + 1;
  const emittedEvents = [];
  const cleanupLifecycle = [];
  const tapLifecycle = [];
  let deadlineCancelCalls = 0;
  const audio = createFakeAudioHarness({
    resumeMode: 'deferred',
    suspendMode: 'deferred',
    stopEndedMode: 'none',
  });
  const loader = createLocalTrackLoader(audio.dependencies);
  const capability = await loader.load({
    file: audio.file,
    loadedSessionId: 'loaded-session-matrix-resume-pending',
  });
  const receipts = createReceiptAuthority();
  const engine = createWebAudioEngine({
    loadedSessionCapability: capability,
    sessionId: SESSION_ID,
    assertTerminalRecordReceipt: receipts.assert,
    createCleanupDeadline(kind, milliseconds) {
      const deadline = audio.dependencies.createDeadline(kind, milliseconds);
      const cancel = deadline.cancel;
      deadline.cancel = () => {
        deadlineCancelCalls += 1;
        cleanupLifecycle.push('deadline-cancelled');
        return Reflect.apply(cancel, deadline, []);
      };
      return deadline;
    },
    failureInjector() {},
    onEvent(event) { emittedEvents.push(event); },
  });
  const failedInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  const expectedResult = Object.freeze({
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  const resultKeys = Object.freeze([
    'scope',
    'status',
    'cause',
    'sourceReferencesCleared',
    'sourceStopSettled',
  ]);
  const operations = () => Object.freeze({
    eventCount: audio.events.length,
    deadlineCount: audio.deadlines.length,
    sourceObjects: audio.context.sources.length,
    gainObjects: audio.context.gains.length,
    sourceAllocations: audio.events.filter(({ type }) => type === 'allocate-source').length,
    gainAllocations: audio.events.filter(({ type }) => type === 'allocate-gain').length,
    bufferAllocations: audio.events.filter(({ type }) => type === 'allocate-buffer').length,
    starts: audio.events.filter(({ type }) => type === 'start').length,
    stops: audio.events.filter(({ type }) => type === 'stop').length,
    sourceDisconnects: audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'source'
    )).length,
    gainDisconnects: audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'gain'
    )).length,
    resumes: audio.events.filter(({ type }) => type === 'resume').length,
    suspends: audio.events.filter(({ type }) => type === 'suspend').length,
    stopCalls: audio.context.sources.reduce((sum, source) => sum + source.stopCalls, 0),
    sourceDisconnectCalls: audio.context.sources.reduce(
      (sum, source) => sum + source.disconnectCalls,
      0,
    ),
    bufferClearCalls: audio.context.sources.reduce(
      (sum, source) => sum + source.bufferClearCalls,
      0,
    ),
    endedClearCalls: audio.context.sources.reduce(
      (sum, source) => sum + source.onendedClearCalls,
      0,
    ),
    gainDisconnectCalls: audio.context.gains.reduce(
      (sum, gain) => sum + gain.disconnectCalls,
      0,
    ),
  });
  const references = () => Object.freeze({
    sources: Object.freeze([...audio.context.sources]),
    gains: Object.freeze([...audio.context.gains]),
    buffers: Object.freeze(audio.context.sources.map(({ buffer }) => buffer)),
    callbacks: Object.freeze(audio.context.sources.map(({ onended }) => onended)),
    sourceConnections: Object.freeze(audio.context.sources.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    gainConnections: Object.freeze(audio.context.gains.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    stopTimes: Object.freeze(audio.context.sources.map(({ stopTime }) => stopTime)),
    stopCalls: Object.freeze(audio.context.sources.map(({ stopCalls }) => stopCalls)),
    sourceDisconnectCalls: Object.freeze(
      audio.context.sources.map(({ disconnectCalls }) => disconnectCalls),
    ),
    bufferClearCalls: Object.freeze(
      audio.context.sources.map(({ bufferClearCalls }) => bufferClearCalls),
    ),
    endedClearCalls: Object.freeze(
      audio.context.sources.map(({ onendedClearCalls }) => onendedClearCalls),
    ),
    gainDisconnectCalls: Object.freeze(
      audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
    ),
  });

  let replacementFailureCalls = 0;
  let replacementEventCalls = 0;
  const replacementOptions = Object.freeze({
    loadedSessionCapability: capability,
    sessionId: SESSION_ID,
    assertTerminalRecordReceipt: receipts.assert,
    createCleanupDeadline: audio.dependencies.createDeadline,
    failureInjector() { replacementFailureCalls += 1; },
    onEvent() { replacementEventCalls += 1; },
  });
  function assertReplacementBlocked(stage) {
    const before = Object.freeze({
      operations: operations(),
      references: references(),
      inspection: engine.inspect(),
    });
    assert.throws(
      () => createWebAudioEngine(replacementOptions),
      /loaded session capability is already bound to an engine/,
      stage,
    );
    assert.deepEqual(operations(), before.operations);
    assert.deepEqual(references(), before.references);
    assert.deepEqual(engine.inspect(), before.inspection);
    assert.equal(replacementFailureCalls, 0);
    assert.equal(replacementEventCalls, 0);
  }
  function assertTapBlocked(generationId, effectId, stage) {
    const before = Object.freeze({
      operations: operations(),
      references: references(),
      inspection: engine.inspect(),
    });
    assert.throws(
      () => engine.directTap(Object.freeze({
        sessionId: SESSION_ID,
        generationId,
        effectId,
        sourceId: `resume-pending-blocked-${generationId}-${effectId}`,
        scheduledAudioTime: 10.7,
      })),
      /generation allocation is frozen/,
      stage,
    );
    assert.deepEqual(operations(), before.operations);
    assert.deepEqual(references(), before.references);
    assert.deepEqual(engine.inspect(), before.inspection);
  }
  async function assertBorrowBlocked(stage) {
    const before = Object.freeze({
      operations: operations(),
      references: references(),
      inspection: engine.inspect(),
    });
    let callbackCalls = 0;
    await assert.rejects(
      capability.borrowForGeneration(nextGenerationId, () => { callbackCalls += 1; }),
      (error) => error?.code === 'parallel-generation-borrow'
        && error?.message === 'parallel-generation-borrow',
      stage,
    );
    assert.equal(callbackCalls, 0);
    assert.deepEqual(operations(), before.operations);
    assert.deepEqual(references(), before.references);
    assert.deepEqual(engine.inspect(), before.inspection);
  }

  const deadlinesBefore = audio.deadlines.length;
  const tap = engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 260,
    sourceId: 'matrix-resume-pending-source',
    scheduledAudioTime: 10.02,
  }));
  const observedTap = tap.settlement.then((result) => {
    tapLifecycle.push('tap-observed');
    return result;
  });
  const source = audio.context.sources[0];
  assert.notEqual(source, undefined);
  const callback = source.onended;
  const buffer = source.buffer;
  const connections = Object.freeze([...source.connections]);
  assert.equal(tap.reusedPendingResume, false);
  assert.equal(tap.resumeKey, `${SESSION_ID}:${GENERATION_ID}:260`);
  assert.equal(typeof callback, 'function');
  assert.notEqual(buffer, null);
  assert.equal(connections.length, 1);
  assert.equal(audio.context.state, 'suspended');
  assert.equal(operations().resumes, 1);
  assert.equal(operations().starts, 1);
  assert.equal(operations().sourceObjects, 1);
  assert.equal(operations().gainObjects, 5);

  const receipt = receipts.mint();
  const cleanup = engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 261,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  const observedCleanup = cleanup.then((result) => {
    cleanupLifecycle.push('cleanup-observed');
    return result;
  });
  assert.deepEqual(engine.inspect(), failedInspection);
  assert.equal(source.stopCalls, 1);
  assert.equal(source.stopTime, 10.525);
  assert.equal(source.ended, false);
  assert.equal(source.buffer, buffer);
  assert.equal(source.onended, callback);
  assert.deepEqual(source.connections, connections);
  assert.equal(source.disconnectCalls, 0);

  const cleanupDeadlines = audio.deadlines
    .slice(deadlinesBefore)
    .filter(({ kind }) => kind === 'generation-cleanup');
  assert.equal(cleanupDeadlines.length, 1);
  const [deadline] = cleanupDeadlines;
  assert.equal(deadline.milliseconds, 100);
  assert.equal(deadline.cancelled, false);
  let deadlineFireCalls = 0;
  const fire = deadline.fire;
  deadline.fire = () => {
    deadlineFireCalls += 1;
    cleanupLifecycle.push('deadline-fired');
    return Reflect.apply(fire, deadline, []);
  };

  const pendingBefore = Object.freeze({
    operations: operations(),
    references: references(),
    inspection: engine.inspect(),
  });
  const pendingReplay = engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 262,
    terminalRecordReceipt: receipt,
    audioNow: 10.51,
  }));
  assert.equal(pendingReplay, cleanup);
  assert.deepEqual(operations(), pendingBefore.operations);
  assert.deepEqual(references(), pendingBefore.references);
  assert.deepEqual(engine.inspect(), pendingBefore.inspection);
  await assertBorrowBlocked('resume and terminal cleanup pending');
  assertTapBlocked(GENERATION_ID, 263, 'pending current generation');
  assertTapBlocked(nextGenerationId, 264, 'pending next generation');
  assertReplacementBlocked('resume and terminal cleanup pending');
  assert.equal(operations().suspends, 0);
  assert.deepEqual(cleanupLifecycle, []);
  assert.deepEqual(tapLifecycle, []);

  audio.advanceTo(source.stopTime);
  assert.equal(source.ended, true);
  assertSourceReferencesClearedOnce(source);
  assert.equal(source.connections.length, 0);
  assert.equal(operations().suspends, 0);
  assert.deepEqual(cleanupLifecycle, [], 'cleanup observer remains pending behind its deadline');
  assert.deepEqual(tapLifecycle, [], 'startup observer remains pending behind resume');
  assert.equal(deadline.cancelled, false);

  const callbackBefore = Object.freeze({
    operations: operations(),
    references: references(),
    inspection: engine.inspect(),
    eventCount: emittedEvents.length,
  });
  assert.doesNotThrow(() => callback());
  assert.deepEqual(operations(), callbackBefore.operations);
  assert.deepEqual(references(), callbackBefore.references);
  assert.deepEqual(engine.inspect(), callbackBefore.inspection);
  assert.equal(emittedEvents.length, callbackBefore.eventCount);

  deadline.fire();
  const [cleanupResult, pendingReplayResult, observedCleanupResult] = await Promise.all([
    cleanup,
    pendingReplay,
    observedCleanup,
  ]);
  assert.equal(pendingReplayResult, cleanupResult);
  assert.equal(observedCleanupResult, cleanupResult);
  assert.equal(Object.isFrozen(cleanupResult), true);
  assert.deepEqual(Reflect.ownKeys(cleanupResult), resultKeys);
  assert.deepEqual(cleanupResult, expectedResult);
  assert.deepEqual(cleanupLifecycle, ['deadline-fired', 'deadline-cancelled', 'cleanup-observed']);
  assert.equal(deadlineFireCalls, 1);
  assert.equal(deadlineCancelCalls, 1);
  assert.equal(deadline.cancelled, true);
  assert.deepEqual(tapLifecycle, []);
  assert.deepEqual(engine.inspect(), failedInspection);
  assert.equal(audio.context.state, 'suspended');
  assert.equal(operations().suspends, 0);
  assertSourceReferencesClearedOnce(source);
  assert.ok(audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.deepEqual(emittedEvents, []);

  const ownership = Object.freeze({
    engine,
    loadedSessionCapability: capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receipt,
  });
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  for (const candidate of [
    { ...cleanupResult },
    Object.freeze({ ...cleanupResult }),
    new Proxy(cleanupResult, {}),
  ]) {
    assert.throws(
      () => assertGenerationCleanupResult(candidate, ownership),
      /genuine generation cleanup result/,
    );
  }
  assert.equal(claimGenerationCleanupResult(cleanupResult, ownership), true);
  assert.throws(
    () => claimGenerationCleanupResult(cleanupResult, ownership),
    /generation cleanup result already claimed/,
  );

  const replayBefore = Object.freeze({
    operations: operations(),
    references: references(),
    inspection: engine.inspect(),
  });
  const failedReplay = engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 265,
    terminalRecordReceipt: receipt,
    audioNow: 10.7,
  }));
  assert.equal(failedReplay, cleanup);
  const failedReplayResult = await failedReplay;
  assert.equal(failedReplayResult, cleanupResult);
  assert.deepEqual(operations(), replayBefore.operations);
  assert.deepEqual(references(), replayBefore.references);
  assert.deepEqual(engine.inspect(), replayBefore.inspection);

  const conflictingReceipt = receipts.mint();
  const conflictBefore = Object.freeze({
    operations: operations(),
    references: references(),
    inspection: engine.inspect(),
  });
  assert.throws(
    () => engine.terminateGeneration(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 266,
      terminalRecordReceipt: conflictingReceipt,
      audioNow: 10.8,
    })),
    /another generation termination owns the engine/,
  );
  assert.deepEqual(operations(), conflictBefore.operations);
  assert.deepEqual(references(), conflictBefore.references);
  assert.deepEqual(engine.inspect(), conflictBefore.inspection);

  const frozenResult = cleanupResult;
  const frozenOwnership = Object.freeze({ ...ownership });
  const evidence = () => Object.freeze({
    cleanupResult,
    pendingReplayResult,
    observedCleanupResult,
    failedReplayResult,
    inspection: engine.inspect(),
    emittedEvents,
  });
  const frozenEvidence = JSON.stringify(evidence());
  const lateBefore = Object.freeze({
    operations: operations(),
    references: references(),
    inspection: engine.inspect(),
    audioEvents: Object.freeze([...audio.events]),
    emittedEvents: Object.freeze([...emittedEvents]),
  });

  audio.resumeDeferred.resolve();
  await audio.suspendStarted.promise;
  assert.equal(audio.context.state, 'running');
  assert.equal(operations().resumes, 1);
  assert.equal(operations().suspends, 1);
  assert.deepEqual(audio.events, [...lateBefore.audioEvents, Object.freeze({ type: 'suspend' })]);
  assert.deepEqual(references(), lateBefore.references);
  assert.deepEqual(engine.inspect(), lateBefore.inspection);
  assert.deepEqual(emittedEvents, lateBefore.emittedEvents);
  assert.deepEqual(tapLifecycle, [], 'startup waits for stale-resume suspension');
  assert.equal(cleanupResult, frozenResult);
  assert.equal(JSON.stringify(evidence()), frozenEvidence);
  assert.deepEqual(ownership, frozenOwnership);
  assert.equal(deadlineFireCalls, 1);
  assert.equal(deadlineCancelCalls, 1);
  assert.deepEqual({
    ...operations(),
    eventCount: lateBefore.operations.eventCount,
    suspends: lateBefore.operations.suspends,
  }, lateBefore.operations);

  await assertBorrowBlocked('late resume suspension pending');
  assertTapBlocked(GENERATION_ID, 267, 'late reconciliation current generation');
  assertTapBlocked(nextGenerationId, 268, 'late reconciliation next generation');
  assertReplacementBlocked('late resume suspension pending');

  const suspendJoin = capability.suspend('matrix-resume-pending-late-join');
  assert.equal(operations().suspends, 1);
  audio.suspendDeferred.resolve();
  const [tapSettlement, joinedSuspend] = await Promise.all([observedTap, suspendJoin]);
  assert.deepEqual(tapSettlement, { status: 'failed', cause: 'schedule-failed' });
  assert.equal(joinedSuspend, true);
  assert.deepEqual(tapLifecycle, ['tap-observed']);
  assert.equal(audio.context.state, 'suspended');
  assert.equal(operations().suspends, 1);
  assert.equal(cleanupResult, frozenResult);
  assert.equal(JSON.stringify(evidence()), frozenEvidence);
  assert.deepEqual(ownership, frozenOwnership);
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  assert.throws(
    () => claimGenerationCleanupResult(cleanupResult, ownership),
    /generation cleanup result already claimed/,
  );
  assert.deepEqual(references(), lateBefore.references);
  assert.deepEqual(engine.inspect(), lateBefore.inspection);
  assert.deepEqual(emittedEvents, lateBefore.emittedEvents);
  assert.deepEqual(cleanupLifecycle, ['deadline-fired', 'deadline-cancelled', 'cleanup-observed']);
  assert.equal(deadlineFireCalls, 1);
  assert.equal(deadlineCancelCalls, 1);
  assertSourceReferencesClearedOnce(source);
  assert.ok(audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));

  const inertBefore = Object.freeze({
    operations: operations(),
    references: references(),
    inspection: engine.inspect(),
    eventCount: emittedEvents.length,
  });
  assert.doesNotThrow(() => callback());
  assert.deepEqual(operations(), inertBefore.operations);
  assert.deepEqual(references(), inertBefore.references);
  assert.deepEqual(engine.inspect(), inertBefore.inspection);
  assert.equal(emittedEvents.length, inertBefore.eventCount);

  const lateReplay = engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 269,
    terminalRecordReceipt: receipt,
    audioNow: 10.9,
  }));
  assert.equal(lateReplay, cleanup);
  assert.equal(await lateReplay, cleanupResult);
  assert.equal(JSON.stringify(evidence()), frozenEvidence);
  assert.equal(deadlineFireCalls, 1);
  assert.equal(deadlineCancelCalls, 1);
  assertSourceReferencesClearedOnce(source);

  assertTapBlocked(GENERATION_ID, 270, 'after late resolve current generation');
  assertTapBlocked(nextGenerationId, 271, 'after late resolve next generation');
  assertReplacementBlocked('after late resume resolution');

  let lowerBorrowCallbackCalls = 0;
  await capability.borrowForGeneration(nextGenerationId, () => {
    lowerBorrowCallbackCalls += 1;
  });
  assert.equal(lowerBorrowCallbackCalls, 1);
  assert.equal(audio.context.state, 'running');
  assert.deepEqual(engine.inspect(), failedInspection);
  assert.equal(cleanupResult, frozenResult);
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  assert.equal(deadlineFireCalls, 1);
  assert.equal(deadlineCancelCalls, 1);
  assert.equal(operations().suspends, 1);
  assertSourceReferencesClearedOnce(source);
  assert.ok(audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assertTapBlocked(nextGenerationId, 272, 'after lower borrow availability');
  assertReplacementBlocked('after lower borrow availability');

  const final = operations();
  assert.deepEqual({
    deadlineCount: final.deadlineCount,
    sourceObjects: final.sourceObjects,
    gainObjects: final.gainObjects,
    sourceAllocations: final.sourceAllocations,
    gainAllocations: final.gainAllocations,
    bufferAllocations: final.bufferAllocations,
    starts: final.starts,
    stops: final.stops,
    sourceDisconnects: final.sourceDisconnects,
    gainDisconnects: final.gainDisconnects,
    resumes: final.resumes,
    suspends: final.suspends,
    stopCalls: final.stopCalls,
    sourceDisconnectCalls: final.sourceDisconnectCalls,
    bufferClearCalls: final.bufferClearCalls,
    endedClearCalls: final.endedClearCalls,
    gainDisconnectCalls: final.gainDisconnectCalls,
  }, {
    deadlineCount: deadlinesBefore + 1,
    sourceObjects: 1,
    gainObjects: 5,
    sourceAllocations: 1,
    gainAllocations: 5,
    bufferAllocations: 1,
    starts: 1,
    stops: 1,
    sourceDisconnects: 1,
    gainDisconnects: 5,
    resumes: 2,
    suspends: 1,
    stopCalls: 1,
    sourceDisconnectCalls: 1,
    bufferClearCalls: 1,
    endedClearCalls: 1,
    gainDisconnectCalls: 5,
  });

  const publicEvidence = Object.freeze({
    tapSettlement,
    cleanupResult,
    pendingReplayResult,
    observedCleanupResult,
    failedReplayResult,
    lateReplayResult: await lateReplay,
    inspection: engine.inspect(),
    emittedEvents,
  });
  const serializedPublicEvidence = JSON.stringify(publicEvidence);
  assert.doesNotMatch(serializedPublicEvidence, /private/i);
  assert.doesNotMatch(
    serializedPublicEvidence,
    /stale-generation-resume|context-suspend-failed|cleanup-timeout/i,
  );
});

test('T8-TX-MATRIX-RESUME-PENDING-DEADLINE-REJECT', async () => {
  const nextGenerationId = GENERATION_ID + 1;
  const emittedEvents = [];
  const cleanupLifecycle = [];
  const tapLifecycle = [];
  let deadlineCancelCalls = 0;
  const audio = createFakeAudioHarness({
    resumeMode: 'deferred',
    suspendMode: 'deferred',
    stopEndedMode: 'none',
  });
  const loader = createLocalTrackLoader(audio.dependencies);
  const capability = await loader.load({
    file: audio.file,
    loadedSessionId: 'loaded-session-matrix-resume-pending-reject',
  });
  const receipts = createReceiptAuthority();
  const engine = createWebAudioEngine({
    loadedSessionCapability: capability,
    sessionId: SESSION_ID,
    assertTerminalRecordReceipt: receipts.assert,
    createCleanupDeadline(kind, milliseconds) {
      const deadline = audio.dependencies.createDeadline(kind, milliseconds);
      const cancel = deadline.cancel;
      deadline.cancel = () => {
        deadlineCancelCalls += 1;
        cleanupLifecycle.push('deadline-cancelled');
        return Reflect.apply(cancel, deadline, []);
      };
      return deadline;
    },
    failureInjector() {},
    onEvent(event) { emittedEvents.push(event); },
  });
  const failedInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  const expectedResult = Object.freeze({
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  const resultKeys = Object.freeze([
    'scope',
    'status',
    'cause',
    'sourceReferencesCleared',
    'sourceStopSettled',
  ]);
  const operations = () => Object.freeze({
    eventCount: audio.events.length,
    deadlineCount: audio.deadlines.length,
    sourceObjects: audio.context.sources.length,
    gainObjects: audio.context.gains.length,
    sourceAllocations: audio.events.filter(({ type }) => type === 'allocate-source').length,
    gainAllocations: audio.events.filter(({ type }) => type === 'allocate-gain').length,
    bufferAllocations: audio.events.filter(({ type }) => type === 'allocate-buffer').length,
    starts: audio.events.filter(({ type }) => type === 'start').length,
    stops: audio.events.filter(({ type }) => type === 'stop').length,
    sourceDisconnects: audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'source'
    )).length,
    gainDisconnects: audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'gain'
    )).length,
    resumes: audio.events.filter(({ type }) => type === 'resume').length,
    suspends: audio.events.filter(({ type }) => type === 'suspend').length,
    stopCalls: audio.context.sources.reduce((sum, source) => sum + source.stopCalls, 0),
    sourceDisconnectCalls: audio.context.sources.reduce(
      (sum, source) => sum + source.disconnectCalls,
      0,
    ),
    bufferClearCalls: audio.context.sources.reduce(
      (sum, source) => sum + source.bufferClearCalls,
      0,
    ),
    endedClearCalls: audio.context.sources.reduce(
      (sum, source) => sum + source.onendedClearCalls,
      0,
    ),
    gainDisconnectCalls: audio.context.gains.reduce(
      (sum, gain) => sum + gain.disconnectCalls,
      0,
    ),
  });
  const references = () => Object.freeze({
    sources: Object.freeze([...audio.context.sources]),
    gains: Object.freeze([...audio.context.gains]),
    buffers: Object.freeze(audio.context.sources.map(({ buffer }) => buffer)),
    callbacks: Object.freeze(audio.context.sources.map(({ onended }) => onended)),
    sourceConnections: Object.freeze(audio.context.sources.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    gainConnections: Object.freeze(audio.context.gains.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    stopTimes: Object.freeze(audio.context.sources.map(({ stopTime }) => stopTime)),
    stopCalls: Object.freeze(audio.context.sources.map(({ stopCalls }) => stopCalls)),
    sourceDisconnectCalls: Object.freeze(
      audio.context.sources.map(({ disconnectCalls }) => disconnectCalls),
    ),
    bufferClearCalls: Object.freeze(
      audio.context.sources.map(({ bufferClearCalls }) => bufferClearCalls),
    ),
    endedClearCalls: Object.freeze(
      audio.context.sources.map(({ onendedClearCalls }) => onendedClearCalls),
    ),
    gainDisconnectCalls: Object.freeze(
      audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
    ),
  });

  let replacementFailureCalls = 0;
  let replacementEventCalls = 0;
  const replacementOptions = Object.freeze({
    loadedSessionCapability: capability,
    sessionId: SESSION_ID,
    assertTerminalRecordReceipt: receipts.assert,
    createCleanupDeadline: audio.dependencies.createDeadline,
    failureInjector() { replacementFailureCalls += 1; },
    onEvent() { replacementEventCalls += 1; },
  });
  function assertReplacementBlocked(stage) {
    const before = Object.freeze({
      operations: operations(),
      references: references(),
      inspection: engine.inspect(),
    });
    assert.throws(
      () => createWebAudioEngine(replacementOptions),
      /loaded session capability is already bound to an engine/,
      stage,
    );
    assert.deepEqual(operations(), before.operations);
    assert.deepEqual(references(), before.references);
    assert.deepEqual(engine.inspect(), before.inspection);
    assert.equal(replacementFailureCalls, 0);
    assert.equal(replacementEventCalls, 0);
  }
  function assertTapBlocked(generationId, effectId, stage) {
    const before = Object.freeze({
      operations: operations(),
      references: references(),
      inspection: engine.inspect(),
    });
    assert.throws(
      () => engine.directTap(Object.freeze({
        sessionId: SESSION_ID,
        generationId,
        effectId,
        sourceId: `resume-pending-reject-blocked-${generationId}-${effectId}`,
        scheduledAudioTime: 10.7,
      })),
      /generation allocation is frozen/,
      stage,
    );
    assert.deepEqual(operations(), before.operations);
    assert.deepEqual(references(), before.references);
    assert.deepEqual(engine.inspect(), before.inspection);
  }
  async function assertBorrowBlocked(stage) {
    const before = Object.freeze({
      operations: operations(),
      references: references(),
      inspection: engine.inspect(),
    });
    let callbackCalls = 0;
    await assert.rejects(
      capability.borrowForGeneration(nextGenerationId, () => { callbackCalls += 1; }),
      (error) => error?.code === 'parallel-generation-borrow'
        && error?.message === 'parallel-generation-borrow',
      stage,
    );
    assert.equal(callbackCalls, 0);
    assert.deepEqual(operations(), before.operations);
    assert.deepEqual(references(), before.references);
    assert.deepEqual(engine.inspect(), before.inspection);
  }

  const deadlinesBefore = audio.deadlines.length;
  const tap = engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 280,
    sourceId: 'matrix-resume-pending-reject-source',
    scheduledAudioTime: 10.02,
  }));
  const observedTap = tap.settlement.then((result) => {
    tapLifecycle.push('tap-observed');
    return result;
  });
  const source = audio.context.sources[0];
  assert.notEqual(source, undefined);
  const callback = source.onended;
  const buffer = source.buffer;
  const connections = Object.freeze([...source.connections]);
  assert.equal(tap.reusedPendingResume, false);
  assert.equal(tap.resumeKey, `${SESSION_ID}:${GENERATION_ID}:280`);
  assert.equal(typeof callback, 'function');
  assert.notEqual(buffer, null);
  assert.equal(connections.length, 1);
  assert.equal(audio.context.state, 'suspended');
  assert.equal(operations().resumes, 1);
  assert.equal(operations().starts, 1);
  assert.equal(operations().sourceObjects, 1);
  assert.equal(operations().gainObjects, 5);

  const receipt = receipts.mint();
  const cleanup = engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 281,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  const observedCleanup = cleanup.then((result) => {
    cleanupLifecycle.push('cleanup-observed');
    return result;
  });
  assert.deepEqual(engine.inspect(), failedInspection);
  assert.equal(source.stopCalls, 1);
  assert.equal(source.stopTime, 10.525);
  assert.equal(source.ended, false);
  assert.equal(source.buffer, buffer);
  assert.equal(source.onended, callback);
  assert.deepEqual(source.connections, connections);
  assert.equal(source.disconnectCalls, 0);

  const cleanupDeadlines = audio.deadlines
    .slice(deadlinesBefore)
    .filter(({ kind }) => kind === 'generation-cleanup');
  assert.equal(cleanupDeadlines.length, 1);
  const [deadline] = cleanupDeadlines;
  assert.equal(deadline.milliseconds, 100);
  assert.equal(deadline.cancelled, false);
  let deadlineFireCalls = 0;
  const fire = deadline.fire;
  deadline.fire = () => {
    deadlineFireCalls += 1;
    cleanupLifecycle.push('deadline-fired');
    return Reflect.apply(fire, deadline, []);
  };

  const pendingBefore = Object.freeze({
    operations: operations(),
    references: references(),
    inspection: engine.inspect(),
  });
  const pendingReplay = engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 282,
    terminalRecordReceipt: receipt,
    audioNow: 10.51,
  }));
  assert.equal(pendingReplay, cleanup);
  assert.deepEqual(operations(), pendingBefore.operations);
  assert.deepEqual(references(), pendingBefore.references);
  assert.deepEqual(engine.inspect(), pendingBefore.inspection);
  await assertBorrowBlocked('resume and terminal cleanup pending');
  assertTapBlocked(GENERATION_ID, 283, 'pending current generation');
  assertTapBlocked(nextGenerationId, 284, 'pending next generation');
  assertReplacementBlocked('resume and terminal cleanup pending');
  assert.equal(operations().suspends, 0);
  assert.deepEqual(cleanupLifecycle, []);
  assert.deepEqual(tapLifecycle, []);

  audio.advanceTo(source.stopTime);
  assert.equal(source.ended, true);
  assertSourceReferencesClearedOnce(source);
  assert.equal(source.connections.length, 0);
  assert.equal(operations().suspends, 0);
  assert.deepEqual(cleanupLifecycle, [], 'cleanup observer remains pending behind its deadline');
  assert.deepEqual(tapLifecycle, [], 'startup observer remains pending behind resume');
  assert.equal(deadline.cancelled, false);

  const callbackBefore = Object.freeze({
    operations: operations(),
    references: references(),
    inspection: engine.inspect(),
    eventCount: emittedEvents.length,
  });
  assert.doesNotThrow(() => callback());
  assert.deepEqual(operations(), callbackBefore.operations);
  assert.deepEqual(references(), callbackBefore.references);
  assert.deepEqual(engine.inspect(), callbackBefore.inspection);
  assert.equal(emittedEvents.length, callbackBefore.eventCount);

  deadline.fire();
  const [cleanupResult, pendingReplayResult, observedCleanupResult] = await Promise.all([
    cleanup,
    pendingReplay,
    observedCleanup,
  ]);
  assert.equal(pendingReplayResult, cleanupResult);
  assert.equal(observedCleanupResult, cleanupResult);
  assert.equal(Object.isFrozen(cleanupResult), true);
  assert.deepEqual(Reflect.ownKeys(cleanupResult), resultKeys);
  assert.deepEqual(cleanupResult, expectedResult);
  assert.deepEqual(cleanupLifecycle, ['deadline-fired', 'deadline-cancelled', 'cleanup-observed']);
  assert.equal(deadlineFireCalls, 1);
  assert.equal(deadlineCancelCalls, 1);
  assert.equal(deadline.cancelled, true);
  assert.deepEqual(tapLifecycle, []);
  assert.deepEqual(engine.inspect(), failedInspection);
  assert.equal(audio.context.state, 'suspended');
  assert.equal(operations().suspends, 0);
  assertSourceReferencesClearedOnce(source);
  assert.ok(audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.deepEqual(emittedEvents, []);

  const ownership = Object.freeze({
    engine,
    loadedSessionCapability: capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receipt,
  });
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  for (const candidate of [
    { ...cleanupResult },
    Object.freeze({ ...cleanupResult }),
    new Proxy(cleanupResult, {}),
  ]) {
    assert.throws(
      () => assertGenerationCleanupResult(candidate, ownership),
      /genuine generation cleanup result/,
    );
  }
  assert.equal(claimGenerationCleanupResult(cleanupResult, ownership), true);
  assert.throws(
    () => claimGenerationCleanupResult(cleanupResult, ownership),
    /generation cleanup result already claimed/,
  );

  const replayBefore = Object.freeze({
    operations: operations(),
    references: references(),
    inspection: engine.inspect(),
  });
  const failedReplay = engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 285,
    terminalRecordReceipt: receipt,
    audioNow: 10.7,
  }));
  assert.equal(failedReplay, cleanup);
  const failedReplayResult = await failedReplay;
  assert.equal(failedReplayResult, cleanupResult);
  assert.deepEqual(operations(), replayBefore.operations);
  assert.deepEqual(references(), replayBefore.references);
  assert.deepEqual(engine.inspect(), replayBefore.inspection);

  const conflictingReceipt = receipts.mint();
  const conflictBefore = Object.freeze({
    operations: operations(),
    references: references(),
    inspection: engine.inspect(),
  });
  assert.throws(
    () => engine.terminateGeneration(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 286,
      terminalRecordReceipt: conflictingReceipt,
      audioNow: 10.8,
    })),
    /another generation termination owns the engine/,
  );
  assert.deepEqual(operations(), conflictBefore.operations);
  assert.deepEqual(references(), conflictBefore.references);
  assert.deepEqual(engine.inspect(), conflictBefore.inspection);

  const frozenResult = cleanupResult;
  const frozenOwnership = Object.freeze({ ...ownership });
  const evidence = () => Object.freeze({
    cleanupResult,
    pendingReplayResult,
    observedCleanupResult,
    failedReplayResult,
    inspection: engine.inspect(),
    emittedEvents,
  });
  const frozenEvidence = JSON.stringify(evidence());
  const lateBefore = Object.freeze({
    operations: operations(),
    references: references(),
    inspection: engine.inspect(),
    audioEvents: Object.freeze([...audio.events]),
    emittedEvents: Object.freeze([...emittedEvents]),
  });

  audio.resumeDeferred.reject(
    new Error('PRIVATE_MATRIX_RESUME_REJECTION_AFTER_TERMINAL_DEADLINE'),
  );
  await audio.suspendStarted.promise;
  assert.equal(audio.context.state, 'suspended');
  assert.equal(operations().resumes, 1);
  assert.equal(operations().suspends, 1);
  assert.deepEqual(audio.events, [...lateBefore.audioEvents, Object.freeze({ type: 'suspend' })]);
  assert.deepEqual(references(), lateBefore.references);
  assert.deepEqual(engine.inspect(), lateBefore.inspection);
  assert.deepEqual(emittedEvents, lateBefore.emittedEvents);
  assert.deepEqual(tapLifecycle, [], 'startup waits for stale-resume suspension');
  assert.equal(cleanupResult, frozenResult);
  assert.equal(JSON.stringify(evidence()), frozenEvidence);
  assert.deepEqual(ownership, frozenOwnership);
  assert.equal(deadlineFireCalls, 1);
  assert.equal(deadlineCancelCalls, 1);
  assert.deepEqual({
    ...operations(),
    eventCount: lateBefore.operations.eventCount,
    suspends: lateBefore.operations.suspends,
  }, lateBefore.operations);

  await assertBorrowBlocked('late resume suspension pending');
  assertTapBlocked(GENERATION_ID, 287, 'late reconciliation current generation');
  assertTapBlocked(nextGenerationId, 288, 'late reconciliation next generation');
  assertReplacementBlocked('late resume suspension pending');

  const suspendJoin = capability.suspend('matrix-resume-pending-reject-late-join');
  assert.equal(operations().suspends, 1);
  audio.suspendDeferred.resolve();
  const [tapSettlement, joinedSuspend] = await Promise.all([observedTap, suspendJoin]);
  assert.deepEqual(tapSettlement, { status: 'failed', cause: 'context-resume-failed' });
  assert.equal(joinedSuspend, true);
  assert.deepEqual(tapLifecycle, ['tap-observed']);
  assert.equal(audio.context.state, 'suspended');
  assert.equal(operations().suspends, 1);
  assert.equal(cleanupResult, frozenResult);
  assert.equal(JSON.stringify(evidence()), frozenEvidence);
  assert.deepEqual(ownership, frozenOwnership);
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  assert.throws(
    () => claimGenerationCleanupResult(cleanupResult, ownership),
    /generation cleanup result already claimed/,
  );
  assert.deepEqual(references(), lateBefore.references);
  assert.deepEqual(engine.inspect(), lateBefore.inspection);
  assert.deepEqual(emittedEvents, lateBefore.emittedEvents);
  assert.deepEqual(cleanupLifecycle, ['deadline-fired', 'deadline-cancelled', 'cleanup-observed']);
  assert.equal(deadlineFireCalls, 1);
  assert.equal(deadlineCancelCalls, 1);
  assertSourceReferencesClearedOnce(source);
  assert.ok(audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));

  const inertBefore = Object.freeze({
    operations: operations(),
    references: references(),
    inspection: engine.inspect(),
    eventCount: emittedEvents.length,
  });
  assert.doesNotThrow(() => callback());
  assert.deepEqual(operations(), inertBefore.operations);
  assert.deepEqual(references(), inertBefore.references);
  assert.deepEqual(engine.inspect(), inertBefore.inspection);
  assert.equal(emittedEvents.length, inertBefore.eventCount);

  const lateReplay = engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 289,
    terminalRecordReceipt: receipt,
    audioNow: 10.9,
  }));
  assert.equal(lateReplay, cleanup);
  assert.equal(await lateReplay, cleanupResult);
  assert.equal(JSON.stringify(evidence()), frozenEvidence);
  assert.equal(deadlineFireCalls, 1);
  assert.equal(deadlineCancelCalls, 1);
  assertSourceReferencesClearedOnce(source);

  assertTapBlocked(GENERATION_ID, 290, 'after late reject current generation');
  assertTapBlocked(nextGenerationId, 291, 'after late reject next generation');
  assertReplacementBlocked('after late resume rejection');

  let lowerBorrowCallbackCalls = 0;
  await assert.rejects(
    capability.borrowForGeneration(nextGenerationId, () => {
      lowerBorrowCallbackCalls += 1;
    }),
    (error) => error?.code === 'context-resume-failed'
      && error?.message === 'context-resume-failed',
    'released lower capability exclusion permits the borrow callback before resume re-rejects',
  );
  assert.equal(lowerBorrowCallbackCalls, 1);
  assert.equal(audio.context.state, 'suspended');
  assert.deepEqual(engine.inspect(), failedInspection);
  assert.equal(cleanupResult, frozenResult);
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  assert.equal(deadlineFireCalls, 1);
  assert.equal(deadlineCancelCalls, 1);
  assert.equal(operations().suspends, 1);
  assertSourceReferencesClearedOnce(source);
  assert.ok(audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assertTapBlocked(nextGenerationId, 292, 'after late-reject hygiene borrow availability');
  assertReplacementBlocked('after late-reject hygiene borrow availability');

  const final = operations();
  assert.deepEqual({
    deadlineCount: final.deadlineCount,
    sourceObjects: final.sourceObjects,
    gainObjects: final.gainObjects,
    sourceAllocations: final.sourceAllocations,
    gainAllocations: final.gainAllocations,
    bufferAllocations: final.bufferAllocations,
    starts: final.starts,
    stops: final.stops,
    sourceDisconnects: final.sourceDisconnects,
    gainDisconnects: final.gainDisconnects,
    resumes: final.resumes,
    suspends: final.suspends,
    stopCalls: final.stopCalls,
    sourceDisconnectCalls: final.sourceDisconnectCalls,
    bufferClearCalls: final.bufferClearCalls,
    endedClearCalls: final.endedClearCalls,
    gainDisconnectCalls: final.gainDisconnectCalls,
  }, {
    deadlineCount: deadlinesBefore + 1,
    sourceObjects: 1,
    gainObjects: 5,
    sourceAllocations: 1,
    gainAllocations: 5,
    bufferAllocations: 1,
    starts: 1,
    stops: 1,
    sourceDisconnects: 1,
    gainDisconnects: 5,
    resumes: 2,
    suspends: 1,
    stopCalls: 1,
    sourceDisconnectCalls: 1,
    bufferClearCalls: 1,
    endedClearCalls: 1,
    gainDisconnectCalls: 5,
  });

  const publicEvidence = Object.freeze({
    tapSettlement,
    cleanupResult,
    pendingReplayResult,
    observedCleanupResult,
    failedReplayResult,
    lateReplayResult: await lateReplay,
    inspection: engine.inspect(),
    emittedEvents,
  });
  const serializedPublicEvidence = JSON.stringify(publicEvidence);
  assert.doesNotMatch(serializedPublicEvidence, /private/i);
  assert.doesNotMatch(
    serializedPublicEvidence,
    /stale-generation-resume|context-suspend-failed|cleanup-timeout/i,
  );
});

test('T8-TX-MATRIX-RESUME-REJECT-BEFORE-DEADLINE', async () => {
  const emittedEvents = [];
  const fixture = await createFixture({
    audio: { resumeMode: 'deferred', suspendMode: 'deferred', stopEndedMode: 'none' },
    onEvent(event) { emittedEvents.push(event); },
  });
  const counts = () => Object.freeze({
    sources: fixture.audio.context.sources.length,
    gains: fixture.audio.context.gains.length,
    starts: fixture.audio.events.filter(({ type }) => type === 'start').length,
    stops: fixture.audio.events.filter(({ type }) => type === 'stop').length,
    disconnects: fixture.audio.events.filter(({ type }) => type === 'disconnect').length,
    suspends: fixture.audio.events.filter(({ type }) => type === 'suspend').length,
    deadlines: fixture.audio.deadlines.length,
  });
  const replacementOptions = () => ({
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    assertTerminalRecordReceipt: fixture.receipts.assert,
    createCleanupDeadline: fixture.audio.dependencies.createDeadline,
    failureInjector() {},
    onEvent() {},
  });

  const tap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 293,
    sourceId: 'matrix-resume-reject-before-deadline',
    scheduledAudioTime: 10.02,
  }));
  const source = fixture.audio.context.sources[0];
  const lateCallback = source.onended;
  assert.notEqual(source.startRecord, null);
  assert.equal(typeof lateCallback, 'function');

  const receipt = fixture.receipts.mint();
  const deadlinesBefore = fixture.audio.deadlines.length;
  const cleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 294,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  const pendingReplay = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 295,
    terminalRecordReceipt: receipt,
    audioNow: 10.501,
  }));
  assert.equal(pendingReplay, cleanup);
  fixture.audio.advanceTo(10.525);
  assert.equal(source.stopCalls, 1);
  assert.equal(source.ended, true);
  assert.equal(counts().suspends, 0);

  const cleanupDeadlines = fixture.audio.deadlines
    .slice(deadlinesBefore)
    .filter(({ kind }) => kind === 'generation-cleanup');
  assert.equal(cleanupDeadlines.length, 1);
  const [cleanupDeadline] = cleanupDeadlines;
  assert.equal(cleanupDeadline.milliseconds, 100);
  assert.equal(cleanupDeadline.cancelled, false);

  await assert.rejects(
    fixture.capability.borrowForGeneration(GENERATION_ID + 1, () => undefined),
    /parallel-generation-borrow/,
  );
  const pendingCounts = counts();
  for (const [generationId, effectId] of [[GENERATION_ID, 296], [GENERATION_ID + 1, 297]]) {
    assert.throws(() => fixture.engine.directTap(Object.freeze({
      sessionId: SESSION_ID,
      generationId,
      effectId,
      sourceId: `matrix-resume-reject-blocked-${generationId}`,
      scheduledAudioTime: 10.7,
    })), /allocation is frozen/);
  }
  assert.deepEqual(counts(), pendingCounts);
  assert.throws(() => createWebAudioEngine(replacementOptions()), /already bound to an engine/);

  let cleanupObserved = false;
  cleanup.then(() => { cleanupObserved = true; });
  fixture.audio.resumeDeferred.reject(new Error('PRIVATE_MATRIX_RESUME_REJECT'));
  await fixture.audio.suspendStarted.promise;
  assert.equal(counts().suspends, 1);
  assert.equal(cleanupObserved, false);
  assert.equal(cleanupDeadline.cancelled, false);

  fixture.audio.suspendDeferred.resolve();
  const [tapResult, cleanupResult, pendingReplayResult] = await Promise.all([
    tap.settlement,
    cleanup,
    pendingReplay,
  ]);
  assert.deepEqual(tapResult, { status: 'failed', cause: 'context-resume-failed' });
  assert.equal(pendingReplayResult, cleanupResult);
  assert.equal(Object.isFrozen(cleanupResult), true);
  assert.deepEqual(cleanupResult, {
    scope: 'generation',
    status: 'succeeded',
    cause: null,
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  assert.equal(cleanupDeadline.cancelled, true);
  assert.equal(counts().suspends, 1);

  const ownership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receipt,
  });
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  assert.equal(claimGenerationCleanupResult(cleanupResult, ownership), true);
  assert.throws(() => claimGenerationCleanupResult(cleanupResult, ownership), /already claimed/);
  assertSourceReferencesClearedOnce(source);
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.equal(fixture.engine.inspect().allocationFrozen, false);
  assert.equal(fixture.engine.inspect().generationId, null);

  const completedCounts = counts();
  const completedReplay = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 298,
    terminalRecordReceipt: receipt,
    audioNow: 10.8,
  }));
  assert.equal(completedReplay, cleanup);
  assert.equal(await completedReplay, cleanupResult);
  assert.deepEqual(counts(), completedCounts);

  const conflictingReceipt = fixture.receipts.mint();
  assert.throws(() => fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 299,
    terminalRecordReceipt: conflictingReceipt,
    audioNow: 10.81,
  })), /another generation termination owns the engine/);
  assert.deepEqual(counts(), completedCounts);

  const inspectionAfterCleanup = fixture.engine.inspect();
  const eventsBeforeLateCallback = emittedEvents.length;
  lateCallback();
  assert.deepEqual(fixture.engine.inspect(), inspectionAfterCleanup);
  assert.equal(emittedEvents.length, eventsBeforeLateCallback);
  assert.deepEqual(counts(), completedCounts);
  assert.throws(() => createWebAudioEngine(replacementOptions()), /already bound to an engine/);

  const publicEvidence = JSON.stringify(Object.freeze({
    tapResult,
    cleanupResult,
    pendingReplayResult,
    completedReplayResult: await completedReplay,
    inspection: fixture.engine.inspect(),
    emittedEvents,
  }));
  assert.doesNotMatch(publicEvidence, /private/i);
  assert.doesNotMatch(publicEvidence, /stale-generation-resume|context-suspend-failed|cleanup-timeout/i);
});

test('T8-TX-MATRIX-SOURCE-DEADLINE-LATE-CALLBACK', async () => {
  const nextGenerationId = GENERATION_ID + 1;
  const emittedEvents = [];
  const fixture = await createFixture({
    audio: { resumeMode: 'resolve', suspendMode: 'resolve', stopEndedMode: 'none' },
    onEvent(event) { emittedEvents.push(event); },
  });

  const failedInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  const expectedResult = Object.freeze({
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: false,
  });
  const resultKeys = Object.freeze([
    'scope',
    'status',
    'cause',
    'sourceReferencesCleared',
    'sourceStopSettled',
  ]);
  const operations = () => Object.freeze({
    eventCount: fixture.audio.events.length,
    deadlineCount: fixture.audio.deadlines.length,
    sourceObjects: fixture.audio.context.sources.length,
    gainObjects: fixture.audio.context.gains.length,
    sourceAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-source').length,
    gainAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-gain').length,
    bufferAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-buffer').length,
    starts: fixture.audio.events.filter(({ type }) => type === 'start').length,
    stops: fixture.audio.events.filter(({ type }) => type === 'stop').length,
    sourceDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'source'
    )).length,
    gainDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'gain'
    )).length,
    resumes: fixture.audio.events.filter(({ type }) => type === 'resume').length,
    suspends: fixture.audio.events.filter(({ type }) => type === 'suspend').length,
    sourceStopCalls: fixture.audio.context.sources.reduce(
      (sum, source) => sum + source.stopCalls,
      0,
    ),
    sourceDisconnectCalls: fixture.audio.context.sources.reduce(
      (sum, source) => sum + source.disconnectCalls,
      0,
    ),
    sourceBufferClearCalls: fixture.audio.context.sources.reduce(
      (sum, source) => sum + source.bufferClearCalls,
      0,
    ),
    sourceEndedClearCalls: fixture.audio.context.sources.reduce(
      (sum, source) => sum + source.onendedClearCalls,
      0,
    ),
    gainDisconnectCalls: fixture.audio.context.gains.reduce(
      (sum, gain) => sum + gain.disconnectCalls,
      0,
    ),
  });
  const references = () => Object.freeze({
    sourceObjects: Object.freeze([...fixture.audio.context.sources]),
    gainObjects: Object.freeze([...fixture.audio.context.gains]),
    sourceBuffers: Object.freeze(fixture.audio.context.sources.map(({ buffer }) => buffer)),
    sourceCallbacks: Object.freeze(fixture.audio.context.sources.map(({ onended }) => onended)),
    sourceConnections: Object.freeze(fixture.audio.context.sources.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    gainConnections: Object.freeze(fixture.audio.context.gains.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    sourceStopTimes: Object.freeze(
      fixture.audio.context.sources.map(({ stopTime }) => stopTime),
    ),
    sourceStopCalls: Object.freeze(
      fixture.audio.context.sources.map(({ stopCalls }) => stopCalls),
    ),
    sourceDisconnectCalls: Object.freeze(
      fixture.audio.context.sources.map(({ disconnectCalls }) => disconnectCalls),
    ),
    sourceBufferClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ bufferClearCalls }) => bufferClearCalls),
    ),
    sourceEndedClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ onendedClearCalls }) => onendedClearCalls),
    ),
    gainDisconnectCalls: Object.freeze(
      fixture.audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
    ),
  });
  const immutableSnapshot = () => Object.freeze({
    operations: operations(),
    references: references(),
    inspection: fixture.engine.inspect(),
    audioEvents: Object.freeze([...fixture.audio.events]),
    emittedEvents: Object.freeze([...emittedEvents]),
  });

  let replacementFailureCalls = 0;
  let replacementEventCalls = 0;
  const replacementOptions = Object.freeze({
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    assertTerminalRecordReceipt: fixture.receipts.assert,
    createCleanupDeadline: fixture.audio.dependencies.createDeadline,
    failureInjector() { replacementFailureCalls += 1; },
    onEvent() { replacementEventCalls += 1; },
  });
  function assertReplacementBlocked(stage) {
    const before = immutableSnapshot();
    assert.throws(
      () => createWebAudioEngine(replacementOptions),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message, 'loaded session capability is already bound to an engine');
        return true;
      },
      stage,
    );
    assert.deepEqual(immutableSnapshot(), before);
    assert.equal(replacementFailureCalls, 0);
    assert.equal(replacementEventCalls, 0);
  }
  function assertTapBlocked(generationId, effectId, stage) {
    const before = immutableSnapshot();
    assert.throws(
      () => fixture.engine.directTap(Object.freeze({
        sessionId: SESSION_ID,
        generationId,
        effectId,
        sourceId: `source-deadline-blocked-${generationId}-${effectId}`,
        scheduledAudioTime: 10.7,
      })),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message, 'generation allocation is frozen');
        return true;
      },
      stage,
    );
    assert.deepEqual(immutableSnapshot(), before);
  }
  async function assertLowerBorrowBlocked(stage) {
    const before = immutableSnapshot();
    let callbackCalls = 0;
    await assert.rejects(
      fixture.capability.borrowForGeneration(nextGenerationId, () => {
        callbackCalls += 1;
      }),
      (error) => error?.code === 'parallel-generation-borrow'
        && error?.message === 'parallel-generation-borrow',
      stage,
    );
    assert.equal(callbackCalls, 0);
    assert.deepEqual(immutableSnapshot(), before);
  }

  const deadlinesBefore = fixture.audio.deadlines.length;
  const tap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 300,
    sourceId: 'matrix-source-deadline-late-callback',
    scheduledAudioTime: 10.02,
  }));
  const source = fixture.audio.context.sources[0];
  assert.notEqual(source, undefined);
  assert.equal(source.startRecord?.when, 10.02);
  assert.equal(source.stopCalls, 0);
  assert.equal(source.ended, false);
  assert.equal(source.endedCallbackHistory.length, 1);
  const capturedEndedCallback = source.onended;
  const originalBuffer = source.buffer;
  const originalConnections = Object.freeze([...source.connections]);
  assert.equal(typeof capturedEndedCallback, 'function');
  assert.equal(source.endedCallbackHistory[0], capturedEndedCallback);
  assert.notEqual(originalBuffer, null);
  assert.equal(originalConnections.length, 1);
  assert.equal(fixture.audio.context.state, 'running');
  source.suppressEnded = true;

  const receipt = fixture.receipts.mint();
  const cleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 301,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  const pendingDuplicate = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 302,
    terminalRecordReceipt: receipt,
    audioNow: 10.501,
  }));
  assert.equal(pendingDuplicate, cleanup);
  assert.deepEqual(fixture.engine.inspect(), failedInspection);
  assert.equal(source.stopCalls, 1);
  assert.equal(source.stopTime, 10.525);
  assert.equal(source.ended, false);
  assert.equal(source.onended, capturedEndedCallback);
  assert.equal(source.buffer, originalBuffer);
  assert.deepEqual(source.connections, originalConnections);
  assert.equal(source.disconnectCalls, 0);

  const cleanupDeadlines = fixture.audio.deadlines
    .slice(deadlinesBefore)
    .filter(({ kind }) => kind === 'generation-cleanup');
  assert.equal(cleanupDeadlines.length, 1);
  const [cleanupDeadline] = cleanupDeadlines;
  assert.equal(cleanupDeadline.milliseconds, 100);
  assert.equal(cleanupDeadline.cancelled, false);
  let deadlineFireCalls = 0;
  const fireDeadline = cleanupDeadline.fire;
  cleanupDeadline.fire = () => {
    deadlineFireCalls += 1;
    return Reflect.apply(fireDeadline, cleanupDeadline, []);
  };

  let cleanupObserved = false;
  let tapObserved = false;
  cleanup.then(() => { cleanupObserved = true; });
  tap.settlement.then(() => { tapObserved = true; });
  assert.equal(cleanupObserved, false);
  assert.equal(tapObserved, false);
  fixture.audio.advanceTo(source.stopTime);
  assert.equal(source.ended, false, 'suppressed source settlement must remain pending at stop time');
  assert.equal(source.disconnectCalls, 0);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 0);

  await assertLowerBorrowBlocked('source waiter pending before its cleanup deadline');
  assertTapBlocked(GENERATION_ID, 303, 'source waiter pending / current generation');
  assertTapBlocked(nextGenerationId, 304, 'source waiter pending / next generation');
  assertReplacementBlocked('source waiter pending');
  assert.equal(cleanupObserved, false);
  assert.equal(tapObserved, false);
  assert.equal(deadlineFireCalls, 0);
  assert.equal(cleanupDeadline.cancelled, false);

  cleanupDeadline.fire();
  const [cleanupResult, duplicateResult, tapResult] = await Promise.all([
    cleanup,
    pendingDuplicate,
    tap.settlement,
  ]);
  assert.equal(deadlineFireCalls, 1);
  assert.equal(cleanupDeadline.cancelled, true);
  assert.equal(duplicateResult, cleanupResult);
  assert.deepEqual(tapResult, { status: 'failed', cause: 'schedule-failed' });
  assert.equal(Object.isFrozen(cleanupResult), true);
  assert.deepEqual(Reflect.ownKeys(cleanupResult), resultKeys);
  assert.deepEqual(cleanupResult, expectedResult);
  assert.equal(cleanupObserved, true);
  assert.equal(tapObserved, true);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assert.equal(fixture.audio.context.state, 'suspended');
  assert.deepEqual(fixture.engine.inspect(), failedInspection);
  assertSourceReferencesClearedOnce(source);
  assert.equal(source.connections.length, 0);
  assert.equal(source.ended, false);
  assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected));
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.ok(fixture.audio.context.gains.every(({ connections }) => connections.length === 0));
  assert.deepEqual(emittedEvents, []);

  const terminalOperations = operations();
  assert.deepEqual({
    deadlineCount: terminalOperations.deadlineCount,
    sourceObjects: terminalOperations.sourceObjects,
    gainObjects: terminalOperations.gainObjects,
    sourceAllocations: terminalOperations.sourceAllocations,
    gainAllocations: terminalOperations.gainAllocations,
    bufferAllocations: terminalOperations.bufferAllocations,
    starts: terminalOperations.starts,
    stops: terminalOperations.stops,
    sourceDisconnects: terminalOperations.sourceDisconnects,
    gainDisconnects: terminalOperations.gainDisconnects,
    resumes: terminalOperations.resumes,
    suspends: terminalOperations.suspends,
    sourceStopCalls: terminalOperations.sourceStopCalls,
    sourceDisconnectCalls: terminalOperations.sourceDisconnectCalls,
    sourceBufferClearCalls: terminalOperations.sourceBufferClearCalls,
    sourceEndedClearCalls: terminalOperations.sourceEndedClearCalls,
    gainDisconnectCalls: terminalOperations.gainDisconnectCalls,
  }, {
    deadlineCount: deadlinesBefore + 1,
    sourceObjects: 1,
    gainObjects: 5,
    sourceAllocations: 1,
    gainAllocations: 5,
    bufferAllocations: 1,
    starts: 1,
    stops: 1,
    sourceDisconnects: 1,
    gainDisconnects: 5,
    resumes: 1,
    suspends: 1,
    sourceStopCalls: 1,
    sourceDisconnectCalls: 1,
    sourceBufferClearCalls: 1,
    sourceEndedClearCalls: 1,
    gainDisconnectCalls: 5,
  });
  assert.deepEqual(references(), {
    sourceObjects: [source],
    gainObjects: [...fixture.audio.context.gains],
    sourceBuffers: [null],
    sourceCallbacks: [null],
    sourceConnections: [[]],
    gainConnections: [[], [], [], [], []],
    sourceStopTimes: [10.525],
    sourceStopCalls: [1],
    sourceDisconnectCalls: [1],
    sourceBufferClearCalls: [1],
    sourceEndedClearCalls: [1],
    gainDisconnectCalls: [1, 1, 1, 1, 1],
  });

  const ownership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receipt,
  });
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  assert.equal(claimGenerationCleanupResult(cleanupResult, ownership), true);
  assert.throws(
    () => claimGenerationCleanupResult(cleanupResult, ownership),
    /generation cleanup result already claimed/,
  );
  for (const candidate of [
    { ...cleanupResult },
    Object.freeze({ ...cleanupResult }),
    new Proxy(cleanupResult, {}),
  ]) {
    assert.throws(
      () => assertGenerationCleanupResult(candidate, ownership),
      /genuine generation cleanup result/,
    );
  }

  const beforeReplay = immutableSnapshot();
  const failedReplay = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 305,
    terminalRecordReceipt: receipt,
    audioNow: 10.8,
  }));
  assert.equal(failedReplay, cleanup);
  const failedReplayResult = await failedReplay;
  assert.equal(failedReplayResult, cleanupResult);
  assert.equal(assertGenerationCleanupResult(failedReplayResult, ownership), true);
  assert.deepEqual(immutableSnapshot(), beforeReplay);

  const conflictingReceipt = fixture.receipts.mint();
  const beforeConflict = immutableSnapshot();
  assert.throws(
    () => fixture.engine.terminateGeneration(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 306,
      terminalRecordReceipt: conflictingReceipt,
      audioNow: 10.81,
    })),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.equal(error.message, 'another generation termination owns the engine');
      return true;
    },
  );
  assert.deepEqual(immutableSnapshot(), beforeConflict);

  const frozenResultIdentity = cleanupResult;
  const frozenResultValue = JSON.stringify(cleanupResult);
  const frozenOwnership = Object.freeze({ ...ownership });
  const beforeLateCallbacks = immutableSnapshot();
  source.suppressEnded = false;
  assert.doesNotThrow(() => capturedEndedCallback());
  assert.doesNotThrow(() => capturedEndedCallback());
  assert.deepEqual(immutableSnapshot(), beforeLateCallbacks);
  assert.equal(cleanupResult, frozenResultIdentity);
  assert.equal(JSON.stringify(cleanupResult), frozenResultValue);
  assert.deepEqual(ownership, frozenOwnership);
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  assert.throws(
    () => claimGenerationCleanupResult(cleanupResult, ownership),
    /generation cleanup result already claimed/,
  );
  assert.equal(deadlineFireCalls, 1);
  assert.equal(cleanupDeadline.cancelled, true);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assertSourceReferencesClearedOnce(source);
  assert.equal(source.onended, null);
  assert.equal(source.buffer, null);
  assert.equal(source.connections.length, 0);
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.deepEqual(fixture.engine.inspect(), failedInspection);
  assert.deepEqual(emittedEvents, []);

  assertTapBlocked(GENERATION_ID, 307, 'after captured late callbacks / failed generation');
  assertTapBlocked(nextGenerationId, 308, 'after captured late callbacks / next generation');
  assertReplacementBlocked('after captured late callbacks');

  let lowerBorrowCallbackCalls = 0;
  await fixture.capability.borrowForGeneration(nextGenerationId, () => {
    lowerBorrowCallbackCalls += 1;
  });
  assert.equal(lowerBorrowCallbackCalls, 1);
  assert.equal(fixture.audio.context.state, 'running');
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'resume').length, 2);
  assert.equal(fixture.audio.events.filter(({ type }) => type === 'suspend').length, 1);
  assert.equal(cleanupResult, frozenResultIdentity);
  assert.equal(JSON.stringify(cleanupResult), frozenResultValue);
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  assertSourceReferencesClearedOnce(source);
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.deepEqual(fixture.engine.inspect(), failedInspection);
  assertTapBlocked(nextGenerationId, 309, 'after lower-layer borrow availability');
  assertReplacementBlocked('after lower-layer borrow availability');

  const finalOperations = operations();
  assert.deepEqual({
    ...finalOperations,
    eventCount: terminalOperations.eventCount,
    resumes: terminalOperations.resumes,
  }, terminalOperations);
  assert.equal(finalOperations.eventCount, terminalOperations.eventCount + 1);
  assert.equal(finalOperations.resumes, terminalOperations.resumes + 1);
  assert.equal(finalOperations.suspends, 1);
  assert.equal(finalOperations.sourceStopCalls, 1);
  assert.equal(finalOperations.sourceDisconnectCalls, 1);
  assert.equal(finalOperations.sourceBufferClearCalls, 1);
  assert.equal(finalOperations.sourceEndedClearCalls, 1);
  assert.equal(finalOperations.gainDisconnectCalls, 5);

  const publicEvidence = JSON.stringify(Object.freeze({
    tapResult,
    cleanupResult,
    duplicateResult,
    failedReplayResult,
    inspection: fixture.engine.inspect(),
    emittedEvents,
  }));
  assert.doesNotMatch(publicEvidence, /private/i);
  assert.doesNotMatch(
    publicEvidence,
    /stale-generation-resume|context-suspend-failed|cleanup-timeout|timeout/i,
  );
});

test('T8-TX-MATRIX-CLEANUP-FAULTS', async () => {
  const nextGenerationId = GENERATION_ID + 1;
  const resultKeys = Object.freeze([
    'scope',
    'status',
    'cause',
    'sourceReferencesCleared',
    'sourceStopSettled',
  ]);
  const failedInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });

  function captureCall(callback) {
    try {
      return Object.freeze({ value: callback(), error: null });
    } catch (error) {
      return Object.freeze({ value: null, error });
    }
  }

  async function runCleanupFaultScenario({ label, faultKind, suspendOutcome, effectBase }) {
    const emittedEvents = [];
    let deadlineCancelCalls = 0;
    let hookProbe = null;
    let stopFaultCalls = 0;
    const disconnectFaultCalls = { source: 0, gain: 0 };
    let audio = null;
    let loader = null;
    let capability = null;
    let receipts = null;
    let engine = null;
    let receipt = null;
    let conflictingReceipt = null;
    let replacementFailureCalls = 0;
    let replacementEventCalls = 0;

    const operations = () => Object.freeze({
      eventCount: audio.events.length,
      deadlineCount: audio.deadlines.length,
      sourceObjects: audio.context.sources.length,
      gainObjects: audio.context.gains.length,
      sourceAllocations: audio.events.filter(({ type }) => type === 'allocate-source').length,
      gainAllocations: audio.events.filter(({ type }) => type === 'allocate-gain').length,
      bufferAllocations: audio.events.filter(({ type }) => type === 'allocate-buffer').length,
      starts: audio.events.filter(({ type }) => type === 'start').length,
      stops: audio.events.filter(({ type }) => type === 'stop').length,
      sourceDisconnectAttempts: audio.events.filter((event) => (
        event.type === 'disconnect' && event.kind === 'source'
      )).length,
      gainDisconnectAttempts: audio.events.filter((event) => (
        event.type === 'disconnect' && event.kind === 'gain'
      )).length,
      resumes: audio.events.filter(({ type }) => type === 'resume').length,
      suspends: audio.events.filter(({ type }) => type === 'suspend').length,
      sourceStopCalls: audio.context.sources.reduce(
        (sum, source) => sum + source.stopCalls,
        0,
      ),
      sourceDisconnectCalls: audio.context.sources.reduce(
        (sum, source) => sum + source.disconnectCalls,
        0,
      ),
      sourceBufferClearCalls: audio.context.sources.reduce(
        (sum, source) => sum + source.bufferClearCalls,
        0,
      ),
      sourceEndedClearCalls: audio.context.sources.reduce(
        (sum, source) => sum + source.onendedClearCalls,
        0,
      ),
      gainDisconnectCalls: audio.context.gains.reduce(
        (sum, gain) => sum + gain.disconnectCalls,
        0,
      ),
    });
    const references = () => Object.freeze({
      sourceBuffers: Object.freeze(audio.context.sources.map(({ buffer }) => buffer)),
      sourceCallbacks: Object.freeze(audio.context.sources.map(({ onended }) => onended)),
      sourceConnections: Object.freeze(audio.context.sources.map(({ connections }) => (
        Object.freeze([...connections])
      ))),
      gainConnections: Object.freeze(audio.context.gains.map(({ connections }) => (
        Object.freeze([...connections])
      ))),
      sourceDisconnected: Object.freeze(
        audio.context.sources.map(({ disconnected }) => disconnected),
      ),
      gainDisconnected: Object.freeze(
        audio.context.gains.map(({ disconnected }) => disconnected),
      ),
      sourceStopCalls: Object.freeze(
        audio.context.sources.map(({ stopCalls }) => stopCalls),
      ),
      sourceDisconnectCalls: Object.freeze(
        audio.context.sources.map(({ disconnectCalls }) => disconnectCalls),
      ),
      sourceBufferClearCalls: Object.freeze(
        audio.context.sources.map(({ bufferClearCalls }) => bufferClearCalls),
      ),
      sourceEndedClearCalls: Object.freeze(
        audio.context.sources.map(({ onendedClearCalls }) => onendedClearCalls),
      ),
      gainDisconnectCalls: Object.freeze(
        audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
      ),
    });
    const immutableSnapshot = () => Object.freeze({
      operations: operations(),
      references: references(),
      inspection: engine.inspect(),
      audioEvents: Object.freeze([...audio.events]),
      emittedEvents: Object.freeze([...emittedEvents]),
    });
    const replacementOptions = () => ({
      loadedSessionCapability: capability,
      sessionId: SESSION_ID,
      assertTerminalRecordReceipt: receipts.assert,
      createCleanupDeadline: audio.dependencies.createDeadline,
      failureInjector() { replacementFailureCalls += 1; },
      onEvent() { replacementEventCalls += 1; },
    });

    function captureTap(generationId, effectId, stage) {
      const before = immutableSnapshot();
      const attempt = captureCall(() => engine.directTap(Object.freeze({
        sessionId: SESSION_ID,
        generationId,
        effectId,
        sourceId: `cleanup-fault-blocked-${label}-${generationId}-${effectId}`,
        scheduledAudioTime: 10.7,
      })));
      const after = immutableSnapshot();
      return Object.freeze({ stage, before, attempt, after });
    }

    function captureReplacement(stage) {
      const before = immutableSnapshot();
      const attempt = captureCall(() => createWebAudioEngine(replacementOptions()));
      const after = immutableSnapshot();
      return Object.freeze({ stage, before, attempt, after });
    }

    function captureConflict(effectId, stage) {
      const before = immutableSnapshot();
      const attempt = captureCall(() => engine.terminateGeneration(Object.freeze({
        sessionId: SESSION_ID,
        generationId: GENERATION_ID,
        effectId,
        terminalRecordReceipt: conflictingReceipt,
        audioNow: 10.51,
      })));
      const after = immutableSnapshot();
      return Object.freeze({ stage, before, attempt, after });
    }

    function captureDuplicate(effectId, stage) {
      const before = immutableSnapshot();
      const attempt = captureCall(() => engine.terminateGeneration(Object.freeze({
        sessionId: SESSION_ID,
        generationId: GENERATION_ID,
        effectId,
        terminalRecordReceipt: receipt,
        audioNow: 10.501,
      })));
      const after = immutableSnapshot();
      return Object.freeze({ stage, before, attempt, after });
    }

    function captureLowerBorrow(stage) {
      const before = immutableSnapshot();
      let callbackCalls = 0;
      const settlement = capability.borrowForGeneration(nextGenerationId, () => {
        callbackCalls += 1;
      }).then(
        () => Object.freeze({ status: 'succeeded', cause: null }),
        (error) => Object.freeze({ status: 'failed', cause: error?.message }),
      );
      const after = immutableSnapshot();
      return Object.freeze({
        stage,
        before,
        after,
        settlement,
        callbackCalls: () => callbackCalls,
      });
    }

    function enterFaultHook(node) {
      if (hookProbe !== null) return;
      hookProbe = Object.freeze({
        node,
        inspection: engine.inspect(),
        duplicate: captureDuplicate(effectBase + 2, `${label}: fault hook duplicate`),
        conflict: captureConflict(effectBase + 3, `${label}: fault hook conflict`),
        currentTap: captureTap(
          GENERATION_ID,
          effectBase + 4,
          `${label}: fault hook current generation`,
        ),
        nextTap: captureTap(
          nextGenerationId,
          effectBase + 5,
          `${label}: fault hook next generation`,
        ),
        replacement: captureReplacement(`${label}: fault hook replacement engine`),
        lowerBorrow: captureLowerBorrow(`${label}: fault hook lower borrow`),
      });
    }

    audio = createFakeAudioHarness({
      resumeMode: 'deferred',
      suspendMode: 'deferred',
      stopEndedMode: faultKind === 'disconnect' ? 'sync' : 'none',
      onStop(source) {
        if (faultKind !== 'stop') return;
        stopFaultCalls += 1;
        enterFaultHook(source);
        throw new Error(`PRIVATE_${label.toUpperCase()}_STOP_FAULT`);
      },
      onDisconnect(node) {
        if (faultKind !== 'disconnect') return;
        if (node.kind === 'source' || node.kind === 'gain') {
          disconnectFaultCalls[node.kind] += 1;
        }
        enterFaultHook(node);
        throw new Error(`PRIVATE_${label.toUpperCase()}_${node.kind.toUpperCase()}_DISCONNECT`);
      },
    });
    loader = createLocalTrackLoader(audio.dependencies);
    capability = await loader.load({
      file: audio.file,
      loadedSessionId: `loaded-session-cleanup-fault-${label}`,
    });
    receipts = createReceiptAuthority();
    engine = createWebAudioEngine({
      loadedSessionCapability: capability,
      sessionId: SESSION_ID,
      assertTerminalRecordReceipt: receipts.assert,
      createCleanupDeadline(kind, milliseconds) {
        const deadline = audio.dependencies.createDeadline(kind, milliseconds);
        const cancel = deadline.cancel;
        deadline.cancel = () => {
          deadlineCancelCalls += 1;
          return Reflect.apply(cancel, deadline, []);
        };
        return deadline;
      },
      failureInjector() {},
      onEvent(event) { emittedEvents.push(event); },
    });

    const deadlinesBefore = audio.deadlines.length;
    const tap = engine.directTap(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: effectBase,
      sourceId: `matrix-cleanup-fault-${label}`,
      scheduledAudioTime: 10.02,
    }));
    const source = audio.context.sources[0];
    const callback = source.onended;
    const buffer = source.buffer;
    const sourceConnections = Object.freeze([...source.connections]);
    const gainConnections = Object.freeze(audio.context.gains.map(({ connections }) => (
      Object.freeze([...connections])
    )));
    assert.equal(tap.reusedPendingResume, false, `${label}: initial resume must be genuine`);
    assert.equal(tap.resumeKey, `${SESSION_ID}:${GENERATION_ID}:${effectBase}`);
    assert.equal(typeof callback, 'function', `${label}: source callback authority must exist`);
    assert.equal(source.endedCallbackHistory.length, 1, `${label}: callback authority is singular`);
    assert.equal(source.endedCallbackHistory[0], callback, `${label}: exact callback is captured`);
    assert.notEqual(buffer, null, `${label}: source buffer must be owned before cleanup`);
    assert.equal(sourceConnections.length, 1, `${label}: source starts connected`);
    assert.ok(gainConnections.every((connections) => connections.length === 1));
    assert.deepEqual(operations(), {
      eventCount: audio.events.length,
      deadlineCount: deadlinesBefore,
      sourceObjects: 1,
      gainObjects: 5,
      sourceAllocations: 1,
      gainAllocations: 5,
      bufferAllocations: 1,
      starts: 1,
      stops: 0,
      sourceDisconnectAttempts: 0,
      gainDisconnectAttempts: 0,
      resumes: 1,
      suspends: 0,
      sourceStopCalls: 0,
      sourceDisconnectCalls: 0,
      sourceBufferClearCalls: 0,
      sourceEndedClearCalls: 0,
      gainDisconnectCalls: 0,
    });

    receipt = receipts.mint();
    conflictingReceipt = receipts.mint();
    const cleanup = engine.terminateGeneration(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: effectBase + 1,
      terminalRecordReceipt: receipt,
      audioNow: 10.5,
    }));
    assert.notEqual(hookProbe, null, `${label}: selected fault hook must run during cleanup`);
    assert.equal(hookProbe.inspection.allocationFrozen, true, `${label}: hook sees frozen engine`);
    assert.equal(hookProbe.inspection.generationId, null, `${label}: hook sees no public generation`);

    function assertCallbackAdmissionBlocked(captured, errorMessage) {
      assert.equal(captured.attempt.value, null, captured.stage);
      assert.equal(captured.attempt.error instanceof TypeError, true, captured.stage);
      assert.equal(captured.attempt.error.message, errorMessage, captured.stage);
      assert.deepEqual(captured.after, captured.before, `${captured.stage}: no mutation`);
    }
    function assertCapturedTapBlocked(captured) {
      assert.equal(captured.attempt.value, null, captured.stage);
      assert.equal(captured.attempt.error instanceof TypeError, true, captured.stage);
      assert.equal(captured.attempt.error.message, 'generation allocation is frozen', captured.stage);
      assert.deepEqual(captured.after, captured.before, `${captured.stage}: no mutation or allocation`);
    }
    function assertCapturedReplacementBlocked(captured) {
      assert.equal(captured.attempt.value, null, captured.stage);
      assert.equal(captured.attempt.error instanceof TypeError, true, captured.stage);
      assert.equal(
        captured.attempt.error.message,
        'loaded session capability is already bound to an engine',
        captured.stage,
      );
      assert.deepEqual(captured.after, captured.before, `${captured.stage}: no mutation`);
      assert.equal(replacementFailureCalls, 0);
      assert.equal(replacementEventCalls, 0);
    }
    function assertCapturedConflictBlocked(captured) {
      assert.equal(captured.attempt.value, null, captured.stage);
      assert.equal(captured.attempt.error instanceof TypeError, true, captured.stage);
      assert.equal(
        captured.attempt.error.message,
        'another generation termination owns the engine',
        captured.stage,
      );
      assert.deepEqual(captured.after, captured.before, `${captured.stage}: no mutation`);
    }
    function assertCapturedDuplicate(captured, expectedPromise) {
      assert.equal(captured.attempt.error, null, captured.stage);
      assert.equal(captured.attempt.value, expectedPromise, captured.stage);
      assert.deepEqual(captured.after, captured.before, `${captured.stage}: no mutation`);
    }
    async function assertCapturedBorrowBlocked(captured) {
      assert.deepEqual(await captured.settlement, {
        status: 'failed',
        cause: 'parallel-generation-borrow',
      }, captured.stage);
      assert.equal(captured.callbackCalls(), 0, captured.stage);
      assert.deepEqual(captured.after, captured.before, `${captured.stage}: no mutation`);
    }
    async function assertActiveGuards(stage, offset) {
      const duplicate = captureDuplicate(effectBase + offset, `${label}: ${stage} duplicate`);
      const conflict = captureConflict(effectBase + offset + 1, `${label}: ${stage} conflict`);
      const currentTap = captureTap(
        GENERATION_ID,
        effectBase + offset + 2,
        `${label}: ${stage} current tap`,
      );
      const nextTap = captureTap(
        nextGenerationId,
        effectBase + offset + 3,
        `${label}: ${stage} next tap`,
      );
      const replacement = captureReplacement(`${label}: ${stage} replacement engine`);
      const lowerBorrow = captureLowerBorrow(`${label}: ${stage} lower borrow`);
      assertCapturedDuplicate(duplicate, cleanup);
      assertCapturedConflictBlocked(conflict);
      assertCapturedTapBlocked(currentTap);
      assertCapturedTapBlocked(nextTap);
      assertCapturedReplacementBlocked(replacement);
      await assertCapturedBorrowBlocked(lowerBorrow);
    }

    if (faultKind === 'disconnect') {
      assertCallbackAdmissionBlocked(
        hookProbe.duplicate,
        'generation termination request is invalid',
      );
      assertCallbackAdmissionBlocked(
        hookProbe.conflict,
        'generation termination request is invalid',
      );
      assertCallbackAdmissionBlocked(hookProbe.currentTap, 'direct tap request is not closed');
      assertCallbackAdmissionBlocked(hookProbe.nextTap, 'direct tap request is not closed');
    } else {
      assertCapturedDuplicate(hookProbe.duplicate, cleanup);
      assertCapturedConflictBlocked(hookProbe.conflict);
      assertCapturedTapBlocked(hookProbe.currentTap);
      assertCapturedTapBlocked(hookProbe.nextTap);
    }
    assertCapturedReplacementBlocked(hookProbe.replacement);
    await assertCapturedBorrowBlocked(hookProbe.lowerBorrow);

    const cleanupDeadlines = audio.deadlines
      .slice(deadlinesBefore)
      .filter(({ kind }) => kind === 'generation-cleanup');
    assert.equal(cleanupDeadlines.length, 1, `${label}: cleanup owns one bounded deadline`);
    const [deadline] = cleanupDeadlines;
    assert.equal(deadline.milliseconds, 100, `${label}: cleanup deadline remains bounded`);
    assert.equal(deadline.cancelled, false, `${label}: pending cleanup retains deadline`);
    assert.equal(deadlineCancelCalls, 0, `${label}: pending deadline is not cancelled early`);
    assert.deepEqual(engine.inspect(), failedInspection, `${label}: cleanup owns frozen authority`);
    assert.equal(source.stopCalls, 1, `${label}: source stop is attempted once`);
    assert.equal(source.disconnectCalls, 1, `${label}: source disconnect is attempted once`);
    assert.equal(source.onendedClearCalls, 1, `${label}: callback reference clears once`);
    assert.equal(source.bufferClearCalls, 1, `${label}: buffer reference clears once`);
    assert.equal(source.onended, null, `${label}: callback reference is cleared`);
    assert.equal(source.buffer, null, `${label}: buffer reference is cleared`);
    assert.deepEqual(
      audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
      [1, 1, 1, 1, 1],
      `${label}: graph disconnect is attempted exactly once per node`,
    );
    assert.deepEqual(emittedEvents, [], `${label}: revoked callback emits no event`);

    if (faultKind === 'stop') {
      assert.equal(stopFaultCalls, 1, `${label}: private stop fault is injected once`);
      assert.deepEqual(disconnectFaultCalls, { source: 0, gain: 0 });
      assert.equal(source.ended, false, `${label}: throwing stop did not claim native settlement`);
      assert.equal(source.disconnected, true, `${label}: source disconnect still completes`);
      assert.deepEqual(source.connections, [], `${label}: source native connection is released`);
      assert.ok(audio.context.gains.every(({ disconnected }) => disconnected));
      assert.ok(audio.context.gains.every(({ connections }) => connections.length === 0));
    } else {
      assert.equal(stopFaultCalls, 0);
      assert.deepEqual(
        disconnectFaultCalls,
        { source: 1, gain: 5 },
        `${label}: every native disconnect attempt throws once`,
      );
      assert.equal(source.ended, true, `${label}: source stop itself settled`);
      assert.equal(source.disconnected, false, `${label}: fake proves native source release failed`);
      assert.deepEqual(
        source.connections,
        sourceConnections,
        `${label}: failed native source disconnect retains its connection`,
      );
      assert.ok(audio.context.gains.every(({ disconnected }) => !disconnected));
      assert.deepEqual(
        audio.context.gains.map(({ connections }) => connections),
        gainConnections,
        `${label}: failed native graph disconnects retain connections`,
      );
    }

    await assertActiveGuards('source/graph/borrow cleanup active', 10);
    assert.equal(deadline.cancelled, false);
    assert.equal(deadlineCancelCalls, 0);

    audio.resumeDeferred.resolve();
    await audio.suspendStarted.promise;
    assert.equal(audio.events.filter(({ type }) => type === 'suspend').length, 1);
    assert.equal(deadline.cancelled, false, `${label}: suspend pending remains deadline-bounded`);
    assert.equal(deadlineCancelCalls, 0);
    assert.deepEqual(engine.inspect(), failedInspection);
    await assertActiveGuards('suspend reconciliation active', 20);

    const suspendDuplicate = captureDuplicate(
      effectBase + 30,
      `${label}: suspend-active same-receipt duplicate`,
    );
    assertCapturedDuplicate(suspendDuplicate, cleanup);
    if (suspendOutcome === 'resolve') {
      audio.suspendDeferred.resolve();
    } else {
      audio.suspendDeferred.reject(new Error(`PRIVATE_${label.toUpperCase()}_SUSPEND_REJECT`));
    }

    const hookDuplicateSettlement = faultKind === 'stop'
      ? hookProbe.duplicate.attempt.value
      : Promise.resolve(null);
    const [
      tapResult,
      cleanupResult,
      hookDuplicateResult,
      suspendDuplicateResult,
    ] = await Promise.all([
      tap.settlement,
      cleanup,
      hookDuplicateSettlement,
      suspendDuplicate.attempt.value,
    ]);
    assert.deepEqual(tapResult, { status: 'failed', cause: 'schedule-failed' });
    if (faultKind === 'stop') {
      assert.equal(hookDuplicateResult, cleanupResult, `${label}: pending hook replay shares result`);
    } else {
      assert.equal(hookDuplicateResult, null, `${label}: callback-bound hook replay is rejected`);
    }
    assert.equal(suspendDuplicateResult, cleanupResult, `${label}: pending suspend replay shares result`);
    assert.equal(Object.isFrozen(cleanupResult), true, `${label}: cleanup result is frozen`);
    assert.deepEqual(Reflect.ownKeys(cleanupResult), resultKeys, `${label}: result contract is closed`);
    assert.equal(cleanupResult.sourceReferencesCleared, true, `${label}: engine references are cleared`);
    assert.equal(deadline.cancelled, true, `${label}: bounded deadline is cancelled after settlement`);
    assert.equal(deadlineCancelCalls, 1, `${label}: bounded deadline is cancelled exactly once`);
    assert.equal(audio.events.filter(({ type }) => type === 'suspend').length, 1);
    assert.equal(source.stopCalls, 1);
    assert.equal(source.disconnectCalls, 1);
    assert.equal(source.onendedClearCalls, 1);
    assert.equal(source.bufferClearCalls, 1);
    assert.deepEqual(audio.context.gains.map(({ disconnectCalls }) => disconnectCalls), [1, 1, 1, 1, 1]);
    const inspectionAfterCleanup = engine.inspect();
    assert.equal(inspectionAfterCleanup.generationId, null);
    assert.equal(inspectionAfterCleanup.pendingResumeKey, null);
    assert.equal(inspectionAfterCleanup.graphCreated, false);
    assert.deepEqual(inspectionAfterCleanup.predictions, []);
    assert.equal(inspectionAfterCleanup.track, null);

    const ownership = Object.freeze({
      engine,
      loadedSessionCapability: capability,
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      terminalRecordReceipt: receipt,
    });
    assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
    for (const candidate of [
      { ...cleanupResult },
      Object.freeze({ ...cleanupResult }),
      new Proxy(cleanupResult, {}),
    ]) {
      assert.throws(
        () => assertGenerationCleanupResult(candidate, ownership),
        /genuine generation cleanup result/,
      );
    }
    assert.equal(claimGenerationCleanupResult(cleanupResult, ownership), true);
    assert.throws(
      () => claimGenerationCleanupResult(cleanupResult, ownership),
      /generation cleanup result already claimed/,
    );

    const beforeReplay = immutableSnapshot();
    const completedReplay = engine.terminateGeneration(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: effectBase + 31,
      terminalRecordReceipt: receipt,
      audioNow: 10.8,
    }));
    assert.equal(completedReplay, cleanup, `${label}: completed replay preserves promise identity`);
    const completedReplayResult = await completedReplay;
    assert.equal(completedReplayResult, cleanupResult, `${label}: completed replay preserves result`);
    assert.equal(assertGenerationCleanupResult(completedReplayResult, ownership), true);
    assert.deepEqual(immutableSnapshot(), beforeReplay, `${label}: completed replay is inert`);

    const completedConflict = captureConflict(
      effectBase + 32,
      `${label}: completed conflicting receipt`,
    );
    assertCapturedConflictBlocked(completedConflict);
    assertCapturedReplacementBlocked(captureReplacement(`${label}: completed replacement engine`));

    const frozenResultValue = JSON.stringify(cleanupResult);
    const beforeLateCallback = immutableSnapshot();
    assert.doesNotThrow(() => callback());
    assert.doesNotThrow(() => callback());
    assert.deepEqual(immutableSnapshot(), beforeLateCallback, `${label}: revoked callback is inert`);
    assert.equal(JSON.stringify(cleanupResult), frozenResultValue, `${label}: result cannot be rewritten`);
    assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
    assert.throws(
      () => claimGenerationCleanupResult(cleanupResult, ownership),
      /generation cleanup result already claimed/,
    );
    assert.deepEqual(emittedEvents, [], `${label}: cleanup callbacks remain silent`);

    const final = operations();
    assert.deepEqual({
      deadlineCount: final.deadlineCount,
      sourceObjects: final.sourceObjects,
      gainObjects: final.gainObjects,
      sourceAllocations: final.sourceAllocations,
      gainAllocations: final.gainAllocations,
      bufferAllocations: final.bufferAllocations,
      starts: final.starts,
      stops: final.stops,
      sourceDisconnectAttempts: final.sourceDisconnectAttempts,
      gainDisconnectAttempts: final.gainDisconnectAttempts,
      resumes: final.resumes,
      suspends: final.suspends,
      sourceStopCalls: final.sourceStopCalls,
      sourceDisconnectCalls: final.sourceDisconnectCalls,
      sourceBufferClearCalls: final.sourceBufferClearCalls,
      sourceEndedClearCalls: final.sourceEndedClearCalls,
      gainDisconnectCalls: final.gainDisconnectCalls,
    }, {
      deadlineCount: deadlinesBefore + 1,
      sourceObjects: 1,
      gainObjects: 5,
      sourceAllocations: 1,
      gainAllocations: 5,
      bufferAllocations: 1,
      starts: 1,
      stops: 1,
      sourceDisconnectAttempts: 1,
      gainDisconnectAttempts: 5,
      resumes: 1,
      suspends: 1,
      sourceStopCalls: 1,
      sourceDisconnectCalls: 1,
      sourceBufferClearCalls: 1,
      sourceEndedClearCalls: 1,
      gainDisconnectCalls: 5,
    }, `${label}: operation attempts remain exact`);

    const publicEvidence = JSON.stringify(Object.freeze({
      tapResult,
      cleanupResult,
      hookDuplicateResult,
      suspendDuplicateResult,
      completedReplayResult,
      inspection: engine.inspect(),
      emittedEvents,
    }));
    assert.doesNotMatch(publicEvidence, /private/i, `${label}: private exceptions must not leak`);
    assert.doesNotMatch(
      publicEvidence,
      /stale-generation-resume|context-suspend-failed|cleanup-timeout|timeout/i,
      `${label}: internal reconciliation causes must not leak`,
    );

    return Object.freeze({
      label,
      engine,
      capability,
      cleanup,
      cleanupResult,
      expectedResult: Object.freeze({
        scope: 'generation',
        status: 'failed',
        cause: 'source-stop-failed',
        sourceReferencesCleared: true,
        sourceStopSettled: faultKind !== 'stop',
      }),
      finalInspection: engine.inspect(),
      captureTap,
      captureReplacement,
      assertCapturedTapBlocked,
      assertCapturedReplacementBlocked,
    });
  }

  function assertFailedScenario(scenario, effectOffset) {
    assert.deepEqual(
      scenario.cleanupResult,
      scenario.expectedResult,
      `${scenario.label}: cleanup faults must fail closed as source-stop-failed`,
    );
    assert.deepEqual(
      scenario.finalInspection,
      failedInspection,
      `${scenario.label}: failed cleanup authority must remain frozen`,
    );
    scenario.assertCapturedTapBlocked(scenario.captureTap(
      GENERATION_ID,
      effectOffset,
      `${scenario.label}: failed current-generation admission`,
    ));
    scenario.assertCapturedTapBlocked(scenario.captureTap(
      nextGenerationId,
      effectOffset + 1,
      `${scenario.label}: failed next-generation admission`,
    ));
    scenario.assertCapturedReplacementBlocked(
      scenario.captureReplacement(`${scenario.label}: failed replacement engine`),
    );
  }

  const stopFault = await runCleanupFaultScenario({
    label: 'stop-resolve',
    faultKind: 'stop',
    suspendOutcome: 'resolve',
    effectBase: 330,
  });
  const disconnectFault = await runCleanupFaultScenario({
    label: 'disconnect-resolve',
    faultKind: 'disconnect',
    suspendOutcome: 'resolve',
    effectBase: 370,
  });
  const disconnectSuspendReject = await runCleanupFaultScenario({
    label: 'disconnect-suspend-reject',
    faultKind: 'disconnect',
    suspendOutcome: 'reject',
    effectBase: 410,
  });

  assertFailedScenario(stopFault, 450);
  assertFailedScenario(disconnectSuspendReject, 460);
  assertFailedScenario(disconnectFault, 470);
});

test('T8-TX-OWNERSHIP-INVARIANT-ORACLE', async () => {
  const emittedEvents = [];
  const fixture = await createFixture({
    audio: { resumeMode: 'deferred', suspendMode: 'reject', stopEndedMode: 'none' },
    onEvent(event) { emittedEvents.push(event); },
  });
  const tap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 480,
    sourceId: 'ownership-invariant-oracle-source',
    scheduledAudioTime: 10.02,
  }));
  const source = fixture.audio.context.sources[0];
  const capturedEndedCallback = source.onended;
  assert.equal(typeof capturedEndedCallback, 'function');

  const receipt = fixture.receipts.mint();
  const cleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 481,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  const cleanupDeadlines = fixture.audio.deadlines.filter(({ kind }) => (
    kind === 'generation-cleanup'
  ));
  assert.equal(cleanupDeadlines.length, 1);
  const [cleanupDeadline] = cleanupDeadlines;
  assert.equal(cleanupDeadline.milliseconds, 100);
  assert.equal(cleanupDeadline.cancelled, false);

  let tapSettlementObserved = false;
  let cleanupSettlementObserved = false;
  const observedTapSettlement = tap.settlement.then((result) => {
    tapSettlementObserved = true;
    return result;
  });
  const observedCleanupSettlement = cleanup.then((result) => {
    cleanupSettlementObserved = true;
    return result;
  });

  fixture.audio.advanceTo(source.stopTime);
  assert.equal(source.ended, true);
  assert.equal(tapSettlementObserved, false);
  assert.equal(cleanupSettlementObserved, false);
  fixture.audio.resumeDeferred.resolve();
  await fixture.audio.suspendStarted.promise;

  const [tapResult, cleanupResult] = await Promise.all([
    observedTapSettlement,
    observedCleanupSettlement,
  ]);
  assert.deepEqual(tapResult, { status: 'failed', cause: 'schedule-failed' });
  assert.equal(Object.isFrozen(cleanupResult), true);
  assert.deepEqual(cleanupResult, {
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  assert.equal(cleanupDeadline.cancelled, true);
  assert.equal(tapSettlementObserved, true);
  assert.equal(cleanupSettlementObserved, true);
  assert.equal(await tap.settlement, tapResult);
  assert.equal(await cleanup, cleanupResult);

  assert.equal(source.stopCalls, 1);
  assert.equal(source.disconnectCalls, 1);
  assert.equal(source.onendedClearCalls, 1);
  assert.equal(source.bufferClearCalls, 1);
  assert.equal(source.disconnected, true);
  assert.equal(source.onended, null);
  assert.equal(source.buffer, null);
  assert.deepEqual(source.connections, []);
  assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected));
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.ok(fixture.audio.context.gains.every(({ connections }) => connections.length === 0));
  assert.deepEqual(emittedEvents, []);

  const failedInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  assert.deepEqual(fixture.engine.inspect(), failedInspection);
  assert.doesNotThrow(() => capturedEndedCallback());
  assert.deepEqual(fixture.engine.inspect(), failedInspection);
  assert.throws(() => fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID + 1,
    effectId: 482,
    sourceId: 'ownership-oracle-frozen-admission',
    scheduledAudioTime: 10.7,
  })), /generation allocation is frozen/);

  const checkpointLabels = fixture.audio.ownershipCheckpointLabels();
  const checkpointCounts = fixture.audio.ownershipCheckpointCounts();
  assert.equal(Object.isFrozen(checkpointLabels), true);
  assert.equal(Object.isFrozen(checkpointCounts), true);
  assert.equal(
    checkpointCounts['ownership:before-compaction-asserted'],
    1,
    `before-compaction checker checkpoint count must be exactly one; observed ${checkpointCounts['ownership:before-compaction-asserted']}; after-compaction observed ${checkpointCounts['ownership:after-compaction-asserted']}`,
  );
  assert.equal(
    checkpointCounts['ownership:after-compaction-asserted'],
    1,
    'after-compaction checker checkpoint count must be exactly one',
  );
  assert.deepEqual(checkpointLabels, [
    'ownership:before-compaction-asserted',
    'ownership:after-compaction-asserted',
  ]);
});

test('T8-TX-TERMINAL-TOMBSTONE-METADATA-ONLY', async () => {
  const emittedEvents = [];
  const fixture = await createFixture({
    audio: {
      resumeMode: 'deferred',
      suspendMode: 'deferred',
      stopEndedMode: 'none',
    },
    onEvent(event) { emittedEvents.push(event); },
  });
  const nextGenerationId = GENERATION_ID + 1;
  const frozenInspection = Object.freeze({
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  const expectedResult = Object.freeze({
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  const zeroCheckpointCounts = Object.freeze({
    'ownership:before-compaction-asserted': 0,
    'ownership:after-compaction-asserted': 0,
  });
  const completedCheckpointCounts = Object.freeze({
    'ownership:before-compaction-asserted': 1,
    'ownership:after-compaction-asserted': 1,
  });
  const completedCheckpointLabels = Object.freeze([
    'ownership:before-compaction-asserted',
    'ownership:after-compaction-asserted',
  ]);

  const operationCounts = () => Object.freeze({
    eventCount: fixture.audio.events.length,
    deadlineCount: fixture.audio.deadlines.length,
    sourceObjects: fixture.audio.context.sources.length,
    gainObjects: fixture.audio.context.gains.length,
    sourceAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-source').length,
    gainAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-gain').length,
    bufferAllocations: fixture.audio.events.filter(({ type }) => type === 'allocate-buffer').length,
    sourceStarts: fixture.audio.events.filter(({ type }) => type === 'start').length,
    sourceStops: fixture.audio.events.filter(({ type }) => type === 'stop').length,
    sourceDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'source'
    )).length,
    gainDisconnects: fixture.audio.events.filter((event) => (
      event.type === 'disconnect' && event.kind === 'gain'
    )).length,
    resumes: fixture.audio.events.filter(({ type }) => type === 'resume').length,
    suspends: fixture.audio.events.filter(({ type }) => type === 'suspend').length,
    sourceStopCalls: fixture.audio.context.sources.reduce(
      (total, source) => total + source.stopCalls,
      0,
    ),
    sourceDisconnectCalls: fixture.audio.context.sources.reduce(
      (total, source) => total + source.disconnectCalls,
      0,
    ),
    sourceBufferClearCalls: fixture.audio.context.sources.reduce(
      (total, source) => total + source.bufferClearCalls,
      0,
    ),
    sourceEndedClearCalls: fixture.audio.context.sources.reduce(
      (total, source) => total + source.onendedClearCalls,
      0,
    ),
    gainDisconnectCalls: fixture.audio.context.gains.reduce(
      (total, gain) => total + gain.disconnectCalls,
      0,
    ),
  });
  const referenceSnapshot = () => Object.freeze({
    sourceObjects: Object.freeze([...fixture.audio.context.sources]),
    gainObjects: Object.freeze([...fixture.audio.context.gains]),
    sourceBuffers: Object.freeze(fixture.audio.context.sources.map(({ buffer }) => buffer)),
    sourceCallbacks: Object.freeze(fixture.audio.context.sources.map(({ onended }) => onended)),
    sourceConnections: Object.freeze(fixture.audio.context.sources.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    gainConnections: Object.freeze(fixture.audio.context.gains.map(({ connections }) => (
      Object.freeze([...connections])
    ))),
    sourceStopTimes: Object.freeze(fixture.audio.context.sources.map(({ stopTime }) => stopTime)),
    sourceEndedStates: Object.freeze(fixture.audio.context.sources.map(({ ended }) => ended)),
    sourceStopCalls: Object.freeze(fixture.audio.context.sources.map(({ stopCalls }) => stopCalls)),
    sourceDisconnectCalls: Object.freeze(
      fixture.audio.context.sources.map(({ disconnectCalls }) => disconnectCalls),
    ),
    sourceBufferClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ bufferClearCalls }) => bufferClearCalls),
    ),
    sourceEndedClearCalls: Object.freeze(
      fixture.audio.context.sources.map(({ onendedClearCalls }) => onendedClearCalls),
    ),
    gainDisconnectCalls: Object.freeze(
      fixture.audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
    ),
  });
  const mutationSnapshot = () => Object.freeze({
    operations: operationCounts(),
    references: referenceSnapshot(),
    inspection: fixture.engine.inspect(),
    emittedEvents: Object.freeze([...emittedEvents]),
  });
  const assertCheckpoints = (expectedCounts, expectedLabels, stage) => {
    const counts = fixture.audio.ownershipCheckpointCounts();
    const labels = fixture.audio.ownershipCheckpointLabels();
    assert.equal(Object.isFrozen(counts), true);
    assert.equal(Object.isFrozen(labels), true);
    assert.deepEqual(counts, expectedCounts, `${stage}: checkpoint counts`);
    assert.deepEqual(labels, expectedLabels, `${stage}: checkpoint order`);
  };
  const assertTapBlocked = (generationId, effectId, stage) => {
    const before = mutationSnapshot();
    assert.throws(
      () => fixture.engine.directTap(Object.freeze({
        sessionId: SESSION_ID,
        generationId,
        effectId,
        sourceId: `tombstone-blocked-${generationId}-${effectId}`,
        scheduledAudioTime: 10.8,
      })),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message, 'generation allocation is frozen');
        return true;
      },
      stage,
    );
    assert.deepEqual(mutationSnapshot(), before, `${stage}: blocked tap must not mutate`);
  };

  let replacementFailureInjections = 0;
  let replacementEvents = 0;
  const replacementOptions = Object.freeze({
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    assertTerminalRecordReceipt: fixture.receipts.assert,
    createCleanupDeadline: fixture.audio.dependencies.createDeadline,
    failureInjector() { replacementFailureInjections += 1; },
    onEvent() { replacementEvents += 1; },
  });
  const assertReplacementBlocked = (stage) => {
    const before = mutationSnapshot();
    assert.throws(
      () => createWebAudioEngine(replacementOptions),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message, 'loaded session capability is already bound to an engine');
        return true;
      },
      stage,
    );
    assert.deepEqual(mutationSnapshot(), before, `${stage}: replacement attempt must not mutate`);
    assert.equal(replacementFailureInjections, 0);
    assert.equal(replacementEvents, 0);
  };

  const tap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 490,
    sourceId: 'terminal-tombstone-source',
    scheduledAudioTime: 10.02,
  }));
  const source = fixture.audio.context.sources[0];
  const capturedCallback = source.onended;
  const capturedBuffer = source.buffer;
  const capturedConnections = Object.freeze([...source.connections]);
  const capturedGains = Object.freeze([...fixture.audio.context.gains]);
  const operationsAtStart = operationCounts();
  assert.equal(typeof capturedCallback, 'function');
  assert.notEqual(capturedBuffer, null);
  assert.equal(capturedConnections.length, 1);
  assert.equal(capturedGains.length, 5);
  assert.deepEqual({
    sourceObjects: operationsAtStart.sourceObjects,
    gainObjects: operationsAtStart.gainObjects,
    sourceAllocations: operationsAtStart.sourceAllocations,
    gainAllocations: operationsAtStart.gainAllocations,
    bufferAllocations: operationsAtStart.bufferAllocations,
    sourceStarts: operationsAtStart.sourceStarts,
    sourceStops: operationsAtStart.sourceStops,
    resumes: operationsAtStart.resumes,
    suspends: operationsAtStart.suspends,
  }, {
    sourceObjects: 1,
    gainObjects: 5,
    sourceAllocations: 1,
    gainAllocations: 5,
    bufferAllocations: 1,
    sourceStarts: 1,
    sourceStops: 0,
    resumes: 1,
    suspends: 0,
  });

  let startupSettlementCount = 0;
  const startupJoin = tap.settlement.then((result) => {
    startupSettlementCount += 1;
    return result;
  });
  const receipt = fixture.receipts.mint();
  const conflictingReceipt = fixture.receipts.mint();
  const deadlinesBeforeCleanup = fixture.audio.deadlines.length;
  const cleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 491,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  const cleanupDeadlines = fixture.audio.deadlines
    .slice(deadlinesBeforeCleanup)
    .filter(({ kind }) => kind === 'generation-cleanup');
  assert.equal(cleanupDeadlines.length, 1);
  const [cleanupDeadline] = cleanupDeadlines;
  assert.equal(cleanupDeadline.milliseconds, 100);
  assert.equal(cleanupDeadline.cancelled, false);
  assert.equal(source.stopCalls, 1);
  assert.equal(source.stopTime, 10.525);
  assert.equal(source.ended, false);
  assert.equal(source.buffer, capturedBuffer);
  assert.equal(source.onended, capturedCallback);
  assert.deepEqual(source.connections, capturedConnections);

  fixture.audio.advanceTo(source.stopTime);
  assert.equal(source.ended, true);
  cleanupDeadline.fire();
  const cleanupResult = await cleanup;
  assert.equal(Object.isFrozen(cleanupResult), true);
  assert.deepEqual(cleanupResult, expectedResult);
  assert.equal(cleanupDeadline.cancelled, true);
  assert.equal(startupSettlementCount, 0);
  assert.deepEqual(fixture.engine.inspect(), frozenInspection);
  assertCheckpoints(zeroCheckpointCounts, [], 'cleanup settled before late resume');

  const ownership = Object.freeze({
    engine: fixture.engine,
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    terminalRecordReceipt: receipt,
  });
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);

  const assertConflictRejectedWithoutMutation = (effectId, stage) => {
    const before = mutationSnapshot();
    assert.throws(
      () => fixture.engine.terminateGeneration(Object.freeze({
        sessionId: SESSION_ID,
        generationId: GENERATION_ID,
        effectId,
        terminalRecordReceipt: conflictingReceipt,
        audioNow: 10.7,
      })),
      (error) => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message, 'another generation termination owns the engine');
        return true;
      },
      stage,
    );
    assert.deepEqual(mutationSnapshot(), before, `${stage}: conflict must not mutate`);
  };

  const beforeLateResume = mutationSnapshot();
  const pendingDuplicate = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 492,
    terminalRecordReceipt: receipt,
    audioNow: 10.6,
  }));
  assert.equal(pendingDuplicate, cleanup);
  assert.equal(await pendingDuplicate, cleanupResult);
  assert.deepEqual(mutationSnapshot(), beforeLateResume);
  assertConflictRejectedWithoutMutation(493, 'before late resume');
  assertTapBlocked(GENERATION_ID, 494, 'before late resume / current generation');
  assertTapBlocked(nextGenerationId, 495, 'before late resume / next generation');
  assertReplacementBlocked('before late resume');
  assertCheckpoints(zeroCheckpointCounts, [], 'after pre-resume replay and exclusion probes');

  const immutableResult = cleanupResult;
  const immutableResultJson = JSON.stringify(cleanupResult);
  fixture.audio.resumeDeferred.resolve();
  await fixture.audio.suspendStarted.promise;
  assert.equal(fixture.audio.context.state, 'running');
  assert.equal(operationCounts().resumes, 1);
  assert.equal(operationCounts().suspends, 1);
  assert.equal(startupSettlementCount, 0);
  assertCheckpoints(zeroCheckpointCounts, [], 'late suspend pending');
  assertTapBlocked(GENERATION_ID, 496, 'late suspend pending / current generation');
  assertTapBlocked(nextGenerationId, 497, 'late suspend pending / next generation');
  assertReplacementBlocked('late suspend pending');

  const hygieneJoin = fixture.capability.suspend('terminal-tombstone-hygiene-join');
  assert.equal(operationCounts().suspends, 1);
  fixture.audio.suspendDeferred.resolve();
  const [startupResult, hygieneResult] = await Promise.all([startupJoin, hygieneJoin]);
  assert.deepEqual(startupResult, { status: 'failed', cause: 'schedule-failed' });
  assert.equal(hygieneResult, true);
  assert.equal(startupSettlementCount, 1);
  assert.equal(fixture.audio.context.state, 'suspended');
  assertCheckpoints(
    completedCheckpointCounts,
    completedCheckpointLabels,
    'startup and hygiene joined after late suspend',
  );

  assert.equal(cleanupResult, immutableResult);
  assert.equal(JSON.stringify(cleanupResult), immutableResultJson);
  assert.equal(Object.isFrozen(cleanupResult), true);
  assert.deepEqual(cleanupResult, expectedResult);
  assert.equal(assertGenerationCleanupResult(cleanupResult, ownership), true);
  assert.equal(claimGenerationCleanupResult(cleanupResult, ownership), true);
  assert.throws(
    () => claimGenerationCleanupResult(cleanupResult, ownership),
    /generation cleanup result already claimed/,
  );
  assert.deepEqual(fixture.engine.inspect(), frozenInspection);

  const afterCompaction = mutationSnapshot();
  const compactedDuplicate = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 498,
    terminalRecordReceipt: receipt,
    audioNow: 10.9,
  }));
  assert.equal(compactedDuplicate, cleanup);
  assert.equal(await compactedDuplicate, cleanupResult);
  assert.deepEqual(mutationSnapshot(), afterCompaction);
  assertConflictRejectedWithoutMutation(499, 'after metadata-only compaction');
  assertTapBlocked(GENERATION_ID, 500, 'after compaction / current generation');
  assertTapBlocked(nextGenerationId, 501, 'after compaction / next generation');
  assertReplacementBlocked('after metadata-only compaction');

  const beforeLateCallback = mutationSnapshot();
  assert.doesNotThrow(() => capturedCallback());
  assert.deepEqual(mutationSnapshot(), beforeLateCallback);
  assert.equal(source.onended, null);
  assert.equal(source.buffer, null);
  assert.deepEqual(source.connections, []);
  assert.equal(source.onendedClearCalls, 1);
  assert.equal(source.bufferClearCalls, 1);
  assert.equal(source.disconnectCalls, 1);
  assert.equal(source.stopCalls, 1);
  assert.ok(capturedGains.every(({ disconnected }) => disconnected));
  assert.ok(capturedGains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.ok(capturedGains.every(({ connections }) => connections.length === 0));
  assert.deepEqual(emittedEvents, []);

  const finalCounts = operationCounts();
  assert.deepEqual({
    deadlineCount: finalCounts.deadlineCount,
    sourceObjects: finalCounts.sourceObjects,
    gainObjects: finalCounts.gainObjects,
    sourceAllocations: finalCounts.sourceAllocations,
    gainAllocations: finalCounts.gainAllocations,
    bufferAllocations: finalCounts.bufferAllocations,
    sourceStarts: finalCounts.sourceStarts,
    sourceStops: finalCounts.sourceStops,
    sourceDisconnects: finalCounts.sourceDisconnects,
    gainDisconnects: finalCounts.gainDisconnects,
    resumes: finalCounts.resumes,
    suspends: finalCounts.suspends,
    sourceStopCalls: finalCounts.sourceStopCalls,
    sourceDisconnectCalls: finalCounts.sourceDisconnectCalls,
    sourceBufferClearCalls: finalCounts.sourceBufferClearCalls,
    sourceEndedClearCalls: finalCounts.sourceEndedClearCalls,
    gainDisconnectCalls: finalCounts.gainDisconnectCalls,
  }, {
    deadlineCount: deadlinesBeforeCleanup + 1,
    sourceObjects: 1,
    gainObjects: 5,
    sourceAllocations: 1,
    gainAllocations: 5,
    bufferAllocations: 1,
    sourceStarts: 1,
    sourceStops: 1,
    sourceDisconnects: 1,
    gainDisconnects: 5,
    resumes: 1,
    suspends: 1,
    sourceStopCalls: 1,
    sourceDisconnectCalls: 1,
    sourceBufferClearCalls: 1,
    sourceEndedClearCalls: 1,
    gainDisconnectCalls: 5,
  });
  assert.equal(cleanupDeadline.cancelled, true);
  assertCheckpoints(completedCheckpointCounts, completedCheckpointLabels, 'final replay-safe state');

  const publicEvidence = JSON.stringify(Object.freeze({
    cleanupResult,
    pendingDuplicateResult: await pendingDuplicate,
    compactedDuplicateResult: await compactedDuplicate,
    startupResult,
    hygieneResult,
    inspection: fixture.engine.inspect(),
    emittedEvents,
    checkpointCounts: fixture.audio.ownershipCheckpointCounts(),
    checkpointLabels: fixture.audio.ownershipCheckpointLabels(),
  }));
  assert.doesNotMatch(publicEvidence, /private/i);
  assert.doesNotMatch(publicEvidence, /stale-generation-resume|cleanup-timeout/i);
});

test('T8-TX-ACTIVE-BORROW-DEADLINE', async () => {
  const emittedEvents = [];
  let fixture = null;
  let terminalDisconnectArmed = false;
  let deadlineFireCalls = 0;
  let deadlineCountAtDisconnect = null;
  let allocationFrozenAtDisconnect = null;
  let lowerBorrowAtDeadline = null;
  let lowerBorrowCallbackCalls = 0;

  fixture = await createFixture({
    audio: {
      resumeMode: 'resolve',
      suspendMode: 'deferred',
      stopEndedMode: 'sync',
      onDisconnect() {
        if (!terminalDisconnectArmed || deadlineFireCalls !== 0) return;
        const cleanupDeadlines = fixture.audio.deadlines.filter(({ kind }) => (
          kind === 'generation-cleanup'
        ));
        if (cleanupDeadlines.length !== 1) return;
        deadlineCountAtDisconnect = cleanupDeadlines.length;
        allocationFrozenAtDisconnect = fixture.engine.inspect().allocationFrozen;
        lowerBorrowAtDeadline = fixture.capability.borrowForGeneration(
          GENERATION_ID + 1,
          () => { lowerBorrowCallbackCalls += 1; },
        ).then(
          () => Object.freeze({ status: 'succeeded', cause: null }),
          (error) => Object.freeze({ status: 'failed', cause: error?.code }),
        );
        deadlineFireCalls += 1;
        cleanupDeadlines[0].fire();
      },
    },
    onEvent(event) { emittedEvents.push(event); },
  });

  const tap = fixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 510,
    sourceId: 'active-borrow-deadline-source',
    scheduledAudioTime: 10.02,
  }));
  assert.deepEqual(await tap.settlement, { status: 'succeeded', cause: null });
  assert.equal(fixture.engine.inspect().pendingResumeKey, null);
  assert.equal(fixture.audio.context.state, 'running');
  await assert.rejects(
    fixture.capability.borrowForGeneration(GENERATION_ID + 1, () => {
      lowerBorrowCallbackCalls += 1;
    }),
    (error) => error?.code === 'parallel-generation-borrow',
  );
  assert.equal(lowerBorrowCallbackCalls, 0);

  const source = fixture.audio.context.sources[0];
  const receipt = fixture.receipts.mint();
  terminalDisconnectArmed = true;
  const cleanup = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 511,
    terminalRecordReceipt: receipt,
    audioNow: 10.5,
  }));
  const pendingReplay = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 512,
    terminalRecordReceipt: receipt,
    audioNow: 10.501,
  }));
  assert.equal(pendingReplay, cleanup);
  assert.equal(deadlineFireCalls, 1);
  assert.equal(deadlineCountAtDisconnect, 1);
  assert.equal(allocationFrozenAtDisconnect, true);
  assert.notEqual(lowerBorrowAtDeadline, null);
  assert.deepEqual(await lowerBorrowAtDeadline, {
    status: 'failed',
    cause: 'parallel-generation-borrow',
  });
  assert.equal(lowerBorrowCallbackCalls, 0);

  const cleanupResult = await cleanup;
  assert.equal(await pendingReplay, cleanupResult);
  assert.equal(Object.isFrozen(cleanupResult), true);
  assert.deepEqual(cleanupResult, {
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  const immutableResultJson = JSON.stringify(cleanupResult);
  const [cleanupDeadline] = fixture.audio.deadlines.filter(({ kind }) => (
    kind === 'generation-cleanup'
  ));
  assert.equal(cleanupDeadline.cancelled, true);
  assert.deepEqual(fixture.engine.inspect(), {
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  assertSourceReferencesClearedOnce(source);
  assert.ok(fixture.audio.context.gains.every(({ disconnected }) => disconnected));
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.deepEqual(emittedEvents, []);

  const replacementOptions = Object.freeze({
    loadedSessionCapability: fixture.capability,
    sessionId: SESSION_ID,
    assertTerminalRecordReceipt: fixture.receipts.assert,
    createCleanupDeadline: fixture.audio.dependencies.createDeadline,
    failureInjector() {},
    onEvent() {},
  });
  const assertTerminalOwnershipRetained = (effectId) => {
    assert.throws(
      () => fixture.engine.directTap(Object.freeze({
        sessionId: SESSION_ID,
        generationId: GENERATION_ID + 1,
        effectId,
        sourceId: `active-deadline-blocked-${effectId}`,
        scheduledAudioTime: 10.7,
      })),
      /generation allocation is frozen/,
    );
    assert.throws(
      () => createWebAudioEngine(replacementOptions),
      /loaded session capability is already bound to an engine/,
    );
  };
  assertTerminalOwnershipRetained(513);

  const deferredSuspend = fixture.capability.suspend('reset-after-evidence');
  await fixture.audio.suspendStarted.promise;
  await assert.rejects(
    fixture.capability.borrowForGeneration(GENERATION_ID + 1, () => {
      lowerBorrowCallbackCalls += 1;
    }),
    (error) => error?.code === 'parallel-generation-borrow',
  );
  assert.equal(lowerBorrowCallbackCalls, 0);
  assertTerminalOwnershipRetained(514);

  fixture.audio.suspendDeferred.resolve();
  await deferredSuspend;
  const deferredBorrowRelease = deferred();
  const lateBorrow = fixture.capability.borrowForGeneration(GENERATION_ID + 1, () => {
    lowerBorrowCallbackCalls += 1;
    return deferredBorrowRelease.promise;
  });
  assert.equal(lowerBorrowCallbackCalls, 1);
  assertTerminalOwnershipRetained(515);
  assert.equal(cleanupResult.status, 'failed');
  assert.equal(JSON.stringify(cleanupResult), immutableResultJson);

  deferredBorrowRelease.resolve();
  await lateBorrow;
  const completedReplay = fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 516,
    terminalRecordReceipt: receipt,
    audioNow: 10.9,
  }));
  assert.equal(completedReplay, cleanup);
  assert.equal(await completedReplay, cleanupResult);
  assertTerminalOwnershipRetained(517);
  assert.equal(JSON.stringify(cleanupResult), immutableResultJson);
  assert.equal(source.stopCalls, 1);
  assert.equal(source.disconnectCalls, 1);
  assert.equal(source.onendedClearCalls, 1);
  assert.equal(source.bufferClearCalls, 1);
  assert.ok(fixture.audio.context.gains.every(({ disconnectCalls }) => disconnectCalls === 1));
  assert.equal(fixture.audio.deadlines.filter(({ kind }) => kind === 'generation-cleanup').length, 1);
  assert.deepEqual(emittedEvents, []);
});

test('T8-ROLLBACK-CLEANUP-FAULT', async () => {
  async function runInitialRollbackScenario(faultKind) {
    const emittedEvents = [];
    const cleanupHooks = [];
    let fixture = null;
    let observeRollback = false;
    let cleanupFaultInjected = false;
    let sourceRegistryCount = 0;
    let hookSequence = 0;
    let lowerBorrowCallbackCalls = 0;

    function observeCleanupHook(kind, node) {
      if (!observeRollback) return;
      hookSequence += 1;
      let sameEngineError = null;
      try {
        fixture.engine.directTap(Object.freeze({
          sessionId: SESSION_ID,
          generationId: GENERATION_ID,
          effectId: 520 + hookSequence,
          sourceId: `initial-rollback-cleanup-blocked-${hookSequence}`,
          scheduledAudioTime: 11 + hookSequence / 100,
        }));
      } catch (error) {
        sameEngineError = error;
      }
      cleanupHooks.push(Object.freeze({
        kind,
        node,
        inspection: fixture.engine.inspect(),
        sameEngineError,
        lowerBorrowSettlement: fixture.capability.borrowForGeneration(
          GENERATION_ID + 1,
          () => { lowerBorrowCallbackCalls += 1; },
        ).then(
          () => Object.freeze({ status: 'succeeded', cause: null }),
          (error) => Object.freeze({ status: 'failed', cause: error.code }),
        ),
      }));
      if (!cleanupFaultInjected && kind === faultKind) {
        cleanupFaultInjected = true;
        throw new Error(`PRIVATE_INITIAL_ROLLBACK_${faultKind.toUpperCase()}_FAILURE`);
      }
    }

    fixture = await createFixture({
      audio: {
        stopEndedMode: 'sync',
        onStop(source) { observeCleanupHook('source-stop', source); },
        onDisconnect(node) {
          observeCleanupHook(
            node.kind === 'source' ? 'source-disconnect' : 'graph-disconnect',
            node,
          );
        },
      },
      failStep(step) {
        if (step === 'source:registry' && ++sourceRegistryCount === 1) {
          observeRollback = true;
          throw new Error('PRIVATE_INITIAL_ROLLBACK_COMMITTED_SOURCE_FAILURE');
        }
      },
      onEvent(event) { emittedEvents.push(event); },
    });

    const originatingCommand = fixture.engine.directTap(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 510,
      sourceId: `initial-rollback-cleanup-fault-${faultKind}`,
      scheduledAudioTime: 10.8,
    }));
    let settlementObservations = 0;
    const settlement = await originatingCommand.settlement.then((value) => {
      settlementObservations += 1;
      return value;
    });
    await Promise.resolve();
    observeRollback = false;

    assert.deepEqual(settlement, { status: 'failed', cause: 'schedule-failed' }, faultKind);
    assert.equal(settlementObservations, 1, `${faultKind}: initial command settles once`);
    assert.equal(cleanupFaultInjected, true, `${faultKind}: initial cleanup fault must fire`);
    assert.deepEqual(emittedEvents, [], `${faultKind}: initial rollback emits no autonomous fact`);
    assert.equal(cleanupHooks.length, 7, `${faultKind}: initial cleanup attempts every owned node`);
    assert.deepEqual(cleanupHooks.map(({ kind }) => kind), [
      'source-stop',
      'source-disconnect',
      'graph-disconnect',
      'graph-disconnect',
      'graph-disconnect',
      'graph-disconnect',
      'graph-disconnect',
    ], `${faultKind}: initial cleanup order must remain complete and deterministic`);
    for (const hook of cleanupHooks) {
      assert.equal(hook.inspection.allocationFrozen, true, `${faultKind}: initial rollback owns ${hook.kind}`);
      assert.equal(hook.inspection.graphCreated, true, `${faultKind}: initial graph owns ${hook.kind}`);
      assert.deepEqual(hook.inspection.predictions, [], `${faultKind}: initial tap is not a prediction`);
      assert.equal(hook.inspection.track, null, `${faultKind}: initial tap is not a track`);
      assert.match(
        hook.sameEngineError?.message ?? 'same-engine replacement was admitted',
        /generation allocation is frozen|request is not closed/,
        `${faultKind}: same-engine replacement must reject inside initial ${hook.kind}`,
      );
      assert.deepEqual(await hook.lowerBorrowSettlement, {
        status: 'failed',
        cause: 'parallel-generation-borrow',
      }, `${faultKind}: lower borrow remains owned inside initial ${hook.kind}`);
    }
    assert.equal(lowerBorrowCallbackCalls, 0, `${faultKind}: cleanup cannot enter a lower callback`);

    const inspection = fixture.engine.inspect();
    assert.equal(inspection.generationId, null, `${faultKind}: initial fault owner is not active`);
    assert.equal(inspection.allocationFrozen, true, `${faultKind}: initial cleanup fault stays frozen`);
    assert.equal(inspection.graphCreated, true, `${faultKind}: initial graph ownership is retained`);
    assert.deepEqual(inspection.predictions, [], `${faultKind}: acknowledgment ownership is not prediction ownership`);
    assert.equal(inspection.track, null, `${faultKind}: initial rollback owns no track`);
    assert.equal(fixture.audio.context.sources.length, 1, `${faultKind}: exact initial source was allocated`);
    assert.deepEqual(fixture.audio.context.sources.map(({ stopCalls }) => stopCalls), [1]);
    assert.deepEqual(fixture.audio.context.sources.map(({ disconnectCalls }) => disconnectCalls), [1]);
    assert.deepEqual(
      fixture.audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
      [1, 1, 1, 1, 1],
      `${faultKind}: initial rollback attempts every graph disconnect`,
    );
    assert.throws(() => fixture.engine.directTap(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 540,
      sourceId: `initial-rollback-cleanup-replacement-${faultKind}`,
      scheduledAudioTime: 11.5,
    })), /generation allocation is frozen/);

    await assert.rejects(
      fixture.capability.borrowForGeneration(GENERATION_ID + 1, () => {
        lowerBorrowCallbackCalls += 1;
      }),
      (error) => error?.code === 'parallel-generation-borrow',
      `${faultKind}: originating settlement must not release the lower borrow`,
    );
    assert.equal(lowerBorrowCallbackCalls, 0, `${faultKind}: post-settlement lower callback remains blocked`);

    const receipt = fixture.receipts.mint();
    const terminalization = fixture.engine.terminateGeneration(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 550,
      terminalRecordReceipt: receipt,
      audioNow: 10.9,
    }));
    if (faultKind === 'source-stop') {
      assert.equal(
        fixture.audio.context.sources[0].fireCapturedEndedCallback(),
        true,
        `${faultKind}: genuine late source settlement remains terminal-owned`,
      );
    }
    const terminalResult = await terminalization;
    assert.deepEqual(terminalResult, {
      scope: 'generation',
      status: 'failed',
      cause: 'source-stop-failed',
      sourceReferencesCleared: true,
      sourceStopSettled: true,
    }, `${faultKind}: genuine terminalization consumes the initial private fault`);
    assert.deepEqual(emittedEvents, [], `${faultKind}: initial rollback never claims autonomous delivery`);
    assert.equal(
      fixture.audio.events.filter(({ type }) => type === 'close').length,
      0,
      `${faultKind}: initial rollback must not claim application teardown`,
    );

    await fixture.capability.borrowForGeneration(GENERATION_ID + 1, () => {
      lowerBorrowCallbackCalls += 1;
    });
    assert.equal(lowerBorrowCallbackCalls, 1, `${faultKind}: terminal settlement releases the lower borrow`);
  }

  async function runRollbackScenario(faultKind) {
    const emittedEvents = [];
    const cleanupHooks = [];
    let fixture = null;
    let observeRollback = false;
    let cleanupFaultInjected = false;
    let sourceRegistryCount = 0;
    let hookSequence = 0;

    function observeCleanupHook(kind, node) {
      if (!observeRollback) return;
      hookSequence += 1;
      let sameEngineError = null;
      try {
        fixture.engine.directTap(Object.freeze({
          sessionId: SESSION_ID,
          generationId: GENERATION_ID,
          effectId: 600 + hookSequence,
          sourceId: `rollback-cleanup-blocked-${hookSequence}`,
          scheduledAudioTime: 11 + hookSequence / 100,
        }));
      } catch (error) {
        sameEngineError = error;
      }
      cleanupHooks.push(Object.freeze({
        kind,
        node,
        inspection: fixture.engine.inspect(),
        sameEngineError,
        lowerBorrowSettlement: fixture.capability.borrowForGeneration(
          GENERATION_ID + 1,
          () => undefined,
        ).then(
          () => Object.freeze({ status: 'succeeded', cause: null }),
          (error) => Object.freeze({ status: 'failed', cause: error.code }),
        ),
      }));
      if (!cleanupFaultInjected && kind === faultKind) {
        cleanupFaultInjected = true;
        throw new Error(`PRIVATE_ROLLBACK_${faultKind.toUpperCase()}_FAILURE`);
      }
    }

    fixture = await createFixture({
      audio: {
        stopEndedMode: 'sync',
        onStop(source) { observeCleanupHook('source-stop', source); },
        onDisconnect(node) {
          observeCleanupHook(
            node.kind === 'source' ? 'source-disconnect' : 'graph-disconnect',
            node,
          );
        },
      },
      failStep(step) {
        if (step === 'source:registry' && ++sourceRegistryCount === 2) {
          observeRollback = true;
          throw new Error('PRIVATE_ROLLBACK_COMMITTED_SOURCE_FAILURE');
        }
      },
      onEvent(event) { emittedEvents.push(event); },
    });
    await activateGeneration(fixture);

    const originatingCommand = fixture.engine.schedulePredictions(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 590,
      predictions: Object.freeze([Object.freeze({
        sourceId: `rollback-cleanup-fault-${faultKind}`,
        scheduledAudioTime: 10.8,
      })]),
    }));
    let settlementObservations = 0;
    const settlement = await originatingCommand.then((value) => {
      settlementObservations += 1;
      return value;
    });
    await Promise.resolve();
    observeRollback = false;

    assert.deepEqual(settlement, { status: 'failed', cause: 'schedule-failed' }, faultKind);
    assert.equal(settlementObservations, 1, `${faultKind}: originating command settles once`);
    assert.equal(cleanupFaultInjected, true, `${faultKind}: selected cleanup fault must fire`);
    assert.deepEqual(emittedEvents, [], `${faultKind}: rollback must emit no autonomous fact`);
    assert.equal(cleanupHooks.length, 9, `${faultKind}: every required cleanup hook must run`);
    assert.deepEqual(cleanupHooks.map(({ kind }) => kind), [
      'source-stop',
      'source-disconnect',
      'source-stop',
      'source-disconnect',
      'graph-disconnect',
      'graph-disconnect',
      'graph-disconnect',
      'graph-disconnect',
      'graph-disconnect',
    ], `${faultKind}: cleanup order must remain complete and deterministic`);
    for (const hook of cleanupHooks) {
      assert.equal(hook.inspection.allocationFrozen, true, `${faultKind}: rollback owns ${hook.kind}`);
      assert.equal(hook.inspection.graphCreated, true, `${faultKind}: graph ownership precedes ${hook.kind}`);
      assert.match(
        hook.sameEngineError?.message ?? 'same-engine replacement was admitted',
        /generation allocation is frozen|request is not closed/,
        `${faultKind}: same-engine replacement must reject inside ${hook.kind}`,
      );
      assert.deepEqual(await hook.lowerBorrowSettlement, {
        status: 'failed',
        cause: 'parallel-generation-borrow',
      }, `${faultKind}: lower borrow must remain owned inside ${hook.kind}`);
    }

    const inspection = fixture.engine.inspect();
    assert.equal(inspection.generationId, null, `${faultKind}: fault owner is not active`);
    assert.equal(inspection.allocationFrozen, true, `${faultKind}: cleanup fault remains fail-closed`);
    assert.equal(inspection.graphCreated, true, `${faultKind}: graph ownership must be retained`);
    assert.deepEqual(inspection.predictions.map(({ sourceId }) => sourceId), [
      `rollback-cleanup-fault-${faultKind}`,
    ], `${faultKind}: exact prediction registry ownership must be retained`);
    assert.throws(() => fixture.engine.directTap(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 700,
      sourceId: `rollback-cleanup-replacement-${faultKind}`,
      scheduledAudioTime: 11.5,
    })), /generation allocation is frozen/);
    await assert.rejects(
      fixture.capability.borrowForGeneration(GENERATION_ID + 1, () => undefined),
      (error) => error?.code === 'parallel-generation-borrow',
    );

    assert.deepEqual(
      fixture.audio.context.sources.map(({ stopCalls }) => stopCalls),
      [1, 1],
      `${faultKind}: every committed source receives one stop attempt`,
    );
    assert.deepEqual(
      fixture.audio.context.sources.map(({ disconnectCalls }) => disconnectCalls),
      [1, 1],
      `${faultKind}: every source receives one disconnect attempt`,
    );
    assert.deepEqual(
      fixture.audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
      [1, 1, 1, 1, 1],
      `${faultKind}: every graph node receives one disconnect attempt`,
    );

    const receipt = fixture.receipts.mint();
    const terminalization = fixture.engine.terminateGeneration(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: 701,
      terminalRecordReceipt: receipt,
      audioNow: 10.9,
    }));
    if (faultKind === 'source-stop') {
      fixture.audio.deadlines.find(({ kind }) => kind === 'generation-cleanup')?.fire();
    }
    const terminalResult = await terminalization;
    assert.deepEqual(terminalResult, {
      scope: 'generation',
      status: 'failed',
      cause: 'source-stop-failed',
      sourceReferencesCleared: true,
      sourceStopSettled: faultKind !== 'source-stop',
    }, `${faultKind}: a genuine receipt consumes the retained private fault`);
    assert.deepEqual(emittedEvents, [], `${faultKind}: rollback never claims autonomous delivery`);
    assert.equal(
      fixture.audio.events.filter(({ type }) => type === 'close').length,
      0,
      `${faultKind}: Task8 rollback must not claim application teardown`,
    );
  }

  for (const faultKind of ['source-stop', 'source-disconnect', 'graph-disconnect']) {
    await runInitialRollbackScenario(faultKind);
  }

  for (const faultKind of ['source-stop', 'source-disconnect', 'graph-disconnect']) {
    await runRollbackScenario(faultKind);
  }

  let successfulFixture = null;
  let successfulRegistryCount = 0;
  let successfulCleanupBorrow = null;
  successfulFixture = await createFixture({
    audio: {
      stopEndedMode: 'sync',
      onDisconnect() {
        successfulCleanupBorrow ??= successfulFixture.capability.borrowForGeneration(
          GENERATION_ID + 1,
          () => undefined,
        ).then(
          () => Object.freeze({ status: 'succeeded', cause: null }),
          (error) => Object.freeze({ status: 'failed', cause: error.code }),
        );
      },
    },
    failStep(step) {
      if (step === 'source:registry' && ++successfulRegistryCount === 1) {
        throw new Error('PRIVATE_SUCCESSFUL_ROLLBACK_TRIGGER');
      }
    },
  });
  const successfulTap = successfulFixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 702,
    sourceId: 'rollback-cleanup-success-control',
    scheduledAudioTime: 10.8,
  }));
  assert.deepEqual(await successfulTap.settlement, {
    status: 'failed',
    cause: 'schedule-failed',
  });
  assert.deepEqual(successfulFixture.engine.inspect(), {
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: false,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  assert.deepEqual(successfulFixture.audio.context.sources.map(({ stopCalls }) => stopCalls), [1]);
  assert.deepEqual(
    successfulFixture.audio.context.sources.map(({ disconnectCalls }) => disconnectCalls),
    [1],
  );
  assert.deepEqual(
    successfulFixture.audio.context.gains.map(({ disconnectCalls }) => disconnectCalls),
    [1, 1, 1, 1, 1],
  );
  assert.deepEqual(await successfulCleanupBorrow, {
    status: 'failed',
    cause: 'parallel-generation-borrow',
  });
  await successfulFixture.capability.borrowForGeneration(GENERATION_ID + 1, () => undefined);
});

test('T8-AUTONOMOUS-CLEANUP-FAULT-FACT', async () => {
  if (process.env.TASK14_5_CONSTRAINED_STACK_CHILD === '1') {
    const sourceCount = 1000;
    const orderedEvents = [];
    let fixture = null;
    let chainArmed = false;
    fixture = await createFixture({
      audio: {
        onDisconnect(node) {
          if (!chainArmed) return;
          const index = fixture.audio.context.sources.indexOf(node);
          fixture.audio.context.sources[index + 1]?.fireCapturedEndedCallback();
        },
      },
      onEvent(event) { orderedEvents.push(event.sourceId); },
    });
    await activateGeneration(fixture);
    for (let index = 1; index < sourceCount; index += 1) {
      fixture.engine.directTap(Object.freeze({
        sessionId: SESSION_ID,
        generationId: GENERATION_ID,
        effectId: 10_000 + index,
        sourceId: `constrained-stack-${index}`,
        scheduledAudioTime: 10.02 + index / sourceCount,
      }));
    }
    chainArmed = true;
    assert.equal(fixture.audio.context.sources[0].fireCurrentEndedCallback(), true);
    assert.deepEqual(orderedEvents, [
      'ack-1',
      ...Array.from({ length: sourceCount - 1 }, (_, index) => (
        `constrained-stack-${index + 1}`
      )),
    ]);
    assert.equal(fixture.engine.inspect().predictions.length, 0);
    assert.equal(fixture.audio.context.sources.filter(({ onended }) => onended !== null).length, 0);
    assert.equal(fixture.audio.context.sources.filter(({ buffer }) => buffer !== null).length, 0);
    assert.equal(
      fixture.audio.context.sources.filter(({ connections }) => connections.length !== 0).length,
      0,
    );
    return;
  }

  const expectedFactKeys = Object.freeze([
    'type',
    'sessionId',
    'generationId',
    'sourceId',
    'cause',
  ]);

  function assertExactFact(event, sourceId) {
    assert.equal(Object.isFrozen(event), true);
    assert.deepEqual(Reflect.ownKeys(event), expectedFactKeys);
    for (const key of expectedFactKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(event, key);
      assert.notEqual(descriptor, undefined);
      assert.equal(Object.hasOwn(descriptor, 'value'), true);
    }
    assert.deepEqual(event, {
      type: 'generation-cleanup-faulted',
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      sourceId,
      cause: 'source-stop-failed',
    });
  }

  function assertOnlyCleanupFaultFact(events, sourceId) {
    assert.equal(events.length, 1);
    assertExactFact(events[0], sourceId);
  }

  function trackRequestReflection(target, label, reflections) {
    return new Proxy(target, {
      getPrototypeOf(value) {
        reflections.push(`${label}:getPrototypeOf`);
        return Reflect.getPrototypeOf(value);
      },
      ownKeys(value) {
        reflections.push(`${label}:ownKeys`);
        return Reflect.ownKeys(value);
      },
      getOwnPropertyDescriptor(value, key) {
        reflections.push(`${label}:getOwnPropertyDescriptor:${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(value, key);
      },
    });
  }

  async function createAutonomousFaultFixture({ role, consumer, audioOptions = {} }) {
    const emittedEvents = [];
    let faultSource = null;
    let fixture = null;
    fixture = await createFixture({
      audio: {
        stopEndedMode: 'sync',
        ...audioOptions,
        onDisconnect(node) {
          if (node !== faultSource) return;
          throw new Error(`PRIVATE_AUTONOMOUS_${role.toUpperCase()}_DISCONNECT`);
        },
      },
      onEvent(event) {
        emittedEvents.push(event);
        consumer?.(event, fixture);
      },
    });
    await activateGeneration(fixture);

    let sourceId;
    if (role === 'prediction') {
      sourceId = 'autonomous-cleanup-fault-prediction';
      await schedulePredictionSet(fixture, [{
        sourceId,
        scheduledAudioTime: 10.8,
      }], 520);
      faultSource = fixture.audio.context.sources.at(-1);
    } else {
      const plan = createPlan();
      const settlement = await fixture.engine.commitHandoff(handoffRequest(plan));
      assert.deepEqual(settlement, { status: 'succeeded', cause: null });
      sourceId = `generation-${GENERATION_ID}-track-source`;
      faultSource = fixture.audio.context.sources.at(-1);
      assert.equal(fixture.engine.inspect().track?.sourceId, sourceId);
      assert.equal(faultSource.startRecord.offset, plan.trackStartOffsetSeconds);
    }

    const callback = faultSource.onended;
    const connections = Object.freeze([...faultSource.connections]);
    assert.equal(typeof callback, 'function');
    assert.equal(faultSource.ended, false);
    assert.equal(connections.length, 1);
    return Object.freeze({
      fixture,
      emittedEvents,
      faultSource,
      callback,
      connections,
      sourceId,
    });
  }

  function assertFaultOwnershipRetained(scenario) {
    const {
      fixture, emittedEvents, faultSource, connections, sourceId,
    } = scenario;
    assert.equal(emittedEvents.length, 1);
    assertExactFact(emittedEvents[0], sourceId);
    assert.equal(faultSource.ended, true);
    assert.equal(faultSource.disconnectCalls, 1);
    assert.equal(faultSource.disconnected, false);
    assert.deepEqual(faultSource.connections, connections);
    assert.equal(faultSource.onended, null);
    assert.equal(faultSource.buffer, null);

    const inspection = fixture.engine.inspect();
    assert.equal(inspection.sessionId, SESSION_ID);
    assert.equal(inspection.generationId, null);
    assert.equal(inspection.allocationFrozen, true);
    assert.equal(inspection.pendingResumeKey, null);
    assert.equal(inspection.graphCreated, true);
    assert.equal(JSON.stringify(inspection).includes('preterminalCleanupFault'), false);
    assert.equal(JSON.stringify(inspection).includes('source-stop-failed'), false);
    assert.equal(fixture.audio.context.state, 'running');
    assert.equal(fixture.audio.events.filter(({ type }) => type === 'close').length, 0);
  }

  async function assertFrozenAdmission(scenario, effectBase) {
    const {
      fixture, faultSource, sourceId, emittedEvents,
    } = scenario;
    const sourceCount = fixture.audio.context.sources.length;
    const eventCount = fixture.audio.events.length;
    assert.throws(() => fixture.engine.directTap(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID + 1,
      effectId: effectBase,
      sourceId: `blocked-autonomous-${effectBase}`,
      scheduledAudioTime: 11,
    })), /generation allocation is frozen/);
    assert.throws(() => fixture.engine.schedulePredictions(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId: effectBase + 1,
      predictions: Object.freeze([Object.freeze({
        sourceId,
        scheduledAudioTime: 11.2,
      })]),
    })), /prediction schedule request is invalid/);
    let lowerBorrowCalls = 0;
    await assert.rejects(
      fixture.capability.borrowForGeneration(GENERATION_ID + 1, () => {
        lowerBorrowCalls += 1;
      }),
      (error) => error?.code === 'parallel-generation-borrow',
    );
    assert.equal(lowerBorrowCalls, 0);
    assert.equal(fixture.audio.context.sources.length, sourceCount);
    assert.equal(fixture.audio.events.length, eventCount);
    assert.equal(faultSource.disconnectCalls, 1);
    assert.equal(emittedEvents.length, 1);
  }

  const absentDelivery = await createAutonomousFaultFixture({
    role: 'prediction',
    consumer() {},
  });
  assert.equal(absentDelivery.faultSource.fireCurrentEndedCallback(), true);
  assertFaultOwnershipRetained(absentDelivery);
  assert.equal(
    absentDelivery.fixture.engine.inspect().predictions.some(({ sourceId }) => (
      sourceId === absentDelivery.sourceId
    )),
    true,
  );
  await assertFrozenAdmission(absentDelivery, 530);
  assert.equal(absentDelivery.faultSource.fireCapturedEndedCallback(), true);
  assert.equal(absentDelivery.emittedEvents.length, 1);
  assert.equal(absentDelivery.faultSource.disconnectCalls, 1);

  const throwingConsumer = await createAutonomousFaultFixture({
    role: 'track',
    consumer() { throw new Error('PRIVATE_AUTONOMOUS_CONSUMER_THROW'); },
  });
  assert.doesNotThrow(() => throwingConsumer.faultSource.fireCurrentEndedCallback());
  assertFaultOwnershipRetained(throwingConsumer);
  assert.equal(throwingConsumer.fixture.engine.inspect().track?.sourceId, throwingConsumer.sourceId);
  assert.equal(throwingConsumer.faultSource.fireCapturedEndedCallback(), true);
  assert.equal(throwingConsumer.emittedEvents.length, 1);
  assert.equal(throwingConsumer.faultSource.disconnectCalls, 1);

  const disconnectReentrantPredictions = Object.freeze([
    Object.freeze({
      sourceId: 'disconnect-reentrant-fault',
      scheduledAudioTime: 10.8,
    }),
    Object.freeze({
      sourceId: 'disconnect-reentrant-sibling',
      scheduledAudioTime: 11.2,
    }),
  ]);
  const disconnectReentrantPlan = createPlan(disconnectReentrantPredictions);
  const disconnectReentrantEvents = [];
  const disconnectReentrantReflections = [];
  const disconnectReentrantAttempts = [];
  let disconnectReentrantFixture = null;
  let disconnectReentrantFaultSource = null;
  let disconnectReentrantSiblingSource = null;
  let disconnectReentrantReceipt = null;
  let disconnectReentrantSiblingDispatch = null;
  let disconnectReentrantHookCalls = 0;
  let disconnectReentrantEvidenceDuringFact = null;

  function attemptDisconnectReentrantCommand(name, invoke) {
    let result;
    let error;
    try { result = invoke(); } catch (caught) { error = caught; }
    disconnectReentrantAttempts.push(Object.freeze({ name, result, error }));
  }

  disconnectReentrantFixture = await createFixture({
    audio: {
      stopEndedMode: 'none',
      onDisconnect(node) {
        if (node !== disconnectReentrantFaultSource) return;
        disconnectReentrantHookCalls += 1;
        disconnectReentrantSiblingDispatch = disconnectReentrantSiblingSource
          .fireCapturedEndedCallback();

        const invalidSessionId = 'disconnect-reentrant-invalid-session';
        const requests = Object.freeze({
          directTap: Object.freeze({
            sessionId: invalidSessionId,
            generationId: GENERATION_ID,
            effectId: 550,
            sourceId: 'disconnect-reentrant-blocked-tap',
            scheduledAudioTime: 11.4,
          }),
          schedulePredictions: Object.freeze({
            sessionId: invalidSessionId,
            generationId: GENERATION_ID,
            effectId: 551,
            predictions: disconnectReentrantPredictions,
          }),
          cancelPredictions: Object.freeze({
            sessionId: invalidSessionId,
            generationId: GENERATION_ID,
            effectId: 552,
            sourceIds: Object.freeze(disconnectReentrantPredictions.map(({ sourceId }) => sourceId)),
            audioNow: 10.6,
          }),
          commitHandoff: Object.freeze({
            ...handoffRequest(disconnectReentrantPlan),
            sessionId: invalidSessionId,
            effectId: 553,
          }),
          terminateGeneration: Object.freeze({
            sessionId: SESSION_ID,
            generationId: GENERATION_ID,
            effectId: 554,
            terminalRecordReceipt: disconnectReentrantReceipt,
            audioNow: 10.6,
          }),
        });
        for (const [name, invoke] of [
          ['directTap', (request) => disconnectReentrantFixture.engine.directTap(request)],
          ['schedulePredictions', (request) => (
            disconnectReentrantFixture.engine.schedulePredictions(request)
          )],
          ['cancelPredictions', (request) => (
            disconnectReentrantFixture.engine.cancelPredictions(request)
          )],
          ['commitHandoff', (request) => (
            disconnectReentrantFixture.engine.commitHandoff(request)
          )],
          ['terminateGeneration', (request) => (
            disconnectReentrantFixture.engine.terminateGeneration(request)
          )],
        ]) {
          attemptDisconnectReentrantCommand(name, () => invoke(trackRequestReflection(
            requests[name],
            name,
            disconnectReentrantReflections,
          )));
        }
        throw new Error('PRIVATE_DISCONNECT_REENTRANT_OUTER_FAULT');
      },
    },
    onEvent(event) {
      disconnectReentrantEvents.push(event);
      if (event.type === 'generation-cleanup-faulted') {
        disconnectReentrantEvidenceDuringFact = Object.freeze({
          inspection: disconnectReentrantFixture.engine.inspect(),
          stopCalls: Object.freeze(disconnectReentrantFixture.audio.context.sources.map(
            ({ stopCalls }) => stopCalls,
          )),
          cleanupDeadlines: disconnectReentrantFixture.audio.deadlines.filter(
            ({ kind }) => kind === 'generation-cleanup',
          ).length,
        });
      }
    },
  });
  await activateGeneration(disconnectReentrantFixture);
  await schedulePredictionSet(
    disconnectReentrantFixture,
    disconnectReentrantPredictions,
    555,
  );
  [disconnectReentrantFaultSource, disconnectReentrantSiblingSource]
    = disconnectReentrantFixture.audio.context.sources.slice(-2);
  disconnectReentrantReceipt = disconnectReentrantFixture.receipts.mint();
  const disconnectReentrantFaultConnections = Object.freeze([
    ...disconnectReentrantFaultSource.connections,
  ]);
  const disconnectReentrantSiblingConnections = Object.freeze([
    ...disconnectReentrantSiblingSource.connections,
  ]);

  assert.equal(disconnectReentrantFaultSource.fireCurrentEndedCallback(), true);
  assertOnlyCleanupFaultFact(
    disconnectReentrantEvents,
    disconnectReentrantPredictions[0].sourceId,
  );
  assert.equal(disconnectReentrantHookCalls, 1);
  assert.equal(disconnectReentrantSiblingDispatch, true);
  assert.deepEqual(disconnectReentrantReflections, []);
  assert.equal(disconnectReentrantAttempts.length, 5);
  const expectedAdmissionErrors = Object.freeze({
    directTap: 'direct tap request is not closed',
    schedulePredictions: 'prediction schedule request is invalid',
    cancelPredictions: 'prediction cancellation request is invalid',
    commitHandoff: 'handoff request is not closed',
    terminateGeneration: 'generation termination request is invalid',
  });
  for (const attempt of disconnectReentrantAttempts) {
    assert.equal(attempt.result, undefined);
    assert.equal(attempt.error instanceof TypeError, true);
    assert.equal(attempt.error.message, expectedAdmissionErrors[attempt.name]);
  }

  const disconnectReentrantInspection = disconnectReentrantFixture.engine.inspect();
  assert.deepEqual(disconnectReentrantInspection.predictions, [
    {
      sourceId: disconnectReentrantPredictions[0].sourceId,
      scheduledAudioTime: disconnectReentrantPredictions[0].scheduledAudioTime,
      generationId: GENERATION_ID,
      role: 'prediction',
      startCommitted: true,
      intentionallyStopping: false,
      ended: true,
      disconnected: true,
    },
    {
      sourceId: disconnectReentrantPredictions[1].sourceId,
      scheduledAudioTime: disconnectReentrantPredictions[1].scheduledAudioTime,
      generationId: GENERATION_ID,
      role: 'prediction',
      startCommitted: true,
      intentionallyStopping: false,
      ended: false,
      disconnected: false,
    },
  ]);
  assert.deepEqual(
    disconnectReentrantEvidenceDuringFact?.inspection.predictions,
    disconnectReentrantInspection.predictions,
  );
  assert.deepEqual(disconnectReentrantEvidenceDuringFact?.stopCalls, [0, 0, 0]);
  assert.equal(disconnectReentrantEvidenceDuringFact?.cleanupDeadlines, 0);
  assert.equal(disconnectReentrantFaultSource.disconnectCalls, 1);
  assert.equal(disconnectReentrantFaultSource.disconnected, false);
  assert.equal(disconnectReentrantFaultSource.onended, null);
  assert.equal(disconnectReentrantFaultSource.buffer, null);
  assert.deepEqual(
    disconnectReentrantFaultSource.connections,
    disconnectReentrantFaultConnections,
  );
  assert.equal(disconnectReentrantSiblingSource.ended, true);
  assert.equal(disconnectReentrantSiblingSource.disconnectCalls, 0);
  assert.equal(disconnectReentrantSiblingSource.disconnected, false);
  assert.equal(typeof disconnectReentrantSiblingSource.onended, 'function');
  assert.notEqual(disconnectReentrantSiblingSource.buffer, null);
  assert.equal(disconnectReentrantSiblingSource.onendedClearCalls, 0);
  assert.equal(disconnectReentrantSiblingSource.bufferClearCalls, 0);
  assert.deepEqual(
    disconnectReentrantSiblingSource.connections,
    disconnectReentrantSiblingConnections,
  );
  assert.equal(
    disconnectReentrantFixture.audio.deadlines.filter(
      ({ kind }) => kind === 'generation-cleanup',
    ).length,
    0,
  );

  const successfulReentrantPredictions = Object.freeze([
    Object.freeze({
      sourceId: 'disconnect-success-outer',
      scheduledAudioTime: 10.9,
    }),
    Object.freeze({
      sourceId: 'disconnect-success-sibling',
      scheduledAudioTime: 11.3,
    }),
  ]);
  const successfulReentrantEvents = [];
  const successfulReentrantReflections = [];
  let successfulReentrantFixture = null;
  let successfulReentrantOuterSource = null;
  let successfulReentrantSiblingSource = null;
  let successfulReentrantSiblingDispatch = null;
  let successfulReentrantInspectionDuringHook = null;
  let successfulReentrantEventsDuringHook = null;
  let successfulReentrantBlockedError = null;
  successfulReentrantFixture = await createFixture({
    audio: {
      onDisconnect(node) {
        if (node !== successfulReentrantOuterSource) return;
        successfulReentrantSiblingDispatch = successfulReentrantSiblingSource
          .fireCapturedEndedCallback();
        try {
          successfulReentrantFixture.engine.directTap(trackRequestReflection(Object.freeze({
            sessionId: 'disconnect-success-invalid-session',
            generationId: GENERATION_ID,
            effectId: 560,
            sourceId: 'disconnect-success-blocked-tap',
            scheduledAudioTime: 11.5,
          }), 'successfulDirectTap', successfulReentrantReflections));
        } catch (error) {
          successfulReentrantBlockedError = error;
        }
        successfulReentrantInspectionDuringHook = successfulReentrantFixture.engine.inspect();
        successfulReentrantEventsDuringHook = Object.freeze([...successfulReentrantEvents]);
      },
    },
    onEvent(event) {
      successfulReentrantEvents.push(event);
      if (event.sourceId === successfulReentrantPredictions[0].sourceId) {
        successfulReentrantFixture.engine.directTap(trackRequestReflection(Object.freeze({
          sessionId: 'disconnect-success-consumer-invalid-session',
          generationId: GENERATION_ID,
          effectId: 562,
          sourceId: 'disconnect-success-consumer-blocked-tap',
          scheduledAudioTime: 11.6,
        }), 'successfulConsumerDirectTap', successfulReentrantReflections));
      }
    },
  });
  await activateGeneration(successfulReentrantFixture);
  await schedulePredictionSet(
    successfulReentrantFixture,
    successfulReentrantPredictions,
    561,
  );
  [successfulReentrantOuterSource, successfulReentrantSiblingSource]
    = successfulReentrantFixture.audio.context.sources.slice(-2);
  assert.throws(
    () => successfulReentrantOuterSource.fireCurrentEndedCallback(),
    (error) => error instanceof TypeError && error.message === 'direct tap request is not closed',
  );
  assert.equal(successfulReentrantSiblingDispatch, true);
  assert.deepEqual(successfulReentrantReflections, []);
  assert.equal(successfulReentrantBlockedError instanceof TypeError, true);
  assert.equal(
    successfulReentrantBlockedError.message,
    'direct tap request is not closed',
  );
  assert.deepEqual(successfulReentrantEventsDuringHook, []);
  assert.deepEqual(successfulReentrantInspectionDuringHook.predictions.map((record) => ({
    sourceId: record.sourceId,
    ended: record.ended,
    disconnected: record.disconnected,
  })), [
    {
      sourceId: successfulReentrantPredictions[0].sourceId,
      ended: true,
      disconnected: false,
    },
    {
      sourceId: successfulReentrantPredictions[1].sourceId,
      ended: false,
      disconnected: false,
    },
  ]);
  assert.deepEqual(successfulReentrantEvents, successfulReentrantPredictions.map((prediction) => ({
    type: 'source-ended',
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    sourceId: prediction.sourceId,
    intentional: false,
  })));
  assert.deepEqual(successfulReentrantFixture.engine.inspect().predictions, []);
  assertSourceReferencesClearedOnce(successfulReentrantOuterSource);
  assertSourceReferencesClearedOnce(successfulReentrantSiblingSource);

  async function assertFirstAbruptValuePreserved(firstValue, label, effectId) {
    const offeredSourceIds = [];
    let abruptFixture = null;
    let outerSource = null;
    let laterSource = null;
    abruptFixture = await createFixture({
      audio: {
        onDisconnect(node) {
          if (node === outerSource) laterSource.fireCapturedEndedCallback();
        },
      },
      onEvent(event) {
        offeredSourceIds.push(event.sourceId);
        if (event.sourceId === `${label}-outer`) throw firstValue;
        if (event.sourceId === `${label}-later`) {
          throw new Error(`PRIVATE_${label.toUpperCase()}_LATER_ABRUPT`);
        }
      },
    });
    await activateGeneration(abruptFixture);
    await schedulePredictionSet(abruptFixture, [
      { sourceId: `${label}-outer`, scheduledAudioTime: 10.8 },
      { sourceId: `${label}-later`, scheduledAudioTime: 11.0 },
    ], effectId);
    [outerSource, laterSource] = abruptFixture.audio.context.sources.slice(-2);
    let hasAbrupt = false;
    let abruptValue;
    try { outerSource.fireCurrentEndedCallback(); } catch (error) {
      hasAbrupt = true;
      abruptValue = error;
    }
    assert.deepEqual(offeredSourceIds, [`${label}-outer`, `${label}-later`]);
    assert.deepEqual(abruptFixture.engine.inspect().predictions, []);
    assertSourceReferencesClearedOnce(outerSource);
    assertSourceReferencesClearedOnce(laterSource);
    assert.equal(hasAbrupt, true);
    assert.equal(Object.is(abruptValue, firstValue), true);
  }

  await assertFirstAbruptValuePreserved(null, 'null-abrupt', 570);
  await assertFirstAbruptValuePreserved(undefined, 'undefined-abrupt', 572);

  const staleInterpositionEvents = [];
  let staleInterpositionFixture = null;
  let staleInterpositionOuterSource = null;
  let staleInterpositionLaterSource = null;
  let staleInterpositionStaleDispatch = null;
  let staleInterpositionLaterDispatch = null;
  staleInterpositionFixture = await createFixture({
    audio: {
      onDisconnect(node) {
        if (node !== staleInterpositionOuterSource) return;
        staleInterpositionStaleDispatch = staleInterpositionStaleSource
          .fireCapturedEndedCallback();
        staleInterpositionLaterDispatch = staleInterpositionLaterSource
          .fireCapturedEndedCallback();
      },
    },
    onEvent(event) { staleInterpositionEvents.push(event.sourceId); },
  });
  await activateGeneration(staleInterpositionFixture);
  const staleInterpositionStaleTap = staleInterpositionFixture.engine.directTap(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 573,
    sourceId: 'stale-interposition-revoked',
    scheduledAudioTime: 10.8,
  }));
  assert.equal((await staleInterpositionStaleTap.settlement).status, 'succeeded');
  const staleInterpositionStaleSource = staleInterpositionFixture.audio.context.sources.at(-1);
  assert.equal(staleInterpositionStaleSource.fireCurrentEndedCallback(), true);
  assertSourceReferencesClearedOnce(staleInterpositionStaleSource);

  for (const [effectId, sourceId, scheduledAudioTime] of [
    [574, 'stale-interposition-outer', 11.0],
    [575, 'stale-interposition-later', 11.2],
  ]) {
    const tap = staleInterpositionFixture.engine.directTap(Object.freeze({
      sessionId: SESSION_ID,
      generationId: GENERATION_ID,
      effectId,
      sourceId,
      scheduledAudioTime,
    }));
    assert.equal((await tap.settlement).status, 'succeeded');
  }
  [staleInterpositionOuterSource, staleInterpositionLaterSource]
    = staleInterpositionFixture.audio.context.sources.slice(-2);
  assert.equal(staleInterpositionOuterSource.fireCurrentEndedCallback(), true);
  assert.equal(staleInterpositionStaleDispatch, true);
  assert.equal(staleInterpositionLaterDispatch, true);
  assert.deepEqual(staleInterpositionEvents, [
    'stale-interposition-revoked',
    'stale-interposition-outer',
    'stale-interposition-later',
  ]);
  assert.equal(
    staleInterpositionFixture.engine.inspect().predictions.some(({ sourceId }) => (
      sourceId === 'stale-interposition-later'
    )),
    false,
  );
  assertSourceReferencesClearedOnce(staleInterpositionStaleSource);
  assertSourceReferencesClearedOnce(staleInterpositionOuterSource);
  assertSourceReferencesClearedOnce(staleInterpositionLaterSource);

  const crossOwnerFixture = await createFixture();
  const crossOwnerReceipt = crossOwnerFixture.receipts.mint();
  let receipt = null;
  let reentrantCleanup = null;
  let reentrantReplay = null;
  let siblingCallback = null;
  let siblingDispatch = null;
  let siblingEvidenceDuringFact = null;
  let inspectionDuringFact = null;
  let rejectedOwnerBefore = null;
  let rejectedOwnerAfter = null;
  let terminalOwnerDuringConsumer = null;
  let nestedTrapCalls = 0;
  const ordinaryReflections = [];
  const proxyReflections = [];
  const authorizationAttempts = [];

  function captureAuthorizationAttempt(name, invoke) {
    let result;
    let error;
    try { result = invoke(); } catch (caught) { error = caught; }
    authorizationAttempts.push(Object.freeze({ name, result, error }));
  }

  const reentrantConsumer = await createAutonomousFaultFixture({
    role: 'track',
    consumer(event, fixture) {
      inspectionDuringFact = fixture.engine.inspect();
      siblingDispatch = siblingCallback();
      siblingEvidenceDuringFact = Object.freeze({
        inspection: fixture.engine.inspect(),
        disconnectCalls: sibling.disconnectCalls,
        onendedClearCalls: sibling.onendedClearCalls,
        bufferClearCalls: sibling.bufferClearCalls,
        connectionCount: sibling.connections.length,
      });
      const ownerSnapshot = () => Object.freeze({
        inspection: fixture.engine.inspect(),
        sourceEvidence: fixture.audio.context.sources.map((source) => Object.freeze({
          disconnectCalls: source.disconnectCalls,
          onendedClearCalls: source.onendedClearCalls,
          bufferClearCalls: source.bufferClearCalls,
          connectionCount: source.connections.length,
        })),
        gainEvidence: fixture.audio.context.gains.map((gain) => Object.freeze({
          disconnectCalls: gain.disconnectCalls,
          connectionCount: gain.connections.length,
        })),
        eventCount: fixture.audio.events.length,
        factCount: reentrantConsumer.emittedEvents.length,
      });
      const terminationRequest = (
        terminalRecordReceipt,
        generationId = GENERATION_ID,
        effectId = 580,
      ) => Object.freeze({
        sessionId: SESSION_ID,
        generationId,
        effectId,
        terminalRecordReceipt,
        audioNow: 10.5,
      });

      const invalidSessionId = 'fault-consumer-invalid-session';
      const ordinaryRequests = Object.freeze({
        directTap: Object.freeze({
          sessionId: invalidSessionId,
          generationId: GENERATION_ID,
          effectId: 574,
          sourceId: 'fault-consumer-blocked-tap',
          scheduledAudioTime: 11.5,
        }),
        schedulePredictions: Object.freeze({
          sessionId: invalidSessionId,
          generationId: GENERATION_ID,
          effectId: 575,
          predictions: Object.freeze([Object.freeze({
            sourceId: 'fault-consumer-blocked-prediction',
            scheduledAudioTime: 11.6,
          })]),
        }),
        cancelPredictions: Object.freeze({
          sessionId: invalidSessionId,
          generationId: GENERATION_ID,
          effectId: 576,
          sourceIds: Object.freeze(['ack-1']),
          audioNow: 10.5,
        }),
        commitHandoff: Object.freeze({
          ...handoffRequest(createPlan()),
          sessionId: invalidSessionId,
          effectId: 577,
        }),
      });
      const ordinaryCommands = Object.freeze({
        directTap: (request) => fixture.engine.directTap(request),
        schedulePredictions: (request) => fixture.engine.schedulePredictions(request),
        cancelPredictions: (request) => fixture.engine.cancelPredictions(request),
        commitHandoff: (request) => fixture.engine.commitHandoff(request),
      });

      rejectedOwnerBefore = ownerSnapshot();
      for (const [name, invoke] of Object.entries(ordinaryCommands)) {
        captureAuthorizationAttempt(name, () => invoke(trackRequestReflection(
          ordinaryRequests[name],
          name,
          ordinaryReflections,
        )));
      }
      captureAuthorizationAttempt('wrong-receipt', () => (
        fixture.engine.terminateGeneration(terminationRequest(Object.freeze({}), GENERATION_ID, 581))
      ));
      captureAuthorizationAttempt('wrong-generation', () => (
        fixture.engine.terminateGeneration(terminationRequest(receipt, GENERATION_ID + 1, 582))
      ));
      captureAuthorizationAttempt('cross-owner', () => (
        fixture.engine.terminateGeneration(terminationRequest(crossOwnerReceipt, GENERATION_ID, 583))
      ));
      captureAuthorizationAttempt('forged-request', () => (
        fixture.engine.terminateGeneration(Object.assign(Object.create(null), {
          sessionId: SESSION_ID,
          generationId: GENERATION_ID,
          effectId: 584,
          terminalRecordReceipt: receipt,
          audioNow: 10.5,
        }))
      ));
      captureAuthorizationAttempt('proxy-request', () => (
        fixture.engine.terminateGeneration(trackRequestReflection(
          terminationRequest(receipt, GENERATION_ID + 1, 585),
          'proxyTermination',
          proxyReflections,
        ))
      ));

      const nestedOuterTarget = terminationRequest(receipt, GENERATION_ID, 586);
      const nestedOuterRequest = new Proxy(nestedOuterTarget, {
        getPrototypeOf(target) {
          nestedTrapCalls += 1;
          captureAuthorizationAttempt('nested-request', () => (
            fixture.engine.terminateGeneration(terminationRequest(receipt, GENERATION_ID, 587))
          ));
          return Reflect.getPrototypeOf(target);
        },
      });
      captureAuthorizationAttempt('sticky-poisoned-outer-request', () => (
        fixture.engine.terminateGeneration(nestedOuterRequest)
      ));
      rejectedOwnerAfter = ownerSnapshot();

      captureAuthorizationAttempt('initial-exact-termination', () => {
        reentrantCleanup = fixture.engine.terminateGeneration(
          terminationRequest(receipt, GENERATION_ID, 588),
        );
        return reentrantCleanup;
      });
      captureAuthorizationAttempt('same-receipt-active-replay', () => {
        reentrantReplay = fixture.engine.terminateGeneration(
          terminationRequest(receipt, GENERATION_ID, 589),
        );
        return reentrantReplay;
      });
      terminalOwnerDuringConsumer = ownerSnapshot();
      assert.equal(event.type, 'generation-cleanup-faulted');
    },
  });
  receipt = reentrantConsumer.fixture.receipts.mint();
  const sibling = reentrantConsumer.fixture.audio.context.sources.find((candidate) => (
    candidate !== reentrantConsumer.faultSource
  ));
  siblingCallback = sibling.endedCallbackHistory[0];
  assert.equal(typeof siblingCallback, 'function');
  assert.equal(reentrantConsumer.faultSource.fireCurrentEndedCallback(), true);
  const terminalOwnerAfterConsumer = Object.freeze({
    inspection: reentrantConsumer.fixture.engine.inspect(),
    sourceEvidence: reentrantConsumer.fixture.audio.context.sources.map((source) => Object.freeze({
      disconnectCalls: source.disconnectCalls,
      onendedClearCalls: source.onendedClearCalls,
      bufferClearCalls: source.bufferClearCalls,
      connectionCount: source.connections.length,
    })),
    gainEvidence: reentrantConsumer.fixture.audio.context.gains.map((gain) => Object.freeze({
      disconnectCalls: gain.disconnectCalls,
      connectionCount: gain.connections.length,
    })),
    eventCount: reentrantConsumer.fixture.audio.events.length,
    factCount: reentrantConsumer.emittedEvents.length,
  });

  assert.equal(siblingDispatch, undefined);
  assert.equal(siblingEvidenceDuringFact.disconnectCalls, 0);
  assert.equal(siblingEvidenceDuringFact.onendedClearCalls, 0);
  assert.equal(siblingEvidenceDuringFact.bufferClearCalls, 0);
  assert.equal(siblingEvidenceDuringFact.connectionCount, 1);
  assert.equal(
    siblingEvidenceDuringFact.inspection.predictions.some(({ ended }) => ended),
    false,
  );
  assert.equal(inspectionDuringFact.allocationFrozen, true);
  assert.equal(inspectionDuringFact.graphCreated, true);
  assert.deepEqual(ordinaryReflections, []);
  assert.ok(proxyReflections.length > 0);
  assert.equal(nestedTrapCalls, 1);
  assert.deepEqual(rejectedOwnerAfter, rejectedOwnerBefore);
  assert.deepEqual(terminalOwnerAfterConsumer, terminalOwnerDuringConsumer);
  assert.equal(reentrantConsumer.emittedEvents.length, 1);
  assertExactFact(reentrantConsumer.emittedEvents[0], reentrantConsumer.sourceId);

  const rejectedAttemptNames = Object.freeze([
    'directTap',
    'schedulePredictions',
    'cancelPredictions',
    'commitHandoff',
    'wrong-receipt',
    'wrong-generation',
    'cross-owner',
    'forged-request',
    'proxy-request',
    'nested-request',
    'sticky-poisoned-outer-request',
  ]);
  assert.deepEqual(
    authorizationAttempts.slice(0, rejectedAttemptNames.length).map(({ name }) => name),
    rejectedAttemptNames,
  );
  for (const attempt of authorizationAttempts.slice(0, rejectedAttemptNames.length)) {
    assert.equal(attempt.result, undefined, attempt.name);
    assert.equal(attempt.error instanceof TypeError, true, attempt.name);
  }
  const successfulAttempts = authorizationAttempts.slice(rejectedAttemptNames.length);
  assert.deepEqual(successfulAttempts.map(({ name }) => name), [
    'initial-exact-termination',
    'same-receipt-active-replay',
  ]);
  assert.ok(reentrantCleanup instanceof Promise);
  assert.equal(reentrantReplay, reentrantCleanup);
  assert.equal(successfulAttempts[0].result, reentrantCleanup);
  assert.equal(successfulAttempts[1].result, reentrantCleanup);
  assert.equal(successfulAttempts[0].error, undefined);
  assert.equal(successfulAttempts[1].error, undefined);

  siblingCallback();
  const cleanupResult = await reentrantCleanup;
  assert.equal(await reentrantReplay, cleanupResult);
  assert.deepEqual(cleanupResult, {
    scope: 'generation',
    status: 'failed',
    cause: 'source-stop-failed',
    sourceReferencesCleared: true,
    sourceStopSettled: true,
  });
  assert.deepEqual(reentrantConsumer.fixture.engine.inspect(), {
    sessionId: SESSION_ID,
    generationId: null,
    allocationFrozen: true,
    pendingResumeKey: null,
    graphCreated: false,
    predictions: [],
    track: null,
  });
  assert.equal(reentrantConsumer.faultSource.disconnectCalls, 1);
  assert.equal(reentrantConsumer.faultSource.disconnected, false);
  assert.deepEqual(
    reentrantConsumer.faultSource.connections,
    reentrantConsumer.connections,
  );
  assert.equal(reentrantConsumer.emittedEvents.length, 1);
  assert.equal(reentrantConsumer.faultSource.fireCapturedEndedCallback(), true);
  assert.equal(reentrantConsumer.emittedEvents.length, 1);
  assert.equal(reentrantConsumer.faultSource.disconnectCalls, 1);

  const completedReplay = reentrantConsumer.fixture.engine.terminateGeneration(Object.freeze({
    sessionId: SESSION_ID,
    generationId: GENERATION_ID,
    effectId: 590,
    terminalRecordReceipt: receipt,
    audioNow: 10.9,
  }));
  assert.equal(completedReplay, reentrantCleanup);
  assert.equal(await completedReplay, cleanupResult);

  const constrainedChildEnvironment = {
    ...process.env,
    TASK14_5_CONSTRAINED_STACK_CHILD: '1',
  };
  delete constrainedChildEnvironment.NODE_TEST_CONTEXT;
  const constrainedChild = spawnSync(process.execPath, [
    '--stack_size=128',
    '--test',
    '--test-name-pattern=^T8-AUTONOMOUS-CLEANUP-FAULT-FACT$',
    fileURLToPath(import.meta.url),
  ], {
    encoding: 'utf8',
    env: constrainedChildEnvironment,
  });
  assert.equal(
    constrainedChild.status,
    0,
    `${constrainedChild.stdout}\n${constrainedChild.stderr}`,
  );
  assert.match(constrainedChild.stdout, /# pass 1/);
  assert.match(constrainedChild.stdout, /# fail 0/);
});
