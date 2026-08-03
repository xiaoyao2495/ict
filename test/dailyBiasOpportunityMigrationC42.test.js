'use strict';

const assert = require('assert');
const OpportunityDetector = require(
  '../indicators/ictOpportunityDetector'
);
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

function current(oldBias, marketBias, transitionDirection) {
  const value = {
    fourHourAnalysis: {
      bias: oldBias,
    },
  };
  if (marketBias !== undefined) {
    value.fourHourAnalysis.dailyBias = {
      marketBias,
      transitionDirection: transitionDirection || null,
    };
  }
  return value;
}

function detectWithOldBias(value, currentPrice, liquidity) {
  return OpportunityDetector.detect({
    currentPrice,
    h4Bias: value.fourHourAnalysis.bias,
    liquidity,
  });
}

function detectWithReport(value, currentPrice, liquidity) {
  return WatchlistReport.analyzeOpportunity({
    currentPrice,
    fourHourAnalysis: value.fourHourAnalysis,
    liquidity,
  });
}

test('BNB Daily Bias activates the retained Equal High WATCH_ZONE', () => {
  const input = current('NEUTRAL', 'BEARISH');
  const liquidity = [{
    type: 'EQUAL_HIGH',
    price: 100.2,
    status: 'ACTIVE',
  }];
  const oldOpportunity = detectWithOldBias(
    input,
    100,
    liquidity
  );
  const newOpportunity = detectWithReport(
    input,
    100,
    liquidity
  );

  assert.strictEqual(oldOpportunity.status, 'WAITING');
  assert.strictEqual(oldOpportunity.reason, 'HTF_BIAS_UNCLEAR');
  assert.strictEqual(newOpportunity.status, 'WATCH_ZONE');
  assert.strictEqual(newOpportunity.direction, 'BEARISH');
  assert.strictEqual(newOpportunity.liquidityType, 'EQUAL_HIGH');
  assert.strictEqual(newOpportunity.price, 100.2);
});

test('ETH restores Bullish context without forcing WATCH_ZONE', () => {
  const result = detectWithReport(
    current('NEUTRAL', 'BULLISH'),
    100,
    [{ type: 'PDL', price: 98, status: 'ACTIVE' }]
  );

  assert.strictEqual(result.status, 'WAITING');
  assert.strictEqual(result.direction, 'BULLISH');
  assert.strictEqual(
    result.reason,
    'NO_MATCHING_LIQUIDITY_WITHIN_THRESHOLD'
  );
  assert.strictEqual(result.liquidityType, null);
});

test('SNDK transition suppresses the legacy Bearish Opportunity', () => {
  const result = detectWithReport(
    current('BEARISH', 'NEUTRAL', 'BULLISH'),
    100,
    [{ type: 'EQUAL_HIGH', price: 100.2 }]
  );

  assert.strictEqual(result.status, 'WAITING');
  assert.strictEqual(result.direction, null);
  assert.strictEqual(result.liquidityType, null);
  assert.strictEqual(result.reason, 'HTF_BIAS_UNCLEAR');
});

test('CL Daily Bias restores a Bearish Opportunity', () => {
  const result = detectWithReport(
    current('NEUTRAL', 'BEARISH'),
    100,
    [{ type: 'PDH', price: 100.3 }]
  );

  assert.strictEqual(result.status, 'WATCH_ZONE');
  assert.strictEqual(result.direction, 'BEARISH');
  assert.strictEqual(result.liquidityType, 'PDH');
});

test('transitionDirection is never used as Opportunity direction', () => {
  const result = detectWithReport(
    current('BEARISH', 'NEUTRAL', 'BULLISH'),
    100,
    [{ type: 'PDL', price: 99.8 }]
  );

  assert.strictEqual(result.status, 'WAITING');
  assert.strictEqual(result.direction, null);
  assert.strictEqual(result.reason, 'HTF_BIAS_UNCLEAR');
});

test('legacy reports without dailyBias keep V3 Opportunity behavior', () => {
  const result = detectWithReport(
    current('BEARISH'),
    100,
    [{ type: 'EQUAL_HIGH', price: 100.2 }]
  );

  assert.strictEqual(result.status, 'WATCH_ZONE');
  assert.strictEqual(result.direction, 'BEARISH');
  assert.strictEqual(result.liquidityType, 'EQUAL_HIGH');
});

test('Opportunity migration does not mutate inputs', () => {
  const input = {
    currentPrice: 100,
    fourHourAnalysis: current(
      'NEUTRAL',
      'BULLISH'
    ).fourHourAnalysis,
    liquidity: [{ type: 'PDL', price: 99.8 }],
  };
  const before = JSON.stringify(input);

  WatchlistReport.analyzeOpportunity(input);

  assert.strictEqual(JSON.stringify(input), before);
});

console.log('\n' + testsPassed + ' tests passed.');
