export const ENROLLMENT_BUILD_COMMIT = '__ENROLLMENT_BUILD_COMMIT__';

export function assertEnrollmentBuildCommit(moduleCommit) {
  if (moduleCommit !== ENROLLMENT_BUILD_COMMIT) {
    throw new TypeError('enrollment build identity mismatch');
  }
}

export function assertEnrollmentHtmlBuildCommit(documentRef) {
  const htmlCommit = documentRef
    ?.querySelector?.('meta[name="build-commit"]')
    ?.getAttribute?.('content');
  if (htmlCommit !== ENROLLMENT_BUILD_COMMIT) {
    throw new TypeError('enrollment HTML build identity mismatch');
  }
}
