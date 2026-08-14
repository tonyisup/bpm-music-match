import test from 'node:test';
import assert from 'node:assert/strict';

import { createRenderer, createViewModel } from '../src/browser/renderer.mjs';
import { createInitialSessionState, reduceSession } from '../src/core/session-reducer.mjs';
import { parseRunQuery } from '../src/core/run-context.mjs';

test('T10-VIEW keeps the initial screen focused on one private local action', () => {
  const state = createInitialSessionState(parseRunQuery('?run=session-1'));
  assert.deepEqual(createViewModel(state), {
    title: 'Choose the approved track',
    detail: 'Everything stays on this device.',
    runLabel: 'Session 1 · Slot 1 · CENTER',
    estimateLabel: '— BPM',
    chooseVisible: true,
    cancelVisible: false,
    tapVisible: false,
    tapEnabled: false,
    tryAgainVisible: false,
    endVisible: false,
    unloadVisible: false,
    evidenceVisible: false,
    resetVisible: false,
    scoredEvidenceVisible: true,
    smokeEvidenceVisible: false,
    busy: false,
    diagnosticsVisible: false,
  });
});

test('T10-VIEW exposes progress and cancellation while loading', () => {
  const initial = createInitialSessionState(parseRunQuery('?run=session-1'));
  const selecting = reduceSession(initial, { type: 'choose-track' }).state;
  const loading = reduceSession(selecting, { type: 'file-selected', selectionId: 'selection-1' }).state;
  const view = createViewModel(loading);
  assert.equal(view.title, 'Checking the track');
  assert.equal(view.cancelVisible, true);
  assert.equal(view.busy, true);
  assert.equal(view.tapVisible, false);
});

test('T10-VIEW gives smoke runs their own assessment mode', () => {
  const state = createInitialSessionState(parseRunQuery('?run=smoke-crossfade'));
  const view = createViewModel(state);
  assert.equal(view.runLabel, 'Smoke check · crossfade');
  assert.equal(view.scoredEvidenceVisible, false);
  assert.equal(view.smokeEvidenceVisible, true);
});

test('T10-VIEW disables the hidden scored controls for smoke form validation', () => {
  const ids = [
    'run-label', 'state-title', 'state-detail', 'estimate', 'choose-track',
    'cancel-loading', 'tap', 'try-again', 'end-trial', 'unload-track',
    'evidence-form', 'scored-assessment', 'smoke-assessment', 'reset-session',
    'busy-indicator', 'diagnostics',
  ];
  const elements = new Map(ids.map((id) => [id, {
    disabled: false,
    hidden: false,
    textContent: '',
  }]));
  const renderer = createRenderer({ getElementById(id) { return elements.get(id) ?? null; } });

  renderer.render(createInitialSessionState(parseRunQuery('?run=smoke-crossfade')));

  assert.equal(elements.get('scored-assessment').hidden, true);
  assert.equal(elements.get('scored-assessment').disabled, true);
  assert.equal(elements.get('smoke-assessment').hidden, false);
  assert.equal(elements.get('smoke-assessment').disabled, false);
});
