import {
  BUILD_SHA,
  assertBuildIdentity,
} from '../build-identity.mjs';
import {
  ASSET_IDENTITY,
  EXPERIMENT_CONFIG_IDENTITY,
} from '../config.mjs';
import { assertTerminalDraft } from './effects.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_ATTEMPTS = 3;
const CAPTURED_JSON_STRINGIFY = JSON.stringify;
const RECEIPT_OWNERS = new WeakMap();
const EVIDENCE_SNAPSHOTS = new WeakMap();

const CLEANUP_KEYS = Object.freeze([
  'scope',
  'status',
  'cause',
  'referencesCleared',
  'settlementComplete',
]);
const SCORED_ASSESSMENT_KEYS = Object.freeze([
  'recordKind',
  'verdict',
  'missingBeat',
  'doubledBeat',
  'click',
  'gap',
  'audibleClipping',
  'staleAudio',
  'ownershipLeak',
  'teardownFailure',
]);
const SMOKE_ASSESSMENT_KEYS = Object.freeze([
  'recordKind',
  'oldGenerationStoppedCleanly',
  'noDelayedTail',
  'noDoubledAcknowledgment',
  'noStaleRestart',
  'nextTapAcknowledged',
]);

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

function isIdentifier(value) {
  return typeof value === 'string'
    && value.length <= MAX_IDENTIFIER_LENGTH
    && /^[a-z][a-z0-9-]*$/.test(value);
}

function readExactRecord(candidate, keys, label) {
  if (candidate === null
      || typeof candidate !== 'object'
      || Array.isArray(candidate)
      || Object.getPrototypeOf(candidate) !== Object.prototype) {
    throw new TypeError(`${label} must be an exact ordinary data record`);
  }
  const ownKeys = Reflect.ownKeys(candidate);
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  if (ownKeys.length !== keys.length
      || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
      || keys.some((key) => {
        const descriptor = descriptors[key];
        return descriptor === undefined
          || descriptor.enumerable !== true
          || !Object.hasOwn(descriptor, 'value');
      })) {
    throw new TypeError(`${label} must be an exact ordinary data record`);
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function clonePureData(value, ancestors = new Set(), depth = 0) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && value.length > 512) {
      throw new TypeError('evidence strings must be bounded');
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('evidence numbers must be finite');
    return value;
  }
  if (typeof value !== 'object' || ancestors.has(value) || depth >= 8) {
    throw new TypeError('evidence must contain bounded acyclic pure data');
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 64) {
      throw new TypeError('evidence arrays must be bounded ordinary arrays');
    }
    const keys = Array.from({ length: value.length }, (_, index) => String(index));
    const ownKeys = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (ownKeys.length !== keys.length + 1
        || ownKeys.some((key) => typeof key !== 'string' || (key !== 'length' && !keys.includes(key)))
        || keys.some((key) => descriptors[key]?.enumerable !== true
          || !Object.hasOwn(descriptors[key], 'value'))) {
      throw new TypeError('evidence arrays must be dense data arrays');
    }
    return Object.freeze(keys.map(
      (key) => clonePureData(descriptors[key].value, nextAncestors, depth + 1),
    ));
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('evidence records must be ordinary data records');
  }
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.length > 64
      || keys.some((key) => typeof key !== 'string'
        || key.length === 0
        || key.length > 64
        || descriptors[key]?.enumerable !== true
        || !Object.hasOwn(descriptors[key], 'value'))) {
    throw new TypeError('evidence records must contain bounded enumerable data properties');
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => [
    key,
    clonePureData(descriptors[key].value, nextAncestors, depth + 1),
  ])));
}

function validateCleanup(candidate) {
  const cleanup = readExactRecord(candidate, CLEANUP_KEYS, 'cleanup');
  const validStatus = cleanup.status === 'succeeded'
    ? cleanup.cause === null
    : cleanup.status === 'failed' && typeof cleanup.cause === 'string';
  if (!['generation', 'application'].includes(cleanup.scope)
      || !validStatus
      || typeof cleanup.referencesCleared !== 'boolean'
      || typeof cleanup.settlementComplete !== 'boolean') {
    throw new TypeError('cleanup result is invalid');
  }
  return Object.freeze({ ...cleanup });
}

function validateAssessment(candidate, recordKind) {
  const keys = recordKind === 'scored' ? SCORED_ASSESSMENT_KEYS : SMOKE_ASSESSMENT_KEYS;
  const assessment = readExactRecord(candidate, keys, 'assessment');
  if (assessment.recordKind !== recordKind) {
    throw new TypeError('assessment record kind does not match terminal evidence');
  }
  if (recordKind === 'scored') {
    if (!['intentional', 'mechanical', 'not-judged'].includes(assessment.verdict)
        || SCORED_ASSESSMENT_KEYS.slice(2).some(
          (key) => typeof assessment[key] !== 'boolean',
        )) {
      throw new TypeError('scored assessment is invalid');
    }
  } else if (SMOKE_ASSESSMENT_KEYS.slice(1).some(
    (key) => typeof assessment[key] !== 'boolean',
  )) {
    throw new TypeError('smoke assessment is invalid');
  }
  return Object.freeze({ ...assessment });
}

function copyTerminalDraft(candidate) {
  assertTerminalDraft(candidate);
  if (candidate.attempts.length > MAX_ATTEMPTS) {
    throw new TypeError('terminal evidence attempts are invalid');
  }
  return clonePureData(candidate);
}

function readOwnedReceipt(recorder, receipt) {
  const ownership = RECEIPT_OWNERS.get(receipt);
  if (ownership?.recorder !== recorder) {
    throw new TypeError('genuine terminal record receipt required');
  }
  return ownership;
}

export function createEvidenceRecorder({ sessionId }) {
  if (!isIdentifier(sessionId)) {
    throw new TypeError('evidence recorder sessionId is invalid');
  }
  const recorder = {};
  let active = null;

  function captureTerminalDraft(candidate) {
    if (active !== null && active.evidence === null) {
      throw new TypeError('terminal evidence is already captured');
    }
    const terminalDraft = copyTerminalDraft(candidate);
    if (terminalDraft.sessionId !== sessionId) {
      throw new TypeError('terminal evidence session ownership is invalid');
    }
    const receipt = Object.freeze({});
    const terminalRecordReceiptId = `terminal-record-${sessionId}-generation-${terminalDraft.generationId}`;
    active = {
      receipt,
      terminalDraft,
      terminalRecordReceiptId,
      cleanup: null,
      evidence: null,
    };
    RECEIPT_OWNERS.set(receipt, Object.freeze({
      recorder,
      terminalRecordReceiptId,
    }));
    return receipt;
  }

  function authorizeGenerationCleanup(candidate) {
    const request = readExactRecord(
      candidate,
      ['sessionId', 'generationId'],
      'generation cleanup authority',
    );
    if (request.sessionId !== sessionId
        || !Number.isSafeInteger(request.generationId)
        || request.generationId <= 0) {
      throw new TypeError('generation cleanup authority is invalid');
    }
    const receipt = Object.freeze({});
    RECEIPT_OWNERS.set(receipt, Object.freeze({
      recorder,
      terminalRecordReceiptId: `cleanup-${sessionId}-generation-${request.generationId}`,
    }));
    return receipt;
  }

  function assertTerminalRecordReceipt(receipt) {
    readOwnedReceipt(recorder, receipt);
    return true;
  }

  function terminalRecordReceiptId(receipt) {
    return readOwnedReceipt(recorder, receipt).terminalRecordReceiptId;
  }

  function writeCleanup(receipt, candidate) {
    readOwnedReceipt(recorder, receipt);
    if (active?.receipt !== receipt || active.cleanup !== null || active.evidence !== null) {
      throw new TypeError('cleanup evidence is not writable');
    }
    active.cleanup = validateCleanup(candidate);
    return true;
  }

  function finalize(receipt, candidate) {
    readOwnedReceipt(recorder, receipt);
    if (active?.receipt !== receipt || active.cleanup === null || active.evidence !== null) {
      throw new TypeError('terminal evidence is not ready to finalize');
    }
    const assessment = validateAssessment(candidate, active.terminalDraft.recordKind);
    const snapshot = Object.freeze({
      schemaVersion: 'one-track-evidence-v1',
      buildCommit: BUILD_SHA,
      terminalRecordReceiptId: active.terminalRecordReceiptId,
      assetIdentity: clonePureData(ASSET_IDENTITY),
      experimentConfigIdentity: clonePureData(EXPERIMENT_CONFIG_IDENTITY),
      terminal: active.terminalDraft,
      cleanup: active.cleanup,
      assessment,
    });
    const evidence = Object.freeze({});
    active.evidence = evidence;
    EVIDENCE_SNAPSHOTS.set(evidence, snapshot);
    return evidence;
  }

  return Object.freeze({
    captureTerminalDraft,
    authorizeGenerationCleanup,
    assertTerminalRecordReceipt,
    terminalRecordReceiptId,
    writeCleanup,
    finalize,
  });
}

export function serializeEvidence(candidate) {
  const snapshot = EVIDENCE_SNAPSHOTS.get(candidate);
  if (snapshot === undefined) throw new TypeError('genuine finalized evidence required');
  return CAPTURED_JSON_STRINGIFY(snapshot);
}

export function createEvidenceDownload(candidate) {
  const serialized = serializeEvidence(candidate);
  return Object.freeze({
    filename: 'bpm-music-match-evidence.json',
    href: `data:application/json;charset=utf-8,${encodeURIComponent(serialized)}`,
  });
}
