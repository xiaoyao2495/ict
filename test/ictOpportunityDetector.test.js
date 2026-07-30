'use strict';

const assert = require('assert');
const Detector = require(
  '../indicators/ictOpportunityDetector'
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

test('bullish bias watches nearby lower sell-side liquidity', () => {
  const result = Detector.detect({
    h4Bias: 'BULLISH',
    currentPrice: 100,
    liquidity: [
      { type: 'PDH', price: 100.1 },
      { type: 'PWL', price: 99.6, status: 'ACTIVE' },
      { type: 'EQUAL_LOW', price: 99 },
    ],
  });

  assert.deepStrictEqual(result, {
    status: 'WATCH_ZONE',
    direction: 'BULLISH',
    liquidityType: 'PWL',
    price: 99.6,
    distancePercent: 0.40000000000000563,
    reason: 'BULLISH_PRICE_NEAR_SELL_SIDE_LIQUIDITY',
  });
});

test('bearish bias watches nearby upper buy-side liquidity', () => {
  const result = Detector.detect({
    h4Bias: 'BEARISH',
    currentPrice: 200,
    liquidityRoadmap: [
      { type: 'PDL', price: 199.5 },
      { type: 'H4_SWING_HIGH', price: 200.8 },
    ],
  });

  assert.strictEqual(result.status, 'WATCH_ZONE');
  assert.strictEqual(result.direction, 'BEARISH');
  assert.strictEqual(
    result.liquidityType,
    'H4_SWING_HIGH'
  );
  assert.strictEqual(result.price, 200.8);
  assert.ok(Math.abs(
    result.distancePercent - 0.4
  ) < 1e-12);
});

test('distance threshold includes exactly 0.5 percent', () => {
  const result = Detector.detect({
    h4Bias: 'BULLISH',
    currentPrice: 100,
    liquidity: [{
      type: 'PDL',
      price: 99.5,
    }],
  });

  assert.strictEqual(result.status, 'WATCH_ZONE');
  assert.strictEqual(result.distancePercent, 0.5);
});

test('distance over 0.5 percent remains waiting', () => {
  const result = Detector.detect({
    h4Bias: 'BEARISH',
    currentPrice: 100,
    liquidity: [{
      type: 'PWH',
      price: 100.51,
    }],
  });

  assert.deepStrictEqual(result, {
    status: 'WAITING',
    direction: 'BEARISH',
    liquidityType: null,
    price: null,
    distancePercent: null,
    reason: 'NO_MATCHING_LIQUIDITY_WITHIN_THRESHOLD',
  });
});

test('wrong side type and swept liquidity are ignored', () => {
  const result = Detector.detect({
    h4Bias: 'BULLISH',
    currentPrice: 100,
    liquidity: [
      { type: 'PDH', price: 99.9 },
      { type: 'PDL', price: 100.1 },
      {
        type: 'EQUAL_LOW',
        price: 99.9,
        status: 'SWEPT',
      },
    ],
  });

  assert.strictEqual(result.status, 'WAITING');
});

test('nearest eligible level wins before type priority', () => {
  const result = Detector.detect({
    h4Bias: 'BEARISH',
    currentPrice: 100,
    liquidity: [
      { type: 'PDH', price: 100.4 },
      { type: 'EQUAL_HIGH', price: 100.2 },
    ],
  });

  assert.strictEqual(result.liquidityType, 'EQUAL_HIGH');
  assert.strictEqual(result.price, 100.2);
});

test('neutral bias does not force an opportunity direction', () => {
  const result = Detector.detect({
    h4Bias: 'NEUTRAL',
    currentPrice: 100,
    liquidity: [{
      type: 'PDL',
      price: 99.9,
    }],
  });

  assert.deepStrictEqual(result, {
    status: 'WAITING',
    direction: null,
    liquidityType: null,
    price: null,
    distancePercent: null,
    reason: 'HTF_BIAS_UNCLEAR',
  });
});

test('detector does not mutate liquidity input', () => {
  const liquidity = [{
    type: 'H4_SWING_LOW',
    price: 99.8,
    status: 'ACTIVE',
  }];
  const original = JSON.parse(JSON.stringify(liquidity));

  Detector.detect({
    h4Bias: 'BULLISH',
    currentPrice: 100,
    liquidity,
  });

  assert.deepStrictEqual(liquidity, original);
});

test('invalid current price is rejected', () => {
  assert.throws(
    () => Detector.detect({
      h4Bias: 'BULLISH',
      currentPrice: 0,
      liquidity: [],
    }),
    /currentPrice/
  );
});

console.log('\n' + testsPassed + ' tests passed.');
