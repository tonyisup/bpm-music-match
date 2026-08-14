export const BUILD_SHA = '__BUILD_SHA__';

const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function assertFullCommit(value, label) {
  if (typeof value !== 'string' || !FULL_COMMIT_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a full 40-character lowercase commit SHA`);
  }
}

export function assertMatchingBuildIdentity(authorityBuildSha, localBuildSha) {
  assertFullCommit(authorityBuildSha, 'authority build identity');
  assertFullCommit(localBuildSha, 'local build identity');
  if (localBuildSha !== authorityBuildSha) {
    throw new TypeError('mixed build identity');
  }
  return authorityBuildSha;
}

export function assertBuildIdentity(localBuildSha) {
  return assertMatchingBuildIdentity(BUILD_SHA, localBuildSha);
}

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(BUILD_SHA);
}
