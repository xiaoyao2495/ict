'use strict';

const assert = require('assert');
const HtfV2 = require('../indicators/ictHtfBiasEngineV2');
const H1Delivery = require('../indicators/ictH1DeliveryEngine');
const Experiment = require(
  '../backtest/ictHtfNarrativeExperiment'
);

let testsPassed = 0;

function test(name, callback) {
  try {
    callback();
    testsPassed += 1;
    console.log('PASS:', name);
  } catch (error) {
    console.error('FAIL:', name);
    throw error;
  }
}

function createH1Bars(length) {
  const start = Date.UTC(2023, 0, 2);
  return Array.from({ length }, (_, index) => {
    const center =
      100 +
      Math.sin(index / 7) * 9 +
      Math.sin(index / 2.7) * 2 +
      index * 0.005;
    const open = center - Math.sin(index / 3);
    const close = center + Math.cos(index / 4);
    return {
      openTime: start + index * HtfV2.ONE_HOUR,
      closeTime:
        start + (index + 1) * HtfV2.ONE_HOUR - 1,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1,
    };
  });
}

function aggregateH4(h1Bars) {
  const result = [];
  for (let index = 0; index + 3 < h1Bars.length; index += 4) {
    const group = h1Bars.slice(index, index + 4);
    result.push({
      openTime: group[0].openTime,
      closeTime: group[3].closeTime,
      open: group[0].open,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      close: group[3].close,
      volume: 4,
    });
  }
  return result;
}

function emptyPdArray() {
  return {
    bullishFvgs: [],
    bullishOrderBlocks: [],
    bearishFvgs: [],
    bearishOrderBlocks: [],
  };
}

test('confirmed 4H swings are causal and never rewritten', () => {
  const h1 = createH1Bars(24 * 35);
  const h4 = aggregateH4(h1);
  const prefixLength = 130;
  const prefix = HtfV2.buildStructureTimeline(
    h4.slice(0, prefixLength)
  );
  const full = HtfV2.buildStructureTimeline(h4);
  const historical = full.swings.filter(
    (swing) => swing.availableIndex < prefixLength
  );

  assert.deepStrictEqual(historical, prefix.swings);
  assert.ok(prefix.swings.every(
    (swing) => swing.availableIndex >= swing.index
  ));
});

test('future candles cannot alter an already published 4H snapshot', () => {
  const h1 = createH1Bars(24 * 30);
  const h4 = aggregateH4(h1);
  const prefixLength = 120;
  const prefix = HtfV2.analyze({
    h4Klines: h4.slice(0, prefixLength),
  });
  const full = HtfV2.analyze({ h4Klines: h4 });

  assert.deepStrictEqual(
    full.states.slice(0, prefixLength),
    prefix.states
  );
  assert.strictEqual(full.protocol.usesMssForH4Bias, false);
  assert.ok(full.states.every(
    (state) => !Object.prototype.hasOwnProperty.call(
      state.structure,
      'mss'
    )
  ));
});

test('liquidity stays active until the sweep candle is available', () => {
  const start = Date.UTC(2024, 0, 1);
  const bars = Array.from({ length: 6 }, (_, index) => ({
    openTime: start + index * HtfV2.FOUR_HOURS,
    closeTime:
      start + (index + 1) * HtfV2.FOUR_HOURS - 1,
    open: 100,
    high: index === 5 ? 112 : 105,
    low: 95,
    close: 100,
  }));
  const levels = HtfV2.applyLiquidityLifecycle([
    {
      type: 'PDH',
      side: 'BUY_SIDE',
      price: 110,
      formedIndex: 0,
      availableIndex: 1,
      status: 'ACTIVE',
      sweptIndex: null,
    },
  ], bars);

  assert.strictEqual(
    HtfV2.projectLiquidity(levels, 4, 100)
      .buySideLiquidity.length,
    1
  );
  assert.strictEqual(
    HtfV2.projectLiquidity(levels, 5, 100)
      .buySideLiquidity.length,
    0
  );
  const taken = HtfV2.projectLiquidity(levels, 5, 100)
    .recentlyTaken[0];
  assert.strictEqual(taken.status, 'SWEPT');
  assert.strictEqual(taken.sweptIndex, 5);
});

test('premium discount remains tied to confirmed range endpoints', () => {
  const high = {
    type: 'SWING_HIGH',
    price: 120,
    index: 5,
    availableIndex: 7,
    time: 0,
  };
  const low = {
    type: 'SWING_LOW',
    price: 80,
    index: 8,
    availableIndex: 10,
    time: 0,
  };
  const discount = HtfV2.buildDealingRange(high, low, 95);
  const premium = HtfV2.buildDealingRange(high, low, 105);

  assert.strictEqual(discount.equilibrium, 100);
  assert.strictEqual(discount.location, 'DISCOUNT');
  assert.strictEqual(premium.equilibrium, 100);
  assert.strictEqual(premium.location, 'PREMIUM');
  assert.deepStrictEqual(discount.highSource, high);
  assert.deepStrictEqual(discount.lowSource, low);
});

test('narrative requires structure location sweep and remaining draw', () => {
  const structure = { state: 'BULLISH' };
  const range = {
    location: 'DISCOUNT',
    availableIndex: 4,
  };
  const liquidity = {
    buySideLiquidity: [{
      type: 'PWH',
      side: 'BUY_SIDE',
      price: 120,
      availableIndex: 3,
    }],
    sellSideLiquidity: [],
    recentlyTaken: [{
      type: 'PDL',
      side: 'SELL_SIDE',
      price: 90,
      availableIndex: 2,
      sweptIndex: 5,
    }],
  };
  const bullish = HtfV2.resolveNarrative(
    structure,
    range,
    liquidity,
    emptyPdArray(),
    95
  );
  assert.strictEqual(bullish.bias, 'BULLISH');
  assert.strictEqual(bullish.primaryDraw.type, 'PWH');

  const conflict = emptyPdArray();
  conflict.bearishFvgs.push({
    type: 'BEARISH_FVG',
    top: 98,
    bottom: 92,
  });
  const neutral = HtfV2.resolveNarrative(
    structure,
    range,
    liquidity,
    conflict,
    95
  );
  assert.strictEqual(neutral.bias, 'NEUTRAL');
  assert.strictEqual(neutral.primaryDraw, null);
});

test('1H delivery can describe but cannot modify 4H bias', () => {
  const h1 = createH1Bars(24 * 24);
  const h4 = aggregateH4(h1);
  const h4Result = HtfV2.analyze({ h4Klines: h4 });
  const before = JSON.parse(JSON.stringify(h4Result.states));
  const changedH1 = JSON.parse(JSON.stringify(h1));
  for (let index = 0; index < changedH1.length; index += 1) {
    changedH1[index].close += Math.sin(index) * 15;
    changedH1[index].high = Math.max(
      changedH1[index].high,
      changedH1[index].close + 1
    );
    changedH1[index].low = Math.min(
      changedH1[index].low,
      changedH1[index].close - 1
    );
  }
  const delivery = H1Delivery.analyze({
    h1Klines: changedH1,
    h4States: h4Result.states,
  });

  assert.deepStrictEqual(h4Result.states, before);
  assert.strictEqual(delivery.protocol.canModify4HBias, false);
  assert.ok(delivery.states.every((state) => (
    state.relationTo4H &&
    typeof state.relationTo4H.h4Bias === 'string'
  )));
});

test('combined 4H and 1H information satisfies prefix invariance', () => {
  const fullH1 = createH1Bars(24 * 32);
  const fullH4 = aggregateH4(fullH1);
  const prefixH1 = fullH1.slice(0, 24 * 20);
  const prefixH4 = aggregateH4(prefixH1);
  const prefixH4Result = HtfV2.analyze({
    h4Klines: prefixH4,
  });
  const fullH4Result = HtfV2.analyze({
    h4Klines: fullH4,
  });
  const prefixH1Result = H1Delivery.analyze({
    h1Klines: prefixH1,
    h4States: prefixH4Result.states,
  });
  const fullH1Result = H1Delivery.analyze({
    h1Klines: fullH1,
    h4States: fullH4Result.states,
  });

  assert.deepStrictEqual(
    fullH4Result.states.filter(
      (state) => state.availableIndex < prefixH4.length
    ),
    prefixH4Result.states
  );
  assert.deepStrictEqual(
    fullH1Result.states.filter(
      (state) => state.availableIndex < prefixH1.length
    ),
    prefixH1Result.states
  );
});

test('independent experiment uses only HTF inputs and freezes draw', () => {
  const h1 = createH1Bars(24 * 22);
  const h4 = aggregateH4(h1);
  const result = Experiment.analyze({
    h4Klines: h4,
    h1Klines: h1,
    horizons: [24],
    years: [2023],
  });

  assert.strictEqual(result.protocol.reads5m, false);
  assert.strictEqual(result.protocol.readsSetup, false);
  assert.strictEqual(result.protocol.readsEntry, false);
  assert.strictEqual(result.protocol.readsExit, false);
  assert.strictEqual(result.protocol.readsTrades, false);
  assert.strictEqual(
    result.biasDistribution.totalSnapshots,
    h4.length
  );
});

console.log('\n' + testsPassed + ' tests passed.');
