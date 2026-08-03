'use strict';

const assert = require('assert');
const DailyBias = require(
  '../indicators/ictHtfDailyBiasEngineV1'
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

function phase(state, values) {
  return {
    state,
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

function inputFor(state, values) {
  values = values || {};
  const price = Number.isFinite(values.price)
    ? values.price
    : 110;
  return {
    structurePhase: phase(state, values.phase),
    htfBiasState: {
      bias: values.legacyBias || 'NEUTRAL',
      referencePrice: price,
    },
    dealingRange: {
      high: 120,
      low: 80,
      equilibrium: 100,
      location: values.location || 'PREMIUM',
    },
    liquidity: {
      buySideLiquidity: [{
        type: 'PDH',
        side: 'BUY_SIDE',
        price: 125,
        status: 'ACTIVE',
        availableIndex: 8,
      }],
      sellSideLiquidity: [{
        type: 'PDL',
        side: 'SELL_SIDE',
        price: 75,
        status: 'ACTIVE',
        availableIndex: 8,
      }],
    },
  };
}

test('Bullish Continuation stays Bullish in Premium', () => {
  const result = DailyBias.analyze(inputFor(
    'BULLISH_CONTINUATION',
    { location: 'PREMIUM', legacyBias: 'NEUTRAL' }
  ));

  assert.strictEqual(result.marketBias, 'BULLISH');
  assert.strictEqual(result.transitionDirection, null);
  assert.strictEqual(result.location.state, 'PREMIUM');
  assert.strictEqual(result.htfLocationReadiness, 'WAIT');
  assert.deepStrictEqual(result.drawOnLiquidity, {
    side: 'BUY_SIDE',
    type: 'PDH',
    price: 125,
    availableIndex: 8,
    distancePercent: 13.636363636363635,
  });
});

test('Bearish Continuation stays Bearish in Discount', () => {
  const result = DailyBias.analyze(inputFor(
    'BEARISH_CONTINUATION',
    { location: 'DISCOUNT', price: 90 }
  ));

  assert.strictEqual(result.marketBias, 'BEARISH');
  assert.strictEqual(result.transitionDirection, null);
  assert.strictEqual(result.location.state, 'DISCOUNT');
  assert.strictEqual(result.htfLocationReadiness, 'WAIT');
  assert.strictEqual(result.drawOnLiquidity.side, 'SELL_SIDE');
  assert.strictEqual(result.drawOnLiquidity.type, 'PDL');
});

test('Bullish MSS is Neutral with Bullish transition', () => {
  const result = DailyBias.analyze(inputFor(
    'BULLISH_MSS',
    {
      legacyBias: 'BEARISH',
      phase: {
        context: 'POST_MSS',
        transitionPending: true,
      },
    }
  ));

  assert.strictEqual(result.marketBias, 'NEUTRAL');
  assert.strictEqual(result.legacyBias, 'BEARISH');
  assert.strictEqual(result.transitionDirection, 'BULLISH');
  assert.strictEqual(result.drawOnLiquidity, null);
});

test('Bearish MSS is Neutral with Bearish transition', () => {
  const result = DailyBias.analyze(inputFor(
    'BEARISH_MSS',
    {
      legacyBias: 'BULLISH',
      phase: {
        context: 'POST_MSS',
        transitionPending: true,
      },
    }
  ));

  assert.strictEqual(result.marketBias, 'NEUTRAL');
  assert.strictEqual(result.legacyBias, 'BULLISH');
  assert.strictEqual(result.transitionDirection, 'BEARISH');
});

test('POST_MSS Pullback remains Neutral', () => {
  const result = DailyBias.analyze(inputFor(
    'BULLISH_PULLBACK',
    {
      legacyBias: 'BEARISH',
      phase: {
        context: 'POST_MSS',
        transitionPending: true,
      },
    }
  ));

  assert.strictEqual(result.marketBias, 'NEUTRAL');
  assert.strictEqual(result.legacyBias, 'BEARISH');
  assert.strictEqual(result.transitionDirection, 'BULLISH');
});

test('CONTINUATION Pullback keeps its direction', () => {
  const bullish = DailyBias.analyze(inputFor(
    'BULLISH_PULLBACK',
    {
      location: 'DISCOUNT',
      price: 90,
      phase: {
        context: 'CONTINUATION',
        transitionPending: false,
      },
    }
  ));
  const bearish = DailyBias.analyze(inputFor(
    'BEARISH_PULLBACK',
    {
      phase: {
        context: 'CONTINUATION',
        transitionPending: false,
      },
    }
  ));

  assert.strictEqual(bullish.marketBias, 'BULLISH');
  assert.strictEqual(bullish.htfLocationReadiness, 'READY');
  assert.strictEqual(bearish.marketBias, 'BEARISH');
  assert.strictEqual(bearish.htfLocationReadiness, 'READY');
});

test('Structure timeline supplies pre-transition legacy Bias', () => {
  const input = inputFor('BULLISH_PULLBACK', {
    legacyBias: 'NEUTRAL',
    phase: {
      context: 'POST_MSS',
      transitionPending: true,
      availableIndex: 12,
      mssEvent: { availableIndex: 10 },
    },
  });
  input.structureTimeline = [
    phase('BEARISH_CONTINUATION', {
      availableIndex: 8,
    }),
    phase('BULLISH_MSS', {
      context: 'POST_MSS',
      transitionPending: true,
      availableIndex: 10,
    }),
  ];

  const result = DailyBias.analyze(input);

  assert.strictEqual(result.legacyBias, 'BEARISH');
  assert.strictEqual(result.transitionDirection, 'BULLISH');
});

test('Price outside range is WAIT without changing Bias', () => {
  const result = DailyBias.analyze(inputFor(
    'BULLISH_CONFIRMED',
    { location: 'PREMIUM', price: 125 }
  ));

  assert.strictEqual(result.marketBias, 'BULLISH');
  assert.strictEqual(
    result.location.relationToRange,
    'ABOVE_RANGE'
  );
  assert.strictEqual(result.htfLocationReadiness, 'WAIT');
});

test('Engine does not mutate input', () => {
  const input = inputFor('BEARISH_CONFIRMED', {
    location: 'PREMIUM',
  });
  const before = JSON.stringify(input);

  DailyBias.analyze(input);

  assert.strictEqual(JSON.stringify(input), before);
});

test('Missing data returns a safe neutral shadow result', () => {
  const result = DailyBias.analyze();

  assert.strictEqual(result.marketBias, 'NEUTRAL');
  assert.strictEqual(result.legacyBias, null);
  assert.strictEqual(result.transitionDirection, null);
  assert.strictEqual(result.structureState, 'UNDETERMINED');
  assert.strictEqual(result.drawOnLiquidity, null);
  assert.strictEqual(result.location.state, 'UNKNOWN');
  assert.strictEqual(result.htfLocationReadiness, 'WAIT');
  assert.ok(Array.isArray(result.reasons));
});

console.log('\n' + testsPassed + ' tests passed.');
