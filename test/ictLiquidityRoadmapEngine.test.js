'use strict';

const assert = require('assert');
const Roadmap = require(
  '../indicators/ictLiquidityRoadmapEngine'
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

test('4H direction alignment sorts before distance', () => {
  const result = Roadmap.analyze({
    currentPrice: 100,
    h4Bias: 'BULLISH',
    liquidity: [
      {
        type: 'PDL',
        side: 'SELL_SIDE',
        price: 99,
        status: 'ACTIVE',
      },
      {
        type: 'PWH',
        side: 'BUY_SIDE',
        price: 110,
        status: 'ACTIVE',
      },
    ],
  });

  assert.deepStrictEqual(
    result.map((item) => item.type),
    ['PWH', 'PDL']
  );
  assert.strictEqual(result[0].directionAligned, true);
  assert.strictEqual(result[1].directionAligned, false);
});

test('distance sorts before liquidity importance', () => {
  const result = Roadmap.analyze({
    currentPrice: 100,
    h4Bias: 'BEARISH',
    liquidity: [
      {
        type: 'PWL',
        side: 'SELL_SIDE',
        price: 90,
      },
      {
        type: 'LTF_SWING_LOW',
        side: 'SELL_SIDE',
        price: 98,
      },
    ],
  });

  assert.deepStrictEqual(
    result.map((item) => item.type),
    ['LTF_SWING_LOW', 'PWL']
  );
});

test('importance breaks equal-distance ties', () => {
  const result = Roadmap.analyze({
    currentPrice: 100,
    h4Bias: 'BULLISH',
    liquidity: [
      {
        type: 'LTF_SWING_HIGH',
        side: 'BUY_SIDE',
        price: 105,
      },
      {
        type: 'PDH',
        side: 'BUY_SIDE',
        price: 105,
      },
    ],
  });

  assert.deepStrictEqual(
    result.map((item) => item.type),
    ['PDH', 'LTF_SWING_HIGH']
  );
  assert.ok(result[0].priority > result[1].priority);
});

test('importance follows daily weekly equal and swing order', () => {
  const result = Roadmap.analyze({
    currentPrice: 100,
    h4Bias: 'BULLISH',
    liquidity: [
      { type: 'LTF_SWING_HIGH', price: 105 },
      { type: 'M15_SWING_HIGH', price: 105 },
      { type: 'H1_SWING_HIGH', price: 105 },
      { type: 'H4_SWING_HIGH', price: 105 },
      { type: 'EQUAL_HIGH', price: 105 },
      { type: 'PWH', price: 105 },
      { type: 'PDH', price: 105 },
    ],
  });

  assert.deepStrictEqual(
    result.map((item) => item.type),
    [
      'PDH',
      'PWH',
      'EQUAL_HIGH',
      'H4_SWING_HIGH',
      'H1_SWING_HIGH',
      'M15_SWING_HIGH',
      'LTF_SWING_HIGH',
    ]
  );
});

test('roadmap exposes required values and infers metadata', () => {
  const result = Roadmap.analyze({
    currentPrice: 100,
    h4Bias: 'BULLISH',
    liquidity: [{
      type: 'PDH',
      price: 100.42,
    }],
  });

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, 'PDH');
  assert.strictEqual(result[0].timeframe, '1D');
  assert.strictEqual(result[0].price, 100.42);
  assert.ok(
    Math.abs(result[0].distancePercent - 0.42) <
      1e-10
  );
  assert.ok(Number.isFinite(result[0].priority));
  assert.strictEqual(result[0].side, 'BUY_SIDE');
});

test('inactive levels are omitted and duplicates collapse', () => {
  const result = Roadmap.analyze({
    currentPrice: 100,
    liquidity: [
      {
        type: 'EQUAL_LOW',
        timeframe: '15m',
        price: 95,
        status: 'ACTIVE',
      },
      {
        type: 'EQUAL_LOW',
        timeframe: '15m',
        price: 95,
        status: 'ACTIVE',
      },
      {
        type: 'PDL',
        price: 90,
        status: 'SWEPT',
      },
      {
        type: 'PWL',
        price: 80,
        status: 'CONSUMED',
      },
    ],
  });

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, 'EQUAL_LOW');
  assert.strictEqual(result[0].timeframe, '15m');
});

test('analysis does not mutate liquidity input', () => {
  const liquidity = [{
    type: 'H4_SWING_HIGH',
    side: 'BUY_SIDE',
    price: 105,
    status: 'ACTIVE',
  }];
  const original = JSON.parse(JSON.stringify(liquidity));

  Roadmap.analyze({
    currentPrice: 100,
    h4Bias: 'BULLISH',
    liquidity,
  });

  assert.deepStrictEqual(liquidity, original);
});

test('invalid current price is rejected', () => {
  assert.throws(
    () => Roadmap.analyze({
      currentPrice: 0,
      liquidity: [],
    }),
    /currentPrice/
  );
});

test('watchlist projection collects active liquidity by timeframe', () => {
  const levels = WatchlistReport.collectRoadmapLiquidity(
    {
      liquidity: {
        buySideLiquidity: [{
          type: 'PDH',
          side: 'BUY_SIDE',
          price: 110,
          status: 'ACTIVE',
        }],
        sellSideLiquidity: [{
          type: 'EQUAL_LOW',
          side: 'SELL_SIDE',
          price: 90,
          status: 'ACTIVE',
        }],
      },
    },
    {
      liquidity: {
        activeLevels: [{
          type: 'LTF_SWING_HIGH',
          side: 'BUY_SIDE',
          price: 105,
          source: 'INTERNAL',
          status: 'ACTIVE',
        }, {
          type: 'H4_SWING_HIGH',
          side: 'BUY_SIDE',
          price: 120,
          source: 'EXTERNAL',
          status: 'ACTIVE',
        }],
      },
    },
    {
      liquidity: {
        activeLevels: [{
          type: 'LTF_SWING_LOW',
          side: 'SELL_SIDE',
          price: 95,
          source: 'INTERNAL',
          status: 'ACTIVE',
        }, {
          type: 'H1_SWING_LOW',
          side: 'SELL_SIDE',
          price: 92,
          source: 'INTERMEDIATE',
          status: 'ACTIVE',
        }],
      },
    }
  );

  assert.deepStrictEqual(
    levels.map((level) => [
      level.type,
      level.timeframe,
    ]),
    [
      ['PDH', undefined],
      ['EQUAL_LOW', '4H'],
      ['M15_SWING_HIGH', '15m'],
      ['LTF_SWING_LOW', '5m'],
    ]
  );
});

console.log('\n' + testsPassed + ' tests passed.');
