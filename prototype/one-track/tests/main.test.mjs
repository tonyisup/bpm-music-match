import test from 'node:test';
import assert from 'node:assert/strict';

import { readAssessment } from '../src/browser/main.mjs';

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
