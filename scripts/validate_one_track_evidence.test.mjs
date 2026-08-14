import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { validateEvidenceCorpus } from './validate_one_track_evidence.mjs';

function record(index, recordKind, runValue) {
  const scored = recordKind === 'scored';
  return {
    schemaVersion: 'one-track-evidence-v1',
    buildCommit: '0123456789abcdef0123456789abcdef01234567',
    terminalRecordReceiptId: `terminal-record-${runValue}-generation-${index + 1}`,
    assetIdentity: { assetVersion: 'm2-island-party-v1' },
    experimentConfigIdentity: { configVersion: 'm2-config-v1' },
    terminal: { recordKind, runValue },
    cleanup: { status: 'succeeded' },
    assessment: scored ? {
      recordKind,
      verdict: index < 8 ? 'intentional' : 'mechanical',
      missingBeat: false,
      doubledBeat: false,
      click: false,
      gap: false,
      audibleClipping: false,
      staleAudio: false,
      ownershipLeak: false,
      teardownFailure: false,
    } : {
      recordKind,
      oldGenerationStoppedCleanly: true,
      noDelayedTail: true,
      noDoubledAcknowledgment: true,
      noStaleRestart: true,
      nextTapAcknowledged: true,
    },
  };
}

function completeCorpus() {
  return [
    ...Array.from({ length: 10 }, (_, index) => record(
      index,
      'scored',
      `session-${Math.floor(index / 2) + 1}`,
    )),
    record(10, 'smoke', 'smoke-crossfade'),
    record(11, 'smoke', 'smoke-playing'),
  ];
}

test('T5-VALIDATOR accepts one closed complete corpus and computes PASS', () => {
  assert.deepEqual(validateEvidenceCorpus(completeCorpus()), {
    scored: 10,
    smokes: 2,
    technical: 10,
    intentional: 8,
    decision: 'PASS',
  });
});

test('T5-VALIDATOR rejects incomplete, mixed, and duplicate corpora', () => {
  assert.throws(() => validateEvidenceCorpus(completeCorpus().slice(0, 11)), /record-count/);
  const mixed = completeCorpus();
  mixed[4] = { ...mixed[4], buildCommit: 'abcdef0123456789abcdef0123456789abcdef01' };
  assert.throws(() => validateEvidenceCorpus(mixed), /mixed-identity/);
  const duplicate = completeCorpus();
  duplicate[3] = {
    ...duplicate[3],
    terminalRecordReceiptId: duplicate[2].terminalRecordReceiptId,
  };
  assert.throws(() => validateEvidenceCorpus(duplicate), /duplicate-record/);
});

test('T5-VALIDATOR CLI emits bounded success and privacy-safe failure output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'one-track-evidence-'));
  try {
    await Promise.all(completeCorpus().map((candidate, index) => writeFile(
      join(directory, `${String(index + 1).padStart(2, '0')}.json`),
      JSON.stringify(candidate),
      'utf8',
    )));
    const success = spawnSync(
      process.execPath,
      ['scripts/validate_one_track_evidence.mjs', '--dir', directory],
      { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
    );
    assert.equal(success.status, 0);
    assert.equal(
      success.stdout.trim(),
      'VALID one-track-evidence scored=10 smokes=2 technical=10 intentional=8 decision=PASS',
    );

    await writeFile(join(directory, '01.json'), '{"private":"SENSITIVE_FILENAME.mp3"}', 'utf8');
    const failure = spawnSync(
      process.execPath,
      ['scripts/validate_one_track_evidence.mjs', '--dir', directory],
      { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
    );
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /^FAIL one-track-evidence record-shape/m);
    assert.doesNotMatch(failure.stderr, /SENSITIVE_FILENAME|one-track-evidence-[^\s]+/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
