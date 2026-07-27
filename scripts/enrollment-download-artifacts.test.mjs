import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHROME_TEMPORARY_TREE_REMOVE_OPTIONS,
  validateDownloadArtifactNames,
} from './enrollment-download-artifacts.mjs';

const REPORT = 'm2-enrollment-report.json';

test('download artifacts require one report and allow only Chrome Linux auxiliary metadata', () => {
  assert.deepEqual(validateDownloadArtifactNames([REPORT]), []);
  assert.deepEqual(
    validateDownloadArtifactNames([REPORT, 'downloads.html']),
    ['downloads.html'],
  );
  assert.deepEqual(
    validateDownloadArtifactNames(['downloads.html', REPORT]),
    ['downloads.html'],
  );

  for (const invalid of [
    [],
    ['downloads.html'],
    [REPORT, REPORT],
    [REPORT, 'downloads.html', 'downloads.html'],
    [REPORT, 'unexpected.txt'],
    [REPORT, 'downloads.html', 'unexpected.txt'],
  ]) {
    assert.throws(() => validateDownloadArtifactNames(invalid), assert.AssertionError);
  }
});

test('Chrome temporary tree cleanup retries only a bounded transient removal race', () => {
  assert.deepEqual(CHROME_TEMPORARY_TREE_REMOVE_OPTIONS, {
    force: true,
    recursive: true,
    maxRetries: 5,
    retryDelay: 100,
  });
  assert.equal(Object.isFrozen(CHROME_TEMPORARY_TREE_REMOVE_OPTIONS), true);
});
