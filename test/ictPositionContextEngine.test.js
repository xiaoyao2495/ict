'use strict';

const assert = require('assert');
const PositionContext = require(
  '../indicators/ictPositionContextEngine'
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

function range() {
  return {
    high: 120,
    low: 80,
    equilibrium: 100,
    location: 'DISCOUNT',
  };
}

test('current price determines premium and discount zones', () => {
  assert.strictEqual(
    PositionContext.analyze({
      currentPrice: 110,
      structureRange: range(),
      premiumDiscount: 'DISCOUNT',
      liquidityRoadmap: [],
    }).positionZone,
    'PREMIUM'
  );
  assert.strictEqual(
    PositionContext.analyze({
      currentPrice: 90,
      structureRange: range(),
      premiumDiscount: 'PREMIUM',
      liquidityRoadmap: [],
    }).positionZone,
    'DISCOUNT'
  );
  assert.strictEqual(
    PositionContext.analyze({
      currentPrice: 100,
      structureRange: range(),
      liquidityRoadmap: [],
    }).positionZone,
    'EQUILIBRIUM'
  );
});

test('premiumDiscount is fallback when range is unavailable', () => {
  const result = PositionContext.analyze({
    currentPrice: 100,
    structureRange: null,
    premiumDiscount: 'PREMIUM',
    liquidityRoadmap: [],
  });

  assert.strictEqual(result.positionZone, 'PREMIUM');
});

test('nearest liquidity is recalculated instead of taking first', () => {
  const result = PositionContext.analyze({
    currentPrice: 100,
    structureRange: range(),
    liquidityRoadmap: [{
      type: 'PWH',
      side: 'BUY_SIDE',
      price: 110,
      distancePercent: 10,
      priority: 6,
    }, {
      type: 'PDL',
      side: 'SELL_SIDE',
      price: 99,
      distancePercent: 1,
      priority: 7,
    }],
  });

  assert.strictEqual(result.nearestLiquidity.type, 'PDL');
  assert.strictEqual(result.nearestLiquidity.distanceValue, 1);
  assert.strictEqual(result.distanceValue, 1);
  assert.strictEqual(result.distancePercent, 1);
});

test('nearby liquidity warns against chasing', () => {
  const result = PositionContext.analyze({
    currentPrice: 100,
    structureRange: range(),
    liquidityRoadmap: [{
      type: 'PDH',
      side: 'BUY_SIDE',
      price: 100.42,
      priority: 7,
    }],
  });

  assert.ok(result.context.includes(
    '价格接近上方买方流动性，不适合追单。'
  ));
});

test('distant lower sell-side liquidity explains context', () => {
  const result = PositionContext.analyze({
    currentPrice: 110,
    structureRange: range(),
    liquidityRoadmap: [{
      type: 'PDL',
      side: 'SELL_SIDE',
      price: 100,
      priority: 7,
    }],
  });

  assert.strictEqual(
    result.context,
    '价格位于溢价区，距离下方卖方流动性较远。'
  );
});

test('missing liquidity produces an explicit context', () => {
  const result = PositionContext.analyze({
    currentPrice: 90,
    structureRange: range(),
    liquidityRoadmap: [],
  });

  assert.strictEqual(result.nearestLiquidity, null);
  assert.strictEqual(result.distanceValue, null);
  assert.strictEqual(result.distancePercent, null);
  assert.strictEqual(
    result.context,
    '价格位于折价区，暂无明确的主要流动性目标。'
  );
});

test('analysis does not mutate range or roadmap', () => {
  const structureRange = range();
  const liquidityRoadmap = [{
    type: 'EQUAL_HIGH',
    side: 'BUY_SIDE',
    price: 105,
    priority: 5,
  }];
  const original = JSON.parse(JSON.stringify({
    structureRange,
    liquidityRoadmap,
  }));

  PositionContext.analyze({
    currentPrice: 100,
    structureRange,
    liquidityRoadmap,
  });

  assert.deepStrictEqual(
    { structureRange, liquidityRoadmap },
    original
  );
});

test('invalid current price is rejected', () => {
  assert.throws(
    () => PositionContext.analyze({
      currentPrice: 0,
      liquidityRoadmap: [],
    }),
    /currentPrice/
  );
});

console.log('\n' + testsPassed + ' tests passed.');
