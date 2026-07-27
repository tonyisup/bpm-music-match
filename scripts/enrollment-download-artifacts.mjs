import assert from 'node:assert/strict';

export const ENROLLMENT_REPORT_FILENAME = 'm2-enrollment-report.json';
const CHROME_AUXILIARY_DOWNLOAD_FILENAMES = Object.freeze(['downloads.html']);

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
