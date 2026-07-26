const COUNTER_KEYS = Object.freeze([
  'rawBuffers',
  'decodedBuffers',
  'contexts',
  'previewSources',
  'sourceRegistries',
]);

export class EnrollmentBrowserError extends Error {
  constructor(code, detailCode = null) {
    super(code);
    this.name = 'EnrollmentBrowserError';
    this.code = code;
    if (detailCode !== null) this.detailCode = detailCode;
  }
}

export function typedError(code, detailCode = null) {
  return new EnrollmentBrowserError(code, detailCode);
}

export function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

export function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

export function operationOutcome(value) {
  if (!isObjectLike(value)) return Promise.resolve({ kind: 'dependency-error' });
  let thenMethod;
  try {
    thenMethod = value.then;
  } catch {
    return Promise.resolve({ kind: 'dependency-error' });
  }
  if (typeof thenMethod !== 'function') return Promise.resolve({ kind: 'dependency-error' });
  return new Promise((resolve, reject) => {
    try {
      thenMethod.call(value, resolve, reject);
    } catch (error) {
      reject(error);
    }
  }).then(
    (result) => ({ kind: 'value', value: result }),
    () => ({ kind: 'dependency-error' }),
  );
}

export function copyCounters(source) {
  return Object.fromEntries(COUNTER_KEYS.map((key) => [key, source[key]]));
}

export function copyCycle(cycle) {
  return {
    sha256: cycle.sha256,
    unloadCompleted: cycle.unloadCompleted,
    contextCloseSettled: cycle.contextCloseSettled,
    counters: copyCounters(cycle.counters),
  };
}

export function copyTeardownResult(result) {
  if (result.ok) {
    return {
      ok: true,
      cycle: copyCycle(result.cycle),
    };
  }
  return {
    ok: false,
    errorCode: result.errorCode,
    recovery: 'reload',
    cycle: copyCycle(result.cycle),
  };
}

export { COUNTER_KEYS };
