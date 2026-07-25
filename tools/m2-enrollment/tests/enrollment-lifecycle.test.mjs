import test from 'node:test';
import assert from 'node:assert/strict';

import * as enrollmentCore from '../enrollment-core.mjs';
import * as enrollmentLifecycle from '../enrollment-lifecycle.mjs';
import * as enrollmentMeasurements from '../enrollment-measurements.mjs';
import * as enrollmentReport from '../enrollment-report.mjs';

const {
  createApplicationMemoryEvidence,
  evaluateApplicationMemoryContract,
} = enrollmentLifecycle;
const {
  analyzeCueEnergy,
  preflightCompressedBytes,
  validateDecodedBounds,
  validateTimingBounds,
} = enrollmentMeasurements;

function validDecoded(overrides = {}) {
  const decoded = {
    durationSeconds: 180,
    channelCount: 2,
    sampleRate: 48_000,
    ...overrides,
  };
  return {
    ...decoded,
    frameCount: Object.hasOwn(overrides, 'frameCount')
      ? overrides.frameCount
      : Number.isFinite(decoded.durationSeconds) && Number.isSafeInteger(decoded.sampleRate)
        ? Math.round(decoded.durationSeconds * decoded.sampleRate)
        : 8_640_000,
  };
}

function validTiming(overrides = {}) {
  return {
    trackBpm: 120,
    targetEntryDownbeatSeconds: 2,
    decodedDurationSeconds: 10,
    ...overrides,
  };
}

function zeroCounters(overrides = {}) {
  return {
    rawBuffers: 0,
    decodedBuffers: 0,
    contexts: 0,
    previewSources: 0,
    sourceRegistries: 0,
    ...overrides,
  };
}

function completedCycle(sha256 = 'a'.repeat(64), overrides = {}) {
  return {
    sha256,
    unloadCompleted: true,
    contextCloseSettled: true,
    counters: zeroCounters(),
    ...overrides,
  };
}

function evaluateCycles(cycles) {
  return evaluateApplicationMemoryContract(createApplicationMemoryEvidence(cycles));
}

function cueInput(channelSamples, overrides = {}) {
  return {
    channelSamples,
    sampleRate: 8_000,
    expectedChannelCount: channelSamples.length,
    ...overrides,
  };
}

const FAILED_MEMORY_CONTRACT = {
  applicationMemoryContractPassed: false,
  completedUnloadCycles: 0,
  matchingAssetIdentity: false,
  ownedReferencesCleared: false,
  contextsCloseSettled: false,
  browserHeapObserved: false,
};

test('application memory contract accepts only opaque application-owned evidence', () => {
  const cycles = [completedCycle(), completedCycle()];
  const token = createApplicationMemoryEvidence(cycles);
  const tokenProxy = new Proxy(token, {});
  const craftedToken = Object.freeze(Object.create(null));
  const { proxy: revokedToken, revoke } = Proxy.revocable(token, {});
  revoke();

  assert.deepEqual(evaluateApplicationMemoryContract(token), {
    applicationMemoryContractPassed: true,
    completedUnloadCycles: 2,
    matchingAssetIdentity: true,
    ownedReferencesCleared: true,
    contextsCloseSettled: true,
    browserHeapObserved: false,
  });
  for (const invalidEvidence of [cycles, tokenProxy, craftedToken, revokedToken, null, {}]) {
    assert.deepEqual(evaluateApplicationMemoryContract(invalidEvidence), FAILED_MEMORY_CONTRACT);
  }
  assert.equal(Object.isFrozen(token), true);
  assert.equal(Object.getPrototypeOf(token), null);
  assert.deepEqual(Reflect.ownKeys(token), []);
  assert.throws(() => {
    token.cycles = cycles;
  }, TypeError);
});

test('application memory evidence snapshots approved values independently of caller mutation', () => {
  const cycles = [completedCycle(), completedCycle()];
  const token = createApplicationMemoryEvidence(cycles);
  cycles[0].sha256 = 'b'.repeat(64);
  cycles[1].counters.rawBuffers = 1;
  cycles.length = 0;

  assert.equal(evaluateApplicationMemoryContract(token).applicationMemoryContractPassed, true);
});

test('application memory contract requires two matching completed cycles with settled closes and cleared references', () => {
  const result = evaluateCycles([completedCycle(), completedCycle()]);

  assert.deepEqual(result, {
    applicationMemoryContractPassed: true,
    completedUnloadCycles: 2,
    matchingAssetIdentity: true,
    ownedReferencesCleared: true,
    contextsCloseSettled: true,
    browserHeapObserved: false,
  });
});

test('application memory contract rejects incomplete or mismatched unload cycles', () => {
  assert.equal(
    evaluateCycles([completedCycle(), completedCycle('b'.repeat(64))]).applicationMemoryContractPassed,
    false,
  );
  assert.equal(evaluateCycles([
    completedCycle(),
    completedCycle('a'.repeat(64), { unloadCompleted: false }),
  ]).applicationMemoryContractPassed, false);
});

test('application memory evidence requires lowercase 64-hex SHA-256 identities', () => {
  for (const sha256 of [
    'a'.repeat(63),
    'A'.repeat(64),
    `${'a'.repeat(63)}g`,
    '',
  ]) {
    assert.throws(
      () => createApplicationMemoryEvidence([completedCycle(sha256), completedCycle(sha256)]),
      TypeError,
      JSON.stringify(sha256),
    );
  }
});

test('application memory evidence requires exactly two cycles', () => {
  for (const cycles of [
    [completedCycle()],
    [completedCycle(), completedCycle(), completedCycle()],
  ]) {
    assert.throws(() => createApplicationMemoryEvidence(cycles), TypeError);
  }
});

test('application memory contract requires every application-owned counter to equal zero', () => {
  for (const counter of ['rawBuffers', 'decodedBuffers', 'contexts', 'previewSources', 'sourceRegistries']) {
    const cycles = [completedCycle(), completedCycle()];
    cycles[1].counters[counter] = 1;
    const result = evaluateCycles(cycles);
    assert.equal(result.ownedReferencesCleared, false, counter);
    assert.equal(result.applicationMemoryContractPassed, false, counter);
  }
});

test('application memory evidence requires nonnegative safe-integer counters', () => {
  for (const invalidCounter of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '0']) {
    const cycles = [completedCycle(), completedCycle()];
    cycles[1].counters.rawBuffers = invalidCounter;
    assert.throws(() => createApplicationMemoryEvidence(cycles), TypeError, String(invalidCounter));
  }
});

test('application memory contract requires both context closes to settle successfully', () => {
  const cycles = [completedCycle(), completedCycle()];
  cycles[1].contextCloseSettled = false;
  const result = evaluateCycles(cycles);

  assert.equal(result.contextsCloseSettled, false);
  assert.equal(result.applicationMemoryContractPassed, false);
});

test('application memory evidence requires direct boolean lifecycle controls', () => {
  for (const [key, invalidValue] of [
    ['unloadCompleted', 1],
    ['unloadCompleted', 'true'],
    ['contextCloseSettled', 0],
    ['contextCloseSettled', null],
  ]) {
    const cycles = [completedCycle(), completedCycle()];
    cycles[1][key] = invalidValue;
    assert.throws(() => createApplicationMemoryEvidence(cycles), TypeError, `${key}: ${String(invalidValue)}`);
  }
});

test('application memory evidence rejects sparse, inherited, accessor, extra, missing, and non-plain cycle records', () => {
  let getterCalls = 0;
  const accessorCycle = completedCycle();
  Object.defineProperty(accessorCycle, 'sha256', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'a'.repeat(64);
    },
  });
  const inheritedCycle = Object.create(completedCycle());
  const extraCycle = { ...completedCycle(), privatePath: '/private/audio.mp3' };
  const missingCycle = completedCycle();
  delete missingCycle.unloadCompleted;
  const nullPrototypeCycle = Object.assign(Object.create(null), completedCycle());
  const classCycle = new (class Cycle {})();
  Object.assign(classCycle, completedCycle());
  const accessorArray = [completedCycle(), completedCycle()];
  Object.defineProperty(accessorArray, '1', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return completedCycle();
    },
  });
  const extraArray = [completedCycle(), completedCycle()];
  extraArray.privatePath = '/private/audio.mp3';

  const malformedCycleArrays = [
    [completedCycle(), ,],
    accessorArray,
    extraArray,
    [completedCycle(), inheritedCycle],
    [completedCycle(), accessorCycle],
    [completedCycle(), extraCycle],
    [completedCycle(), missingCycle],
    [completedCycle(), nullPrototypeCycle],
    [completedCycle(), classCycle],
    [completedCycle(), null],
  ];
  for (const cycles of malformedCycleArrays) {
    assert.throws(() => createApplicationMemoryEvidence(cycles), TypeError);
  }
  assert.equal(getterCalls, 0);
});

test('application memory evidence rejects inherited, accessor, extra, missing, and non-plain counter records', () => {
  let getterCalls = 0;
  const accessorCounters = zeroCounters();
  Object.defineProperty(accessorCounters, 'rawBuffers', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 0;
    },
  });
  const inheritedCounters = Object.create(zeroCounters());
  const extraCounters = { ...zeroCounters(), browserHeapBytes: 0 };
  const missingCounters = zeroCounters();
  delete missingCounters.rawBuffers;
  const nullPrototypeCounters = Object.assign(Object.create(null), zeroCounters());
  const classCounters = new (class Counters {})();
  Object.assign(classCounters, zeroCounters());

  for (const counters of [
    inheritedCounters,
    accessorCounters,
    extraCounters,
    missingCounters,
    nullPrototypeCounters,
    classCounters,
    null,
  ]) {
    const cycles = [completedCycle(), completedCycle('a'.repeat(64), { counters })];
    assert.throws(() => createApplicationMemoryEvidence(cycles), TypeError);
  }
  assert.equal(getterCalls, 0);
});

test('application memory evidence canonicalizes transparent proxy input into fresh branded evidence', () => {
  const firstCounters = new Proxy(zeroCounters(), {});
  const firstCycle = new Proxy(completedCycle('a'.repeat(64), { counters: firstCounters }), {});
  const cycles = new Proxy([firstCycle, completedCycle()], {});

  const evidence = createApplicationMemoryEvidence(cycles);

  assert.equal(evaluateApplicationMemoryContract(evidence).applicationMemoryContractPassed, true);
  assert.notStrictEqual(evidence, cycles);
});

test('application memory factory throws for trap-failing proxies while evaluator rejects them without nested access', () => {
  const throwingProxy = new Proxy({}, {
    getOwnPropertyDescriptor() {
      throw new Error('descriptor trap must be contained');
    },
    getPrototypeOf() {
      throw new Error('prototype trap must be contained');
    },
    ownKeys() {
      throw new Error('ownKeys trap must be contained');
    },
  });
  const { proxy: revokedProxy, revoke } = Proxy.revocable({}, {});
  revoke();
  const counterTrapCycle = completedCycle();
  counterTrapCycle.counters = throwingProxy;
  const arrayTrapProxy = new Proxy([completedCycle(), completedCycle()], {
    ownKeys() {
      throw new Error('array ownKeys trap must be contained');
    },
  });

  for (const cycles of [
    throwingProxy,
    revokedProxy,
    [completedCycle(), throwingProxy],
    [completedCycle(), revokedProxy],
    [completedCycle(), counterTrapCycle],
    arrayTrapProxy,
  ]) {
    assert.throws(() => createApplicationMemoryEvidence(cycles));
    assert.doesNotThrow(() => evaluateApplicationMemoryContract(cycles));
    assert.deepEqual(evaluateApplicationMemoryContract(cycles), FAILED_MEMORY_CONTRACT);
  }
});

test('application memory evaluator rejects raw arrays without executing nested data access', () => {
  let getterCalls = 0;
  const cycle = completedCycle();
  Object.defineProperty(cycle, 'sha256', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });
  const rawCycles = [completedCycle(), cycle];

  assert.deepEqual(evaluateApplicationMemoryContract(rawCycles), FAILED_MEMORY_CONTRACT);
  assert.equal(getterCalls, 0);
});

test('application memory evaluator returns fresh result objects without browser or process release claims', () => {
  const evidence = createApplicationMemoryEvidence([completedCycle(), completedCycle()]);
  const first = evaluateApplicationMemoryContract(evidence);
  const second = evaluateApplicationMemoryContract(evidence);

  assert.notStrictEqual(first, second);
  assert.deepEqual(Object.keys(first), [
    'applicationMemoryContractPassed',
    'completedUnloadCycles',
    'matchingAssetIdentity',
    'ownedReferencesCleared',
    'contextsCloseSettled',
    'browserHeapObserved',
  ]);
  for (const unsupportedClaim of ['memoryEnvelopeCompliant', 'browserMemoryReleased', 'nativeMemoryReleased', 'processMemoryReleased']) {
    assert.equal(Object.hasOwn(first, unsupportedClaim), false, unsupportedClaim);
  }
});

test('pure contract helpers never return a mutable shared result object', () => {
  const firstPreflight = preflightCompressedBytes(1);
  const secondPreflight = preflightCompressedBytes(1);
  const firstDecoded = validateDecodedBounds(validDecoded());
  const secondDecoded = validateDecodedBounds(validDecoded());
  const firstTiming = validateTimingBounds(validTiming());
  const secondTiming = validateTimingBounds(validTiming());
  const firstCue = analyzeCueEnergy(cueInput([Array(400).fill(0.05)]));
  const secondCue = analyzeCueEnergy(cueInput([Array(400).fill(0.05)]));
  const memoryEvidence = createApplicationMemoryEvidence([completedCycle(), completedCycle()]);
  const firstMemory = evaluateApplicationMemoryContract(memoryEvidence);
  const secondMemory = evaluateApplicationMemoryContract(memoryEvidence);

  assert.notStrictEqual(firstPreflight, secondPreflight);
  assert.notStrictEqual(firstDecoded, secondDecoded);
  assert.notStrictEqual(firstTiming, secondTiming);
  assert.notStrictEqual(firstCue, secondCue);
  assert.notStrictEqual(firstMemory, secondMemory);
});

test('compatibility facade exports exactly the seven legacy APIs with direct-module identity', () => {
  const directPublicApis = {
    analyzeCueEnergy: enrollmentMeasurements.analyzeCueEnergy,
    createSanitizedReport: enrollmentReport.createSanitizedReport,
    evaluateApplicationMemoryContract: enrollmentLifecycle.evaluateApplicationMemoryContract,
    preflightCompressedBytes: enrollmentMeasurements.preflightCompressedBytes,
    serializeSanitizedReport: enrollmentReport.serializeSanitizedReport,
    validateDecodedBounds: enrollmentMeasurements.validateDecodedBounds,
    validateTimingBounds: enrollmentMeasurements.validateTimingBounds,
  };

  assert.deepEqual(Object.keys(enrollmentCore), Object.keys(directPublicApis));
  for (const [exportName, directExport] of Object.entries(directPublicApis)) {
    assert.strictEqual(enrollmentCore[exportName], directExport, exportName);
  }
  assert.equal(Object.hasOwn(enrollmentCore, 'MEASUREMENT_LIMITS'), false);
});
