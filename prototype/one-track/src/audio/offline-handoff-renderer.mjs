import { assertHandoffPlan } from '../core/handoff-planner.mjs';
import {
  createEqualPowerCurves,
  equalPowerGainsAtProgress,
} from './audio-math.mjs';

const OUTPUT_CHANNEL_COUNT = 4;
const CANCELLATION_RAMP_SECONDS = 0.020;
const CANCELLATION_STOP_SECONDS = 0.025;
const SYNTHETIC_END_TAIL_SECONDS = 0.100;
const RENDER_TAIL_SECONDS = 0.050;
const SYNTHETIC_PULSE_SPACING_SAMPLES = 4;

function createContext({
  offlineAudioContextFactory,
  length,
  sampleRate,
}) {
  const options = {
    numberOfChannels: OUTPUT_CHANNEL_COUNT,
    length,
    sampleRate,
  };
  if (typeof offlineAudioContextFactory !== 'function') {
    throw new TypeError('offlineAudioContextFactory must be an injected function');
  }
  return offlineAudioContextFactory(options);
}

function setConstantGain(gainNode, value) {
  gainNode.gain.setValueAtTime(value, 0);
}

function scheduleEqualPowerFade({
  percussionGain,
  musicGain,
  startTime,
  endTime,
  sampleCount,
}) {
  const duration = endTime - startTime;
  const curves = createEqualPowerCurves(sampleCount);
  percussionGain.gain.setValueAtTime(1, 0);
  percussionGain.gain.setValueAtTime(1, startTime);
  percussionGain.gain.setValueCurveAtTime(
    Float32Array.from(curves.percussion),
    startTime,
    duration,
  );
  musicGain.gain.setValueAtTime(0, 0);
  musicGain.gain.setValueAtTime(0, startTime);
  musicGain.gain.setValueCurveAtTime(
    Float32Array.from(curves.music),
    startTime,
    duration,
  );
}

function holdAndRampToSilence(audioParam, audioTime, heldValue) {
  if (typeof audioParam.cancelAndHoldAtTime === 'function') {
    audioParam.cancelAndHoldAtTime(audioTime);
  } else {
    audioParam.cancelScheduledValues(audioTime);
    audioParam.setValueAtTime(heldValue, audioTime);
  }
  audioParam.linearRampToValueAtTime(0, audioTime + CANCELLATION_RAMP_SECONDS);
}

function makePulseBuffer(context) {
  const buffer = context.createBuffer(1, 1, context.sampleRate);
  buffer.getChannelData(0)[0] = 1;
  return buffer;
}

function makeSyntheticTrackBuffer(context, plan, effectiveDurationSeconds) {
  const cueOffsetSeconds = plan.trackStartOffsetSeconds
    + (plan.curatedDownbeatAudioTime - plan.trackStartAudioTime);
  const totalDurationSeconds = plan.trackStartOffsetSeconds + effectiveDurationSeconds;
  const buffer = context.createBuffer(
    1,
    Math.ceil(totalDurationSeconds * context.sampleRate) + 1,
    context.sampleRate,
  );
  const channel = buffer.getChannelData(0);
  const playbackStartIndex = Math.floor(plan.trackStartOffsetSeconds * context.sampleRate);
  for (
    let index = playbackStartIndex;
    index < channel.length;
    index += SYNTHETIC_PULSE_SPACING_SAMPLES
  ) {
    channel[index] = 1;
  }
  channel[Math.round(cueOffsetSeconds * context.sampleRate)] = 1;
  return buffer;
}

function freezeRecords(records) {
  return Object.freeze(records.map((record) => Object.freeze(record)));
}

function peakOf(channel) {
  let peak = 0;
  for (const sample of channel) {
    peak = Math.max(peak, Math.abs(sample));
  }
  return peak;
}

export async function renderSyntheticOfflineHandoff({
  plan,
  offlineAudioContextFactory,
  cancellationAudioTime = null,
}) {
  assertHandoffPlan(plan);
  if (cancellationAudioTime !== null
      && (!Number.isFinite(cancellationAudioTime)
        || cancellationAudioTime < plan.trackStartAudioTime
        || cancellationAudioTime >= plan.crossfadeEndAudioTime)) {
    throw new TypeError(
      'cancellationAudioTime must be finite within the synthetic handoff before fade end',
    );
  }

  const sampleRate = plan.outputSampleRate;
  const renderOriginAudioTime = Math.min(
    plan.trackStartAudioTime,
    plan.beatTimes[0],
  );
  const toRenderTime = (audioTime) => audioTime - renderOriginAudioTime;
  const syntheticNaturalTrackEndAudioTime = plan.crossfadeEndAudioTime
    + SYNTHETIC_END_TAIL_SECONDS;
  const syntheticNaturalTrackEndRenderTime = toRenderTime(
    syntheticNaturalTrackEndAudioTime,
  );
  const renderEndAudioTime = Math.max(
    syntheticNaturalTrackEndRenderTime,
    cancellationAudioTime === null
      ? 0
      : toRenderTime(cancellationAudioTime) + CANCELLATION_STOP_SECONDS,
  ) + RENDER_TAIL_SECONDS;
  const context = createContext({
    offlineAudioContextFactory,
    length: Math.ceil(renderEndAudioTime * sampleRate),
    sampleRate,
  });
  if (context === null || typeof context !== 'object'
      || context.sampleRate !== sampleRate
      || typeof context.startRendering !== 'function') {
    throw new TypeError('injected offline audio context is incompatible');
  }

  const merger = context.createChannelMerger(OUTPUT_CHANNEL_COUNT);
  const master = context.createGain();
  const percussionTrim = context.createGain();
  const percussionFade = context.createGain();
  const trackTrim = context.createGain();
  const trackFade = context.createGain();
  setConstantGain(master, plan.masterGain);
  setConstantGain(percussionTrim, plan.percussionTrimGain);
  setConstantGain(trackTrim, plan.trackTrimGain);
  scheduleEqualPowerFade({
    percussionGain: percussionFade,
    musicGain: trackFade,
    startTime: toRenderTime(plan.crossfadeStartAudioTime),
    endTime: toRenderTime(plan.crossfadeEndAudioTime),
    sampleCount: plan.crossfadeCurveSampleCount,
  });

  percussionTrim.connect(percussionFade);
  percussionFade.connect(master);
  trackTrim.connect(trackFade);
  trackFade.connect(master);
  master.connect(merger, 0, 0);
  trackFade.connect(merger, 0, 2);
  merger.connect(context.destination);

  const endEvents = [];
  const sourceRecords = [];
  const registerSource = ({ source, sourceId, sourceType, naturalEndAudioTime }) => {
    const record = {
      source,
      sourceId,
      sourceType,
      naturalEndAudioTime,
      intentionallyStopping: false,
    };
    source.onended = () => {
      endEvents.push(Object.freeze({
        sourceId,
        sourceType,
        endKind: record.intentionallyStopping ? 'intentional' : 'natural',
      }));
    };
    sourceRecords.push(record);
    return record;
  };

  const pulseBuffer = makePulseBuffer(context);
  const percussionBeats = [];
  for (let index = 0; index < plan.beatTimes.length; index += 1) {
    const beatNumber = index + 1;
    const adoptedSourceIds = plan.adoptedSourceIdsByBeat[index];
    const role = adoptedSourceIds.length > 0 ? 'adopted' : 'scheduled';
    const sourceId = role === 'adopted'
      ? adoptedSourceIds[0]
      : `synthetic-beat-${beatNumber}`;
    const source = context.createBufferSource();
    source.buffer = pulseBuffer;
    source.connect(percussionTrim);
    source.connect(merger, 0, 1);
    const beatRenderTime = toRenderTime(plan.beatTimes[index]);
    source.start(beatRenderTime);
    registerSource({
      source,
      sourceId,
      sourceType: 'percussion',
      naturalEndAudioTime: beatRenderTime + pulseBuffer.duration,
    });
    percussionBeats.push(Object.freeze({
      beatNumber,
      audioTime: plan.beatTimes[index],
      role,
      sourceIds: Object.freeze(role === 'adopted' ? [...adoptedSourceIds] : [sourceId]),
      amplitude: 1,
    }));
  }

  const effectiveTrackDurationSeconds = syntheticNaturalTrackEndAudioTime
    - plan.trackStartAudioTime;
  const trackBuffer = makeSyntheticTrackBuffer(context, plan, effectiveTrackDurationSeconds);
  const trackSource = context.createBufferSource();
  trackSource.buffer = trackBuffer;
  trackSource.connect(trackTrim);
  trackSource.connect(merger, 0, 3);
  const trackStartRenderTime = toRenderTime(plan.trackStartAudioTime);
  trackSource.start(trackStartRenderTime, plan.trackStartOffsetSeconds);
  registerSource({
    source: trackSource,
    sourceId: 'synthetic-track',
    sourceType: 'track',
    naturalEndAudioTime: trackStartRenderTime
      + trackBuffer.duration
      - plan.trackStartOffsetSeconds,
  });

  let cancellation = null;
  if (cancellationAudioTime !== null) {
    const cancellationRenderTime = toRenderTime(cancellationAudioTime);
    const fadeProgress = Math.max(0, Math.min(
      1,
      (cancellationAudioTime - plan.crossfadeStartAudioTime)
        / (plan.crossfadeEndAudioTime - plan.crossfadeStartAudioTime),
    ));
    const heldGains = equalPowerGainsAtProgress(fadeProgress);
    const percussionHeldGain = heldGains.percussion;
    const musicHeldGain = heldGains.music;
    holdAndRampToSilence(percussionFade.gain, cancellationRenderTime, percussionHeldGain);
    holdAndRampToSilence(trackFade.gain, cancellationRenderTime, musicHeldGain);
    const stopRenderTime = cancellationRenderTime + CANCELLATION_STOP_SECONDS;
    for (const record of sourceRecords) {
      if (record.naturalEndAudioTime > stopRenderTime) {
        record.intentionallyStopping = true;
        record.source.stop(stopRenderTime);
      }
    }
    cancellation = Object.freeze({
      audioTime: cancellationAudioTime,
      rampEndAudioTime: cancellationAudioTime + CANCELLATION_RAMP_SECONDS,
      stopAudioTime: cancellationAudioTime + CANCELLATION_STOP_SECONDS,
      percussionHeldGain,
      musicHeldGain,
    });
  }

  const audioBuffer = await context.startRendering();
  const timeline = Object.freeze({
    renderOriginAudioTime,
    beatTimes: Object.freeze([...plan.beatTimes]),
    crossfadeStartAudioTime: plan.crossfadeStartAudioTime,
    curatedDownbeatAudioTime: plan.curatedDownbeatAudioTime,
    crossfadeEndAudioTime: plan.crossfadeEndAudioTime,
  });
  return Object.freeze({
    audioBuffer,
    timeline,
    percussionBeats: Object.freeze(percussionBeats),
    trims: Object.freeze({
      percussion: plan.percussionTrimGain,
      track: plan.trackTrimGain,
      master: plan.masterGain,
    }),
    peak: peakOf(audioBuffer.getChannelData(0)),
    cancellation,
    endEvents: freezeRecords(endEvents),
  });
}
