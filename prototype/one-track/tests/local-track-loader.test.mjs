import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { TRACK_METADATA } from '../src/track-metadata.mjs';
import {
  LocalTrackLoaderError,
  createLocalTrackLoader,
} from '../src/browser/local-track-loader.mjs';
import {
  assertApplicationReleaseResult,
  assertLoadedSessionCapability,
} from '../src/browser/loaded-session.mjs';
import {
  createFakeTrackLoaderDeps,
  flushMicrotasks,
} from './fake-track-loader-deps.mjs';

const PRIVATE_SENTINELS = Object.freeze([
  'PRIVATE-FILENAME-DO-NOT-LEAK',
  'SECR',
  'PRIVATE_DEPENDENCY_MESSAGE',
]);

function assertTypedCode(error, code) {
  assert.equal(error instanceof LocalTrackLoaderError, true);
  assert.equal(error.code, code);
  const serialized = JSON.stringify(error);
  for (const sentinel of PRIVATE_SENTINELS) {
    assert.equal(error.message.includes(sentinel), false);
    assert.equal(serialized.includes(sentinel), false);
  }
  return true;
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => assertTypedCode(error, code));
}

async function successfulLoad(options = {}, loadedSessionId = 'loaded-session-1') {
  const fake = createFakeTrackLoaderDeps(options);
  const loader = createLocalTrackLoader(fake.deps);
  const capability = await loader.load({
    file: fake.file,
    loadedSessionId,
  });
  return { ...fake, loader, capability, loadedSessionId };
}

test('T7-LOAD-ORDER validates closed file metadata and size before one read, hashes before allocation, and uses bounded copies', async () => {
  for (const [overrides, code] of [
    [{ filename: 'PRIVATE-FILENAME-DO-NOT-LEAK.MP3' }, 'track-identity-failed'],
    [{ filename: 'PRIVATE-FILENAME-DO-NOT-LEAK.mp3.exe' }, 'track-identity-failed'],
    [{ mimeType: 'audio/mp3' }, 'track-identity-failed'],
    [{ size: 20 * 1024 * 1024 + 1 }, 'track-bounds-invalid'],
    [{ size: TRACK_METADATA.compressedBytes - 1 }, 'track-identity-failed'],
  ]) {
    const fake = createFakeTrackLoaderDeps(overrides);
    const loader = createLocalTrackLoader(fake.deps);
    await expectCode(loader.load({ file: fake.file, loadedSessionId: 'rejected' }), code);
    assert.equal(fake.events.some(({ type }) => type === 'read'), false);
  }

  const loaded = await successfulLoad();
  assert.equal(assertLoadedSessionCapability(loaded.capability), true);
  assert.deepEqual(
    loaded.events.filter(({ type }) => type !== 'copy').map(({ type }) => type),
    ['read', 'hash', 'allocate-context', 'decode'],
  );
  assert.equal(loaded.events.filter(({ type }) => type === 'read').length, 1);
  assert.equal(loaded.contexts.length, 1);
  const copies = loaded.events.filter(({ type }) => type === 'copy');
  assert.equal(copies.length, 6);
  assert.deepEqual(copies.map(({ sampleCount }) => sampleCount), [4096, 4096, 2400, 4096, 4096, 2400]);
  assert.equal(Math.max(...copies.map(({ sampleCount }) => sampleCount)), 4096);
  assert.equal(loaded.events.some(({ type }) => type === 'forbidden-full-channel-view'), false);
  assert.deepEqual(loaded.loader.getDiagnostics(), {
    state: 'loaded',
    allocatedContextCount: 1,
    loadedSessionCount: 1,
  });
});

test('T7-HASH-MISMATCH rejects immediately before context allocation', async () => {
  const fake = createFakeTrackLoaderDeps({ sha256: '0'.repeat(64) });
  const loader = createLocalTrackLoader(fake.deps);
  await expectCode(
    loader.load({ file: fake.file, loadedSessionId: 'hash-mismatch' }),
    'track-identity-failed',
  );
  assert.deepEqual(fake.events.map(({ type }) => type), ['read', 'hash']);
});

test('T7-DECODE-LIMITS enforces enrolled facts, hard limits, exact PCM, and cue energy', async () => {
  const cases = [
    [{ duration: TRACK_METADATA.decodedDurationSeconds + 0.051 }, 'track-metadata-invalid'],
    [{ duration: 360.001 }, 'track-bounds-invalid'],
    [{ channels: 1 }, 'track-metadata-invalid'],
    [{ channels: 3 }, 'track-bounds-invalid'],
    [{ sampleRate: 44_100 }, 'track-metadata-invalid'],
    [{ sampleRate: 96_001 }, 'track-bounds-invalid'],
    [{ frames: TRACK_METADATA.decodedFrameCount - 1 }, 'track-metadata-invalid'],
    [{ frames: Math.floor(160 * 1024 * 1024 / 8) + 1 }, 'track-bounds-invalid'],
    [{ cueEnergetic: false }, 'track-metadata-invalid'],
  ];
  for (const [options, code] of cases) {
    const fake = createFakeTrackLoaderDeps(options);
    const loader = createLocalTrackLoader(fake.deps);
    await expectCode(loader.load({ file: fake.file, loadedSessionId: 'invalid-decode' }), code);
    assert.equal(fake.events.filter(({ type }) => type === 'close').length, 1);
    assert.deepEqual(loader.getDiagnostics(), {
      state: 'idle',
      allocatedContextCount: 0,
      loadedSessionCount: 0,
    });
  }
});

test('T7-FAILED-LOAD-CLOSE uses the bounded close deadline and sanitizes deadline creation failure', async () => {
  {
    const fake = createFakeTrackLoaderDeps({
      duration: TRACK_METADATA.decodedDurationSeconds + 0.051,
      closeMode: 'deferred',
    });
    const loader = createLocalTrackLoader(fake.deps);
    const pending = loader.load({ file: fake.file, loadedSessionId: 'failed-load-close' });
    await flushMicrotasks(24);
    assert.deepEqual(
      fake.deadlines.map(({ kind, milliseconds }) => ({ kind, milliseconds })),
      [
        { kind: 'hash-decode', milliseconds: 15_000 },
        { kind: 'context-close', milliseconds: 1_000 },
      ],
    );
    fake.deadlines[1].fire();
    await expectCode(pending, 'track-metadata-invalid');
    assert.equal(loader.getDiagnostics().state, 'recovery');
  }

  {
    const fake = createFakeTrackLoaderDeps({
      duration: TRACK_METADATA.decodedDurationSeconds + 0.051,
      closeMode: 'deferred',
      deadlineCreateThrows: true,
    });
    const loader = createLocalTrackLoader(fake.deps);
    await expectCode(
      loader.load({ file: fake.file, loadedSessionId: 'failed-deadline-create' }),
      'track-metadata-invalid',
    );
    assert.deepEqual(loader.getDiagnostics(), {
      state: 'recovery',
      allocatedContextCount: 1,
      loadedSessionCount: 0,
    });
    await loader.teardown('application-teardown');
  }
});

test('T7-DECODE-CLOSE rejects a context that closes while asynchronous decode is pending', async () => {
  const fake = createFakeTrackLoaderDeps({ decodeMode: 'deferred' });
  const loader = createLocalTrackLoader(fake.deps);
  const pending = loader.load({ file: fake.file, loadedSessionId: 'closed-during-decode' });
  await flushMicrotasks(8);
  assert.equal(fake.contexts.length, 1);
  fake.contexts[0].state = 'closed';
  fake.decodeOperation.resolve(fake.decoded);
  await expectCode(pending, 'track-decode-failed');
  assert.deepEqual(loader.getDiagnostics(), {
    state: 'idle',
    allocatedContextCount: 0,
    loadedSessionCount: 0,
  });
});

test('T7-CANCELLATION invalidates synchronously at read/hash/decode awaits and forbids post-cancel allocation', async () => {
  {
    const fake = createFakeTrackLoaderDeps({ readMode: 'never' });
    const loader = createLocalTrackLoader(fake.deps);
    const pending = loader.load({ file: fake.file, loadedSessionId: 'read-hangs' });
    assert.equal(loader.cancel(), true);
    await expectCode(pending, 'track-load-cancelled');
    assert.equal(fake.contexts.length, 0);
    await loader.teardown('application-teardown');
  }

  {
    const fake = createFakeTrackLoaderDeps({ hashMode: 'deferred' });
    const loader = createLocalTrackLoader(fake.deps);
    const pending = loader.load({ file: fake.file, loadedSessionId: 'hash-race' });
    await flushMicrotasks();
    assert.equal(fake.events.some(({ type }) => type === 'hash'), true);
    fake.hashOperation.resolve(TRACK_METADATA.sha256);
    assert.equal(loader.cancel(), true);
    await expectCode(pending, 'track-load-cancelled');
    await flushMicrotasks();
    assert.equal(fake.contexts.length, 0);
  }

  {
    const fake = createFakeTrackLoaderDeps({ decodeMode: 'never' });
    const loader = createLocalTrackLoader(fake.deps);
    const pending = loader.load({ file: fake.file, loadedSessionId: 'decode-hangs' });
    await flushMicrotasks(8);
    assert.equal(fake.contexts.length, 1);
    const teardown = loader.teardown('application-teardown');
    await expectCode(pending, 'track-load-cancelled');
    await teardown;
    assert.equal(fake.events.filter(({ type }) => type === 'close').length, 1);
    assert.equal(loader.getDiagnostics().allocatedContextCount, 0);
  }
});

test('T7-DEADLINE uses one aggregate 15-second hash/decode deadline and leaves no loaded owner', async () => {
  const fake = createFakeTrackLoaderDeps({ hashMode: 'never' });
  const loader = createLocalTrackLoader(fake.deps);
  const pending = loader.load({ file: fake.file, loadedSessionId: 'deadline' });
  await flushMicrotasks();
  assert.deepEqual(
    fake.deadlines.map(({ kind, milliseconds }) => ({ kind, milliseconds })),
    [{ kind: 'hash-decode', milliseconds: 15_000 }],
  );
  fake.deadlines[0].fire();
  await expectCode(pending, 'track-load-deadline');
  assert.equal(fake.contexts.length, 0);
});

test('T7-SINGLE-ACTIVE rejects replacement while loading or loaded and ignores stale settlements', async () => {
  const fake = createFakeTrackLoaderDeps({ readMode: 'deferred' });
  const loader = createLocalTrackLoader(fake.deps);
  const first = loader.load({ file: fake.file, loadedSessionId: 'first' });
  await expectCode(
    loader.load({ file: fake.file, loadedSessionId: 'parallel' }),
    'track-load-active',
  );
  loader.cancel();
  await expectCode(first, 'track-load-cancelled');
  fake.readOperation.resolve(fake.rawBytes);
  await flushMicrotasks();
  assert.equal(fake.contexts.length, 0);

  const fresh = createFakeTrackLoaderDeps();
  const freshLoader = createLocalTrackLoader(fresh.deps);
  const capability = await freshLoader.load({ file: fresh.file, loadedSessionId: 'loaded' });
  await expectCode(
    freshLoader.load({ file: fresh.file, loadedSessionId: 'replacement' }),
    'track-load-active',
  );
  const cleanup = await capability.unload('explicit-unload');
  assert.equal(
    assertApplicationReleaseResult(cleanup, {
      loadedSessionId: 'loaded',
      capability,
    }),
    true,
  );
});

test('T7-PRIVACY keeps filename, byte sentinel, dependency messages, and forbidden browser paths out of public surfaces', async () => {
  const loaded = await successfulLoad();
  const surfaces = [
    JSON.stringify(loaded.capability),
    JSON.stringify(loaded.loader.getDiagnostics()),
    String(loaded.capability),
  ];
  for (const surface of surfaces) {
    for (const sentinel of PRIVATE_SENTINELS) {
      assert.equal(surface.includes(sentinel), false);
    }
  }

  const failing = createFakeTrackLoaderDeps({ readMode: 'reject' });
  const loader = createLocalTrackLoader(failing.deps);
  await expectCode(
    loader.load({ file: failing.file, loadedSessionId: 'private-error' }),
    'track-read-failed',
  );

  const sources = await Promise.all([
    readFile(new URL('../src/browser/local-track-loader.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/browser/loaded-session.mjs', import.meta.url), 'utf8'),
  ]);
  const forbidden = [
    'createObjectURL', 'HTMLAudioElement', 'fetch(', 'XMLHttpRequest', 'WebSocket',
    'localStorage', 'sessionStorage', 'indexedDB', 'Worker(', 'getChannelData(',
  ];
  for (const source of sources) {
    for (const token of forbidden) assert.equal(source.includes(token), false, token);
  }
});
