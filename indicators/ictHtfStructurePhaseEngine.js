'use strict';

const PHASES = Object.freeze({
  UNDETERMINED: 'UNDETERMINED',
  BULLISH_CONTINUATION: 'BULLISH_CONTINUATION',
  BEARISH_CONTINUATION: 'BEARISH_CONTINUATION',
  BULLISH_MSS: 'BULLISH_MSS',
  BEARISH_MSS: 'BEARISH_MSS',
  BULLISH_PULLBACK: 'BULLISH_PULLBACK',
  BEARISH_PULLBACK: 'BEARISH_PULLBACK',
  BULLISH_CONFIRMED: 'BULLISH_CONFIRMED',
  BEARISH_CONFIRMED: 'BEARISH_CONFIRMED',
});

const CONTEXTS = Object.freeze({
  POST_MSS: 'POST_MSS',
  CONTINUATION: 'CONTINUATION',
});

function clone(value) {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));
}

function availableIndexOf(item) {
  if (!item || typeof item !== 'object') return null;
  if (Number.isInteger(item.availableIndex)) {
    return item.availableIndex;
  }
  if (Number.isInteger(item.confirmationIndex)) {
    return item.confirmationIndex;
  }
  return null;
}

function extremeIndexOf(swing) {
  if (Number.isInteger(swing.extremeIndex)) {
    return swing.extremeIndex;
  }
  return Number.isInteger(swing.index)
    ? swing.index
    : null;
}

function swingTypeOf(swing) {
  if (swing.type === 'HIGH' ||
      swing.type === 'SWING_HIGH') {
    return 'HIGH';
  }
  if (swing.type === 'LOW' ||
      swing.type === 'SWING_LOW') {
    return 'LOW';
  }
  return null;
}

function eventDirection(event) {
  if (String(event.type).indexOf('BULLISH_') === 0) {
    return 'BULLISH';
  }
  if (String(event.type).indexOf('BEARISH_') === 0) {
    return 'BEARISH';
  }
  return null;
}

function isStructuralEvent(event) {
  return Boolean(
    event &&
    (
      event.type === 'BULLISH_STRUCTURE_CONFIRMED' ||
      event.type === 'BEARISH_STRUCTURE_CONFIRMED' ||
      event.type === 'BULLISH_BOS' ||
      event.type === 'BEARISH_BOS' ||
      event.type === 'BULLISH_MSS' ||
      event.type === 'BEARISH_MSS'
    ) &&
    event.breakType !== 'WICK_BREAK'
  );
}

function createMachineState() {
  return {
    phase: PHASES.UNDETERMINED,
    direction: null,
    context: null,
    phaseAvailableIndex: null,
    sourceEvent: null,
    mssEvent: null,
    pullbackSwing: null,
    confirmationBos: null,
    invalidationLevel: null,
    transitionPending: false,
    anchorEvent: null,
  };
}

function resetDirectionalState(
  state,
  direction,
  phase,
  event
) {
  state.phase = phase;
  state.direction = direction;
  state.context = CONTEXTS.CONTINUATION;
  state.phaseAvailableIndex = availableIndexOf(event);
  state.sourceEvent = event;
  state.mssEvent = null;
  state.pullbackSwing = null;
  state.confirmationBos = null;
  state.invalidationLevel = direction === 'BULLISH'
    ? Number.isFinite(event.protectedLow)
      ? event.protectedLow
      : null
    : Number.isFinite(event.protectedHigh)
      ? event.protectedHigh
      : null;
  state.transitionPending = false;
  state.anchorEvent = event;
}

function enterMss(state, event) {
  const bullish = event.type === 'BULLISH_MSS';
  state.phase = bullish
    ? PHASES.BULLISH_MSS
    : PHASES.BEARISH_MSS;
  state.direction = bullish ? 'BULLISH' : 'BEARISH';
  state.context = CONTEXTS.POST_MSS;
  state.phaseAvailableIndex = availableIndexOf(event);
  state.sourceEvent = event;
  state.mssEvent = event;
  state.pullbackSwing = null;
  state.confirmationBos = null;
  state.invalidationLevel = bullish
    ? Number.isFinite(event.newProtectedLow)
      ? event.newProtectedLow
      : null
    : Number.isFinite(event.newProtectedHigh)
      ? event.newProtectedHigh
      : null;
  state.transitionPending = true;
  state.anchorEvent = event;
}

function confirmsPendingTransition(state, event) {
  const eventIndex = availableIndexOf(event);
  const pullbackIndex = availableIndexOf(
    state.pullbackSwing
  );
  return (
    state.transitionPending &&
    state.pullbackSwing &&
    Number.isInteger(eventIndex) &&
    Number.isInteger(pullbackIndex) &&
    eventIndex > pullbackIndex
  );
}

function applyBos(state, event) {
  const direction = eventDirection(event);
  const bullish = direction === 'BULLISH';
  const pullbackPhase = bullish
    ? PHASES.BULLISH_PULLBACK
    : PHASES.BEARISH_PULLBACK;
  const confirmedPhase = bullish
    ? PHASES.BULLISH_CONFIRMED
    : PHASES.BEARISH_CONFIRMED;
  const continuationPhase = bullish
    ? PHASES.BULLISH_CONTINUATION
    : PHASES.BEARISH_CONTINUATION;

  if (!state.direction) {
    resetDirectionalState(
      state,
      direction,
      continuationPhase,
      event
    );
    return;
  }

  if (state.direction !== direction) {
    return;
  }

  if (
    state.phase === pullbackPhase &&
    confirmsPendingTransition(state, event)
  ) {
    state.phase = confirmedPhase;
    state.context = CONTEXTS.POST_MSS;
    state.phaseAvailableIndex = availableIndexOf(event);
    state.sourceEvent = event;
    state.confirmationBos = event;
    state.transitionPending = false;
    state.anchorEvent = event;
    if (bullish && Number.isFinite(event.protectedLow)) {
      state.invalidationLevel = event.protectedLow;
    }
    if (!bullish && Number.isFinite(event.protectedHigh)) {
      state.invalidationLevel = event.protectedHigh;
    }
    return;
  }

  if (state.transitionPending) {
    return;
  }

  state.phase = continuationPhase;
  state.context = CONTEXTS.CONTINUATION;
  state.phaseAvailableIndex = availableIndexOf(event);
  state.sourceEvent = event;
  state.pullbackSwing = null;
  state.anchorEvent = event;
  if (bullish && Number.isFinite(event.protectedLow)) {
    state.invalidationLevel = event.protectedLow;
  }
  if (!bullish && Number.isFinite(event.protectedHigh)) {
    state.invalidationLevel = event.protectedHigh;
  }
}

function applyEvent(state, event) {
  if (!isStructuralEvent(event)) return;

  if (
    event.type === 'BULLISH_STRUCTURE_CONFIRMED' ||
    event.type === 'BEARISH_STRUCTURE_CONFIRMED'
  ) {
    const bullish =
      event.type === 'BULLISH_STRUCTURE_CONFIRMED';
    resetDirectionalState(
      state,
      bullish ? 'BULLISH' : 'BEARISH',
      bullish
        ? PHASES.BULLISH_CONTINUATION
        : PHASES.BEARISH_CONTINUATION,
      event
    );
    return;
  }

  if (
    event.type === 'BULLISH_MSS' ||
    event.type === 'BEARISH_MSS'
  ) {
    enterMss(state, event);
    return;
  }

  applyBos(state, event);
}

function isAfterAnchor(state, swing) {
  const swingAvailable = availableIndexOf(swing);
  const anchorAvailable = availableIndexOf(
    state.anchorEvent
  );
  if (
    !Number.isInteger(swingAvailable) ||
    !Number.isInteger(anchorAvailable) ||
    swingAvailable <= anchorAvailable
  ) {
    return false;
  }
  if (
    state.transitionPending &&
    state.mssEvent &&
    Number.isInteger(state.mssEvent.breakIndex)
  ) {
    const extremeIndex = extremeIndexOf(swing);
    return (
      Number.isInteger(extremeIndex) &&
      extremeIndex > state.mssEvent.breakIndex
    );
  }
  return true;
}

function respectsInvalidation(state, swing) {
  if (!Number.isFinite(state.invalidationLevel)) {
    return true;
  }
  if (state.direction === 'BULLISH') {
    return swing.price > state.invalidationLevel;
  }
  return swing.price < state.invalidationLevel;
}

function isDeeperPullback(state, swing) {
  if (!state.pullbackSwing) return true;
  if (state.direction === 'BULLISH') {
    return swing.price < state.pullbackSwing.price;
  }
  return swing.price > state.pullbackSwing.price;
}

function applySwing(state, swing) {
  const type = swingTypeOf(swing);
  const expectedType = state.direction === 'BULLISH'
    ? 'LOW'
    : state.direction === 'BEARISH'
      ? 'HIGH'
      : null;
  if (
    !expectedType ||
    type !== expectedType ||
    !Number.isFinite(swing.price) ||
    !isAfterAnchor(state, swing) ||
    !respectsInvalidation(state, swing)
  ) {
    return;
  }

  const bullish = state.direction === 'BULLISH';
  const mssPhase = bullish
    ? PHASES.BULLISH_MSS
    : PHASES.BEARISH_MSS;
  const continuationPhase = bullish
    ? PHASES.BULLISH_CONTINUATION
    : PHASES.BEARISH_CONTINUATION;
  const confirmedPhase = bullish
    ? PHASES.BULLISH_CONFIRMED
    : PHASES.BEARISH_CONFIRMED;
  const pullbackPhase = bullish
    ? PHASES.BULLISH_PULLBACK
    : PHASES.BEARISH_PULLBACK;

  if (
    state.phase !== mssPhase &&
    state.phase !== continuationPhase &&
    state.phase !== confirmedPhase &&
    state.phase !== pullbackPhase
  ) {
    return;
  }

  if (
    state.phase === pullbackPhase &&
    !isDeeperPullback(state, swing)
  ) {
    return;
  }

  state.phase = pullbackPhase;
  state.context = state.transitionPending
    ? CONTEXTS.POST_MSS
    : CONTEXTS.CONTINUATION;
  state.phaseAvailableIndex = availableIndexOf(swing);
  state.pullbackSwing = swing;
}

function publicSnapshot(state, index) {
  return {
    index,
    availableIndex: index,
    structurePhase: state.phase,
    direction: state.direction,
    context: state.context,
    phaseAvailableIndex: state.phaseAvailableIndex,
    sourceEvent: clone(state.sourceEvent),
    mssEvent: clone(state.mssEvent),
    pullbackSwing: clone(state.pullbackSwing),
    confirmationBos: clone(state.confirmationBos),
    invalidationLevel: state.invalidationLevel,
    transitionPending: state.transitionPending,
  };
}

function groupByAvailability(items) {
  const grouped = new Map();
  for (const item of items) {
    const index = availableIndexOf(item);
    if (!Number.isInteger(index) || index < 0) continue;
    if (!grouped.has(index)) grouped.set(index, []);
    grouped.get(index).push(item);
  }
  return grouped;
}

function resolveEndIndex(input, events, swings) {
  if (Number.isInteger(input.endIndex)) {
    return input.endIndex;
  }
  if (Number.isInteger(input.length)) {
    return input.length - 1;
  }
  let result = -1;
  for (const item of events.concat(swings)) {
    const index = availableIndexOf(item);
    if (Number.isInteger(index)) {
      result = Math.max(result, index);
    }
  }
  return result;
}

function analyze(input) {
  input = input || {};
  const events = Array.isArray(input.structureEvents)
    ? input.structureEvents
    : Array.isArray(input.events)
      ? input.events
      : [];
  const swings = Array.isArray(input.confirmedSwings)
    ? input.confirmedSwings
    : Array.isArray(input.swings)
      ? input.swings
      : [];
  const endIndex = resolveEndIndex(
    input,
    events,
    swings
  );
  const eventsByIndex = groupByAvailability(events);
  const swingsByIndex = groupByAvailability(swings);
  const machine = createMachineState();
  const states = [];

  for (let index = 0; index <= endIndex; index += 1) {
    for (const event of eventsByIndex.get(index) || []) {
      applyEvent(machine, event);
    }
    for (const swing of swingsByIndex.get(index) || []) {
      applySwing(machine, swing);
    }
    states.push(publicSnapshot(machine, index));
  }

  const current = states.length > 0
    ? states[states.length - 1]
    : publicSnapshot(machine, null);
  return {
    protocol: {
      version: 'ICT_HTF_STRUCTURE_PHASE_ENGINE_V1',
      consumesStructureEngineV2Events: true,
      consumesConfirmedSwings: true,
      usesAvailableIndex: true,
      modifiesHtfBiasV3: false,
      generatesSignal: false,
    },
    structurePhase: current.structurePhase,
    current,
    states,
  };
}

module.exports = {
  CONTEXTS,
  PHASES,
  analyze,
  applyBos,
  applyEvent,
  applySwing,
  availableIndexOf,
  createMachineState,
  eventDirection,
  extremeIndexOf,
  groupByAvailability,
  isStructuralEvent,
  publicSnapshot,
  resolveEndIndex,
  respectsInvalidation,
  swingTypeOf,
};
