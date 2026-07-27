import { assertBuildIdentity } from '../build-identity.mjs';

const LOCAL_BUILD_SHA = '__BUILD_SHA__';

export function assertLocalBuildIdentity() {
  return assertBuildIdentity(LOCAL_BUILD_SHA);
}

const RUN_CONTEXTS = new WeakSet();
const RUN_LINEAGES = new WeakMap();

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return Object.freeze(value);
}

export const RUN_TABLE = deepFreeze({
  'session-1': {
    cold: { slot: 1, assignedClass: 'CENTER' },
    warmed: { slot: 2, assignedClass: 'LOW_EDGE' },
  },
  'session-2': {
    cold: { slot: 3, assignedClass: 'HIGH_EDGE' },
    warmed: { slot: 4, assignedClass: 'CENTER' },
  },
  'session-3': {
    cold: { slot: 5, assignedClass: 'LOW_EDGE' },
    warmed: { slot: 6, assignedClass: 'HIGH_EDGE' },
  },
  'session-4': {
    cold: { slot: 7, assignedClass: 'CENTER' },
    warmed: { slot: 8, assignedClass: 'LOW_EDGE' },
  },
  'session-5': {
    cold: { slot: 9, assignedClass: 'HIGH_EDGE' },
    warmed: { slot: 10, assignedClass: 'CENTER' },
  },
  'smoke-crossfade': {
    cancellationPhase: 'crossfade',
  },
  'smoke-playing': {
    cancellationPhase: 'playing',
  },
});

export const RUN_VALUES = Object.freeze(Object.keys(RUN_TABLE));

function createContext(
  runValue,
  thermalState,
  contextFrozenAtFirstAcceptedTap = false,
  lineage = { frozenContext: null, consumed: false },
) {
  const row = RUN_TABLE[runValue];
  const isSmoke = runValue.startsWith('smoke-');
  const assignment = isSmoke ? null : row[thermalState];
  const context = Object.freeze({
    runValue,
    session: runValue,
    slot: isSmoke ? null : assignment.slot,
    thermalState: isSmoke ? 'smoke' : thermalState,
    assignedClass: isSmoke ? null : assignment.assignedClass,
    recordKind: isSmoke ? 'smoke' : 'scored',
    cancellationPhase: isSmoke ? row.cancellationPhase : null,
    scored: !isSmoke,
    contextFrozenAtFirstAcceptedTap,
  });
  RUN_CONTEXTS.add(context);
  RUN_LINEAGES.set(context, lineage);
  return context;
}

export function parseRunQuery(search) {
  if (typeof search !== 'string') {
    throw new TypeError('invalid run query');
  }
  const match = /^\?run=([a-z0-9-]+)$/.exec(search);
  if (match === null || !Object.hasOwn(RUN_TABLE, match[1])) {
    throw new TypeError('invalid run query');
  }
  return createContext(match[1], 'cold');
}

export function freezeColdContextAtFirstAcceptedTap(context) {
  if (!RUN_CONTEXTS.has(context)
      || context.recordKind !== 'scored'
      || context.thermalState !== 'cold') {
    throw new TypeError('first accepted tap can freeze only a cold scored context');
  }
  if (context.contextFrozenAtFirstAcceptedTap) {
    return context;
  }
  const lineage = RUN_LINEAGES.get(context);
  if (lineage.frozenContext === null) {
    lineage.frozenContext = createContext(context.runValue, 'cold', true, lineage);
  }
  return lineage.frozenContext;
}

export function advanceRunContext(context, gate) {
  if (!RUN_CONTEXTS.has(context)
      || context.recordKind !== 'scored'
      || context.thermalState !== 'cold') {
    throw new TypeError('run advancement requires a cold scored context');
  }
  if (!context.contextFrozenAtFirstAcceptedTap) {
    throw new TypeError('run advancement requires the cold context frozen at its first accepted tap');
  }
  if (gate === null
      || typeof gate !== 'object'
      || gate.evidenceResolved !== true
      || gate.downloadGesture !== true
      || gate.reset !== true) {
    throw new TypeError(
      'run advancement requires resolved cold evidence, explicit download gesture, and Reset',
    );
  }
  const lineage = RUN_LINEAGES.get(context);
  if (lineage.consumed) {
    throw new TypeError('run context lineage has already advanced');
  }
  lineage.consumed = true;
  return createContext(context.runValue, 'warmed', false, lineage);
}
