'use strict';

const STAGES = Object.freeze({
  RETRACEMENT: 'RETRACEMENT',
  WAITING_LIQUIDITY: 'WAITING_LIQUIDITY',
  LIQUIDITY_TAKEN: 'LIQUIDITY_TAKEN',
  STRUCTURE_SHIFT: 'STRUCTURE_SHIFT',
  DELIVERY_CONFIRMED: 'DELIVERY_CONFIRMED',
  INVALIDATED: 'INVALIDATED',
});

function isDirectionalBias(bias) {
  return bias === 'BULLISH' || bias === 'BEARISH';
}

function initialState(h4Bias, index, time) {
  return Object.freeze({
    stage: STAGES.WAITING_LIQUIDITY,
    h4Bias: isDirectionalBias(h4Bias)
      ? h4Bias
      : 'NEUTRAL',
    retracementSeen: false,
    waitingLiquiditySide: null,
    availableIndex: Number.isInteger(index)
      ? index
      : null,
    time: Number.isFinite(time) ? time : null,
  });
}

function isAdvancedStage(stage) {
  return (
    stage === STAGES.LIQUIDITY_TAKEN ||
    stage === STAGES.STRUCTURE_SHIFT ||
    stage === STAGES.DELIVERY_CONFIRMED ||
    stage === STAGES.INVALIDATED
  );
}

function expectedLiquiditySide(h4Bias) {
  if (h4Bias === 'BEARISH') return 'BUY_SIDE';
  if (h4Bias === 'BULLISH') return 'SELL_SIDE';
  return null;
}

function waitingLiquiditySideOf(
  stage,
  h4Bias,
  retracementSeen
) {
  if (
    retracementSeen !== true ||
    (
      stage !== STAGES.RETRACEMENT &&
      stage !== STAGES.WAITING_LIQUIDITY
    )
  ) {
    return null;
  }
  return expectedLiquiditySide(h4Bias);
}

function deliveryInvalidated(input) {
  input = input || {};
  if (
    !Number.isInteger(input.structureShiftIndex) ||
    !Number.isInteger(input.index) ||
    input.index <= input.structureShiftIndex ||
    !Number.isFinite(input.retracementExtreme)
  ) {
    return false;
  }
  if (
    input.h4Bias === 'BEARISH' &&
    Number.isFinite(input.high)
  ) {
    return input.high > input.retracementExtreme;
  }
  if (
    input.h4Bias === 'BULLISH' &&
    Number.isFinite(input.low)
  ) {
    return input.low < input.retracementExtreme;
  }
  return false;
}

function transition(previous, event) {
  event = event || {};
  const h4Bias = isDirectionalBias(event.h4Bias)
    ? event.h4Bias
    : 'NEUTRAL';
  const mustReset = (
    !previous ||
    previous.h4Bias !== h4Bias ||
    event.reset === true
  );
  const base = mustReset
    ? initialState(h4Bias, event.index, event.time)
    : previous;
  let stage = base.stage;
  let retracementSeen = base.retracementSeen;

  if (!isDirectionalBias(h4Bias)) {
    stage = STAGES.WAITING_LIQUIDITY;
    retracementSeen = false;
  } else if (event.invalidated === true) {
    stage = STAGES.INVALIDATED;
    retracementSeen = true;
  } else if (event.deliveryConfirmed === true) {
    stage = STAGES.DELIVERY_CONFIRMED;
    retracementSeen = true;
  } else if (event.structureShift === true) {
    stage = STAGES.STRUCTURE_SHIFT;
    retracementSeen = true;
  } else if (event.liquidityTaken === true) {
    stage = STAGES.LIQUIDITY_TAKEN;
    retracementSeen = true;
  } else if (isAdvancedStage(stage)) {
    // Preserve an already published causal milestone.
  } else if (event.retracement === true) {
    stage = retracementSeen
      ? STAGES.WAITING_LIQUIDITY
      : STAGES.RETRACEMENT;
    retracementSeen = true;
  } else {
    stage = STAGES.WAITING_LIQUIDITY;
    retracementSeen = false;
  }

  return Object.freeze({
    stage,
    h4Bias,
    retracementSeen,
    waitingLiquiditySide: waitingLiquiditySideOf(
      stage,
      h4Bias,
      retracementSeen
    ),
    availableIndex: Number.isInteger(event.index)
      ? event.index
      : base.availableIndex,
    time: Number.isFinite(event.time)
      ? event.time
      : base.time,
  });
}

function run(events) {
  const states = [];
  let current = null;
  for (const event of events || []) {
    current = transition(current, event);
    states.push(current);
  }
  return states;
}

module.exports = {
  STAGES,
  deliveryInvalidated,
  expectedLiquiditySide,
  initialState,
  isAdvancedStage,
  isDirectionalBias,
  run,
  transition,
  waitingLiquiditySideOf,
};
