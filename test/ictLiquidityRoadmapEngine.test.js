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
        type: 'H4_SWING_HIGH',
        timeframe: '4H',
        side: 'BUY_SIDE',
        price: 105,
      },
      {
        type: 'EQUAL_HIGH',
        timeframe: '4H',
        side: 'BUY_SIDE',
        price: 105,
      },
    ],
  });

  assert.deepStrictEqual(
    result.map((item) => item.type),
    ['EQUAL_HIGH', 'H4_SWING_HIGH']
  );
  assert.ok(result[0].priority > result[1].priority);
});

test('importance follows daily weekly equal and swing order', () => {
  const priority = Roadmap.LIQUIDITY_PRIORITY;
  assert.ok(priority.PDH > priority.PWH);
  assert.ok(priority.PWH > priority.EQUAL_HIGH);
  assert.ok(priority.EQUAL_HIGH > priority.H4_SWING_HIGH);
  assert.ok(priority.H4_SWING_HIGH > priority.H1_SWING_HIGH);
  assert.ok(priority.H1_SWING_HIGH > priority.M15_SWING_HIGH);
  assert.ok(priority.M15_SWING_HIGH > priority.LTF_SWING_HIGH);
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
  assert.ok(
    Math.abs(result[0].distanceValue - 0.42) <
      1e-10
  );
  assert.ok(Number.isFinite(result[0].priority));
  assert.strictEqual(result[0].side, 'BUY_SIDE');
  assert.strictEqual(result[0].category, 'PRIMARY_TARGET');
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

test('multiple yesterday highs produce only the newest one', () => {
  const result = Roadmap.analyze({
    currentPrice: 100,
    h4Bias: 'BULLISH',
    liquidity: [{
      type: 'PDH',
      side: 'BUY_SIDE',
      price: 104,
      availableIndex: 10,
    }, {
      type: 'PDH',
      side: 'BUY_SIDE',
      price: 106,
      availableIndex: 20,
    }, {
      type: 'PDH',
      side: 'BUY_SIDE',
      price: 105,
      availableIndex: 15,
    }],
  });

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, 'PDH');
  assert.strictEqual(result[0].price, 106);
});

test('nearby Swing Lows merge into one liquidity zone', () => {
  const result = Roadmap.analyze({
    currentPrice: 100,
    h4Bias: 'BEARISH',
    liquidity: [{
      type: 'M15_SWING_LOW',
      timeframe: '15m',
      side: 'SELL_SIDE',
      price: 95,
      availableIndex: 10,
    }, {
      type: 'M15_SWING_LOW',
      timeframe: '15m',
      side: 'SELL_SIDE',
      price: 95.15,
      availableIndex: 20,
    }, {
      type: 'M15_SWING_LOW',
      timeframe: '15m',
      side: 'SELL_SIDE',
      price: 93,
      availableIndex: 30,
    }],
  });

  assert.strictEqual(result.length, 2);
  const zone = result.find(
    (item) => item.liquidityCount === 2
  );
  assert.ok(zone);
  assert.strictEqual(zone.price, 95);
  assert.strictEqual(zone.zoneLow, 95);
  assert.strictEqual(zone.zoneHigh, 95.15);
  assert.deepStrictEqual(zone.mergedTimeframes, ['15m']);
});

test('higher timeframe covers lower timeframe in same region', () => {
  const result = Roadmap.analyze({
    currentPrice: 100,
    h4Bias: 'BEARISH',
    liquidity: [{
      type: 'LTF_SWING_LOW',
      timeframe: '5m',
      side: 'SELL_SIDE',
      price: 95.1,
      availableIndex: 10,
    }, {
      type: 'H4_SWING_LOW',
      timeframe: '4H',
      side: 'SELL_SIDE',
      price: 95,
      availableIndex: 20,
    }],
  });

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, 'H4_SWING_LOW');
  assert.strictEqual(result[0].timeframe, '4H');
  assert.strictEqual(result[0].liquidityCount, 2);
  assert.deepStrictEqual(
    result[0].mergedTimeframes,
    ['4H', '5m']
  );
});

test('roadmap limits primary targets to three and risks to two', () => {
  const result = Roadmap.analyze({
    currentPrice: 100,
    h4Bias: 'BULLISH',
    liquidity: [
      { type: 'PDH', price: 101 },
      { type: 'PWH', price: 102 },
      {
        type: 'H4_SWING_HIGH',
        price: 103,
      },
      {
        type: 'H1_SWING_HIGH',
        price: 104,
      },
      {
        type: 'M15_SWING_HIGH',
        price: 105,
      },
      { type: 'PDL', price: 99 },
      { type: 'PWL', price: 98 },
      {
        type: 'H4_SWING_LOW',
        price: 97,
      },
    ],
  });

  assert.strictEqual(result.length, 5);
  assert.strictEqual(
    result.filter(
      (item) => item.category === 'PRIMARY_TARGET'
    ).length,
    3
  );
  assert.strictEqual(
    result.filter(
      (item) => item.category === 'COUNTER_RISK'
    ).length,
    2
  );
});

test('prefix analysis is invariant after later inputs are analyzed', () => {
  const prefixLiquidity = [{
    type: 'H4_SWING_HIGH',
    price: 105,
    side: 'BUY_SIDE',
    availableIndex: 10,
  }, {
    type: 'H4_SWING_LOW',
    price: 95,
    side: 'SELL_SIDE',
    availableIndex: 12,
  }];
  const futureLiquidity = prefixLiquidity.concat([{
    type: 'LTF_SWING_HIGH',
    price: 105.1,
    side: 'BUY_SIDE',
    availableIndex: 30,
  }, {
    type: 'PDH',
    price: 110,
    side: 'BUY_SIDE',
    availableIndex: 40,
  }]);
  const prefixBefore = Roadmap.analyze({
    currentPrice: 100,
    h4Bias: 'BULLISH',
    liquidity: prefixLiquidity,
  });

  Roadmap.analyze({
    currentPrice: 100,
    h4Bias: 'BULLISH',
    liquidity: futureLiquidity,
  });
  const prefixAfter = Roadmap.analyze({
    currentPrice: 100,
    h4Bias: 'BULLISH',
    liquidity: prefixLiquidity,
  });

  assert.deepStrictEqual(prefixAfter, prefixBefore);
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
      ['LTF_SWING_LOW', '5m'],
    ]
  );
});

console.log('\n' + testsPassed + ' tests passed.');
