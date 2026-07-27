import { assertEnrollmentBuildCommit } from './enrollment-build.mjs';

assertEnrollmentBuildCommit('__ENROLLMENT_BUILD_COMMIT__');

export const ENROLLMENT_CONFIG = Object.freeze({
  schemaVersion: 1,
  assetVersion: 'm2-island-party-v1',
  displayLabel: 'Island Party by NDA',
  allowedExtension: '.mp3',
  allowedMimeType: 'audio/mpeg',
  decodedDurationToleranceSeconds: 0.050,
  configVersion: 'm2-config-v1',
  trackBpm: 110,
  trackBpmVerified: false,
  beatsPerBar: 4,
  leadInBeats: 4,
  minimumPostCrossfadeTailSeconds: 2,
  percussionRecipeId: 'kick-snare-v1',
  percussionTrimGain: 0.25,
  trackTrimGain: 0.50,
  masterGain: 0.70,
  bpmMatchWindow: 3.0,
  intervalOutlierFraction: 0.20,
  stabilityCvLimit: 0.05,
  reconciliationToleranceMs: 60,
  silenceTimeoutFormula: 'clamp-1.5x-median-900-1800-v1',
  crossfadeStartBeat: 4,
  targetDownbeatBeat: 5,
  crossfadeEndBeat: 8,
  crossfadeSampleCount: 128,
  crossfadeCurveId: 'equal-power-sin-cos-v1',
});
