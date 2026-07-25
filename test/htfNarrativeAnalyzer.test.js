'use strict';

const assert = require('assert');
const HTFNarrativeAnalyzer = require(
  '../indicators/htfNarrativeAnalyzer'
);
const BaselineV1 = require('../config/baselineV1');
const RunBacktest = require('../scripts/runBacktest');

const FIVE_MINUTES = 5 * 60 * 1000;
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

function createSeries(length) {
  const start = Date.UTC(2024, 0, 1);
  return Array.from({ length }, (_, index) => {
    const center =
      100 +
      Math.sin(index / 30) * 9 +
      Math.sin(index / 7) * 2 +
      index * 0.002;
    const open = center - Math.sin(index / 5);
    const close = center + Math.cos(index / 6);
    const openTime = start + index * FIVE_MINUTES;
    return {
      openTime,
      closeTime: openTime + FIVE_MINUTES - 1,
      open,
      high: Math.max(open, close) + 1.5,
      low: Math.min(open, close) - 1.5,
      close,
      volume: 1,
    };
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('historical HTF snapshots satisfy prefix invariance', () => {
  const full = createSeries(288 * 10);
  const prefix = full.slice(0, 288 * 7);
  const prefixResult = HTFNarrativeAnalyzer.analyze(prefix);
  const fullResult = HTFNarrativeAnalyzer.analyze(full);
  const historical = fullResult.snapshots.filter(
    (snapshot) => snapshot.timestamp <=
      prefixResult.snapshots[prefixResult.snapshots.length - 1].timestamp
  );

  assert.deepStrictEqual(historical, prefixResult.snapshots);
});

test('future confirmed swings cannot rewrite a historical dealing range', () => {
  const full = createSeries(288 * 12);
  const prefix = full.slice(0, 288 * 8);
  const prefixResult = HTFNarrativeAnalyzer.analyze(prefix);
  const fullResult = HTFNarrativeAnalyzer.analyze(full);
  const historical = prefixResult.snapshots
    .slice()
    .reverse()
    .find((snapshot) => (
      snapshot.h4 &&
      snapshot.h4.dealingRange.high !== null
    ));

  assert.ok(historical);
  const extended = fullResult.snapshots.find(
    (snapshot) => snapshot.timestamp === historical.timestamp
  );
  assert.deepStrictEqual(
    extended.h4.dealingRange,
    historical.h4.dealingRange
  );
  assert.ok(
    historical.h4.dealingRange.availableAt <= historical.timestamp
  );
});

test('liquidity lifecycle hides a future sweep from past snapshots', () => {
  const start = Date.UTC(2024, 0, 1);
  const bars = Array.from({ length: 4 }, (_, index) => ({
    openTime: start + index * HTFNarrativeAnalyzer.FOUR_HOURS,
    closeTime:
      start +
      (index + 1) * HTFNarrativeAnalyzer.FOUR_HOURS -
      1,
    open: 100,
    high: index === 3 ? 111 : 105,
    low: 95,
    close: 100,
  }));
  const levels = HTFNarrativeAnalyzer.applyLiquidityLifecycle([
    {
      type: 'PDH',
      side: 'BUY_SIDE',
      price: 110,
      formedAt: bars[0].closeTime,
      availableAt: bars[1].openTime,
      activeIndex: 1,
      status: 'ACTIVE',
      sweptAt: null,
      sweptIndex: null,
      priority: 3,
    },
  ], bars);
  const past = HTFNarrativeAnalyzer.buildLiquiditySnapshot(
    levels,
    2,
    bars[2].closeTime,
    100
  );
  const future = HTFNarrativeAnalyzer.buildLiquiditySnapshot(
    levels,
    3,
    bars[3].closeTime,
    100
  );

  assert.strictEqual(past.activeBuySide.length, 1);
  assert.strictEqual(past.activeBuySide[0].status, 'ACTIVE');
  assert.strictEqual(past.activeBuySide[0].sweptAt, null);
  assert.strictEqual(future.activeBuySide.length, 0);
  assert.strictEqual(future.recentlyTaken[0].status, 'SWEPT');
  assert.strictEqual(
    future.recentlyTaken[0].sweptAt,
    bars[3].closeTime
  );
});

test('1H changes inside an open 4H bar do not rewrite 4H narrative', () => {
  const length = 288 * 9 + 12;
  const first = createSeries(length);
  const second = clone(first);

  for (let index = length - 12; index < length; index += 1) {
    second[index].open += 40;
    second[index].high += 40;
    second[index].low += 40;
    second[index].close += 40;
  }

  const firstSnapshot = HTFNarrativeAnalyzer
    .analyze(first, { latestOnly: true }).snapshots[0];
  const secondSnapshot = HTFNarrativeAnalyzer
    .analyze(second, { latestOnly: true }).snapshots[0];

  assert.notStrictEqual(
    firstSnapshot.referencePrice,
    secondSnapshot.referencePrice
  );
  assert.deepStrictEqual(firstSnapshot.h4, secondSnapshot.h4);
});

test('narrative uses confluence and selects only active external draw', () => {
  const structure = {
    state: 'BULLISH',
    dealingRange: { location: 'DISCOUNT' },
  };
  const liquidity = {
    activeBuySide: [
      { type: 'PDH', side: 'BUY_SIDE', price: 110 },
      { type: 'PWH', side: 'BUY_SIDE', price: 120 },
    ],
    activeSellSide: [
      { type: 'PWL', side: 'SELL_SIDE', price: 80 },
    ],
    nearestBuySide: { type: 'PDH', side: 'BUY_SIDE', price: 110 },
    nearestSellSide: { type: 'PWL', side: 'SELL_SIDE', price: 80 },
    recentlyTaken: [
      { type: 'PDL', side: 'SELL_SIDE', price: 90, status: 'SWEPT' },
    ],
  };
  const result = HTFNarrativeAnalyzer.buildNarrative(
    structure,
    liquidity,
    { bullishFvgs: [], bearishFvgs: [] },
    100
  );

  assert.strictEqual(result.advantageDirection, 'BULLISH');
  assert.strictEqual(result.primaryDraw.type, 'PWH');
  assert.strictEqual(result.primaryDraw.side, 'BUY_SIDE');
  assert.strictEqual(result.opposingLiquidity.type, 'PWL');
  assert.ok(result.reasons.includes('SELL_SIDE_LIQUIDITY_TAKEN'));
  assert.ok(result.reasons.includes('PRICE_IN_DISCOUNT'));
});

test('1H delivery remains context and Baseline V1 contract is unchanged', () => {
  const result = HTFNarrativeAnalyzer.analyze(
    createSeries(288 * 3),
    { latestOnly: true }
  );

  assert.strictEqual(
    HTFNarrativeAnalyzer.relationToH4('DOWN', 'BULLISH'),
    'RETRACING'
  );
  assert.strictEqual(result.protocol.h1DoesNotRewriteH4, true);
  assert.strictEqual(result.protocol.entrySignalGenerated, false);
  assert.strictEqual(result.protocol.automatedOrderGenerated, false);
  assert.deepStrictEqual(
    RunBacktest.resolveConfiguration(),
    BaselineV1
  );
});

console.log('\n' + testsPassed + ' tests passed.');
