'use strict';

const assert = require('assert');
const HTFStandalone = require(
  '../backtest/htfStandaloneExperiment'
);

let testsPassed = 0;
const FIVE_MINUTES = 5 * 60 * 1000;

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

function kline(index, values) {
  const input = values || {};
  const openTime = Date.UTC(2024, 0, 1) + index * FIVE_MINUTES;
  return {
    openTime,
    closeTime: openTime + FIVE_MINUTES - 1,
    open: input.open === undefined ? 100 : input.open,
    high: input.high === undefined ? 101 : input.high,
    low: input.low === undefined ? 99 : input.low,
    close: input.close === undefined ? 100 : input.close,
    volume: 1,
  };
}

function closeTo(actual, expected, tolerance) {
  assert.ok(
    Math.abs(actual - expected) <= (tolerance || 1e-10),
    actual + ' is not close to ' + expected
  );
}

test('forward outcome starts after event and is direction adjusted', () => {
  const klines = Array.from({ length: 13 }, (_, index) => kline(index));
  klines[5].low = 95;
  klines[8].high = 112;
  klines[12].close = 110;
  const bullish = HTFStandalone.evaluateEvent({
    direction: 'BULLISH',
    sourceIndex: 0,
    referenceOpenTime: klines[0].openTime,
    referencePrice: 100,
  }, klines, 1);
  const bearish = HTFStandalone.evaluateEvent({
    direction: 'BEARISH',
    sourceIndex: 0,
    referenceOpenTime: klines[0].openTime,
    referencePrice: 100,
  }, klines, 1);

  closeTo(bullish.return, 10);
  assert.strictEqual(bullish.directionCorrect, true);
  closeTo(bullish.mfe, 12);
  closeTo(bullish.mae, 5);
  closeTo(bearish.return, -10);
  assert.strictEqual(bearish.directionCorrect, false);
  closeTo(bearish.mfe, 5);
  closeTo(bearish.mae, 12);
});

test('summary reports accuracy return MFE and MAE for a horizon', () => {
  const events = [
    { outcomes: { '24h': { directionCorrect: true, return: 2, rawReturn: 2, mfe: 4, mae: 1 } } },
    { outcomes: { '24h': { directionCorrect: false, return: -1, rawReturn: 1, mfe: 2, mae: 3 } } },
  ];
  const summary = HTFStandalone.summarize(events, 24);

  assert.strictEqual(summary.events, 2);
  assert.strictEqual(summary.directionAccuracy, 0.5);
  assert.strictEqual(summary.averageReturn, 0.5);
  assert.strictEqual(summary.averageMFE, 3);
  assert.strictEqual(summary.averageMAE, 2);
  assert.strictEqual(summary.maximumMFE, 4);
  assert.strictEqual(summary.maximumMAE, 3);
});

test('daily events use the previous complete UTC day once per level', () => {
  const klines = Array.from({ length: 576 }, (_, index) => kline(index));
  for (let index = 0; index < 288; index += 1) {
    klines[index].high = index === 10 ? 110 : 105;
    klines[index].low = index === 20 ? 90 : 95;
  }
  klines[288 + 5].high = 111;
  klines[288 + 6].high = 112;
  klines[288 + 10].low = 89;
  klines[288 + 11].low = 88;

  const events = HTFStandalone.buildDailyLiquidityEvents(klines);

  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].type, 'PDH_TOUCH');
  assert.strictEqual(events[0].direction, 'BEARISH');
  assert.strictEqual(events[0].sourceIndex, 293);
  assert.strictEqual(events[1].type, 'PDL_TOUCH');
  assert.strictEqual(events[1].direction, 'BULLISH');
  assert.strictEqual(events[1].sourceIndex, 298);
});

test('combination requires all 4H 1H and PDH PDL conditions', () => {
  assert.strictEqual(
    HTFStandalone.isRangeAligned('BULLISH', 'DISCOUNT'),
    true
  );
  assert.strictEqual(
    HTFStandalone.isRangeAligned('BEARISH', 'PREMIUM'),
    true
  );
  assert.strictEqual(
    HTFStandalone.isRangeAligned('BULLISH', 'PREMIUM'),
    false
  );
  assert.strictEqual(HTFStandalone.isCombinationAligned({
    direction: 'BULLISH',
    fourHourTrend: 'BULLISH',
    premiumDiscount: 'DISCOUNT',
    previousDayLocation: 'BELOW_PDL',
  }), true);
  assert.strictEqual(HTFStandalone.isCombinationAligned({
    direction: 'BEARISH',
    fourHourTrend: 'BEARISH',
    premiumDiscount: 'PREMIUM',
    previousDayLocation: 'ABOVE_PDH',
  }), true);
  assert.strictEqual(HTFStandalone.isCombinationAligned({
    direction: 'BULLISH',
    fourHourTrend: 'BEARISH',
    premiumDiscount: 'DISCOUNT',
    previousDayLocation: 'BELOW_PDL',
  }), false);
});

test('standalone analysis declares no Setup or Baseline trade dependency', () => {
  const klines = Array.from({ length: 900 }, (_, index) => {
    const center = 100 + Math.sin(index / 20) * 10;
    return kline(index, {
      open: center,
      high: center + 2,
      low: center - 2,
      close: center + Math.sin(index / 7),
    });
  });
  const before = JSON.stringify(klines);
  const result = HTFStandalone.analyze(klines, {
    horizons: [1],
    includeEvents: false,
  });

  assert.strictEqual(result.protocol.standalone, true);
  assert.strictEqual(result.protocol.reads5mSetups, false);
  assert.strictEqual(result.protocol.usesBaselineTrades, false);
  assert.strictEqual(result.protocol.usesEntryOrExit, false);
  assert.strictEqual(result.events, undefined);
  assert.strictEqual(JSON.stringify(klines), before);
});

console.log('\n' + testsPassed + ' tests passed.');
