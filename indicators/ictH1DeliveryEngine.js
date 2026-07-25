'use strict';

const HtfBiasV2 = require('./ictHtfBiasEngineV2');

function latestClosedH4State(h4States, timestamp) {
  let low = 0;
  let high = h4States.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (h4States[middle].time <= timestamp) low = middle + 1;
    else high = middle;
  }
  return low > 0 ? h4States[low - 1] : null;
}

function h4BiasOf(h4State) {
  if (!h4State) return 'UNAVAILABLE';
  if (
    h4State.narrative &&
    typeof h4State.narrative.bias === 'string'
  ) {
    return h4State.narrative.bias;
  }
  if (typeof h4State.bias === 'string') return h4State.bias;
  if (
    h4State.bias &&
    typeof h4State.bias.direction === 'string'
  ) {
    return h4State.bias.direction;
  }
  return 'NEUTRAL';
}

function h4StructureOf(h4State) {
  if (!h4State || !h4State.structure) return 'NEUTRAL';
  return h4State.structure.state || 'NEUTRAL';
}

function deliveryDirection(structure) {
  if (structure.state === 'BULLISH') return 'BULLISH';
  if (structure.state === 'BEARISH') return 'BEARISH';
  const highLabels = new Set(['HH', 'LH']);
  const lowLabels = new Set(['HL', 'LL']);
  const hasHigh = structure.swingSequence.some(
    (item) => highLabels.has(item.label)
  );
  const hasLow = structure.swingSequence.some(
    (item) => lowLabels.has(item.label)
  );
  return hasHigh && hasLow ? 'TRANSITION' : 'NEUTRAL';
}

function relationToH4(direction, h4State) {
  const h4Bias = h4BiasOf(h4State);
  if (
    (h4Bias === 'BULLISH' && direction === 'BULLISH') ||
    (h4Bias === 'BEARISH' && direction === 'BEARISH')
  ) {
    return 'ALIGNED';
  }
  if (
    (h4Bias === 'BULLISH' && direction === 'BEARISH') ||
    (h4Bias === 'BEARISH' && direction === 'BULLISH')
  ) {
    return 'RETRACEMENT';
  }

  const h4Structure = h4StructureOf(h4State);
  if (
    h4Bias === 'NEUTRAL' &&
    (
      (h4Structure === 'BULLISH' && direction === 'BEARISH') ||
      (h4Structure === 'BEARISH' && direction === 'BULLISH')
    )
  ) {
    return 'COUNTER_TREND';
  }
  return 'UNCLEAR';
}

function deliveryState(direction, relation) {
  if (relation === 'ALIGNED' && direction === 'BULLISH') {
    return 'ALIGNED_BULLISH';
  }
  if (relation === 'ALIGNED' && direction === 'BEARISH') {
    return 'ALIGNED_BEARISH';
  }
  if (relation === 'RETRACEMENT') return 'RETRACEMENT';
  if (relation === 'COUNTER_TREND') return 'COUNTER_TREND';
  return 'NEUTRAL';
}

function createLiquidity(
  type,
  side,
  price,
  formedIndex,
  availableIndex,
  sweepStartIndex
) {
  return {
    type,
    side,
    price,
    formedIndex,
    availableIndex,
    sweepStartIndex,
    status: 'ACTIVE',
    sweptIndex: null,
  };
}

function samePrice(left, right) {
  const reference = Math.max(Math.abs(left), Math.abs(right));
  if (reference === 0) return left === right;
  return Math.abs(left - right) / reference <=
    HtfBiasV2.EQUAL_TOLERANCE;
}

function buildInternalLiquidity(timeline) {
  const levels = [];
  const previousSwing = { HIGH: null, LOW: null };

  for (
    let index = 0;
    index + 1 < timeline.klines.length;
    index += 1
  ) {
    levels.push(createLiquidity(
      'PREVIOUS_1H_HIGH',
      'BUY_SIDE',
      timeline.klines[index].high,
      index,
      index + 1,
      index + 1
    ));
    levels.push(createLiquidity(
      'PREVIOUS_1H_LOW',
      'SELL_SIDE',
      timeline.klines[index].low,
      index,
      index + 1,
      index + 1
    ));
  }

  for (const swing of timeline.rawSwings) {
    const availableIndex = Number.isInteger(swing.availableIndex)
      ? swing.availableIndex
      : swing.confirmationIndex;
    const side = swing.type === 'HIGH'
      ? 'BUY_SIDE'
      : 'SELL_SIDE';
    levels.push(createLiquidity(
      'H1_SWING_' + swing.type,
      side,
      swing.price,
      swing.index,
      availableIndex,
      availableIndex + 1
    ));
    const prior = previousSwing[swing.type];
    if (prior && samePrice(prior.price, swing.price)) {
      levels.push(createLiquidity(
        swing.type === 'HIGH' ? 'EQUAL_HIGH' : 'EQUAL_LOW',
        side,
        (prior.price + swing.price) / 2,
        swing.index,
        availableIndex,
        availableIndex + 1
      ));
    }
    previousSwing[swing.type] = swing;
  }

  return applyInternalLiquidityLifecycle(
    levels,
    timeline.klines
  );
}

function applyInternalLiquidityLifecycle(levels, klines) {
  const priceIndex = HtfBiasV2.buildPriceRangeIndex(klines);
  for (const level of levels) {
    level.sweptIndex = level.side === 'BUY_SIDE'
      ? HtfBiasV2.firstRangeMatch(
        priceIndex.highs,
        level.sweepStartIndex,
        (maximum) => maximum >= level.price
      )
      : HtfBiasV2.firstRangeMatch(
        priceIndex.lows,
        level.sweepStartIndex,
        (minimum) => minimum <= level.price
      );
  }
  return levels;
}

function publicStructure(structure) {
  return {
    state: structure.state,
    swingSequence: structure.swingSequence,
    lastConfirmedSwingHigh: structure.lastConfirmedSwingHigh,
    lastConfirmedSwingLow: structure.lastConfirmedSwingLow,
  };
}

function primaryDrawOf(h4State) {
  if (!h4State) return null;
  if (
    h4State.narrative &&
    h4State.narrative.primaryDraw
  ) {
    return { ...h4State.narrative.primaryDraw };
  }
  if (h4State.liquidity && h4State.liquidity.primaryDraw) {
    return { ...h4State.liquidity.primaryDraw };
  }
  return null;
}

function analyze(input) {
  input = input || {};
  const h1Klines = input.h1Klines;
  const h4States = input.h4BiasSnapshots ||
    input.h4States ||
    [];
  const includeLiquidity = input.includeLiquidity !== false;
  HtfBiasV2.validateClosedKlines(
    h1Klines,
    HtfBiasV2.ONE_HOUR,
    '1H'
  );
  const timeline = HtfBiasV2.buildStructureTimeline(h1Klines);
  const liquidityTimeline = includeLiquidity
    ? HtfBiasV2.buildLiquidityTimeline(
      buildInternalLiquidity(timeline),
      h1Klines,
      { maxLevelsPerSide: 12 }
    )
    : null;
  const states = timeline.states.map((state) => {
    const structure = publicStructure(state.structure);
    const direction = deliveryDirection(structure);
    const h4State = latestClosedH4State(h4States, state.time);
    const relation = relationToH4(direction, h4State);
    return {
      index: state.index,
      availableIndex: state.index,
      time: state.time,
      referencePrice: state.referencePrice,
      structure,
      liquidity: includeLiquidity
        ? liquidityTimeline[state.index]
        : null,
      deliveryDirection: direction,
      deliveryState: deliveryState(direction, relation),
      relationToH4: relation,
      relationTo4H: {
        state: relation,
        h4Bias: h4BiasOf(h4State),
      },
      h4Context: {
        snapshotTime: h4State ? h4State.time : null,
        bias: h4BiasOf(h4State),
        structure: h4StructureOf(h4State),
        primaryDraw: primaryDrawOf(h4State),
      },
    };
  });
  return {
    protocol: {
      version: 'ICT_H1_DELIVERY_ENGINE_V2',
      inputs: [
        'Complete closed 1H Klines',
        'Published 4H HTF Bias snapshots',
      ],
      role: 'Intermediate Delivery only',
      reads5m: false,
      readsSetup: false,
      readsEntryExit: false,
      readsTrades: false,
      canModify4HBias: false,
      usesMss: false,
      generatesEntry: false,
      includesLiquidity: includeLiquidity,
    },
    swings: timeline.swings,
    states,
  };
}

module.exports = {
  analyze,
  applyInternalLiquidityLifecycle,
  buildInternalLiquidity,
  deliveryDirection,
  deliveryState,
  h4BiasOf,
  h4StructureOf,
  latestClosedH4State,
  primaryDrawOf,
  publicStructure,
  relationToH4,
};
