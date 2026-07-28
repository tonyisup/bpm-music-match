import test from 'node:test';
import assert from 'node:assert/strict';

import { createLocalTrackLoader } from '../src/browser/local-track-loader.mjs';
import * as loadedSessionModule from '../src/browser/loaded-session.mjs';
import {
  LoadedSessionError,
  acceptValidatedLoadReceipt,
  assertApplicationReleaseResult,
  assertLoadedSessionCapability,
  claimApplicationReleaseResult,
} from '../src/browser/loaded-session.mjs';
import {
  createFakeTrackLoaderDeps,
  deferred,
  flushMicrotasks,
} from './fake-track-loader-deps.mjs';

function assertSessionCode(error, code) {
  assert.equal(error instanceof LoadedSessionError, true);
  assert.equal(error.code, code);
  assert.equal(error.message.includes('PRIVATE_'), false);
  return true;
}

async function expectSessionCode(promise, code) {
  await assert.rejects(promise, (error) => assertSessionCode(error, code));
}

async function loadSession(options = {}, id = 'loaded-session-1') {
  const fake = createFakeTrackLoaderDeps(options);
  const loader = createLocalTrackLoader(fake.deps);
  const capability = await loader.load({ file: fake.file, loadedSessionId: id });
  return { ...fake, loader, capability, id };
}

test('T7-CAPABILITY is opaque, closed, genuine-only, and cannot be publicly minted from structural resources or callbacks', async () => {
  const loaded = await loadSession();
  const { capability } = loaded;
  assert.deepEqual(Object.keys(capability), [
    'borrowForGeneration',
    'suspend',
    'resetAfterEvidence',
    'unload',
  ]);
  assert.equal(Object.isFrozen(capability), true);
  assert.equal(assertLoadedSessionCapability(capability), true);
  assert.equal('context' in capability, false);
  assert.equal('buffer' in capability, false);
  assert.equal('identities' in capability, false);
  assert.throws(() => assertLoadedSessionCapability({ ...capability }), /genuine/);
  assert.throws(() => assertLoadedSessionCapability(new Proxy(capability, {})), /genuine/);
  await assert.rejects(
    () => capability.borrowForGeneration.call({ ...capability }, 1, () => undefined),
    /receiver/,
  );

  assert.equal(
    Object.keys(loadedSessionModule).some((name) => /^create.*capability/i.test(name)),
    false,
  );
  assert.throws(
    () => acceptValidatedLoadReceipt(Object.freeze({
      assertValidated: () => true,
      context: loaded.contexts[0],
      buffer: loaded.decoded,
    })),
    /validated load receipt/,
  );
});

test('T7-GENERATION-LIFETIME exposes resume settlement while one borrow remains owned until callback lifetime release', async () => {
  const loaded = await loadSession({ resumeMode: 'deferred' });
  const lifetime = deferred();
  let resumeSettlement;
  let borrowSettled = false;
  const borrow = loaded.capability.borrowForGeneration(1, (resources) => {
    assert.deepEqual(Object.keys(resources), ['context', 'buffer', 'resumeSettlement']);
    resumeSettlement = resources.resumeSettlement;
    return lifetime.promise;
  }).finally(() => { borrowSettled = true; });
  await flushMicrotasks(4);
  assert.equal(borrowSettled, false);
  await expectSessionCode(
    loaded.capability.borrowForGeneration(1, () => undefined),
    'parallel-generation-borrow',
  );
  await expectSessionCode(loaded.capability.suspend('premature-suspend'), 'parallel-generation-borrow');
  loaded.resumeOperations[0].resolve();
  assert.equal(await resumeSettlement, true);
  await flushMicrotasks(4);
  assert.equal(borrowSettled, false);
  lifetime.resolve('released');
  assert.equal(await borrow, 'released');
});

test('T7-GENERATION-LIFETIME expires resources with callback lifetime, reads callback thenables once, and revokes resume authority after suspend', async () => {
  {
    const loaded = await loadSession({ resumeMode: 'deferred' });
    let retained;
    const borrow = loaded.capability.borrowForGeneration(1, (resources) => {
      retained = resources;
      return undefined;
    });
    await flushMicrotasks(4);
    assert.throws(() => retained.context, /expired/);
    assert.throws(() => retained.buffer, /expired/);
    loaded.resumeOperations[0].resolve();
    await borrow;
  }
  {
    const loaded = await loadSession();
    let reads = 0;
    const marker = new Error('callback-then-accessor-marker');
    await assert.rejects(
      loaded.capability.borrowForGeneration(1, () => Object.defineProperty({}, 'then', {
        get() {
          reads += 1;
          if (reads === 1) throw marker;
          return (resolve) => resolve('unexpected-success');
        },
      })),
      (error) => error === marker,
    );
    assert.equal(reads, 1);

    reads = 0;
    await expectSessionCode(
      loaded.capability.borrowForGeneration(1, () => Object.defineProperty({}, 'then', {
        enumerable: true,
        get() {
          reads += 1;
          if (reads === 1) return undefined;
          return (resolve) => resolve('unexpected-second-read');
        },
      })),
      'borrow-result-invalid',
    );
    assert.equal(reads, 1);
  }
  {
    const loaded = await loadSession({ resumeMode: 'deferred', suspendMode: 'deferred' });
    let resumeSettlement;
    const firstBorrow = loaded.capability.borrowForGeneration(1, (resources) => {
      resumeSettlement = resources.resumeSettlement;
      return undefined;
    });
    await flushMicrotasks(4);
    const suspension = loaded.capability.suspend('stale-generation-resume');
    assert.equal(loaded.events.filter(({ type }) => type === 'suspend').length, 0);
    await expectSessionCode(
      loaded.capability.borrowForGeneration(1, () => undefined),
      'parallel-generation-borrow',
    );
    loaded.resumeOperations[0].resolve();
    await resumeSettlement;
    await flushMicrotasks(4);
    assert.equal(loaded.events.filter(({ type }) => type === 'suspend').length, 1);
    await expectSessionCode(
      loaded.capability.borrowForGeneration(1, () => undefined),
      'parallel-generation-borrow',
    );
    loaded.suspendOperations[0].resolve();
    await suspension;
    await firstBorrow;
    await loaded.capability.borrowForGeneration(1, () => undefined);
    assert.equal(loaded.events.filter(({ type }) => type === 'resume').length, 2);
  }
});

test('T7-BORROW resumes once per generation, runs callbacks synchronously, blocks parallel/stale use, and invalidates after settlement', async () => {
  const loaded = await loadSession();
  const order = [];
  const first = await loaded.capability.borrowForGeneration(1, ({ context, buffer }) => {
    order.push('callback');
    assert.equal(context, loaded.contexts[0]);
    assert.equal(buffer, loaded.decoded);
    return 7;
  });
  assert.equal(first, 7);
  assert.deepEqual(loaded.events.filter(({ type }) => type === 'resume').map(({ type }) => type), ['resume']);
  assert.deepEqual(order, ['callback']);

  await loaded.capability.borrowForGeneration(1, () => 8);
  assert.equal(loaded.events.filter(({ type }) => type === 'resume').length, 1);

  const held = deferred();
  const pending = loaded.capability.borrowForGeneration(2, async () => held.promise);
  await expectSessionCode(
    loaded.capability.borrowForGeneration(2, () => undefined),
    'parallel-generation-borrow',
  );
  held.resolve('done');
  assert.equal(await pending, 'done');
  await expectSessionCode(
    loaded.capability.borrowForGeneration(1, () => undefined),
    'stale-generation-borrow',
  );

  let escaped;
  await loaded.capability.borrowForGeneration(2, (resources) => {
    escaped = resources;
  });
  assert.equal(Object.isFrozen(escaped), true);
  assert.throws(() => escaped.context, /expired/);
  assert.throws(() => escaped.buffer, /expired/);
});

test('T7-BORROW-EXPORT blocks direct and nested owned resource aliases from callback results', async () => {
  const loaded = await loadSession();
  await expectSessionCode(
    loaded.capability.borrowForGeneration(1, ({ context }) => context),
    'owned-resource-export-blocked',
  );
  await expectSessionCode(
    loaded.capability.borrowForGeneration(1, ({ buffer }) => ({ nested: [{ buffer }] })),
    'owned-resource-export-blocked',
  );
  await expectSessionCode(
    loaded.capability.borrowForGeneration(1, ({ buffer }) => new Map([['buffer', buffer]])),
    'owned-resource-export-blocked',
  );
  await expectSessionCode(
    loaded.capability.borrowForGeneration(1, ({ context }) => Object.create(context)),
    'owned-resource-export-blocked',
  );
  assert.equal(
    await loaded.capability.borrowForGeneration(1, () => ({ safe: 1 })).then(({ safe }) => safe),
    1,
  );
});

test('T7-RESUME-FAILURE cannot authorize the same generation without a fresh successful resume', async () => {
  const loaded = await loadSession({ resumeMode: 'reject' });
  await expectSessionCode(
    loaded.capability.borrowForGeneration(1, () => 'first-callback'),
    'context-resume-failed',
  );
  await expectSessionCode(
    loaded.capability.borrowForGeneration(1, () => 'second-callback'),
    'context-resume-failed',
  );
  assert.equal(loaded.events.filter(({ type }) => type === 'resume').length, 2);
});

test('T7-THENABLE requires genuine resume and suspend settlement while Reset and foreground retain ownership', async () => {
  {
    const loaded = await loadSession({ resumeMode: 'non-thenable' });
    await expectSessionCode(
      loaded.capability.borrowForGeneration(1, () => undefined),
      'context-resume-failed',
    );
  }
  {
    const loaded = await loadSession({ suspendMode: 'non-thenable' });
    await expectSessionCode(
      loaded.capability.suspend('foreground-loss'),
      'context-suspend-failed',
    );
    assert.deepEqual(loaded.loader.getDiagnostics(), {
      state: 'loaded',
      allocatedContextCount: 1,
      loadedSessionCount: 1,
    });
  }
  {
    const loaded = await loadSession();
    await loaded.capability.suspend('foreground-loss');
    await loaded.capability.resetAfterEvidence();
    assert.equal(loaded.events.filter(({ type }) => type === 'suspend').length, 2);
    assert.deepEqual(loaded.loader.getDiagnostics(), {
      state: 'loaded',
      allocatedContextCount: 1,
      loadedSessionCount: 1,
    });
    await loaded.capability.borrowForGeneration(2, () => undefined);
  }
});

test('T7-SUSPEND-INVALIDATION rejects a never-settling suspend when unload revokes the owner', async () => {
  const loaded = await loadSession({ suspendMode: 'never' });
  const pendingSuspend = loaded.capability.suspend('foreground-loss');
  await flushMicrotasks();
  const release = await loaded.capability.unload('application-teardown');
  assert.deepEqual(release, { status: 'succeeded', cause: null });
  await expectSessionCode(pendingSuspend, 'loaded-session-unloaded');
});

test('T7-UNLOAD invalidates hung borrows, clears the buffer, closes once, and returns genuine immutable provenance', async () => {
  const loaded = await loadSession();
  const held = deferred();
  const borrow = loaded.capability.borrowForGeneration(1, () => held.promise);
  const result = await loaded.capability.unload('application-teardown');
  await expectSessionCode(borrow, 'loaded-session-unloaded');

  assert.deepEqual(result, { status: 'succeeded', cause: null });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(
    assertApplicationReleaseResult(result, {
      loadedSessionId: loaded.id,
      capability: loaded.capability,
    }),
    true,
  );
  assert.equal(
    claimApplicationReleaseResult(result, {
      loadedSessionId: loaded.id,
      capability: loaded.capability,
    }),
    true,
  );
  assert.throws(
    () => claimApplicationReleaseResult(result, {
      loadedSessionId: loaded.id,
      capability: loaded.capability,
    }),
    /already claimed/,
  );
  assert.equal(await loaded.capability.unload('duplicate'), result);
  assert.equal(loaded.events.filter(({ type }) => type === 'close').length, 1);
  assert.deepEqual(loaded.loader.getDiagnostics(), {
    state: 'idle',
    allocatedContextCount: 0,
    loadedSessionCount: 0,
  });
  await expectSessionCode(
    loaded.capability.borrowForGeneration(2, () => undefined),
    'loaded-session-unloaded',
  );
});

test('T7-RELEASE-PROVENANCE rejects raw, structural, copied, proxied, foreign, mismatched-ID, and reused results', async () => {
  const first = await loadSession({}, 'loaded-session-first');
  const second = await loadSession({}, 'loaded-session-second');
  const firstResult = await first.capability.unload('application-teardown');
  const secondResult = await second.capability.unload('application-teardown');
  const ownership = {
    loadedSessionId: first.id,
    capability: first.capability,
  };

  for (const candidate of [
    { status: 'succeeded', cause: null },
    Object.freeze({ status: 'succeeded', cause: null }),
    { ...firstResult },
    new Proxy(firstResult, {}),
    secondResult,
  ]) {
    assert.throws(
      () => assertApplicationReleaseResult(candidate, ownership),
      /genuine application release result/,
    );
  }
  assert.throws(
    () => assertApplicationReleaseResult(firstResult, {
      loadedSessionId: second.id,
      capability: first.capability,
    }),
    /genuine application release result/,
  );
  assert.equal(assertApplicationReleaseResult(firstResult, ownership), true);
  assert.equal(claimApplicationReleaseResult(firstResult, ownership), true);
  assert.throws(() => claimApplicationReleaseResult(firstResult, ownership), /already claimed/);
});

test('T7-CLOSE-TIMEOUT freezes historical failure, permits genuine late ref clearing, and remains reload-only', async () => {
  const loaded = await loadSession({ closeMode: 'deferred' }, 'timed-out-session');
  const pending = loaded.capability.unload('application-teardown');
  await flushMicrotasks();
  const closeDeadline = loaded.deadlines.find(({ kind }) => kind === 'context-close');
  assert.deepEqual(
    { kind: closeDeadline.kind, milliseconds: closeDeadline.milliseconds },
    { kind: 'context-close', milliseconds: 1_000 },
  );
  closeDeadline.fire();
  const result = await pending;
  assert.deepEqual(result, { status: 'failed', cause: 'context-close-failed' });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(loaded.loader.getDiagnostics().state, 'recovery');
  assert.equal(loaded.loader.getDiagnostics().allocatedContextCount, 1);

  loaded.closeOperations[0].resolve();
  await flushMicrotasks(8);
  assert.deepEqual(result, { status: 'failed', cause: 'context-close-failed' });
  assert.deepEqual(loaded.loader.getDiagnostics(), {
    state: 'recovery',
    allocatedContextCount: 0,
    loadedSessionCount: 0,
  });
  await assert.rejects(
    loaded.loader.load({ file: loaded.file, loadedSessionId: 'replacement' }),
    (error) => error.code === 'loader-recovery-required',
  );
});

test('T7-DEADLINE-ACCESSORS captures deadline authority once and never leaks accessor failures', async () => {
  const loaded = await loadSession({
    closeMode: 'deferred',
    deadlinePromiseAccessorBomb: true,
  }, 'deadline-accessor-session');
  const pending = loaded.capability.unload('application-teardown');
  await flushMicrotasks();
  const closeDeadline = loaded.deadlines.find(({ kind }) => kind === 'context-close');
  closeDeadline.fire();
  const result = await pending;
  assert.deepEqual(result, { status: 'failed', cause: 'context-close-failed' });
  assert.equal(JSON.stringify(result).includes('PRIVATE_DEADLINE_ACCESSOR'), false);
  assert.equal(loaded.loader.getDiagnostics().state, 'recovery');
});

test('T7-UNEXPECTED-CLOSE releases the decoded owner and requires a fresh selected session', async () => {
  const loaded = await loadSession({}, 'unexpected-close');
  loaded.contexts[0].state = 'closed';
  loaded.contexts[0].onstatechange();
  await flushMicrotasks(8);
  const result = await loaded.capability.unload('observe-completed-cleanup');
  assert.deepEqual(result, { status: 'succeeded', cause: null });
  assert.deepEqual(loaded.loader.getDiagnostics(), {
    state: 'idle',
    allocatedContextCount: 0,
    loadedSessionCount: 0,
  });
});
