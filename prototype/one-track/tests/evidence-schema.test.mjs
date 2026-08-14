import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEvidenceDownload,
  createEvidenceRecorder,
  serializeEvidence,
} from '../src/core/evidence-schema.mjs';

function terminalDraft(overrides = {}) {
  return Object.freeze({
    sessionId: 'session-1',
    generationId: 1,
    cause: 'trial-complete',
    runValue: 'session-1',
    recordKind: 'scored',
    acceptedTap: true,
    estimatedBpmExact: 110,
    matchDecision: Object.freeze({
      estimatedBpmExact: 110,
      withinApplicationWindow: true,
      actualClass: 'CENTER',
      assignedClass: 'CENTER',
      assignedClassMatched: true,
    }),
    attempts: Object.freeze([]),
    pairedWarmedAutoFailure: null,
    ...overrides,
  });
}

function cleanup() {
  return {
    scope: 'generation',
    status: 'succeeded',
    cause: null,
    referencesCleared: true,
    settlementComplete: true,
  };
}

function scoredAssessment() {
  return {
    recordKind: 'scored',
    verdict: 'intentional',
    missingBeat: false,
    doubledBeat: false,
    click: false,
    gap: false,
    audibleClipping: false,
    staleAudio: false,
    ownershipLeak: false,
    teardownFailure: false,
  };
}

test('T5-AUTHORITY captures one terminal draft and mints a no-data owned receipt', () => {
  const owner = createEvidenceRecorder({ sessionId: 'session-1' });
  const receipt = owner.captureTerminalDraft(terminalDraft());
  assert.deepEqual(receipt, {});
  assert.equal(owner.assertTerminalRecordReceipt(receipt), true);
  assert.equal(
    owner.terminalRecordReceiptId(receipt),
    'terminal-record-session-1-generation-1',
  );
  assert.throws(() => owner.captureTerminalDraft(terminalDraft()), /already captured/);
  assert.throws(() => createEvidenceRecorder({ sessionId: 'session-1' })
    .assertTerminalRecordReceipt(receipt), /genuine terminal/);
});

test('T5-FINALIZE requires genuine cleanup before one immutable finalization', () => {
  const owner = createEvidenceRecorder({ sessionId: 'session-1' });
  const receipt = owner.captureTerminalDraft(terminalDraft());
  assert.throws(() => owner.finalize(receipt, scoredAssessment()), /not ready/);
  owner.writeCleanup(receipt, cleanup());
  const evidence = owner.finalize(receipt, scoredAssessment());
  const parsed = JSON.parse(serializeEvidence(evidence));
  assert.equal(parsed.schemaVersion, 'one-track-evidence-v1');
  assert.equal(parsed.terminal.cause, 'trial-complete');
  assert.equal(parsed.cleanup.status, 'succeeded');
  assert.equal(parsed.assessment.verdict, 'intentional');
  assert.throws(() => owner.finalize(receipt, scoredAssessment()), /not ready/);
  assert.throws(() => owner.writeCleanup(receipt, cleanup()), /not writable/);
});

test('T5-SMOKE closes observations without adding a subjective verdict', () => {
  const owner = createEvidenceRecorder({ sessionId: 'smoke-crossfade' });
  const receipt = owner.captureTerminalDraft(terminalDraft({
    sessionId: 'smoke-crossfade',
    runValue: 'smoke-crossfade',
    recordKind: 'smoke',
    cause: 'trial-cancelled',
    estimatedBpmExact: null,
    matchDecision: null,
  }));
  owner.writeCleanup(receipt, cleanup());
  const evidence = owner.finalize(receipt, {
    recordKind: 'smoke',
    oldGenerationStoppedCleanly: true,
    noDelayedTail: true,
    noDoubledAcknowledgment: true,
    noStaleRestart: true,
    nextTapAcknowledged: true,
  });
  const parsed = JSON.parse(serializeEvidence(evidence));
  assert.equal(parsed.assessment.recordKind, 'smoke');
  assert.equal(Object.hasOwn(parsed.assessment, 'verdict'), false);
});

test('T5-PRIVACY rejects foreign shapes and exports only a fixed data URL', () => {
  const owner = createEvidenceRecorder({ sessionId: 'session-1' });
  assert.throws(() => owner.captureTerminalDraft({
    ...terminalDraft(),
    filename: 'private-song.mp3',
  }), /terminal draft/);
  const receipt = owner.captureTerminalDraft(terminalDraft());
  assert.throws(() => owner.writeCleanup(receipt, {
    ...cleanup(),
    path: '/private/song.mp3',
  }), /exact ordinary/);
  owner.writeCleanup(receipt, cleanup());
  const evidence = owner.finalize(receipt, scoredAssessment());
  const descriptor = createEvidenceDownload(evidence);
  assert.equal(descriptor.filename, 'bpm-music-match-evidence.json');
  assert.match(descriptor.href, /^data:application\/json;charset=utf-8,/);
  assert.doesNotMatch(descriptor.href, /private-song|\/private\//);
  assert.throws(() => serializeEvidence({}), /genuine finalized/);
});
