#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

const TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion',
  'buildCommit',
  'terminalRecordReceiptId',
  'assetIdentity',
  'experimentConfigIdentity',
  'terminal',
  'cleanup',
  'assessment',
]);

class ValidationFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ValidationFailure(code);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isRecord(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function validateRecord(candidate) {
  if (!hasExactKeys(candidate, TOP_LEVEL_KEYS)
      || candidate.schemaVersion !== 'one-track-evidence-v1'
      || typeof candidate.buildCommit !== 'string'
      || !/^(?:__BUILD_SHA__|[0-9a-f]{40})$/.test(candidate.buildCommit)
      || typeof candidate.terminalRecordReceiptId !== 'string'
      || !isRecord(candidate.assetIdentity)
      || !isRecord(candidate.experimentConfigIdentity)
      || !isRecord(candidate.terminal)
      || !isRecord(candidate.cleanup)
      || !isRecord(candidate.assessment)) {
    fail('record-shape');
  }
  const { terminal, cleanup, assessment } = candidate;
  if (!['scored', 'smoke'].includes(terminal.recordKind)
      || assessment.recordKind !== terminal.recordKind
      || !['succeeded', 'failed'].includes(cleanup.status)) {
    fail('record-contract');
  }
  if (terminal.recordKind === 'scored'
      && !['intentional', 'mechanical', 'not-judged'].includes(assessment.verdict)) {
    fail('scored-assessment');
  }
  if (terminal.recordKind === 'smoke' && Object.hasOwn(assessment, 'verdict')) {
    fail('smoke-assessment');
  }
  return candidate;
}

export function validateEvidenceCorpus(records) {
  if (!Array.isArray(records) || records.length !== 12) fail('record-count');
  const validated = records.map(validateRecord);
  const buildCommit = validated[0].buildCommit;
  const assetIdentity = JSON.stringify(validated[0].assetIdentity);
  const experimentConfigIdentity = JSON.stringify(validated[0].experimentConfigIdentity);
  if (validated.some((record) => record.buildCommit !== buildCommit
      || JSON.stringify(record.assetIdentity) !== assetIdentity
      || JSON.stringify(record.experimentConfigIdentity) !== experimentConfigIdentity)) {
    fail('mixed-identity');
  }
  const receiptIds = new Set(validated.map((record) => record.terminalRecordReceiptId));
  if (receiptIds.size !== validated.length) fail('duplicate-record');
  const scored = validated.filter((record) => record.terminal.recordKind === 'scored');
  const smokes = validated.filter((record) => record.terminal.recordKind === 'smoke');
  if (scored.length !== 10 || smokes.length !== 2) fail('protocol-shape');
  const smokeRuns = new Set(smokes.map((record) => record.terminal.runValue));
  if (!smokeRuns.has('smoke-crossfade') || !smokeRuns.has('smoke-playing')) {
    fail('smoke-runs');
  }
  const intentional = scored.filter(
    (record) => record.assessment.verdict === 'intentional',
  ).length;
  const technical = scored.filter((record) => (
    record.cleanup.status === 'succeeded'
      && record.assessment.missingBeat === false
      && record.assessment.doubledBeat === false
      && record.assessment.click === false
      && record.assessment.gap === false
      && record.assessment.audibleClipping === false
      && record.assessment.staleAudio === false
      && record.assessment.ownershipLeak === false
      && record.assessment.teardownFailure === false
  )).length;
  const decision = technical === 10 && intentional >= 8 ? 'PASS' : 'STOP';
  return Object.freeze({ scored: 10, smokes: 2, technical, intentional, decision });
}

function parseDirectoryArgument(args) {
  if (args.length !== 2 || args[0] !== '--dir' || args[1].length === 0) {
    fail('arguments');
  }
  return args[1];
}

export async function run(args) {
  const directory = parseDirectoryArgument(args);
  let names;
  try {
    names = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    fail('directory');
  }
  const records = [];
  for (const name of names) {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(join(directory, basename(name)), 'utf8'));
    } catch {
      fail('json');
    }
    records.push(parsed);
  }
  return validateEvidenceCorpus(records);
}

function reportFailure(error) {
  const code = error instanceof ValidationFailure ? error.code : 'internal';
  process.stderr.write([
    `FAIL one-track-evidence ${code}`,
    'CAUSE: evidence corpus does not satisfy the closed protocol',
    'RERUN: node scripts/validate_one_track_evidence.mjs --dir "$EVIDENCE_DIR"',
    'FIX: docs/validation/milestone-2-one-track-protocol.md#evidence-validator-errors',
    '',
  ].join('\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await run(process.argv.slice(2));
    process.stdout.write(
      `VALID one-track-evidence scored=${result.scored} smokes=${result.smokes} `
      + `technical=${result.technical} intentional=${result.intentional} `
      + `decision=${result.decision}\n`,
    );
  } catch (error) {
    reportFailure(error);
    process.exitCode = 1;
  }
}
