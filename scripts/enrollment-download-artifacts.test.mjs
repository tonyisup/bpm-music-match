import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHROME_DOWNLOAD_SETTLE_OPTIONS,
  CHROME_TEMPORARY_TREE_REMOVE_OPTIONS,
  validateDownloadArtifactNames,
  waitForSettledDownloadArtifacts,
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

test('download artifact settling waits for a Chrome partial download to finish', async () => {
  const observations = [
    [REPORT, 'downloads.html.crdownload'],
    [REPORT, 'downloads.html'],
  ];
  const waits = [];

  const settled = await waitForSettledDownloadArtifacts(
    async () => observations.shift(),
    {
      maxAttempts: 2,
      retryDelay: 7,
      wait: async (milliseconds) => waits.push(milliseconds),
    },
  );

  assert.deepEqual(settled, [REPORT, 'downloads.html']);
  assert.deepEqual(waits, [7]);
  assert.deepEqual(validateDownloadArtifactNames(settled), ['downloads.html']);
});

test('download artifact settling fails closed when a partial download persists', async () => {
  let reads = 0;
  let waits = 0;

  await assert.rejects(
    waitForSettledDownloadArtifacts(
      async () => {
        reads += 1;
        return [REPORT, 'downloads.html.crdownload'];
      },
      {
        maxAttempts: 3,
        retryDelay: 0,
        wait: async () => {
          waits += 1;
        },
      },
    ),
    /Chrome download artifacts did not settle/,
  );
  assert.equal(reads, 3);
  assert.equal(waits, 2);
});

test('Chrome download settling is bounded and frozen', () => {
  assert.deepEqual(CHROME_DOWNLOAD_SETTLE_OPTIONS, {
    maxAttempts: 50,
    retryDelay: 100,
  });
  assert.equal(Object.isFrozen(CHROME_DOWNLOAD_SETTLE_OPTIONS), true);
});
