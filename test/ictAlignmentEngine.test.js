'use strict';

const assert = require('assert');
const Alignment = require(
  '../indicators/ictAlignmentEngine'
);
const WatchlistReport = require(
  '../indicators/ictWatchlistAnalystReport'
);

const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function input(overrides) {
  return {
    h4Bias: 'BULLISH',
    m15DeliveryDirection: 'BULLISH',
    m15Relation: 'ALIGNED',
    fiveMinuteConfirmationDirection: 'BULLISH',
    fiveMinuteConfirmationStatus: 'CONFIRMED',
    ...(overrides || {}),
  };
}

test('Bullish multi-timeframe agreement is ALIGNED', () => {
  assert.deepStrictEqual(
    Alignment.analyze(input()),
    {
      status: 'ALIGNED',
      direction: 'BULLISH',
      reason:
        '4H bullish bias + 15m bullish delivery + 5m bullish confirmation',
    }
  );
});

test('Bearish multi-timeframe agreement is ALIGNED', () => {
  assert.deepStrictEqual(
    Alignment.analyze(input({
      h4Bias: 'BEARISH',
      m15DeliveryDirection: 'BEARISH',
      fiveMinuteConfirmationDirection: 'BEARISH',
    })),
    {
      status: 'ALIGNED',
      direction: 'BEARISH',
      reason:
        '4H bearish bias + 15m bearish delivery + 5m bearish confirmation',
    }
  );
});

test('Bearish 4H with Bullish 5m is CONFLICT', () => {
  assert.deepStrictEqual(
    Alignment.analyze(input({
      h4Bias: 'BEARISH',
      m15DeliveryDirection: 'BEARISH',
      fiveMinuteConfirmationDirection: 'BULLISH',
    })),
    {
      status: 'CONFLICT',
      direction: null,
      reason: '4H bearish but 5m bullish confirmation',
    }
  );
});

test('Bullish 4H with Bearish 5m is CONFLICT', () => {
  assert.deepStrictEqual(
    Alignment.analyze(input({
      fiveMinuteConfirmationDirection: 'BEARISH',
    })),
    {
      status: 'CONFLICT',
      direction: null,
      reason: '4H bullish but 5m bearish confirmation',
    }
  );
});

test('HTF direction with incomplete lower timeframe is WAITING', () => {
  assert.deepStrictEqual(
    Alignment.analyze(input({
      h4Bias: 'BEARISH',
      m15DeliveryDirection: 'NEUTRAL',
      m15Relation: 'RETRACEMENT',
      fiveMinuteConfirmationDirection: null,
      fiveMinuteConfirmationStatus: 'NONE',
    })),
    {
      status: 'WAITING',
      direction: null,
      reason:
        'Higher timeframe direction exists but lower timeframe confirmation is incomplete',
    }
  );
});

test('Neutral 4H is WAITING without forced direction', () => {
  assert.deepStrictEqual(
    Alignment.analyze(input({
      h4Bias: 'NEUTRAL',
      m15DeliveryDirection: 'NEUTRAL',
      fiveMinuteConfirmationDirection: null,
      fiveMinuteConfirmationStatus: 'NONE',
    })),
    {
      status: 'WAITING',
      direction: null,
      reason: 'HTF bias is unclear',
    }
  );
});

test('Watchlist report projection adds alignment only', () => {
  const snapshot = {
    index: 10,
    availableIndex: 10,
    asOf: 1000,
    fourHourAnalysis: {
      bias: 'BULLISH',
    },
    oneHourAnalysis: {
      deliveryDirection: 'BULLISH',
      deliveryState: 'ALIGNED_BULLISH',
      relationToH4: 'ALIGNED',
    },
    fiveMinuteObservation: {
      currentConfirmed: {
        liquiditySweeps: [],
        mss: null,
        displacement: null,
      },
      latestConfirmed: {
        liquiditySweep: null,
        mss: null,
        displacement: null,
      },
      potentialObservation: {
        state: 'NONE',
      },
    },
  };
  const normalized = WatchlistReport.normalizeSnapshot(
    snapshot,
    {
      currentConfirmation: null,
      latestConfirmation: null,
    }
  );

  assert.deepStrictEqual(normalized.alignment, {
    status: 'WAITING',
    direction: null,
    reason:
      'Higher timeframe direction exists but lower timeframe confirmation is incomplete',
  });
  assert.strictEqual(
    normalized.fourHourAnalysis.bias,
    'BULLISH'
  );
  assert.strictEqual(
    normalized.fifteenMinuteAnalysis.deliveryDirection,
    'BULLISH'
  );
});

(async () => {
  for (const item of tests) {
    try {
      await item.callback();
      testsPassed += 1;
      console.log('PASS:', item.name);
    } catch (error) {
      console.error('FAIL:', item.name);
      throw error;
    }
  }
  console.log('\n' + testsPassed + ' tests passed.');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
