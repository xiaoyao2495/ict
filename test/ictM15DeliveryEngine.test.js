'use strict';

const assert = require('assert');
const M15Delivery = require(
  '../indicators/ictM15DeliveryEngine'
);

const START = Date.UTC(2026, 0, 1);
const tests = [];
let testsPassed = 0;

function test(name, callback) {
  tests.push({ name, callback });
}

function confirmation(overrides) {
  return {
    h4Bias: 'BULLISH',
    retracementState: 'BEARISH',
    sweep: {
      side: 'SELL_SIDE',
      type: 'LTF_SWING_LOW',
    },
    mss: {
      direction: 'BULLISH',
      level: { label: 'LH', price: 101 },
    },
    displacement: {
      direction: 'BULLISH',
      strength: 2,
    },
    ...(overrides || {}),
  };
}

function bars(length) {
  return Array.from({ length }, (_, index) => {
    const center = 100 +
      Math.sin(index / 5) * 4 +
      Math.sin(index / 2) * 0.8;
    const open = center + (index % 2 ? -0.2 : 0.2);
    const close = center + (index % 2 ? 0.3 : -0.3);
    return {
      openTime: START +
        index * M15Delivery.FIFTEEN_MINUTES,
      closeTime: START +
        (index + 1) * M15Delivery.FIFTEEN_MINUTES - 1,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 1,
    };
  });
}

function h4Snapshots(klines, bias) {
  return [{
    index: 0,
    availableIndex: 0,
    time: klines[0].closeTime,
    bias,
    liquidity: {
      buySideLiquidity: [],
      sellSideLiquidity: [],
    },
  }];
}

test(
  '4H bullish + 15m SSL sweep + bullish MSS + displacement confirms bullish delivery',
  () => {
    assert.strictEqual(
      M15Delivery.evaluateDeliveryConfirmation(
        confirmation()
      ),
      'BULLISH'
    );
  }
);

test(
  '4H bearish + 15m BSL sweep + bearish MSS + displacement confirms bearish delivery',
  () => {
    assert.strictEqual(
      M15Delivery.evaluateDeliveryConfirmation(
        confirmation({
          h4Bias: 'BEARISH',
          retracementState: 'BULLISH',
          sweep: {
            side: 'BUY_SIDE',
            type: 'LTF_SWING_HIGH',
          },
          mss: {
            direction: 'BEARISH',
            level: { label: 'HL', price: 99 },
          },
          displacement: {
            direction: 'BEARISH',
            strength: 2,
          },
        })
      ),
      'BEARISH'
    );
  }
);

test('15m Sweep without MSS does not confirm direction', () => {
  assert.strictEqual(
    M15Delivery.evaluateDeliveryConfirmation(
      confirmation({ mss: null })
    ),
    null
  );
});

test('15m MSS without displacement does not confirm', () => {
  assert.strictEqual(
    M15Delivery.evaluateDeliveryConfirmation(
      confirmation({ displacement: null })
    ),
    null
  );
});

test('MSS level is the latest confirmed LH before the Sweep', () => {
  const selected = M15Delivery.latestPreSweepLevel({
    swingSequence: [
      {
        label: 'LH',
        price: 105,
        availableIndex: 4,
      },
      {
        label: 'LH',
        price: 103,
        availableIndex: 8,
      },
      {
        label: 'LH',
        price: 101,
        availableIndex: 10,
      },
    ],
  }, 'LH', 10);

  assert.strictEqual(selected.price, 103);
  assert.strictEqual(selected.availableIndex, 8);
});

test('15m analysis is prefix invariant', () => {
  const complete = bars(140);
  const prefixLength = 110;
  const prefix = complete.slice(0, prefixLength);
  const prefixResult = M15Delivery.analyze15mDelivery({
    m15Klines: prefix,
    h4BiasSnapshots: h4Snapshots(prefix, 'BULLISH'),
  });
  const fullResult = M15Delivery.analyze15mDelivery({
    m15Klines: complete,
    h4BiasSnapshots: h4Snapshots(complete, 'BULLISH'),
  });

  assert.deepStrictEqual(
    fullResult.states.slice(0, prefixLength),
    prefixResult.states
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
