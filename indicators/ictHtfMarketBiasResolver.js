'use strict';

const DIRECTIONS = Object.freeze({
  BULLISH: 'BULLISH',
  BEARISH: 'BEARISH',
  NEUTRAL: 'NEUTRAL',
});

const READINESS = Object.freeze({
  READY: 'READY',
  WAIT: 'WAIT',
});

const RANGE_RELATIONS = Object.freeze({
  INSIDE: 'INSIDE',
  ABOVE_RANGE: 'ABOVE_RANGE',
  BELOW_RANGE: 'BELOW_RANGE',
  UNKNOWN: 'UNKNOWN',
});

function directional(value) {
  return value === DIRECTIONS.BULLISH ||
    value === DIRECTIONS.BEARISH
    ? value
    : null;
}

function phaseStateOf(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') {
    return 'UNDETERMINED';
  }
  return value.state ||
    value.structurePhase ||
    'UNDETERMINED';
}

function phaseDirectionOf(value) {
  const explicit = value && typeof value === 'object'
    ? directional(value.direction)
    : null;
  if (explicit) return explicit;
  const phase = phaseStateOf(value);
  if (phase.indexOf('BULLISH_') === 0) {
    return DIRECTIONS.BULLISH;
  }
  if (phase.indexOf('BEARISH_') === 0) {
    return DIRECTIONS.BEARISH;
  }
  return null;
}

function phaseContextOf(value) {
  return value && typeof value === 'object'
    ? value.context || null
    : null;
}

function isPullback(phase) {
  return phase === 'BULLISH_PULLBACK' ||
    phase === 'BEARISH_PULLBACK';
}

function isPostMssPhase(value) {
  const phase = phaseStateOf(value);
  if (phase === 'BULLISH_MSS' || phase === 'BEARISH_MSS') {
    return true;
  }
  if (!isPullback(phase)) return false;
  return Boolean(
    phaseContextOf(value) === 'POST_MSS' ||
    value && value.transitionPending === true
  );
}

function establishedDirectionOf(value) {
  const phase = phaseStateOf(value);
  const direction = phaseDirectionOf(value);
  if (!direction) return null;
  if (
    phase.endsWith('_CONTINUATION') ||
    phase.endsWith('_CONFIRMED')
  ) {
    return direction;
  }
  if (
    isPullback(phase) &&
    phaseContextOf(value) === 'CONTINUATION' &&
    value.transitionPending !== true
  ) {
    return direction;
  }
  return null;
}

function latestValue(values) {
  return Array.isArray(values) && values.length > 0
    ? values[values.length - 1]
    : null;
}

function h4StateOf(input) {
  const source = input.h4Bias ||
    input.fourHourAnalysis ||
    input.h4 ||
    null;
  if (source && Array.isArray(source.states)) {
    return latestValue(source.states);
  }
  return source;
}

function phaseAnalysisOf(input) {
  return input.structurePhase ||
    input.structurePhaseAnalysis ||
    null;
}

function phaseCurrentOf(input) {
  const source = phaseAnalysisOf(input);
  if (source && source.current) return source.current;
  return source;
}

function phaseStatesOf(input) {
  if (Array.isArray(input.structurePhaseStates)) {
    return input.structurePhaseStates;
  }
  const source = phaseAnalysisOf(input);
  return source && Array.isArray(source.states)
    ? source.states
    : [];
}

function h4BiasOf(state) {
  if (!state || typeof state !== 'object') return null;
  return directional(
    state.bias ||
    state.marketBias ||
    state.narrative && state.narrative.bias
  );
}

function availableIndexOf(value) {
  if (!value || typeof value !== 'object') return null;
  if (Number.isInteger(value.availableIndex)) {
    return value.availableIndex;
  }
  if (Number.isInteger(value.phaseAvailableIndex)) {
    return value.phaseAvailableIndex;
  }
  if (Number.isInteger(value.index)) return value.index;
  return null;
}

function transitionStartIndexOf(phase) {
  if (!phase || typeof phase !== 'object') return null;
  const mssIndex = availableIndexOf(phase.mssEvent);
  if (Number.isInteger(mssIndex)) return mssIndex;
  return availableIndexOf(phase);
}

function historicalLegacyBias(states, currentPhase) {
  const transitionStart = transitionStartIndexOf(currentPhase);
  for (let index = states.length - 1; index >= 0; index -= 1) {
    const state = states[index];
    const stateIndex = availableIndexOf(state);
    if (
      Number.isInteger(transitionStart) &&
      Number.isInteger(stateIndex) &&
      stateIndex >= transitionStart
    ) {
      continue;
    }
    const direction = establishedDirectionOf(state);
    if (direction) return direction;
  }
  return null;
}

function dealingRangeOf(h4) {
  return h4 && typeof h4 === 'object'
    ? h4.dealingRange || h4.location || null
    : null;
}

function referencePriceOf(input, h4) {
  if (Number.isFinite(input.currentPrice)) {
    return input.currentPrice;
  }
  if (h4 && Number.isFinite(h4.referencePrice)) {
    return h4.referencePrice;
  }
  return null;
}

function locationStateOf(h4, range) {
  if (range && typeof range.location === 'string') {
    return range.location;
  }
  if (h4 && typeof h4.premiumDiscount === 'string') {
    return h4.premiumDiscount;
  }
  if (range && typeof range.state === 'string') {
    return range.state;
  }
  return 'UNKNOWN';
}

function relationToRange(price, range) {
  if (
    !Number.isFinite(price) ||
    !range ||
    !Number.isFinite(range.high) ||
    !Number.isFinite(range.low) ||
    range.high <= range.low
  ) {
    return RANGE_RELATIONS.UNKNOWN;
  }
  if (price > range.high) return RANGE_RELATIONS.ABOVE_RANGE;
  if (price < range.low) return RANGE_RELATIONS.BELOW_RANGE;
  return RANGE_RELATIONS.INSIDE;
}

function locationOf(input, h4) {
  const range = dealingRangeOf(h4) || {};
  const rangeHigh = Number.isFinite(range.high)
    ? range.high
    : Number.isFinite(range.rangeHigh)
      ? range.rangeHigh
      : null;
  const rangeLow = Number.isFinite(range.low)
    ? range.low
    : Number.isFinite(range.rangeLow)
      ? range.rangeLow
      : null;
  const equilibrium = Number.isFinite(range.equilibrium)
    ? range.equilibrium
    : Number.isFinite(rangeHigh) && Number.isFinite(rangeLow)
      ? (rangeHigh + rangeLow) / 2
      : null;
  const normalizedRange = {
    high: rangeHigh,
    low: rangeLow,
  };
  return {
    state: locationStateOf(h4, range),
    rangeHigh,
    rangeLow,
    equilibrium,
    relationToRange: relationToRange(
      referencePriceOf(input, h4),
      normalizedRange
    ),
  };
}

function locationReady(marketBias, location) {
  if (location.relationToRange !== RANGE_RELATIONS.INSIDE) {
    return READINESS.WAIT;
  }
  if (
    marketBias === DIRECTIONS.BULLISH &&
    location.state === 'DISCOUNT'
  ) {
    return READINESS.READY;
  }
  if (
    marketBias === DIRECTIONS.BEARISH &&
    location.state === 'PREMIUM'
  ) {
    return READINESS.READY;
  }
  return READINESS.WAIT;
}

function analyze(input) {
  input = input || {};
  const h4 = h4StateOf(input);
  const phase = phaseCurrentOf(input);
  const structurePhase = phaseStateOf(phase);
  const established = establishedDirectionOf(phase);
  const transitioning = isPostMssPhase(phase);
  const transitionDirection = transitioning
    ? phaseDirectionOf(phase)
    : null;
  const fallbackLegacy = directional(input.legacyBias) ||
    historicalLegacyBias(phaseStatesOf(input), phase) ||
    h4BiasOf(h4);
  const marketBias = established || DIRECTIONS.NEUTRAL;
  const legacyBias = established || (
    transitioning ? fallbackLegacy : null
  );
  const location = locationOf(input, h4);

  return {
    marketBias,
    legacyBias,
    transitionDirection,
    structurePhase,
    location,
    htfLocationReadiness: locationReady(
      marketBias,
      location
    ),
  };
}

module.exports = {
  DIRECTIONS,
  RANGE_RELATIONS,
  READINESS,
  analyze,
  establishedDirectionOf,
  historicalLegacyBias,
  isPostMssPhase,
  locationOf,
  locationReady,
  phaseDirectionOf,
  phaseStateOf,
  relationToRange,
};
