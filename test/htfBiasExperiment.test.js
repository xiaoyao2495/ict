'use strict';

const assert = require('assert');
const HTFBiasExperiment = require(
  '../backtest/htfBiasExperiment'
);

let testsPassed = 0;
const FOUR_HOURS = 4 * 60 * 60 * 1000;

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

function closeTo(actual, expected, tolerance) {
  assert.ok(
    Math.abs(actual - expected) <= (tolerance || 1e-10),
    actual + ' is not close to ' + expected
  );
}

function bars(length) {
  const start = Date.UTC(2023, 0, 1);
  return Array.from({ length }, (_, index) => ({
    openTime: start + index * FOUR_HOURS,
    closeTime: start + (index + 1) * FOUR_HOURS - 1,
    open: 100 + index,
    high: 102 + index,
    low: 98 + index,
    close: 100 + index,
  }));
}

test('bias outcome measures accuracy return MFE MAE and target hit', () => {
  const h4 = bars(8);
  const event = {
    index: 0,
    direction: 'BULLISH',
    referencePrice: 100,
    primaryLiquidityTarget: {
      side: 'BUY_SIDE',
      price: 105,
      type: 'PDH',
    },
  };
  const outcome = HTFBiasExperiment.evaluateEvent(event, h4, 24);

  assert.strictEqual(outcome.directionCorrect, true);
  closeTo(outcome.return, 6);
  closeTo(outcome.mfe, 8);
  closeTo(outcome.mae, 1);
  assert.strictEqual(outcome.targetHit, true);
  assert.strictEqual(outcome.targetHitIndex, 3);
});

test('summary includes liquidity target hit rate', () => {
  const events = [
    {
      primaryLiquidityTarget: { type: 'PDH' },
      outcomes: {
        '24h': {
          directionCorrect: true,
          return: 2,
          mfe: 3,
          mae: 1,
          targetHit: true,
        },
      },
    },
    {
      primaryLiquidityTarget: { type: 'PWL' },
      outcomes: {
        '24h': {
          directionCorrect: false,
          return: -1,
          mfe: 1,
          mae: 2,
          targetHit: false,
        },
      },
    },
  ];
  const summary = HTFBiasExperiment.summarize(events, 24);

  assert.strictEqual(summary.events, 2);
  assert.strictEqual(summary.accuracy, 0.5);
  assert.strictEqual(summary.averageReturn, 0.5);
  assert.strictEqual(summary.targetHits, 1);
  assert.strictEqual(summary.targetHitRate, 0.5);
});

test('yearly split preserves empty years and never tunes rules', () => {
  const sample = {
    year: 2023,
    direction: 'BULLISH',
    location: 'DISCOUNT',
    primaryLiquidityTarget: { type: 'PDH' },
    outcomes: {
      '24h': {
        directionCorrect: true,
        return: 1,
        mfe: 2,
        mae: 1,
        targetHit: true,
      },
    },
  };
  const yearly = HTFBiasExperiment.buildYearly(
    [sample],
    [2022, 2023],
    [24]
  );

  assert.strictEqual(yearly['2022'].eventCount, 0);
  assert.strictEqual(yearly['2023'].eventCount, 1);
  assert.strictEqual(
    yearly['2023'].premiumDiscount
      .BULLISH_DISCOUNT['24h'].accuracy,
    1
  );
});

console.log('\n' + testsPassed + ' tests passed.');
