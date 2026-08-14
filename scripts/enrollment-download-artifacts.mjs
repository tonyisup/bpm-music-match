import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export const ENROLLMENT_REPORT_FILENAME = 'm2-enrollment-report.json';
export const CHROME_TEMPORARY_TREE_REMOVE_OPTIONS = Object.freeze({
  force: true,
  recursive: true,
  maxRetries: 5,
  retryDelay: 100,
});
export const CHROME_DOWNLOAD_SETTLE_OPTIONS = Object.freeze({
  maxAttempts: 50,
  retryDelay: 100,
});
const CHROME_AUXILIARY_DOWNLOAD_FILENAMES = Object.freeze(['downloads.html']);

export async function waitForSettledDownloadArtifacts(
  readDownloadFiles,
  {
    maxAttempts = CHROME_DOWNLOAD_SETTLE_OPTIONS.maxAttempts,
    retryDelay = CHROME_DOWNLOAD_SETTLE_OPTIONS.retryDelay,
    wait = delay,
  } = {},
) {
  assert.equal(typeof readDownloadFiles, 'function', 'download artifact reader must be a function');
  assert.equal(Number.isInteger(maxAttempts) && maxAttempts > 0, true, 'max attempts must be positive');
  assert.equal(Number.isInteger(retryDelay) && retryDelay >= 0, true, 'retry delay must be non-negative');
  assert.equal(typeof wait, 'function', 'download artifact wait must be a function');

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const downloadFiles = await readDownloadFiles();
    assert.equal(Array.isArray(downloadFiles), true, 'download artifact names must be an array');
    const hasPartialDownload = downloadFiles.some(
      (name) => typeof name === 'string' && name.endsWith('.crdownload'),
    );
    if (!hasPartialDownload) return downloadFiles;
    if (attempt < maxAttempts) await wait(retryDelay);
  }

  assert.fail('Chrome download artifacts did not settle');
}

export function validateDownloadArtifactNames(downloadFiles) {
  assert.equal(Array.isArray(downloadFiles), true, 'download artifact names must be an array');
  assert.equal(
    downloadFiles.every((name) => typeof name === 'string'),
    true,
    'download artifact names must be strings',
  );
  assert.equal(
    downloadFiles.filter((name) => name === ENROLLMENT_REPORT_FILENAME).length,
    1,
    'download directory must contain exactly one enrollment report',
  );

  const auxiliaryFiles = downloadFiles
    .filter((name) => name !== ENROLLMENT_REPORT_FILENAME)
    .sort();
  assert.deepEqual(
    auxiliaryFiles,
    auxiliaryFiles.filter((name) => CHROME_AUXILIARY_DOWNLOAD_FILENAMES.includes(name)),
    'download directory contained an unknown artifact',
  );
  assert.equal(
    new Set(auxiliaryFiles).size,
    auxiliaryFiles.length,
    'download directory contained a duplicate auxiliary artifact',
  );
  return auxiliaryFiles;
}
