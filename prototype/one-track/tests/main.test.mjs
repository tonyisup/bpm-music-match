import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activateEvidenceDownload,
  bindTapActivation,
  readAssessment,
} from '../src/browser/main.mjs';

function formWith(values) {
  return {
    elements: {
      namedItem(name) { return values[name]; },
    },
  };
}

test('T10-MAIN reads the exact scored assessment without browser or track data', () => {
  const form = formWith({
    verdict: { value: 'intentional' },
    missingBeat: { checked: false },
    doubledBeat: { checked: false },
    click: { checked: true },
    gap: { checked: false },
    audibleClipping: { checked: false },
    staleAudio: { checked: false },
    ownershipLeak: { checked: false },
    teardownFailure: { checked: false },
  });
  assert.deepEqual(readAssessment(form, 'scored'), {
    recordKind: 'scored',
    verdict: 'intentional',
    missingBeat: false,
    doubledBeat: false,
    click: true,
    gap: false,
    audibleClipping: false,
    staleAudio: false,
    ownershipLeak: false,
    teardownFailure: false,
  });
});

test('T10-MAIN reads smoke observations without a subjective verdict', () => {
  const form = formWith({
    oldGenerationStoppedCleanly: { checked: true },
    noDelayedTail: { checked: true },
    noDoubledAcknowledgment: { checked: true },
    noStaleRestart: { checked: true },
    nextTapAcknowledged: { checked: true },
  });
  const result = readAssessment(form, 'smoke');
  assert.equal(Object.hasOwn(result, 'verdict'), false);
  assert.equal(Object.values(result).filter((value) => value === true).length, 5);
});

test('T10-MAIN accepts pointer and keyboard tap activation exactly once', () => {
  const listeners = new Map();
  const button = {
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  const taps = [];
  bindTapActivation(button, (timestamp) => taps.push(timestamp));

  let prevented = false;
  listeners.get('pointerdown')({
    preventDefault() { prevented = true; },
    timeStamp: 101,
  });
  listeners.get('click')({ detail: 1, timeStamp: 102 });
  listeners.get('click')({ detail: 0, timeStamp: 103 });

  assert.equal(prevented, true);
  assert.deepEqual(taps, [101, 103]);
});

test('T10-MAIN attaches the evidence download and always removes it', () => {
  const calls = [];
  const link = {
    click() { calls.push('click'); },
    remove() { calls.push('remove'); },
  };
  const root = {
    body: { append(candidate) { assert.equal(candidate, link); calls.push('append'); } },
    createElement(name) { assert.equal(name, 'a'); return link; },
  };
  activateEvidenceDownload(root, {
    download: { filename: 'evidence.json', href: 'data:application/json,{}' },
  });
  assert.equal(link.download, 'evidence.json');
  assert.equal(link.href, 'data:application/json,{}');
  assert.equal(link.hidden, true);
  assert.deepEqual(calls, ['append', 'click', 'remove']);
});
