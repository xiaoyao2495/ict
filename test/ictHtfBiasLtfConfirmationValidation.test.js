'use strict';

const assert = require('assert');
const HtfV3 = require('../indicators/ictHtfBiasEngineV3');
const LtfEngine = require('../indicators/ictLtfExecutionEngine');
const Validation = require(
  '../backtest/ictHtfBiasLtfConfirmationValidation'
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

function createBars(length, duration) {
  const start = Date.UTC(2023, 0, 2);
  return Array.from({ length }, (_, index) => {
    const center =
      100 +
      Math.sin(index / 8) * 8 +
      Math.sin(index / 3) * 2;
    const open = center - 0.4;
    const close = center + 0.4;
    return {
      openTime: start + index * duration,
      closeTime: start + (index + 1) * duration - 1,
      open,
      high: Math.max(open, close) + 0.6,
      low: Math.min(open, close) - 0.6,
      close,
      volume: 1,
    };
  });
}

function emptyPdArray() {
  return {
    bullishFvgs: [],
    bullishOrderBlocks: [],
    bearishFvgs: [],
    bearishOrderBlocks: [],
  };
}

function h4State(index, bias, draw) {
  return {
    index,
    time: Date.UTC(2023, 0, 2) +
      (index + 1) * 4 * 60 * 60 * 1000 - 1,
    narrative: {
      bias,
      primaryDraw: draw,
    },
  };
}

test('Bias v3 does not require a prior liquidity sweep', () => {
  const narrative = HtfV3.resolveNarrative({
    referencePrice: 95,
    structure: { state: 'BULLISH' },
    dealingRange: { location: 'DISCOUNT' },
    liquidity: {
      buySideLiquidity: [{
        type: 'PDH',
        side: 'BUY_SIDE',
        price: 110,
        availableIndex: 1,
      }],
      sellSideLiquidity: [],
      recentlyTaken: [],
    },
    pdArray: emptyPdArray(),
  });

  assert.strictEqual(narrative.bias, 'BULLISH');
  assert.strictEqual(narrative.primaryDraw.type, 'PDH');
  assert.ok(!narrative.reasons.includes(
    'SELL_SIDE_LIQUIDITY_TAKEN'
  ));
});

test('Bias v3 snapshots remain prefix invariant', () => {
  const bars = createBars(
    180,
    4 * 60 * 60 * 1000
  );
  const prefixLength = 120;
  const prefix = HtfV3.analyze({
    h4Klines: bars.slice(0, prefixLength),
  });
  const full = HtfV3.analyze({ h4Klines: bars });

  assert.deepStrictEqual(
    full.states.slice(0, prefixLength),
    prefix.states
  );
  assert.strictEqual(
    full.protocol.liquiditySweepRequiredForBias,
    false
  );
});

test('only specified opposite-side sweep types are accepted', () => {
  assert.strictEqual(Validation.allowedSweep('BULLISH', {
    type: 'PDL',
    side: 'SELL_SIDE',
  }), true);
  assert.strictEqual(Validation.allowedSweep('BULLISH', {
    type: 'H1_SWING_LOW',
    side: 'SELL_SIDE',
  }), true);
  assert.strictEqual(Validation.allowedSweep('BEARISH', {
    type: 'LTF_SWING_HIGH',
    side: 'BUY_SIDE',
  }), true);
  assert.strictEqual(Validation.allowedSweep('BULLISH', {
    type: 'PWL',
    side: 'SELL_SIDE',
  }), false);
  assert.strictEqual(Validation.allowedSweep('BULLISH', {
    type: 'PDH',
    side: 'BUY_SIDE',
  }), false);
});

test('confirmation requires sweep and MSS in the same Bias period', () => {
  const draw = {
    side: 'BUY_SIDE',
    type: 'PDH',
    price: 120,
  };
  const states = [
    h4State(0, 'BULLISH', draw),
    h4State(1, 'BULLISH', draw),
  ];
  const timeline = Validation.buildBiasPeriods(states);
  const klines = createBars(120, LtfEngine.FIVE_MINUTES);
  klines[20].close = 105;
  const sweepTime = states[0].time + LtfEngine.FIVE_MINUTES;
  const mssTime = sweepTime + LtfEngine.FIVE_MINUTES;
  const events = Validation.matchConfirmationEvents([{
    direction: 'BULLISH',
    index: 20,
    time: mssTime,
    sweep: {
      side: 'SELL_SIDE',
      level: {
        type: 'LTF_SWING_LOW',
        side: 'SELL_SIDE',
        price: 90,
      },
      index: 19,
      time: sweepTime,
    },
  }], states, timeline.periodByH4Index, klines);

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].bias, 'BULLISH');
  assert.strictEqual(events[0].liquidityType, 'PDH');

  const invalid = Validation.matchConfirmationEvents([{
    direction: 'BULLISH',
    index: 20,
    time: states[1].time,
    sweep: {
      side: 'SELL_SIDE',
      level: {
        type: 'PWL',
        side: 'SELL_SIDE',
        price: 90,
      },
      index: 19,
      time: sweepTime,
    },
  }], states, timeline.periodByH4Index, klines);
  assert.strictEqual(invalid.length, 0);
});

test('delivery outcome separates direction and Primary Draw hit', () => {
  const bars = createBars(400, LtfEngine.FIVE_MINUTES);
  bars[0].close = 100;
  bars[10].high = 121;
  bars[288].close = 110;
  const outcome = Validation.evaluateEvent({
    index: 0,
    bias: 'BULLISH',
    referencePrice: 100,
    primaryDraw: {
      side: 'BUY_SIDE',
      type: 'PDH',
      price: 120,
    },
  }, bars, 24);

  assert.strictEqual(outcome.directionSuccess, true);
  assert.strictEqual(outcome.primaryDrawHit, true);
  assert.strictEqual(outcome.primaryDrawHitIndex, 10);
  assert.ok(outcome.mfe >= 21);
  assert.ok(outcome.mae >= 0);
});

console.log('\n' + testsPassed + ' tests passed.');
