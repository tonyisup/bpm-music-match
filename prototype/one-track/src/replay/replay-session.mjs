import {
  assertSessionState,
  reduceSession,
} from '../core/session-reducer.mjs';

const MAX_REPLAY_EVENTS = 512;

function readDenseEvents(candidate) {
  if (!Array.isArray(candidate)
      || Object.getPrototypeOf(candidate) !== Array.prototype
      || candidate.length > MAX_REPLAY_EVENTS) {
    throw new TypeError('replay events must be a bounded dense ordinary array');
  }
  const expectedKeys = [
    ...Array.from({ length: candidate.length }, (_, index) => String(index)),
    'length',
  ];
  const ownKeys = Reflect.ownKeys(candidate);
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  if (ownKeys.length !== expectedKeys.length
      || ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
      || expectedKeys.slice(0, -1).some((key) => {
        const descriptor = descriptors[key];
        return descriptor === undefined
          || descriptor.enumerable !== true
          || !Object.hasOwn(descriptor, 'value');
      })) {
    throw new TypeError('replay events must be a bounded dense ordinary array');
  }
  return expectedKeys.slice(0, -1).map((key) => descriptors[key].value);
}

function freezeResult(value) {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      freezeResult(child);
    }
  }
  return Object.freeze(value);
}

export function replaySession(initialState, eventCandidates) {
  assertSessionState(initialState);
  const events = readDenseEvents(eventCandidates);
  const transitions = [];
  const orderedEffects = [];
  let state = initialState;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const result = reduceSession(state, event);
    const typeDescriptor = Object.getOwnPropertyDescriptor(event, 'type');
    const transition = freezeResult({
      index,
      eventType: typeDescriptor.value,
      state: result.state,
      effects: result.effects,
    });
    transitions.push(transition);
    orderedEffects.push(...result.effects);
    state = result.state;
  }

  return freezeResult({
    initialState,
    transitions,
    finalState: state,
    orderedEffects,
  });
}
