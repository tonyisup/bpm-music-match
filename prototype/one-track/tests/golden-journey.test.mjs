import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSET_IDENTITY,
  EXPERIMENT_CONFIG_IDENTITY,
} from '../src/config.mjs';
import {
  createEvidenceDownload,
  createEvidenceRecorder,
} from '../src/core/evidence-schema.mjs';
import { parseRunQuery } from '../src/core/run-context.mjs';
import { createInitialSessionState, reduceSession } from '../src/core/session-reducer.mjs';
import { replaySession } from '../src/replay/replay-session.mjs';
import { createViewModel } from '../src/browser/renderer.mjs';
import { REPLAY_CASES } from './fixtures/replay-cases.mjs';

function readyState() {
  const initial = createInitialSessionState(parseRunQuery('?run=session-1'));
  const selecting = reduceSession(initial, { type: 'choose-track' });
  const loading = reduceSession(selecting.state, {
    type: 'file-selected',
    selectionId: 'selection-1',
  });
  const effect = loading.effects[0];
  return reduceSession(loading.state, {
    type: 'load-succeeded',
    sessionId: effect.sessionId,
    generationId: effect.generationId,
    effectId: effect.effectId,
    effectType: effect.effectType,
    loadToken: effect.payload.loadToken,
    loadedSessionId: 'loaded-session-1',
    assetIdentity: ASSET_IDENTITY,
    experimentConfigIdentity: EXPERIMENT_CONFIG_IDENTITY,
  }).state;
}

test('T10-GOLDEN-JOURNEY reaches evidence through tracking, handoff, playing, and natural completion', () => {
  const journey = REPLAY_CASES.find(({ name }) => name === 'natural-end');
  const replay = replaySession(readyState(), journey.events);
  const phases = replay.transitions.map(({ state }) => state.phase);
  assert.equal(phases.includes('tracking'), true);
  assert.equal(phases.includes('armed'), true);
  assert.equal(phases.includes('handoff'), true);
  assert.equal(phases.includes('playing'), true);
  assert.equal(replay.finalState.phase, 'evidence-pending');
  assert.equal(createViewModel(replay.finalState).evidenceVisible, true);

  const recorder = createEvidenceRecorder({ sessionId: replay.finalState.sessionId });
  const receipt = recorder.captureTerminalDraft(replay.finalState.terminalDraft);
  recorder.writeCleanup(receipt, {
    scope: 'generation',
    status: 'succeeded',
    cause: null,
    referencesCleared: true,
    settlementComplete: true,
  });
  const evidence = recorder.finalize(receipt, {
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
  });
  const download = createEvidenceDownload(evidence);
  assert.equal(download.filename, 'bpm-music-match-evidence.json');
  assert.match(download.href, /^data:application\/json;charset=utf-8,/);
  assert.equal(download.href.includes('loaded-session-1'), false);
});
