import { assertEnrollmentBuildCommit } from './enrollment-build.mjs';

assertEnrollmentBuildCommit('__ENROLLMENT_BUILD_COMMIT__');

const COUNTER_KEYS = Object.freeze([
  'rawBuffers',
  'decodedBuffers',
  'contexts',
  'previewSources',
  'sourceRegistries',
]);

const CYCLE_KEYS = Object.freeze([
  'sha256',
  'unloadCompleted',
  'contextCloseSettled',
  'counters',
]);

const APPLICATION_MEMORY_SNAPSHOTS = new WeakMap();
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function requireNonnegativeSafeInteger(value, fieldName, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`${fieldName} must be a nonnegative safe integer no greater than ${maximum}`);
  }
}

function copyNullPrototypeRecord(source, keys) {
  const copy = Object.create(null);
  for (const key of keys) {
    copy[key] = source[key];
  }
  return copy;
}

function memoryContractResult({
  completedUnloadCycles = 0,
  matchingAssetIdentity = false,
  ownedReferencesCleared = false,
  contextsCloseSettled = false,
} = {}) {
  return {
    applicationMemoryContractPassed: completedUnloadCycles === 2
      && matchingAssetIdentity
      && ownedReferencesCleared
      && contextsCloseSettled,
    completedUnloadCycles,
    matchingAssetIdentity,
    ownedReferencesCleared,
    contextsCloseSettled,
    browserHeapObserved: false,
  };
}

function snapshotStrictPlainDataRecord(source, keys, objectName) {
  if (source === null
      || typeof source !== 'object'
      || Object.getPrototypeOf(source) !== Object.prototype) {
    throw new TypeError(`${objectName} must be a strict plain object`);
  }
  const ownKeys = Reflect.ownKeys(source);
  if (ownKeys.length !== keys.length
      || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    throw new TypeError(`${objectName} must contain exactly the approved keys`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(source);
  return Object.fromEntries(keys.map((key) => {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${objectName}.${key} must be a direct data property`);
    }
    return [key, descriptor.value];
  }));
}

function snapshotMemoryCycles(cycles) {
  if (!Array.isArray(cycles) || Object.getPrototypeOf(cycles) !== Array.prototype) {
    throw new TypeError('cycles must be an array');
  }
  const ownKeys = Reflect.ownKeys(cycles);
  if (ownKeys.length !== 3
      || !ownKeys.includes('0')
      || !ownKeys.includes('1')
      || !ownKeys.includes('length')) {
    throw new TypeError('cycles must contain exactly two records');
  }
  const descriptors = Object.getOwnPropertyDescriptors(cycles);
  if (descriptors.length.value !== 2
      || !Object.hasOwn(descriptors[0], 'value')
      || !Object.hasOwn(descriptors[1], 'value')) {
    throw new TypeError('cycles must contain two direct data properties');
  }

  const cycleSnapshots = [descriptors[0].value, descriptors[1].value].map((cycle, index) => {
    const objectName = `cycles[${index}]`;
    const cycleSnapshot = snapshotStrictPlainDataRecord(cycle, CYCLE_KEYS, objectName);
    if (typeof cycleSnapshot.sha256 !== 'string' || !SHA256_PATTERN.test(cycleSnapshot.sha256)) {
      throw new TypeError(`${objectName}.sha256 must be a lowercase 64-hex SHA-256`);
    }
    for (const key of ['unloadCompleted', 'contextCloseSettled']) {
      if (typeof cycleSnapshot[key] !== 'boolean') {
        throw new TypeError(`${objectName}.${key} must be a boolean`);
      }
    }

    const counterObjectName = `${objectName}.counters`;
    const counterSnapshot = snapshotStrictPlainDataRecord(
      cycleSnapshot.counters,
      COUNTER_KEYS,
      counterObjectName,
    );
    for (const key of COUNTER_KEYS) {
      requireNonnegativeSafeInteger(counterSnapshot[key], `${counterObjectName}.${key}`);
    }

    return Object.freeze(Object.assign(Object.create(null), {
      sha256: cycleSnapshot.sha256,
      unloadCompleted: cycleSnapshot.unloadCompleted,
      contextCloseSettled: cycleSnapshot.contextCloseSettled,
      counters: Object.freeze(copyNullPrototypeRecord(counterSnapshot, COUNTER_KEYS)),
    }));
  });

  return Object.freeze(Object.assign(Object.create(null), {
    0: cycleSnapshots[0],
    1: cycleSnapshots[1],
    length: 2,
  }));
}

export function createApplicationMemoryEvidence(cycles) {
  const snapshot = snapshotMemoryCycles(cycles);
  const evidence = Object.freeze(Object.create(null));
  APPLICATION_MEMORY_SNAPSHOTS.set(evidence, snapshot);
  return evidence;
}

export function evaluateApplicationMemoryContract(evidence) {
  const snapshot = (evidence !== null && typeof evidence === 'object')
    ? APPLICATION_MEMORY_SNAPSHOTS.get(evidence)
    : undefined;
  if (snapshot === undefined) {
    return memoryContractResult();
  }

  const firstCycle = snapshot[0];
  const secondCycle = snapshot[1];
  const completedUnloadCycles = Number(firstCycle.unloadCompleted === true)
    + Number(secondCycle.unloadCompleted === true);
  const matchingAssetIdentity = firstCycle.sha256 === secondCycle.sha256;
  const ownedReferencesCleared = COUNTER_KEYS.every(
    (key) => firstCycle.counters[key] === 0 && secondCycle.counters[key] === 0,
  );
  const contextsCloseSettled = firstCycle.contextCloseSettled === true
    && secondCycle.contextCloseSettled === true;

  return memoryContractResult({
    completedUnloadCycles,
    matchingAssetIdentity,
    ownedReferencesCleared,
    contextsCloseSettled,
  });
}
