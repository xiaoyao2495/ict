'use strict';

const HtfBiasV2 = require('./ictHtfBiasEngineV2');

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

function last(values) {
  return Array.isArray(values) && values.length > 0
    ? values[values.length - 1]
    : null;
}

function phaseSourceOf(input) {
  return input.structurePhase || null;
}

function currentPhaseOf(input) {
  const source = phaseSourceOf(input);
  return source && source.current ? source.current : source;
}

function phaseStateOf(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') {
    return 'UNDETERMINED';
  }
  return value.state ||
    value.structurePhase ||
    value.phase ||
    'UNDETERMINED';
}

function phaseDirectionOf(value) {
  if (value && typeof value === 'object') {
    const explicit = directional(value.direction);
    if (explicit) return explicit;
  }
  const state = phaseStateOf(value);
  if (state.indexOf('BULLISH_') === 0) {
    return DIRECTIONS.BULLISH;
  }
  if (state.indexOf('BEARISH_') === 0) {
    return DIRECTIONS.BEARISH;
  }
  return null;
}

function phaseContextOf(value) {
  return value && typeof value === 'object'
    ? value.context || null
    : null;
}

function isPullback(state) {
  return state === 'BULLISH_PULLBACK' ||
    state === 'BEARISH_PULLBACK';
}

function isTransitionPhase(value) {
  const state = phaseStateOf(value);
  if (state === 'BULLISH_MSS' || state === 'BEARISH_MSS') {
    return true;
  }
  return Boolean(
    isPullback(state) &&
    (
      phaseContextOf(value) === 'POST_MSS' ||
      value && value.transitionPending === true
    )
  );
}

function establishedDirectionOf(value) {
  const state = phaseStateOf(value);
  const direction = phaseDirectionOf(value);
  if (!direction) return null;
  if (
    state.endsWith('_CONTINUATION') ||
    state.endsWith('_CONFIRMED')
  ) {
    return direction;
  }
  if (
    isPullback(state) &&
    phaseContextOf(value) === 'CONTINUATION' &&
    value.transitionPending !== true
  ) {
    return direction;
  }
  return null;
}

function timelineStatesOf(input) {
  if (Array.isArray(input.structureTimeline)) {
    return input.structureTimeline;
  }
  if (
    input.structureTimeline &&
    Array.isArray(input.structureTimeline.states)
  ) {
    return input.structureTimeline.states;
  }
  const source = phaseSourceOf(input);
  return source && Array.isArray(source.states)
    ? source.states
    : [];
}

function availableIndexOf(value) {
  if (!value || typeof value !== 'object') return null;
  for (const field of [
    'phaseAvailableIndex',
    'availableIndex',
    'confirmationIndex',
    'index',
  ]) {
    if (Number.isInteger(value[field])) return value[field];
  }
  return null;
}

function transitionStartIndexOf(phase) {
  if (!phase || typeof phase !== 'object') return null;
  const mssIndex = availableIndexOf(phase.mssEvent);
  return Number.isInteger(mssIndex)
    ? mssIndex
    : availableIndexOf(phase);
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

function htfBiasStateOf(input) {
  const source = input.htfBiasState ||
    input.fourHourAnalysis ||
    input.h4Bias ||
    null;
  return source && Array.isArray(source.states)
    ? last(source.states)
    : source;
}

function legacyBiasOf(input, htfState, phase) {
  const explicit = directional(input.legacyBias);
  if (explicit) return explicit;
  const historical = historicalLegacyBias(
    timelineStatesOf(input),
    phase
  );
  if (historical) return historical;
  if (!htfState || typeof htfState !== 'object') return null;
  return directional(
    htfState.legacyBias ||
    htfState.bias ||
    htfState.marketBias ||
    htfState.narrative && htfState.narrative.bias
  );
}

function dealingRangeOf(input, htfState) {
  return input.dealingRange ||
    htfState && htfState.dealingRange ||
    null;
}

function currentPriceOf(input, htfState) {
  if (Number.isFinite(input.currentPrice)) {
    return input.currentPrice;
  }
  return htfState && Number.isFinite(htfState.referencePrice)
    ? htfState.referencePrice
    : null;
}

function rangeNumber(range, direct, alternate) {
  if (!range || typeof range !== 'object') return null;
  if (Number.isFinite(range[direct])) return range[direct];
  return Number.isFinite(range[alternate])
    ? range[alternate]
    : null;
}

function rangeRelation(price, high, low) {
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    high <= low
  ) {
    return RANGE_RELATIONS.UNKNOWN;
  }
  if (price > high) return RANGE_RELATIONS.ABOVE_RANGE;
  if (price < low) return RANGE_RELATIONS.BELOW_RANGE;
  return RANGE_RELATIONS.INSIDE;
}

function locationOf(input, htfState) {
  const range = dealingRangeOf(input, htfState) || {};
  const rangeHigh = rangeNumber(range, 'high', 'rangeHigh');
  const rangeLow = rangeNumber(range, 'low', 'rangeLow');
  const equilibrium = Number.isFinite(range.equilibrium)
    ? range.equilibrium
    : Number.isFinite(rangeHigh) && Number.isFinite(rangeLow)
      ? (rangeHigh + rangeLow) / 2
      : null;
  const price = currentPriceOf(input, htfState);
  let state = typeof range.location === 'string'
    ? range.location
    : htfState && typeof htfState.premiumDiscount === 'string'
      ? htfState.premiumDiscount
      : 'UNKNOWN';
  if (
    state === 'UNKNOWN' &&
    Number.isFinite(price) &&
    Number.isFinite(equilibrium)
  ) {
    state = price > equilibrium
      ? 'PREMIUM'
      : price < equilibrium
        ? 'DISCOUNT'
        : 'EQUILIBRIUM';
  }
  return {
    state,
    relationToRange: rangeRelation(
      price,
      rangeHigh,
      rangeLow
    ),
    rangeHigh,
    rangeLow,
    equilibrium,
  };
}

function locationReadiness(marketBias, location) {
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

function liquidityOf(input, htfState) {
  return input.liquidity ||
    htfState && (
      htfState.liquidity || htfState.externalLiquidity
    ) ||
    {};
}

function activeLevels(levels, side, price) {
  return (Array.isArray(levels) ? levels : []).filter((level) => (
    level &&
    level.side === side &&
    Number.isFinite(level.price) &&
    (
      level.status === undefined ||
      level.status === null ||
      level.status === 'ACTIVE'
    ) &&
    (
      !Number.isFinite(price) ||
      (
        side === 'BUY_SIDE'
          ? level.price >= price
          : level.price <= price
      )
    )
  ));
}

function drawOnLiquidityOf(input, htfState, marketBias) {
  const liquidity = liquidityOf(input, htfState);
  const price = currentPriceOf(input, htfState);
  const side = marketBias === DIRECTIONS.BULLISH
    ? 'BUY_SIDE'
    : marketBias === DIRECTIONS.BEARISH
      ? 'SELL_SIDE'
      : null;
  if (!side) return null;
  const rawLevels = side === 'BUY_SIDE'
    ? liquidity.buySideLiquidity || liquidity.buySide || []
    : liquidity.sellSideLiquidity || liquidity.sellSide || [];
  const selected = HtfBiasV2.selectPrimaryDraw(
    activeLevels(rawLevels, side, price),
    Number.isFinite(price) ? price : 0
  );
  return selected ? { ...selected } : null;
}

function reasonCodes(
  structureState,
  marketBias,
  transitionDirection,
  draw,
  location,
  readiness
) {
  const reasons = [
    'STRUCTURE_PHASE_' + structureState,
  ];
  if (transitionDirection) {
    reasons.push(
      'POST_MSS_TRANSITION_' + transitionDirection
    );
  } else if (directional(marketBias)) {
    reasons.push(
      'MARKET_BIAS_FROM_STRUCTURE_' + marketBias
    );
  } else {
    reasons.push('STRUCTURE_DIRECTION_UNDETERMINED');
  }
  reasons.push(
    'LOCATION_' + location.state,
    'RANGE_RELATION_' + location.relationToRange
  );
  reasons.push(
    draw
      ? 'DRAW_ON_' + draw.side + '_' + draw.type
      : 'NO_DIRECTIONAL_DRAW'
  );
  reasons.push('HTF_LOCATION_' + readiness);
  return reasons;
}

function analyze(input) {
  input = input || {};
  const htfState = htfBiasStateOf(input);
  const phase = currentPhaseOf(input);
  const structureState = phaseStateOf(phase);
  const establishedDirection = establishedDirectionOf(phase);
  const transitioning = isTransitionPhase(phase);
  const transitionDirection = transitioning
    ? phaseDirectionOf(phase)
    : null;
  const previousBias = legacyBiasOf(input, htfState, phase);
  const marketBias = establishedDirection || DIRECTIONS.NEUTRAL;
  const legacyBias = transitioning
    ? previousBias
    : establishedDirection || previousBias;
  const location = locationOf(input, htfState);
  const htfLocationReadiness = locationReadiness(
    marketBias,
    location
  );
  const drawOnLiquidity = drawOnLiquidityOf(
    input,
    htfState,
    marketBias
  );

  return {
    marketBias,
    legacyBias,
    transitionDirection,
    structureState,
    drawOnLiquidity,
    location,
    htfLocationReadiness,
    reasons: reasonCodes(
      structureState,
      marketBias,
      transitionDirection,
      drawOnLiquidity,
      location,
      htfLocationReadiness
    ),
  };
}

module.exports = {
  DIRECTIONS,
  RANGE_RELATIONS,
  READINESS,
  analyze,
  drawOnLiquidityOf,
  establishedDirectionOf,
  historicalLegacyBias,
  isTransitionPhase,
  locationOf,
  locationReadiness,
  phaseDirectionOf,
  phaseStateOf,
};
