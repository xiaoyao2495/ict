'use strict';

const HtfBiasV2 = require('./ictHtfBiasEngineV2');

function containsPrice(item, price) {
  return item.bottom <= price && price <= item.top;
}

function hasPdConflict(pdArray, direction, price) {
  const items = direction === 'BULLISH'
    ? pdArray.bearishFvgs.concat(pdArray.bearishOrderBlocks)
    : pdArray.bullishFvgs.concat(pdArray.bullishOrderBlocks);
  return items.some((item) => containsPrice(item, price));
}

function resolveNarrative(state) {
  const structure = state.structure.state;
  const location = state.dealingRange.location;
  const bullishDraw = HtfBiasV2.selectPrimaryDraw(
    state.liquidity.buySideLiquidity,
    state.referencePrice
  );
  const bearishDraw = HtfBiasV2.selectPrimaryDraw(
    state.liquidity.sellSideLiquidity,
    state.referencePrice
  );
  const bullish = (
    structure === 'BULLISH' &&
    location === 'DISCOUNT' &&
    Boolean(bullishDraw) &&
    !hasPdConflict(state.pdArray, 'BULLISH', state.referencePrice)
  );
  const bearish = (
    structure === 'BEARISH' &&
    location === 'PREMIUM' &&
    Boolean(bearishDraw) &&
    !hasPdConflict(state.pdArray, 'BEARISH', state.referencePrice)
  );

  if (bullish && !bearish) {
    return {
      bias: 'BULLISH',
      primaryDraw: bullishDraw,
      reasons: [
        'HH_HL_STRUCTURE',
        'PRICE_IN_DISCOUNT',
        'ACTIVE_BUY_SIDE_PRIMARY_DRAW',
        'NO_OPPOSING_PD_ARRAY_CONFLICT',
      ],
    };
  }
  if (bearish && !bullish) {
    return {
      bias: 'BEARISH',
      primaryDraw: bearishDraw,
      reasons: [
        'LH_LL_STRUCTURE',
        'PRICE_IN_PREMIUM',
        'ACTIVE_SELL_SIDE_PRIMARY_DRAW',
        'NO_OPPOSING_PD_ARRAY_CONFLICT',
      ],
    };
  }
  return {
    bias: 'NEUTRAL',
    primaryDraw: null,
    reasons: ['HTF_CONTEXT_CONFLICT_OR_INCOMPLETE'],
  };
}

function analyze(input) {
  const base = HtfBiasV2.analyze(input);
  const states = base.states.map((state) => {
    const narrative = resolveNarrative(state);
    return {
      ...state,
      liquidity: {
        ...state.liquidity,
        primaryDraw: narrative.primaryDraw,
      },
      narrative,
    };
  });
  return {
    protocol: {
      ...base.protocol,
      version: 'ICT_HTF_BIAS_ENGINE_V3',
      liquiditySweepRequiredForBias: false,
      role: '4H direction, location and external primary draw only',
      modifiesV2: false,
      modifiesProduction: false,
    },
    swings: base.swings,
    states,
  };
}

module.exports = {
  analyze,
  containsPrice,
  hasPdConflict,
  resolveNarrative,
};
