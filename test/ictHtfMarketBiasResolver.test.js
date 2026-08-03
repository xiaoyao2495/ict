'use strict';

const assert = require('assert');
const Resolver = require(
  '../indicators/ictHtfMarketBiasResolver'
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

function h4(values) {
  values = values || {};
  return {
    bias: values.bias || 'NEUTRAL',
    premiumDiscount: values.location || 'UNKNOWN',
    referencePrice: values.price,
    dealingRange: {
      high: values.high,
      low: values.low,
      equilibrium: Number.isFinite(values.high) &&
        Number.isFinite(values.low)
        ? (values.high + values.low) / 2
        : null,
      location: values.location || 'UNKNOWN',
    },
  };
}

function phase(state, values) {
  return {
    state,
    structurePhase: state,
    direction: state.indexOf('BULLISH_') === 0
      ? 'BULLISH'
      : state.indexOf('BEARISH_') === 0
        ? 'BEARISH'
        : null,
    context: 'CONTINUATION',
    transitionPending: false,
    ...(values || {}),
  };
}

test('Continuation and Confirmed phases keep direction', () => {
  const cases = [
    ['BULLISH_CONTINUATION', 'BULLISH'],
    ['BULLISH_CONFIRMED', 'BULLISH'],
    ['BEARISH_CONTINUATION', 'BEARISH'],
    ['BEARISH_CONFIRMED', 'BEARISH'],
  ];
  for (const [state, direction] of cases) {
    const result = Resolver.analyze({
      h4Bias: h4({
        location: direction === 'BULLISH'
          ? 'PREMIUM'
          : 'DISCOUNT',
        high: 120,
        low: 80,
        price: 110,
      }),
      structurePhase: phase(state),
    });
    assert.strictEqual(result.marketBias, direction);
    assert.strictEqual(result.legacyBias, direction);
    assert.strictEqual(result.transitionDirection, null);
  }
});

test('MSS becomes neutral and preserves transition context', () => {
  const result = Resolver.analyze({
    h4Bias: h4({
      bias: 'BEARISH',
      location: 'PREMIUM',
      high: 120,
      low: 80,
      price: 110,
    }),
    structurePhase: phase('BULLISH_MSS', {
      context: 'POST_MSS',
      transitionPending: true,
    }),
  });

  assert.strictEqual(result.marketBias, 'NEUTRAL');
  assert.strictEqual(result.legacyBias, 'BEARISH');
  assert.strictEqual(result.transitionDirection, 'BULLISH');
});

test('Pullback distinguishes POST_MSS and CONTINUATION', () => {
  const postMss = Resolver.analyze({
    h4Bias: h4({ bias: 'BEARISH' }),
    structurePhase: phase('BULLISH_PULLBACK', {
      context: 'POST_MSS',
      transitionPending: true,
    }),
  });
  const continuation = Resolver.analyze({
    h4Bias: h4({ bias: 'NEUTRAL' }),
    structurePhase: phase('BEARISH_PULLBACK', {
      context: 'CONTINUATION',
      transitionPending: false,
    }),
  });

  assert.deepStrictEqual(
    [
      postMss.marketBias,
      postMss.legacyBias,
      postMss.transitionDirection,
    ],
    ['NEUTRAL', 'BEARISH', 'BULLISH']
  );
  assert.deepStrictEqual(
    [
      continuation.marketBias,
      continuation.legacyBias,
      continuation.transitionDirection,
    ],
    ['BEARISH', 'BEARISH', null]
  );
});

test('phase history supplies legacy Bias before POST_MSS', () => {
  const result = Resolver.analyze({
    h4Bias: h4({ bias: 'BULLISH' }),
    structurePhase: {
      current: phase('BULLISH_PULLBACK', {
        context: 'POST_MSS',
        transitionPending: true,
        availableIndex: 8,
        mssEvent: { availableIndex: 6 },
      }),
      states: [
        phase('BEARISH_CONTINUATION', {
          availableIndex: 4,
        }),
        phase('BULLISH_MSS', {
          context: 'POST_MSS',
          transitionPending: true,
          availableIndex: 6,
        }),
      ],
    },
  });

  assert.strictEqual(result.marketBias, 'NEUTRAL');
  assert.strictEqual(result.legacyBias, 'BEARISH');
  assert.strictEqual(result.transitionDirection, 'BULLISH');
});

test('ETH shadow case retains Bullish context in Premium', () => {
  const result = Resolver.analyze({
    h4Bias: h4({
      bias: 'NEUTRAL',
      location: 'PREMIUM',
      high: 1885,
      low: 1820.61,
      price: 1884.37,
    }),
    structurePhase: phase('BULLISH_CONTINUATION'),
  });

  assert.strictEqual(result.marketBias, 'BULLISH');
  assert.strictEqual(result.location.state, 'PREMIUM');
  assert.strictEqual(
    result.location.relationToRange,
    'INSIDE'
  );
  assert.strictEqual(result.htfLocationReadiness, 'WAIT');
});

test('CL shadow case retains Bearish context in Discount', () => {
  const result = Resolver.analyze({
    h4Bias: h4({
      bias: 'NEUTRAL',
      location: 'DISCOUNT',
      high: 88.17,
      low: 80,
      price: 80.77,
    }),
    structurePhase: phase('BEARISH_CONTINUATION'),
  });

  assert.strictEqual(result.marketBias, 'BEARISH');
  assert.strictEqual(result.location.state, 'DISCOUNT');
  assert.strictEqual(result.htfLocationReadiness, 'WAIT');
});

test('SNDK shadow case exposes Bullish transition', () => {
  const result = Resolver.analyze({
    h4Bias: h4({
      bias: 'BEARISH',
      location: 'PREMIUM',
      high: 1229.93,
      low: 1167.42,
      price: 1243.06,
    }),
    structurePhase: phase('BULLISH_PULLBACK', {
      context: 'POST_MSS',
      transitionPending: true,
    }),
  });

  assert.strictEqual(result.marketBias, 'NEUTRAL');
  assert.strictEqual(result.legacyBias, 'BEARISH');
  assert.strictEqual(result.transitionDirection, 'BULLISH');
  assert.strictEqual(
    result.location.relationToRange,
    'ABOVE_RANGE'
  );
  assert.strictEqual(result.htfLocationReadiness, 'WAIT');
});

test('location reports below range and readiness is causal', () => {
  const below = Resolver.analyze({
    h4Bias: h4({
      location: 'DISCOUNT',
      high: 120,
      low: 80,
      price: 75,
    }),
    structurePhase: phase('BULLISH_CONTINUATION'),
  });
  const ready = Resolver.analyze({
    h4Bias: h4({
      location: 'DISCOUNT',
      high: 120,
      low: 80,
      price: 90,
    }),
    structurePhase: phase('BULLISH_CONTINUATION'),
  });

  assert.strictEqual(
    below.location.relationToRange,
    'BELOW_RANGE'
  );
  assert.strictEqual(below.htfLocationReadiness, 'WAIT');
  assert.strictEqual(ready.htfLocationReadiness, 'READY');
});

test('raw V3 and Structure Phase analysis outputs are accepted', () => {
  const result = Resolver.analyze({
    h4Bias: {
      states: [{
        referencePrice: 90,
        dealingRange: {
          high: 120,
          low: 80,
          equilibrium: 100,
          location: 'DISCOUNT',
        },
        narrative: { bias: 'NEUTRAL' },
      }],
    },
    structurePhase: {
      current: phase('BULLISH_CONFIRMED'),
      states: [],
    },
  });

  assert.strictEqual(result.marketBias, 'BULLISH');
  assert.strictEqual(result.htfLocationReadiness, 'READY');
});

test('missing context returns a safe neutral shadow state', () => {
  assert.deepStrictEqual(Resolver.analyze(), {
    marketBias: 'NEUTRAL',
    legacyBias: null,
    transitionDirection: null,
    structurePhase: 'UNDETERMINED',
    location: {
      state: 'UNKNOWN',
      rangeHigh: null,
      rangeLow: null,
      equilibrium: null,
      relationToRange: 'UNKNOWN',
    },
    htfLocationReadiness: 'WAIT',
  });
});

test('resolver does not mutate input or old Bias', () => {
  const input = {
    h4Bias: h4({
      bias: 'NEUTRAL',
      location: 'PREMIUM',
      high: 120,
      low: 80,
      price: 110,
    }),
    structurePhase: phase('BULLISH_CONTINUATION'),
  };
  const before = JSON.stringify(input);

  Resolver.analyze(input);

  assert.strictEqual(JSON.stringify(input), before);
  assert.strictEqual(input.h4Bias.bias, 'NEUTRAL');
});

console.log('\n' + testsPassed + ' tests passed.');
