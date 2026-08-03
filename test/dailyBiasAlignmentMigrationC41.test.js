'use strict';

const assert = require('assert');
const WatchlistReport = require(
  '../indicators/ictWatchlistAnalystReport'
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

function current(oldBias, marketBias, structureState) {
  const value = {
    fourHourAnalysis: {
      bias: oldBias,
    },
    structurePhase: {
      state: structureState,
    },
  };
  if (marketBias !== undefined) {
    value.fourHourAnalysis.dailyBias = {
      marketBias,
    };
  }
  return value;
}

test('ETH Daily Bias restores Bullish HTF Alignment', () => {
  const result = WatchlistReport.analyzeHtfAlignment(
    current(
      'NEUTRAL',
      'BULLISH',
      'BULLISH_CONTINUATION'
    )
  );

  assert.strictEqual(result.status, 'ALIGNED');
  assert.strictEqual(result.biasDirection, 'BULLISH');
});

test('CL Daily Bias restores Bearish HTF Alignment', () => {
  const result = WatchlistReport.analyzeHtfAlignment(
    current(
      'NEUTRAL',
      'BEARISH',
      'BEARISH_CONTINUATION'
    )
  );

  assert.strictEqual(result.status, 'ALIGNED');
  assert.strictEqual(result.biasDirection, 'BEARISH');
});

test('SNDK transition no longer remains a false Conflict', () => {
  const result = WatchlistReport.analyzeHtfAlignment(
    current(
      'BEARISH',
      'NEUTRAL',
      'BULLISH_PULLBACK'
    )
  );

  assert.strictEqual(result.status, 'UNDETERMINED');
  assert.strictEqual(result.biasDirection, null);
  assert.strictEqual(result.structureDirection, 'BULLISH');
});

test('legacy reports without dailyBias keep V3 Alignment', () => {
  const result = WatchlistReport.analyzeHtfAlignment(
    current(
      'BEARISH',
      undefined,
      'BEARISH_CONTINUATION'
    )
  );

  assert.strictEqual(result.status, 'ALIGNED');
  assert.strictEqual(result.biasDirection, 'BEARISH');
});

test('Alignment migration never mutates report input', () => {
  const input = current(
    'NEUTRAL',
    'BULLISH',
    'BULLISH_CONTINUATION'
  );
  const before = JSON.stringify(input);

  WatchlistReport.analyzeHtfAlignment(input);

  assert.strictEqual(JSON.stringify(input), before);
});

console.log('\n' + testsPassed + ' tests passed.');
