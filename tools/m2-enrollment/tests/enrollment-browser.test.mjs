import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createApplicationMemoryEvidence, evaluateApplicationMemoryContract } from '../enrollment-lifecycle.mjs';
import { createEnrollmentBrowserController } from '../enrollment-browser.mjs';
import {
  FakeAudioBuffer,
  FakeAudioContext,
  FakeBufferSource,
  FakeFile,
  FakeFileInput,
  containsBinary,
  cryptoHarness,
  deferred,
  flushMicrotasks,
  sequenceGetter,
  timerHarness,
} from './fake-audio.mjs';

const MiB = 1024 * 1024;
const LOWERCASE_SHA = 'ab'.repeat(32);
const PRIVATE_FILENAME = 'Tony-private-island-party.mp3';
const TEST_ASSERTION_BOUND_MILLISECONDS = 9_999;
const COUNTER_KEYS = [
  'rawBuffers',
  'decodedBuffers',
  'contexts',
  'previewSources',
  'sourceRegistries',
];

function createHarness({
  contexts = [new FakeAudioContext()],
  crypto = cryptoHarness(),
  timers = timerHarness(),
} = {}) {
  let contextIndex = 0;
  const contextAllocations = [];
  const controller = createEnrollmentBrowserController({
    allowedMimeType: 'audio/mpeg',
    digest: crypto.digest,
    createAudioContext() {
      const context = contexts[contextIndex];
      contextIndex += 1;
      if (context === undefined) throw new Error('unexpected AudioContext allocation');
      contextAllocations.push(context);
      return context;
    },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  return {
    controller,
    contextAllocations,
    contexts,
    crypto,
    timers,
  };
}

function selection(overrides = {}) {
  const file = overrides.file ?? new FakeFile({ name: PRIVATE_FILENAME });
  const fileInput = overrides.fileInput ?? new FakeFileInput('C:\\fakepath\\private.mp3');
  return { file, fileInput };
}

async function captureError(action) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  assert.fail('expected operation to fail');
}

async function expectCode(action, code) {
  const error = await captureError(action);
  assert.equal(error?.code, code);
  return error;
}

function counters(controller) {
  const value = controller.snapshot().counters;
  assert.deepEqual(Object.keys(value), COUNTER_KEYS);
  return value;
}

function assertPrivacySafe(value, privateNeedles = [
  PRIVATE_FILENAME,
  '/Users/tony/Music/private.mp3',
  'file:///private/audio',
  'C:\\fakepath',
]) {
  assert.equal(containsBinary(value), false, 'public value must not retain bytes, samples, or typed-array views');
  const seen = new Set();
  const inspect = (candidate) => {
    if (typeof candidate === 'string') {
      for (const needle of privateNeedles) {
        assert.equal(candidate.includes(needle), false, `public value leaked ${needle}`);
      }
      return;
    }
    if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function')) return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    for (const key of Reflect.ownKeys(candidate)) {
      if (typeof key === 'string') {
        assert.doesNotMatch(key, /^(?:filename|fileName|path|uri|url|bytes|samples|channelData)$/i);
      }
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (descriptor !== undefined && Object.hasOwn(descriptor, 'value')) inspect(descriptor.value);
    }
  };
  inspect(value);

  const serialized = JSON.stringify(value);
  for (const needle of privateNeedles) {
    assert.equal(serialized.includes(needle), false, `public value leaked ${needle}`);
  }
  for (const forbiddenKey of ['filename', 'fileName', 'path', 'uri', 'url', 'bytes', 'samples', 'channelData']) {
    assert.equal(new RegExp(`"${forbiddenKey}"`, 'i').test(serialized), false, `public value exposed ${forbiddenKey}`);
  }
}

async function loadReady(controller, overrides = {}) {
  const selected = selection(overrides);
  const result = await controller.load(selected);
  return { ...selected, result };
}

async function finishSuccessfulUnload(controller, context) {
  const pending = controller.unload();
  for (const source of context.sources) source.finish();
  return pending;
}

async function boundedOutcome(promise, timers, { fireDelays = [] } = {}) {
  let guardId;
  const operation = Promise.resolve(promise).then(
    (value) => ({ kind: 'fulfilled', value }),
    (error) => ({ kind: 'rejected', error }),
  );
  const guard = new Promise((resolve) => {
    guardId = timers.setTimeoutFn(
      () => resolve({ kind: 'test-bound-exceeded' }),
      TEST_ASSERTION_BOUND_MILLISECONDS,
    );
  });
  const raced = Promise.race([operation, guard]);

  await flushMicrotasks(20);
  for (const delay of fireDelays) {
    let firings = 0;
    while (timers.activeDelays().includes(delay)) {
      timers.fireDelay(delay);
      await flushMicrotasks();
      firings += 1;
      assert.equal(firings <= 10, true, `too many ${delay} ms timers`);
    }
  }
  if (timers.has(guardId)) timers.fire(guardId);
  const result = await raced;
  timers.clearTimeoutFn(guardId);
  return result;
}

function assertBoundedRejection(outcome, code) {
  assert.equal(outcome.kind, 'rejected', 'invalidated load must reject before the deterministic test bound');
  assert.equal(outcome.error?.code, code);
  assertPrivacySafe(outcome.error);
}


test('public boundary is one injected factory returning the explicit controller contract', async () => {
  const browserModule = await import('../enrollment-browser.mjs');
  assert.deepEqual(Object.keys(browserModule), ['createEnrollmentBrowserController']);

  const { controller } = createHarness();
  for (const methodName of [
    'analyzeCue',
    'cancelLoad',
    'handleForegroundLoss',
    'handlePageHide',
    'load',
    'playPreview',
    'snapshot',
    'stopPreview',
    'unload',
  ]) {
    assert.equal(typeof controller[methodName], 'function', methodName);
  }
  assert.deepEqual(counters(controller), {
    rawBuffers: 0,
    decodedBuffers: 0,
    contexts: 0,
    previewSources: 0,
    sourceRegistries: 0,
  });
  assertPrivacySafe(controller.snapshot());
});

test('compressed size is rejected before arrayBuffer and without constructing a context', async () => {
  const file = new FakeFile({
    name: PRIVATE_FILENAME,
    size: (20 * MiB) + 1,
  });
  const fileInput = new FakeFileInput('C:\\fakepath\\private.mp3');
  const { controller, contexts, crypto } = createHarness();

  const error = await expectCode(
    () => controller.load({ file, fileInput }),
    'compressed-size-limit-exceeded',
  );

  assert.equal(file.arrayBufferCalls, 0);
  assert.equal(fileInput.value, '');
  assert.equal(fileInput.clearCount, 1);
  assert.equal(crypto.calls.length, 0);
  assert.equal(contexts[0].decodeCalls.length, 0);
  assert.equal(contexts[0].closeCalls, 0);
  assertPrivacySafe(error);
});

test('compressed-size rejection precedes MIME property access', async () => {
  const file = new FakeFile({ size: (20 * MiB) + 1 });
  const typeGetter = sequenceGetter(
    file,
    'type',
    [new Error(`${PRIVATE_FILENAME} /Users/tony/Music/private.mp3`)],
  );
  const fileInput = new FakeFileInput('C:\\fakepath\\private.mp3');
  const { controller } = createHarness();

  const error = await expectCode(
    () => controller.load({ file, fileInput }),
    'compressed-size-limit-exceeded',
  );

  assert.equal(typeGetter.reads, 0);
  assert.equal(fileInput.value, '');
  assert.equal(file.arrayBufferCalls, 0);
  assertPrivacySafe(error);
});

test('browser File.type must equal the configured MIME exactly without extension inference', async () => {
  for (const type of ['', 'audio/MP3', 'audio/mp3', 'application/octet-stream', 'audio/mpeg; codecs=mp3']) {
    const file = new FakeFile({ name: `looks-correct-${type.length}.mp3`, type });
    const fileInput = new FakeFileInput('C:\\fakepath\\looks-correct.mp3');
    const { controller, contexts, crypto } = createHarness();

    const error = await expectCode(() => controller.load({ file, fileInput }), 'mime-type-mismatch');

    assert.equal(file.arrayBufferCalls, 0, type);
    assert.equal(file.nameReads, 0, type);
    assert.equal(fileInput.value, '', type);
    assert.equal(crypto.calls.length, 0, type);
    assert.equal(contexts[0].decodeCalls.length, 0, type);
    assertPrivacySafe(error, ['looks-correct', 'C:\\fakepath']);
  }
});

test('SHA-256 is lowercase and completely settled before decode begins', async () => {
  const hash = deferred();
  const crypto = cryptoHarness({ digest: () => hash.promise });
  const context = new FakeAudioContext();
  const { controller } = createHarness({ contexts: [context], crypto });
  const selected = selection();

  const loading = controller.load(selected);
  await flushMicrotasks();

  assert.equal(crypto.calls.length, 1);
  assert.equal(crypto.calls[0].algorithm, 'SHA-256');
  assert.equal(context.decodeCalls.length, 0);
  hash.resolve(Uint8Array.from({ length: 32 }, () => 0xAB).buffer);
  await flushMicrotasks();
  assert.equal(context.decodeCalls.length, 1);

  const result = await loading;
  assert.equal(result.sha256, LOWERCASE_SHA);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assertPrivacySafe(result);
  await finishSuccessfulUnload(controller, context);
});

test('one tokenized load owns one aggregate 15 second hash/decode deadline', async () => {
  const hash = deferred();
  const decode = deferred();
  const crypto = cryptoHarness({ digest: () => hash.promise });
  const context = new FakeAudioContext({ decode: () => decode.promise });
  const { controller, timers } = createHarness({ contexts: [context], crypto });
  const first = selection();
  const second = selection({ file: new FakeFile(), fileInput: new FakeFileInput('second') });

  const loading = controller.load(first);
  await flushMicrotasks();
  assert.deepEqual(timers.calls.filter(({ delay }) => delay === 15_000).map(({ delay }) => delay), [15_000]);
  await expectCode(() => controller.load(second), 'load-already-active');
  assert.equal(second.file.arrayBufferCalls, 0);

  hash.resolve(Uint8Array.from({ length: 32 }, () => 0xAB).buffer);
  await flushMicrotasks();
  assert.equal(context.decodeCalls.length, 1);
  assert.equal(timers.calls.filter(({ delay }) => delay === 15_000).length, 1);

  timers.fireDelay(15_000);
  decode.resolve(context.audioBuffer);
  const error = await expectCode(() => loading, 'hash-decode-timeout');
  assert.equal(context.closeCalls, 1);
  assert.equal(controller.snapshot().state, 'awaiting-file');
  assertPrivacySafe(error);
});

test('cancellation invalidates the token, blocks replacement through teardown, and discards stale decode', async () => {
  const decode = deferred();
  const close = deferred();
  const staleBuffer = new FakeAudioBuffer();
  const staleContext = new FakeAudioContext({
    audioBuffer: staleBuffer,
    decode: () => decode.promise,
    close: () => close.promise,
  });
  const replacementContext = new FakeAudioContext();
  const { controller } = createHarness({ contexts: [staleContext, replacementContext] });
  const first = selection();
  const second = selection({ file: new FakeFile(), fileInput: new FakeFileInput('second') });

  const loading = controller.load(first);
  await flushMicrotasks();
  assert.equal(staleContext.decodeCalls.length, 1);

  const cancellation = controller.cancelLoad();
  await flushMicrotasks();
  assert.equal(staleContext.closeCalls, 1);
  assert.equal(controller.snapshot().replacementAllowed, false);
  await expectCode(() => controller.load(second), 'load-teardown-pending');
  assert.equal(second.file.arrayBufferCalls, 0);

  decode.resolve(staleBuffer);
  await flushMicrotasks();
  assert.notEqual(controller.snapshot().state, 'ready');
  assert.equal(counters(controller).decodedBuffers, 0, 'late decoded result is discarded without taking application ownership');
  close.resolve();
  await cancellation;
  await expectCode(() => loading, 'load-cancelled');

  assert.deepEqual(counters(controller), {
    rawBuffers: 0,
    decodedBuffers: 0,
    contexts: 0,
    previewSources: 0,
    sourceRegistries: 0,
  });
  assert.equal(controller.snapshot().replacementAllowed, true);
  const replacement = await controller.load(second);
  assert.equal(replacement.sha256, LOWERCASE_SHA);
  assert.equal(replacementContext.decodeCalls.length, 1);
  await finishSuccessfulUnload(controller, replacementContext);
});

test('digest settlement followed by immediate cancellation cannot allocate a post-close context', async () => {
  const hash = deferred();
  const context = new FakeAudioContext();
  const crypto = cryptoHarness({ digest: () => hash.promise });
  const {
    controller,
    contextAllocations,
    timers,
  } = createHarness({ contexts: [context], crypto });

  const loading = controller.load(selection());
  await flushMicrotasks();
  assert.equal(crypto.calls.length, 1);

  hash.resolve(Uint8Array.from({ length: 32 }, () => 0xAB).buffer);
  const cancellation = controller.cancelLoad();
  const loadOutcome = await boundedOutcome(loading, timers);
  const cancellationOutcome = await boundedOutcome(cancellation, timers);

  assertBoundedRejection(loadOutcome, 'load-cancelled');
  assert.equal(cancellationOutcome.kind, 'fulfilled');
  assert.equal(cancellationOutcome.value.ok, true);
  assert.equal(contextAllocations.length, 0);
  assert.equal(context.decodeCalls.length, 0);
  assert.equal(context.closeCalls, 0);
  assert.equal(cancellationOutcome.value.cycle.contextCloseSettled, true);
  assert.deepEqual(counters(controller), {
    rawBuffers: 0,
    decodedBuffers: 0,
    contexts: 0,
    previewSources: 0,
    sourceRegistries: 0,
  });
});

test('never-settling read is invalidated promptly and cancellation completes without native settlement', async () => {
  const file = new FakeFile({ read: () => new Promise(() => {}) });
  const { controller, contextAllocations, timers } = createHarness();

  const loading = controller.load({ file, fileInput: new FakeFileInput('pending-read') });
  const cancellation = controller.cancelLoad();
  const loadOutcome = await boundedOutcome(loading, timers);
  const cancellationOutcome = await boundedOutcome(cancellation, timers);

  assertBoundedRejection(loadOutcome, 'load-cancelled');
  assert.equal(cancellationOutcome.kind, 'fulfilled');
  assert.equal(cancellationOutcome.value.ok, true);
  assert.equal(cancellationOutcome.value.cycle.unloadCompleted, true);
  assert.equal(contextAllocations.length, 0);
  assert.deepEqual(counters(controller), {
    rawBuffers: 0,
    decodedBuffers: 0,
    contexts: 0,
    previewSources: 0,
    sourceRegistries: 0,
  });
});

test('never-settling hash rejects promptly and clears application-owned references without native-release claims', async () => {
  const crypto = cryptoHarness({ digest: () => new Promise(() => {}) });
  const { controller, timers } = createHarness({ crypto });

  const loading = controller.load(selection());
  await flushMicrotasks();
  assert.equal(crypto.calls.length, 1);
  const cancellation = controller.cancelLoad();
  const loadOutcome = await boundedOutcome(loading, timers);
  const cancellationOutcome = await boundedOutcome(cancellation, timers);

  assertBoundedRejection(loadOutcome, 'load-cancelled');
  assert.equal(cancellationOutcome.kind, 'fulfilled');
  assert.equal(cancellationOutcome.value.ok, true);
  assert.equal(cancellationOutcome.value.cycle.unloadCompleted, true);
  assert.equal(cancellationOutcome.value.cycle.contextCloseSettled, true);
  assert.deepEqual(counters(controller), {
    rawBuffers: 0,
    decodedBuffers: 0,
    contexts: 0,
    previewSources: 0,
    sourceRegistries: 0,
  });
  assert.equal(controller.snapshot().state, 'awaiting-file');
  assert.equal(controller.snapshot().replacementAllowed, true);
});

test('never-settling decode rejects promptly and successful context close clears application-owned references', async () => {
  const context = new FakeAudioContext({ decode: () => new Promise(() => {}) });
  const { controller, timers } = createHarness({ contexts: [context] });

  const loading = controller.load(selection());
  await flushMicrotasks();
  assert.equal(context.decodeCalls.length, 1);
  const unloading = controller.unload();
  const loadOutcome = await boundedOutcome(loading, timers);
  const unloadOutcome = await boundedOutcome(unloading, timers);

  assertBoundedRejection(loadOutcome, 'load-invalidated');
  assert.equal(unloadOutcome.kind, 'fulfilled');
  assert.equal(unloadOutcome.value.ok, true);
  assert.equal(unloadOutcome.value.cycle.unloadCompleted, true);
  assert.equal(unloadOutcome.value.cycle.contextCloseSettled, true);
  assert.equal(context.closeCalls, 1);
  assert.deepEqual(counters(controller), {
    rawBuffers: 0,
    decodedBuffers: 0,
    contexts: 0,
    previewSources: 0,
    sourceRegistries: 0,
  });
  assert.equal(controller.snapshot().state, 'awaiting-file');
  assert.equal(controller.snapshot().replacementAllowed, true);
});

test('file input is cleared synchronously after File capture on success, cancellation, and failure', async () => {
  {
    const read = deferred();
    const context = new FakeAudioContext();
    const { controller } = createHarness({ contexts: [context] });
    const file = new FakeFile({ read: () => read.promise });
    const fileInput = new FakeFileInput('selected-success');
    const loading = controller.load({ file, fileInput });
    assert.equal(fileInput.value, '');
    assert.equal(fileInput.clearCount, 1);
    read.resolve(file.bytes.slice().buffer);
    await loading;
    assert.equal(fileInput.clearCount, 1);
    await finishSuccessfulUnload(controller, context);
  }

  {
    const read = deferred();
    const { controller } = createHarness();
    const file = new FakeFile({ read: () => read.promise });
    const fileInput = new FakeFileInput('selected-cancel');
    const loading = controller.load({ file, fileInput });
    assert.equal(fileInput.value, '');
    assert.equal(fileInput.clearCount, 1);
    const cancellation = controller.cancelLoad();
    read.resolve(file.bytes.slice().buffer);
    await cancellation;
    await expectCode(() => loading, 'load-cancelled');
    assert.equal(fileInput.clearCount, 1);
  }

  {
    const { controller } = createHarness();
    const file = new FakeFile({ read: () => Promise.reject(new Error(`cannot read ${PRIVATE_FILENAME}`)) });
    const fileInput = new FakeFileInput('selected-failure');
    const loading = controller.load({ file, fileInput });
    assert.equal(fileInput.value, '');
    assert.equal(fileInput.clearCount, 1);
    const error = await expectCode(() => loading, 'track-read-failed');
    assert.equal(fileInput.clearCount, 1);
    assertPrivacySafe(error);
  }
});

test('raw bytes remain owned through hash/decode settlement and are dereferenced afterward', async () => {
  const decode = deferred();
  const context = new FakeAudioContext({ decode: () => decode.promise });
  const { controller } = createHarness({ contexts: [context] });
  const loading = controller.load(selection());
  await flushMicrotasks();

  assert.equal(counters(controller).rawBuffers, 1);
  decode.resolve(context.audioBuffer);
  const result = await loading;
  assert.equal(counters(controller).rawBuffers, 0);
  assert.equal(counters(controller).decodedBuffers, 1);
  assert.equal(containsBinary(result), false);
  assert.equal(containsBinary(controller.snapshot()), false);

  await finishSuccessfulUnload(controller, context);
});

test('decoded metadata is validated through Task 1 exact frame, metadata, and PCM limits', async () => {
  const pcmLimitFrameCount = (160 * MiB) / (2 * 4);
  const invalidCases = [
    [new FakeAudioBuffer({ duration: 361, sampleRate: 8_000, length: 361 * 8_000 }), 'decoded-duration-invalid'],
    [new FakeAudioBuffer({ numberOfChannels: 3 }), 'decoded-channel-count-invalid'],
    [new FakeAudioBuffer({ sampleRate: 7_999, length: 15_998, duration: 2 }), 'decoded-sample-rate-invalid'],
    [new FakeAudioBuffer({ length: 0, duration: 1 }), 'decoded-frame-count-invalid'],
    [new FakeAudioBuffer({ duration: 2 + (2 / 8_000) }), 'decoded-duration-frame-mismatch'],
    [new FakeAudioBuffer({
      sampleRate: 96_000,
      length: pcmLimitFrameCount + 1,
      duration: (pcmLimitFrameCount + 1) / 96_000,
    }), 'decoded-pcm-limit-exceeded'],
  ];

  for (const [audioBuffer, detailCode] of invalidCases) {
    const context = new FakeAudioContext({ audioBuffer });
    const { controller } = createHarness({ contexts: [context] });
    const error = await expectCode(() => controller.load(selection()), 'track-bounds-invalid');
    assert.equal(error.detailCode, detailCode);
    assert.equal(context.closeCalls, 1, detailCode);
    assert.deepEqual(counters(controller), {
      rawBuffers: 0,
      decodedBuffers: 0,
      contexts: 0,
      previewSources: 0,
      sourceRegistries: 0,
    });
    assertPrivacySafe(error);
  }

  const validBuffer = new FakeAudioBuffer();
  const validContext = new FakeAudioContext({ audioBuffer: validBuffer });
  const { controller } = createHarness({ contexts: [validContext] });
  const { result } = await loadReady(controller);
  assert.deepEqual(result.decoded, {
    durationSeconds: 2,
    channelCount: 2,
    sampleRate: 8_000,
    frameCount: 16_000,
    calculatedDecodedPcmBytes: 128_000,
  });
  await finishSuccessfulUnload(controller, validContext);
});

test('decoded metadata getters are read once and the canonical scalars drive validation and public output', async () => {
  const privateDuration = `/Users/tony/Music/private.mp3 ${PRIVATE_FILENAME}`;
  const audioBuffer = new FakeAudioBuffer();
  const context = new FakeAudioContext({ audioBuffer });
  const getters = {
    duration: sequenceGetter(audioBuffer, 'duration', [2, privateDuration]),
    numberOfChannels: sequenceGetter(audioBuffer, 'numberOfChannels', [2, 2]),
    sampleRate: sequenceGetter(audioBuffer, 'sampleRate', [8_000, 8_000]),
    length: sequenceGetter(audioBuffer, 'length', [16_000, 16_000]),
  };
  const { controller } = createHarness({ contexts: [context] });

  const result = await controller.load(selection());

  assert.deepEqual(
    Object.fromEntries(Object.entries(getters).map(([key, getter]) => [key, getter.reads])),
    {
      duration: 1,
      numberOfChannels: 1,
      sampleRate: 1,
      length: 1,
    },
  );
  assert.deepEqual(result.decoded, {
    durationSeconds: 2,
    channelCount: 2,
    sampleRate: 8_000,
    frameCount: 16_000,
    calculatedDecodedPcmBytes: 128_000,
  });
  assertPrivacySafe(result);
  await finishSuccessfulUnload(controller, context);
});

test('malformed context factory values never enter application ownership accounting', async () => {
  const malformedContexts = [
    ['null', null],
    ['primitive', 17],
  ];

  for (const [label, malformedContext] of malformedContexts) {
    const { controller, contextAllocations } = createHarness({ contexts: [malformedContext] });
    const error = await expectCode(() => controller.load(selection()), 'track-decode-failed');

    assert.equal(contextAllocations.length, 1, label);
    assert.deepEqual(counters(controller), {
      rawBuffers: 0,
      decodedBuffers: 0,
      contexts: 0,
      previewSources: 0,
      sourceRegistries: 0,
    }, label);
    assert.equal(controller.snapshot().state, 'awaiting-file', label);
    assert.equal(controller.snapshot().replacementAllowed, true, label);
    assertPrivacySafe(error);
  }
});

test('allocated context without an observable close remains honestly accounted and reload-only', async () => {
  const context = {
    decodeAudioData() {
      return Promise.resolve(new FakeAudioBuffer());
    },
  };
  const { controller } = createHarness({ contexts: [context] });

  const error = await expectCode(() => controller.load(selection()), 'track-decode-failed');

  assertPrivacySafe(error);
  assert.deepEqual(counters(controller), {
    rawBuffers: 0,
    decodedBuffers: 0,
    contexts: 1,
    previewSources: 0,
    sourceRegistries: 0,
  });
  assert.equal(controller.snapshot().state, 'reload-required');
  assert.equal(controller.snapshot().replacementAllowed, false);
});

test('partially malformed allocated context is accounted and closed before replacement', async () => {
  const privateMessage = `${PRIVATE_FILENAME} /Users/tony/Music/private.mp3`;
  const context = new FakeAudioContext();
  Object.defineProperty(context, 'createBufferSource', {
    configurable: true,
    get() {
      throw new Error(privateMessage);
    },
  });
  const { controller } = createHarness({ contexts: [context] });

  const error = await expectCode(() => controller.load(selection()), 'track-decode-failed');

  assertPrivacySafe(error);
  assert.equal(context.closeCalls, 1);
  assert.deepEqual(counters(controller), {
    rawBuffers: 0,
    decodedBuffers: 0,
    contexts: 0,
    previewSources: 0,
    sourceRegistries: 0,
  });
  assert.equal(controller.snapshot().replacementAllowed, true);
});

test('timer adapter failures are sanitized and cannot strand teardown state', async () => {
  {
    const timers = timerHarness();
    timers.clearTimeoutFn = () => {
      throw new Error(`${PRIVATE_FILENAME} private clear timer failure`);
    };
    const context = new FakeAudioContext({
      audioBuffer: new FakeAudioBuffer({ duration: 0 }),
    });
    const { controller } = createHarness({ contexts: [context], timers });

    const error = await expectCode(() => controller.load(selection()), 'track-bounds-invalid');
    assertPrivacySafe(error);
    assert.equal(context.closeCalls, 1);
    assert.equal(controller.snapshot().state, 'awaiting-file');
    assert.deepEqual(counters(controller), {
      rawBuffers: 0,
      decodedBuffers: 0,
      contexts: 0,
      previewSources: 0,
      sourceRegistries: 0,
    });
  }

  {
    const baseTimers = timerHarness();
    const timers = {
      ...baseTimers,
      setTimeoutFn(callback, delay) {
        if (delay === 1_000) {
          throw new Error(`${PRIVATE_FILENAME} private close timer failure`);
        }
        return baseTimers.setTimeoutFn(callback, delay);
      },
    };
    const context = new FakeAudioContext();
    const { controller } = createHarness({ contexts: [context], timers });
    await loadReady(controller);

    const result = await controller.unload();
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'context-close-failed');
    assert.equal(result.recovery, 'reload');
    assertPrivacySafe(result);
    assert.equal(controller.snapshot().state, 'reload-required');
    await flushMicrotasks();
    assert.deepEqual(counters(controller), {
      rawBuffers: 0,
      decodedBuffers: 0,
      contexts: 0,
      previewSources: 0,
      sourceRegistries: 0,
    });
  }
});

test('non-thenable resume cannot authorize preview source creation', async () => {
  const context = new FakeAudioContext({ resume: () => undefined });
  const { controller } = createHarness({ contexts: [context] });
  await loadReady(controller);

  const error = await expectCode(
    () => controller.playPreview({ offsetSeconds: 0.25 }),
    'context-resume-failed',
  );

  assertPrivacySafe(error);
  assert.equal(context.sources.length, 0);
  assert.equal(counters(controller).previewSources, 0);
  await finishSuccessfulUnload(controller, context);
});

test('non-thenable context close results remain reload-only and cannot prove close settlement', async () => {
  for (const [label, closeResult] of [
    ['undefined', undefined],
    ['object', {}],
  ]) {
    const context = new FakeAudioContext({ close: () => closeResult });
    const { controller } = createHarness({ contexts: [context] });
    await loadReady(controller);

    const result = await controller.unload();

    assert.equal(context.closeCalls, 1, label);
    assert.equal(result.ok, false, label);
    assert.equal(result.errorCode, 'context-close-failed', label);
    assert.equal(result.recovery, 'reload', label);
    assert.equal(result.cycle.unloadCompleted, false, label);
    assert.equal(result.cycle.contextCloseSettled, false, label);
    assert.deepEqual(counters(controller), {
      rawBuffers: 0,
      decodedBuffers: 1,
      contexts: 1,
      previewSources: 0,
      sourceRegistries: 1,
    }, label);
    assert.equal(controller.snapshot().state, 'reload-required', label);
    assertPrivacySafe(result);
  }
});

test('malformed decode settlement cannot poison ownership or replacement state', async () => {
  const context = new FakeAudioContext({ decode: () => Promise.resolve(null) });
  const { controller } = createHarness({ contexts: [context] });

  const error = await expectCode(() => controller.load(selection()), 'track-decode-failed');

  assert.deepEqual(counters(controller), {
    rawBuffers: 0,
    decodedBuffers: 0,
    contexts: 0,
    previewSources: 0,
    sourceRegistries: 0,
  });
  assert.equal(controller.snapshot().state, 'awaiting-file');
  assert.equal(controller.snapshot().replacementAllowed, true);
  assertPrivacySafe(error);
});

test('start, end, and cue inspection use bounded copyFromChannel scratch only', async () => {
  const audioBuffer = new FakeAudioBuffer();
  const context = new FakeAudioContext({ audioBuffer });
  const { controller } = createHarness({ contexts: [context] });
  const { result } = await loadReady(controller);

  assert.deepEqual(
    audioBuffer.copyCalls.map(({ channelNumber, startInChannel, length }) => ({ channelNumber, startInChannel, length })),
    [
      { channelNumber: 0, startInChannel: 0, length: 4_096 },
      { channelNumber: 1, startInChannel: 0, length: 4_096 },
      { channelNumber: 0, startInChannel: 16_000 - 4_096, length: 4_096 },
      { channelNumber: 1, startInChannel: 16_000 - 4_096, length: 4_096 },
    ],
  );

  const cue = controller.analyzeCue({ cueTimeSeconds: 1 });
  assert.deepEqual(
    audioBuffer.copyCalls.slice(4).map(({ channelNumber, startInChannel, length }) => ({ channelNumber, startInChannel, length })),
    [
      { channelNumber: 0, startInChannel: 8_000, length: 400 },
      { channelNumber: 1, startInChannel: 8_000, length: 400 },
    ],
  );
  assert.equal(audioBuffer.getChannelDataCalls, 0);
  assert.equal(new Set(audioBuffer.copyCalls.map(({ destination }) => destination)).size, 6);
  assertPrivacySafe(result);
  assertPrivacySafe(cue);
  assertPrivacySafe(controller.snapshot());
  await finishSuccessfulUnload(controller, context);
});

test('preview resumes directly in each gesture and replaces only after old one-shot source settles', async () => {
  const audioBuffer = new FakeAudioBuffer({ length: 80_000, duration: 10 });
  const context = new FakeAudioContext({ audioBuffer, currentTime: 10 });
  const { controller } = createHarness({ contexts: [context] });
  await loadReady(controller);

  const firstPlay = controller.playPreview({ offsetSeconds: 2 });
  assert.equal(context.resumeCalls, 1, 'resume must be called before the method crosses an await');
  await firstPlay;
  const firstSource = context.sources[0];
  assert.equal(context.sources.length, 1);
  assert.equal(counters(controller).previewSources, 1);
  assert.equal(firstSource.startCalls.length, 1);
  assert.equal(firstSource.startCalls[0][1], 2);

  context.currentTime = 12.5;
  assert.equal(controller.snapshot().preview.positionSeconds, 4.5);

  const replacement = controller.playPreview({ offsetSeconds: 4 });
  assert.equal(context.resumeCalls, 2, 'replacement gesture must call resume directly too');
  assert.equal(firstSource.stopCalls.length, 1);
  assert.equal(context.sources.length, 1, 'replacement source waits for old-source settlement');
  assert.equal(counters(controller).previewSources, 1);

  firstSource.finish();
  await replacement;
  const secondSource = context.sources[1];
  assert.equal(context.sources.length, 2);
  assert.equal(secondSource.startCalls[0][1], 4);
  assert.equal(counters(controller).previewSources, 1);

  context.currentTime = 13;
  assert.equal(controller.snapshot().preview.positionSeconds, 4.5);
  const stopped = controller.stopPreview();
  assert.equal(secondSource.stopCalls.length, 1);
  assert.equal(counters(controller).previewSources, 1, 'stop request is not source settlement');
  secondSource.finish();
  await stopped;
  assert.equal(counters(controller).previewSources, 0);
  await finishSuccessfulUnload(controller, context);
});

test('Stop invalidates preview requests still waiting on resume settlement', async () => {
  for (const settlement of ['resolve', 'reject']) {
    const resume = deferred();
    const context = new FakeAudioContext({ resume: () => resume.promise });
    const { controller, timers } = createHarness({ contexts: [context] });
    await loadReady(controller);

    const playing = controller.playPreview({ offsetSeconds: 0.25 });
    const stopped = await controller.stopPreview();
    assert.deepEqual(stopped, { ok: true });
    const playOutcome = await boundedOutcome(playing, timers);
    assertBoundedRejection(playOutcome, 'preview-invalidated');
    if (settlement === 'resolve') resume.resolve();
    else resume.reject(new Error(`${PRIVATE_FILENAME} private resume rejection`));
    await flushMicrotasks();

    assert.equal(context.sources.length, 0);
    assert.equal(counters(controller).previewSources, 0);
    await finishSuccessfulUnload(controller, context);
  }
});

test('missing onended bounds Stop and replacement without claiming source settlement', async () => {
  for (const operation of ['stop', 'replace']) {
    const context = new FakeAudioContext();
    const { controller, timers } = createHarness({ contexts: [context] });
    await loadReady(controller);
    await controller.playPreview({ offsetSeconds: 0.25 });
    const source = context.sources[0];

    const pending = operation === 'stop'
      ? controller.stopPreview()
      : controller.playPreview({ offsetSeconds: 0.5 });
    await flushMicrotasks();
    assert.equal(source.stopCalls.length, 1);
    assert.equal(counters(controller).previewSources, 1);
    timers.fireDelay(1_000);

    const error = await expectCode(() => pending, 'preview-stop-timeout');
    assertPrivacySafe(error);
    assert.equal(counters(controller).previewSources, 1);
    assert.equal(controller.snapshot().state, 'reload-required');
    assert.equal(context.sources.length, 1);

    const unloaded = await controller.unload();
    assert.equal(unloaded.ok, true);
    assert.equal(counters(controller).previewSources, 0);
  }
});

test('failed replacement resume still bounds an accepted old-source stop', async () => {
  for (const resumeFailure of ['reject', 'non-thenable']) {
    let resumeCalls = 0;
    const context = new FakeAudioContext({
      resume() {
        resumeCalls += 1;
        if (resumeCalls === 1) return Promise.resolve();
        if (resumeFailure === 'reject') {
          return Promise.reject(new Error(`${PRIVATE_FILENAME} private resume failure`));
        }
        return undefined;
      },
    });
    const { controller, timers } = createHarness({ contexts: [context] });
    await loadReady(controller);
    await controller.playPreview({ offsetSeconds: 0.1 });
    const source = context.sources[0];

    const failure = captureError(
      () => controller.playPreview({ offsetSeconds: 0.2 }),
    );
    await flushMicrotasks();
    assert.equal(source.stopCalls.length, 1);
    assert.equal(counters(controller).previewSources, 1);
    timers.fireDelay(1_000);

    const error = await failure;
    assert.equal(error.code, 'preview-stop-timeout');
    assertPrivacySafe(error);
    assert.equal(controller.snapshot().state, 'reload-required');
    assert.equal(counters(controller).previewSources, 1);

    const unloaded = await controller.unload();
    assert.equal(unloaded.ok, true);
    assert.equal(counters(controller).previewSources, 0);
  }
});

test('preview setup sanitizes onended dependency failure and releases the unstarted source', async () => {
  const privateMessage = `${PRIVATE_FILENAME} /Users/tony/Music/private.mp3`;
  const context = new FakeAudioContext({
    sourceFactory(sourceContext) {
      const source = new FakeBufferSource(sourceContext);
      Object.defineProperty(source, 'onended', {
        configurable: true,
        set() {
          throw new Error(privateMessage);
        },
      });
      return source;
    },
  });
  const { controller } = createHarness({ contexts: [context] });
  await loadReady(controller);

  const error = await expectCode(
    () => controller.playPreview({ offsetSeconds: 0.25 }),
    'preview-start-failed',
  );

  assertPrivacySafe(error);
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].startCalls.length, 0);
  assert.equal(context.sources[0].connections.length, 0);
  assert.equal(counters(controller).previewSources, 0);
  await finishSuccessfulUnload(controller, context);
});

test('throwing currentTime during preview setup is sanitized before a source can become untracked', async () => {
  const privateMessage = `${PRIVATE_FILENAME} /Users/tony/Music/private.mp3`;
  const context = new FakeAudioContext();
  const { controller } = createHarness({ contexts: [context] });
  await loadReady(controller);
  Object.defineProperty(context, 'currentTime', {
    configurable: true,
    get() {
      throw new Error(privateMessage);
    },
  });

  const error = await expectCode(
    () => controller.playPreview({ offsetSeconds: 0.25 }),
    'preview-start-failed',
  );

  assertPrivacySafe(error);
  assert.equal(context.sources.length, 0);
  Object.defineProperty(context, 'currentTime', { configurable: true, value: 10, writable: true });
  assert.equal(counters(controller).previewSources, 0);
  await finishSuccessfulUnload(controller, context);
});

test('throwing currentTime during snapshot is a sanitized typed failure and keeps the source tracked', async () => {
  const privateMessage = `${PRIVATE_FILENAME} file:///private/audio`;
  const context = new FakeAudioContext();
  const { controller } = createHarness({ contexts: [context] });
  await loadReady(controller);
  await controller.playPreview({ offsetSeconds: 0.25 });
  const source = context.sources[0];
  Object.defineProperty(context, 'currentTime', {
    configurable: true,
    get() {
      throw new Error(privateMessage);
    },
  });

  const error = await expectCode(() => controller.snapshot(), 'snapshot-failed');

  assertPrivacySafe(error);
  assert.equal(source.settled, false);
  Object.defineProperty(context, 'currentTime', { configurable: true, value: 10, writable: true });
  assert.equal(counters(controller).previewSources, 1);
  source.finish();
  await finishSuccessfulUnload(controller, context);
});

test('failed source stop remains owned until successful context-close settlement', async () => {
  const privateMessage = `${PRIVATE_FILENAME} /Users/tony/Music/private.mp3`;
  const context = new FakeAudioContext({
    sourceFactory(sourceContext) {
      const source = new FakeBufferSource(sourceContext);
      source.stop = (...args) => {
        sourceContext.operations.push('source.stop');
        source.stopCalls.push(args);
        throw new Error(privateMessage);
      };
      return source;
    },
  });
  const { controller } = createHarness({ contexts: [context] });
  await loadReady(controller);
  await controller.playPreview({ offsetSeconds: 0.5 });
  const source = context.sources[0];

  const error = await expectCode(() => controller.stopPreview(), 'preview-stop-failed');

  assertPrivacySafe(error);
  assert.equal(source.settled, false);
  assert.equal(counters(controller).previewSources, 1);
  assert.equal(controller.snapshot().state, 'reload-required');

  const unloaded = await controller.unload();
  assert.equal(unloaded.ok, true);
  assert.equal(context.closeCalls, 1);
  assert.equal(counters(controller).previewSources, 0);
  assert.equal(controller.snapshot().state, 'awaiting-file');
});

test('browser boundary source has no media element or object/file URL path', async () => {
  const modulePaths = [
    '../enrollment-browser.mjs',
    '../enrollment-browser-load.mjs',
    '../enrollment-browser-preview.mjs',
    '../enrollment-browser-resources.mjs',
    '../enrollment-browser-shared.mjs',
  ];
  const source = (await Promise.all(modulePaths.map(async (modulePath) => (
    readFile(new URL(modulePath, import.meta.url), 'utf8')
  )))).join('\n');
  const forbiddenPatterns = [
    /createObjectURL/,
    /revokeObjectURL/,
    /readAsDataURL/,
    /HTMLMediaElement/,
    /HTMLAudioElement/,
    /new\s+Audio\s*\(/,
    /createElement\s*\(\s*['"](?:audio|video)['"]\s*\)/,
  ];
  for (const pattern of forbiddenPatterns) assert.doesNotMatch(source, pattern);
});

test('Unload, pagehide, and foreground loss invalidate loads and fully settle owned resources', async () => {
  for (const methodName of ['unload', 'handlePageHide', 'handleForegroundLoss']) {
    const close = deferred();
    const context = new FakeAudioContext({ close: () => close.promise });
    const { controller } = createHarness({ contexts: [context] });
    await loadReady(controller);
    await controller.playPreview({ offsetSeconds: 0.25 });
    const source = context.sources[0];

    const teardown = controller[methodName]();
    assert.equal(source.stopCalls.length, 1, methodName);
    assert.equal(context.closeCalls, 1, methodName);
    assert.equal(controller.snapshot().replacementAllowed, false, methodName);
    assert.equal(counters(controller).previewSources, 1, methodName);
    source.finish();
    close.resolve();
    const result = await teardown;

    assert.equal(result.ok, true, methodName);
    assert.equal(result.cycle.unloadCompleted, true, methodName);
    assert.equal(result.cycle.contextCloseSettled, true, methodName);
    assert.deepEqual(counters(controller), {
      rawBuffers: 0,
      decodedBuffers: 0,
      contexts: 0,
      previewSources: 0,
      sourceRegistries: 0,
    });
    assertPrivacySafe(result);
  }
});

test('pagehide and foreground loss invalidate pending loads and discard late settlements', async () => {
  for (const methodName of ['handlePageHide', 'handleForegroundLoss']) {
    const decode = deferred();
    const close = deferred();
    const context = new FakeAudioContext({
      decode: () => decode.promise,
      close: () => close.promise,
    });
    const { controller } = createHarness({ contexts: [context] });
    const loading = controller.load(selection());
    await flushMicrotasks();
    assert.equal(context.decodeCalls.length, 1, methodName);

    const teardown = controller[methodName]();
    assert.equal(context.closeCalls, 1, methodName);
    assert.equal(controller.snapshot().replacementAllowed, false, methodName);
    decode.resolve(context.audioBuffer);
    await flushMicrotasks();
    assert.notEqual(controller.snapshot().state, 'ready', methodName);
    close.resolve();

    const result = await teardown;
    const loadError = await expectCode(() => loading, 'load-invalidated');
    assert.equal(result.ok, true, methodName);
    assert.deepEqual(counters(controller), {
      rawBuffers: 0,
      decodedBuffers: 0,
      contexts: 0,
      previewSources: 0,
      sourceRegistries: 0,
    });
    assertPrivacySafe(loadError);
    assertPrivacySafe(result);
  }
});

test('context-close rejection is reload-only and cannot produce a successful unload', async () => {
  const context = new FakeAudioContext({ close: () => Promise.reject(new Error(`close failed ${PRIVATE_FILENAME}`)) });
  const { controller } = createHarness({ contexts: [context] });
  await loadReady(controller);

  const result = await controller.unload();

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'context-close-failed');
  assert.equal(result.recovery, 'reload');
  assert.equal(result.cycle.unloadCompleted, false);
  assert.equal(result.cycle.contextCloseSettled, false);
  assert.equal(controller.snapshot().state, 'reload-required');
  assert.equal(controller.snapshot().replacementAllowed, false);
  assert.equal(counters(controller).contexts, 1);
  assertPrivacySafe(result);
});

test('late native close releases live references after timeout without rewriting the reload-only result', async () => {
  const close = deferred();
  const context = new FakeAudioContext({ close: () => close.promise });
  const { controller, timers } = createHarness({ contexts: [context] });
  await loadReady(controller);

  const unloading = controller.unload();
  assert.deepEqual(timers.activeDelays(), [1_000]);
  timers.fireDelay(1_000);
  const result = await unloading;

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'context-close-timeout');
  assert.equal(result.recovery, 'reload');
  assert.equal(result.cycle.unloadCompleted, false);
  assert.equal(result.cycle.contextCloseSettled, false);
  assert.equal(counters(controller).contexts, 1);
  assert.equal(controller.snapshot().state, 'reload-required');
  assertPrivacySafe(result);

  close.resolve();
  await flushMicrotasks();

  assert.equal(result.ok, false, 'the historical timeout result is immutable');
  assert.equal(result.errorCode, 'context-close-timeout');
  assert.equal(result.cycle.contextCloseSettled, false);
  assert.deepEqual(counters(controller), {
    rawBuffers: 0,
    decodedBuffers: 0,
    contexts: 0,
    previewSources: 0,
    sourceRegistries: 0,
  });
  assert.equal(controller.snapshot().state, 'reload-required');
  assert.equal(controller.snapshot().replacementAllowed, false);

  const repeated = await controller.unload();
  assert.equal(repeated.ok, false);
  assert.equal(repeated.errorCode, 'context-close-timeout');
  assert.equal(repeated.cycle.unloadCompleted, false);
  assert.equal(repeated.cycle.contextCloseSettled, false);
  assertPrivacySafe(repeated);
});

test('resource counters decrement only after source and context settlement', async () => {
  const close = deferred();
  const context = new FakeAudioContext({ close: () => close.promise });
  const { controller } = createHarness({ contexts: [context] });
  await loadReady(controller);
  await controller.playPreview({ offsetSeconds: 0.5 });
  const source = context.sources[0];

  assert.deepEqual(counters(controller), {
    rawBuffers: 0,
    decodedBuffers: 1,
    contexts: 1,
    previewSources: 1,
    sourceRegistries: 1,
  });

  const unloading = controller.unload();
  assert.deepEqual(counters(controller), {
    rawBuffers: 0,
    decodedBuffers: 1,
    contexts: 1,
    previewSources: 1,
    sourceRegistries: 1,
  });

  source.finish();
  await flushMicrotasks();
  assert.deepEqual(counters(controller), {
    rawBuffers: 0,
    decodedBuffers: 1,
    contexts: 1,
    previewSources: 0,
    sourceRegistries: 1,
  });

  close.resolve();
  await unloading;
  assert.deepEqual(counters(controller), {
    rawBuffers: 0,
    decodedBuffers: 0,
    contexts: 0,
    previewSources: 0,
    sourceRegistries: 0,
  });
});

test('selection file and fileInput getter failures are typed and sanitized before capture', async () => {
  const privateMessage = `${PRIVATE_FILENAME} at /Users/tony/Music/private.mp3`;

  for (const propertyName of ['file', 'fileInput']) {
    const selected = {
      file: new FakeFile(),
      fileInput: new FakeFileInput('C:\\fakepath\\private.mp3'),
    };
    Object.defineProperty(selected, propertyName, {
      configurable: true,
      get() {
        throw new Error(privateMessage);
      },
    });
    const { controller } = createHarness();

    const error = await expectCode(() => controller.load(selected), 'track-selection-invalid');

    assertPrivacySafe(error);
    assert.deepEqual(counters(controller), {
      rawBuffers: 0,
      decodedBuffers: 0,
      contexts: 0,
      previewSources: 0,
      sourceRegistries: 0,
    });
    assert.equal(controller.snapshot().replacementAllowed, true);
  }
});

test('thrown dependency errors and all returned values exclude private file data', async () => {
  const privateMessage = `${PRIVATE_FILENAME} at /Users/tony/Music/private.mp3 file:///private/audio`;
  const file = new FakeFile({
    name: PRIVATE_FILENAME,
    read: () => Promise.reject(Object.assign(new Error(privateMessage), {
      bytes: Uint8Array.of(1, 2, 3),
      path: '/Users/tony/Music/private.mp3',
    })),
  });
  const input = new FakeFileInput('C:\\fakepath\\Tony-private-island-party.mp3');
  const { controller } = createHarness();

  const error = await expectCode(() => controller.load({ file, fileInput: input }), 'track-read-failed');

  assert.equal(file.nameReads, 0);
  assertPrivacySafe(error);
  assertPrivacySafe(controller.snapshot());
  assert.equal(Object.hasOwn(error, 'cause'), false);
});

test('application cleanup cycle is the exact Task 1 record ready for memory evidence', async () => {
  const context = new FakeAudioContext();
  const { controller } = createHarness({ contexts: [context] });
  const { result: loaded } = await loadReady(controller);
  const unloaded = await controller.unload();
  const cycle = unloaded.cycle;

  assert.deepEqual(Object.keys(cycle), [
    'sha256',
    'unloadCompleted',
    'contextCloseSettled',
    'counters',
  ]);
  assert.equal(cycle.sha256, loaded.sha256);
  assert.equal(cycle.sha256, LOWERCASE_SHA);
  assert.equal(cycle.unloadCompleted, true);
  assert.equal(cycle.contextCloseSettled, true);
  assert.deepEqual(Object.keys(cycle.counters), COUNTER_KEYS);
  assert.deepEqual(cycle.counters, {
    rawBuffers: 0,
    decodedBuffers: 0,
    contexts: 0,
    previewSources: 0,
    sourceRegistries: 0,
  });
  assertPrivacySafe(cycle);

  const evidence = createApplicationMemoryEvidence([cycle, structuredClone(cycle)]);
  assert.deepEqual(evaluateApplicationMemoryContract(evidence), {
    applicationMemoryContractPassed: true,
    completedUnloadCycles: 2,
    matchingAssetIdentity: true,
    ownedReferencesCleared: true,
    contextsCloseSettled: true,
    browserHeapObserved: false,
  });
});
