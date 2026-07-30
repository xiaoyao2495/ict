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
      reason: '4小时与5分钟方向一致：偏多',
    }
  );
});

test('Bearish multi-timeframe agreement is ALIGNED', () => {
  assert.deepStrictEqual(
    Alignment.analyze(input({
      h4Bias: 'BEARISH',
      fiveMinuteConfirmationDirection: 'BEARISH',
    })),
    {
      status: 'ALIGNED',
      direction: 'BEARISH',
      reason: '4小时与5分钟方向一致：偏空',
    }
  );
});

test('legacy 15m fields do not affect Alignment', () => {
  assert.deepStrictEqual(
    Alignment.analyze({
      ...input(),
      m15DeliveryDirection: 'BEARISH',
      m15Relation: 'RETRACEMENT',
    }),
    {
      status: 'ALIGNED',
      direction: 'BULLISH',
      reason: '4小时与5分钟方向一致：偏多',
    }
  );
});

test('Bearish 4H with Bullish 5m is CONFLICT', () => {
  assert.deepStrictEqual(
    Alignment.analyze(input({
      h4Bias: 'BEARISH',
      fiveMinuteConfirmationDirection: 'BULLISH',
    })),
    {
      status: 'CONFLICT',
      direction: null,
      reason: '4小时偏空，但5分钟确认偏多',
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
      reason: '4小时偏多，但5分钟确认偏空',
    }
  );
});

test('HTF direction with incomplete lower timeframe is WAITING', () => {
  assert.deepStrictEqual(
    Alignment.analyze(input({
      h4Bias: 'BEARISH',
      fiveMinuteConfirmationDirection: null,
      fiveMinuteConfirmationStatus: 'NONE',
    })),
    {
      status: 'WAITING',
      direction: null,
      reason: '等待5分钟确认',
    }
  );
});

test('Neutral 4H is WAITING without forced direction', () => {
  assert.deepStrictEqual(
    Alignment.analyze(input({
      h4Bias: 'NEUTRAL',
      fiveMinuteConfirmationDirection: null,
      fiveMinuteConfirmationStatus: 'NONE',
    })),
    {
      status: 'WAITING',
      direction: null,
      reason: '等待4小时方向明确',
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
    reason: '等待5分钟确认',
  });
  assert.strictEqual(
    normalized.fourHourAnalysis.bias,
    'BULLISH'
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      normalized,
      'fifteenMinuteAnalysis'
    ),
    false
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
