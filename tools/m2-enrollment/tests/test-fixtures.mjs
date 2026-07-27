export function validDecoded(overrides = {}) {
  const decoded = {
    durationSeconds: 180,
    channelCount: 2,
    sampleRate: 48_000,
    ...overrides,
  };
  return {
    ...decoded,
    frameCount: Object.hasOwn(overrides, 'frameCount')
      ? overrides.frameCount
      : Number.isFinite(decoded.durationSeconds) && Number.isSafeInteger(decoded.sampleRate)
        ? Math.round(decoded.durationSeconds * decoded.sampleRate)
        : 8_640_000,
  };
}

export function validTiming(overrides = {}) {
  return {
    trackBpm: 120,
    targetEntryDownbeatSeconds: 2,
    decodedDurationSeconds: 10,
    ...overrides,
  };
}

export function cueInput(channelSamples, overrides = {}) {
  return {
    channelSamples,
    sampleRate: 8_000,
    expectedChannelCount: channelSamples.length,
    ...overrides,
  };
}
