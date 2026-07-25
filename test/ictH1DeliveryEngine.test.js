'use strict';

const assert = require('assert');
const HtfV2 = require('../indicators/ictHtfBiasEngineV2');
const H1Delivery = require('../indicators/ictH1DeliveryEngine');
const Experiment = require(
  '../backtest/ictH1DeliveryExperiment'
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
      Math.sin(index / 2.5) * 2 +
      index * 0.004;
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

function h4Snapshot(time, bias, structure, primaryDraw) {
  return {
    time,
    structure: { state: structure || bias },
    narrative: {
      bias,
      primaryDraw: primaryDraw || null,
    },
  };
}

test('1H confirmed swings remain causal and append only', () => {
  const bars = createH1Bars(24 * 25);
  const prefixLength = 24 * 16;
  const prefix = HtfV2.buildStructureTimeline(
    bars.slice(0, prefixLength)
  );
  const full = HtfV2.buildStructureTimeline(bars);
  const historical = full.swings.filter(
    (swing) => swing.availableIndex < prefixLength
  );

  assert.deepStrictEqual(historical, prefix.swings);
  assert.ok(prefix.swings.every(
    (swing) => swing.availableIndex >= swing.index
  ));
});

test('previous 1H liquidity changes from ACTIVE to SWEPT causally', () => {
  const bars = createH1Bars(5);
  bars[0].high = 105;
  bars[1].high = 104;
  bars[2].high = 106;
  const levels = H1Delivery.applyInternalLiquidityLifecycle([
    {
      type: 'PREVIOUS_1H_HIGH',
      side: 'BUY_SIDE',
      price: 105,
      formedIndex: 0,
      availableIndex: 1,
      sweepStartIndex: 1,
      status: 'ACTIVE',
      sweptIndex: null,
    },
  ], bars);
  const timeline = HtfV2.buildLiquidityTimeline(levels, bars);

  assert.strictEqual(timeline[1].buySideLiquidity.length, 1);
  assert.strictEqual(timeline[1].buySideLiquidity[0].status, 'ACTIVE');
  assert.strictEqual(timeline[2].buySideLiquidity.length, 0);
  assert.strictEqual(timeline[2].recentlyTaken[0].status, 'SWEPT');
  assert.strictEqual(timeline[2].recentlyTaken[0].sweptIndex, 2);
});

test('future 1H candles cannot alter historical delivery snapshots', () => {
  const bars = createH1Bars(24 * 24);
  const prefixLength = 24 * 15;
  const h4 = aggregateH4(bars);
  const h4Result = HtfV2.analyze({ h4Klines: h4 });
  const prefix = H1Delivery.analyze({
    h1Klines: bars.slice(0, prefixLength),
    h4BiasSnapshots: h4Result.states,
  });
  const full = H1Delivery.analyze({
    h1Klines: bars,
    h4BiasSnapshots: h4Result.states,
  });

  assert.deepStrictEqual(
    full.states.slice(0, prefixLength),
    prefix.states
  );
});

test('1H reads but never mutates the published 4H snapshots', () => {
  const bars = createH1Bars(24 * 10);
  const h4 = aggregateH4(bars);
  const h4Result = HtfV2.analyze({ h4Klines: h4 });
  const before = JSON.parse(JSON.stringify(h4Result.states));
  const result = H1Delivery.analyze({
    h1Klines: bars,
    h4BiasSnapshots: h4Result.states,
  });

  assert.deepStrictEqual(h4Result.states, before);
  assert.strictEqual(result.protocol.canModify4HBias, false);
  assert.strictEqual(result.protocol.usesMss, false);
});

test('4H and 1H relation follows aligned and retracement rules', () => {
  const bullishH4 = h4Snapshot(1, 'BULLISH', 'BULLISH');
  const bearishH4 = h4Snapshot(1, 'BEARISH', 'BEARISH');
  const neutralBullishStructure = h4Snapshot(
    1,
    'NEUTRAL',
    'BULLISH'
  );

  assert.strictEqual(
    H1Delivery.relationToH4('BULLISH', bullishH4),
    'ALIGNED'
  );
  assert.strictEqual(
    H1Delivery.deliveryState('BULLISH', 'ALIGNED'),
    'ALIGNED_BULLISH'
  );
  assert.strictEqual(
    H1Delivery.relationToH4('BEARISH', bullishH4),
    'RETRACEMENT'
  );
  assert.strictEqual(
    H1Delivery.relationToH4('BEARISH', bearishH4),
    'ALIGNED'
  );
  assert.strictEqual(
    H1Delivery.deliveryState('BEARISH', 'ALIGNED'),
    'ALIGNED_BEARISH'
  );
  assert.strictEqual(
    H1Delivery.relationToH4(
      'BEARISH',
      neutralBullishStructure
    ),
    'COUNTER_TREND'
  );
});

test('4H and 1H combined output satisfies prefix invariance', () => {
  const fullH1 = createH1Bars(24 * 24);
  const fullH4 = aggregateH4(fullH1);
  const prefixH1 = fullH1.slice(0, 24 * 16);
  const prefixH4 = aggregateH4(prefixH1);
  const prefixH4Result = HtfV2.analyze({
    h4Klines: prefixH4,
  });
  const fullH4Result = HtfV2.analyze({
    h4Klines: fullH4,
  });
  const prefix = H1Delivery.analyze({
    h1Klines: prefixH1,
    h4BiasSnapshots: prefixH4Result.states,
  });
  const full = H1Delivery.analyze({
    h1Klines: fullH1,
    h4BiasSnapshots: fullH4Result.states,
  });

  assert.deepStrictEqual(
    full.states.filter(
      (state) => state.availableIndex < prefixH1.length
    ),
    prefix.states
  );
});

test('aligned experiment measures direction and frozen target separately', () => {
  const bars = createH1Bars(30);
  const event = {
    index: 0,
    referencePrice: 100,
    primaryDraw: {
      side: 'BUY_SIDE',
      type: 'PWH',
      price: 110,
    },
  };
  bars[1].high = 106;
  bars[1].low = 99;
  bars[2].high = 111;
  const outcome = Experiment.evaluateAlignedEvent(
    event,
    bars,
    24
  );

  assert.strictEqual(outcome.targetHit, true);
  assert.strictEqual(outcome.targetHitIndex, 2);
  assert.ok(outcome.progressToTarget > 0);
});

console.log('\n' + testsPassed + ' tests passed.');
