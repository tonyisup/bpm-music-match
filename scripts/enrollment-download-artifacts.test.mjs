import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDownloadArtifactNames } from './enrollment-download-artifacts.mjs';

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
